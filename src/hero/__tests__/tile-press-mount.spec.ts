/**
 * @vitest-environment jsdom
 *
 * The pressable scene tile of a row, mounted: a press sends the command and
 * changes nothing visible until the device REPORTS; a report settles it; no
 * report reverts after 10 s; a refused call reverts; a stale error left by
 * another control of the row never fails a fresh press.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import React, { useState } from 'react'
import type { HeroAction, HeroControl, HeroRowModel } from '@camstack/types'
import { mountScreen } from '../../testing/mount.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { HeroRowBody } from '../HeroRowBody.js'
import { SETTLE_TIMEOUT_MS } from '../tile-press.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

const act_ = (id: string, cap: string, method: string): HeroAction => ({
  id,
  label: { en: id, it: id },
  icon: 'power',
  call: { cap, method, args: {} },
  emphasis: 'normal',
  confirm: null,
})

const power = (on: boolean): HeroControl => ({
  kind: 'toggle',
  id: 'own-power',
  label: { en: 'Power', it: 'Power' },
  on,
  turnOn: act_('own-power.on', 'switch', 'turnOn'),
  turnOff: act_('own-power.off', 'switch', 'turnOff'),
})

const light = (on: boolean): HeroRowModel =>
  ({
    deviceId: 4,
    name: 'Lamp',
    type: 'light',
    state: on ? 'on' : 'off',
    stateAssumed: false,
    look: { icon: 'lightbulb', tone: on ? 'warning' : 'muted', background: 'plain', animation: 'none' },
    scene: { id: 'generic', mode: null, level: null },
    statusLine: [],
    primary: power(on),
    extras: [],
    timedRun: null,
    trailing: null,
  }) as HeroRowModel

let setModel: (m: HeroRowModel) => void = () => undefined

function Harness({ initial }: { readonly initial: HeroRowModel }): React.JSX.Element {
  const [model, set] = useState(initial)
  setModel = set
  return React.createElement(HeroRowBody, { deviceId: 4, name: 'Lamp', online: true, model, onOpen: () => undefined, openLabel: 'Open' })
}

const HUB = { 'auth.me': { id: 'u', username: 'op', isAdmin: true }, 'switch.turnOff': undefined, 'switch.turnOn': undefined }
const sent = (path: string): number => hubCalls().filter((c) => c.path === path).length
const press = (): void => {
  fireEvent.click(screen.getByTestId('hero-row-scene-4-press'))
}
const ring = (): HTMLElement | null => screen.queryByTestId('hero-row-scene-4-ring')

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('the pressable tile', () => {
  it('sends the command, shows a spinner, and settles only when the device reports', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
    mountScreen(React.createElement(Harness, { initial: light(true) }), { hub: HUB })
    await flush(10)
    expect(ring()).toBeNull()
    press()
    await flush(10)
    expect(sent('switch.turnOff')).toBe(1)
    expect(ring()).not.toBeNull()
    await flush(3000)
    expect(ring()).not.toBeNull() // nothing reported: still waiting, never optimistic
    act(() => setModel(light(false)))
    await flush(10)
    expect(ring()).toBeNull()
  })

  it('reverts when the device never reports within the timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
    mountScreen(React.createElement(Harness, { initial: light(true) }), { hub: HUB })
    await flush(10)
    press()
    await flush(SETTLE_TIMEOUT_MS - 100)
    expect(ring()).not.toBeNull()
    await flush(200)
    expect(ring()).toBeNull()
  })

  it('reverts when the call is refused', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
    mountScreen(
      React.createElement(Harness, { initial: light(true) }),
      { hub: { ...HUB, 'switch.turnOff': () => { throw new Error('refused') } } },
    )
    await flush(10)
    press()
    await flush(50)
    expect(sent('switch.turnOff')).toBe(1)
    expect(ring()).toBeNull()
  })
})

describe('a stale error from another control of the row', () => {
  it('does not fail a fresh tile press', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] })
    const run: HeroControl = { kind: 'action', action: { ...act_('automation.run', 'automation', 'run'), label: { en: 'Run now', it: 'Run now' } } }
    const enabled: HeroControl = {
      kind: 'toggle',
      id: 'automation.enabled',
      label: { en: 'Enabled', it: 'Enabled' },
      on: true,
      turnOn: act_('automation.enable', 'automation', 'enable'),
      turnOff: act_('automation.disable', 'automation', 'disable'),
    }
    const model = { ...light(true), type: 'automation', primary: run, extras: [enabled] } as HeroRowModel
    mountScreen(
      React.createElement(Harness, { initial: model }),
      { hub: { ...HUB, 'automation.run': () => { throw new Error('run refused') }, 'automation.disable': undefined } },
    )
    await flush(10)
    fireEvent.click(screen.getByLabelText('Run now'))
    await flush(50)
    expect(sent('automation.run')).toBe(1)
    press()
    await flush(50)
    expect(sent('automation.disable')).toBe(1)
    expect(ring()).not.toBeNull() // the old refusal did not fail THIS press
  })
})
