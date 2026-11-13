/**
 * @vitest-environment jsdom
 *
 * A row draws the hub's `primary` then its `extras`; a `remote.open` action is a
 * remote button, never sent to the hub. An older hub sends no `extras`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import React from 'react'
import type { HeroAction, HeroControl, HeroRowModel } from '@camstack/types'
import { mountScreen } from '../../testing/mount.js'
import { HeroRowBody, rowControls } from '../HeroRowBody.js'
import { routerCalls } from '../../testing/native-stubs/expo-router.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => cleanup())

const base: HeroRowModel = {
  deviceId: 4,
  name: 'TV',
  type: 'media-player',
  state: 'on',
  stateAssumed: false,
  look: { icon: 'tv', tone: 'success', background: 'plain', animation: 'none' },
  scene: { id: 'generic', mode: null, level: null },
  statusLine: [],
  primary: null,
  timedRun: null,
  trailing: null,
}

const act = (id: string): HeroAction => ({
  id,
  label: { en: id, it: id },
  icon: 'power',
  call: { cap: 'remote', method: id, args: {} },
  emphasis: 'normal',
  confirm: null,
})

const remote: HeroControl = { kind: 'action', action: act('remote.open') }

describe('rowControls', () => {
  it('an older hub (no extras) draws the primary alone', () => {
    expect(rowControls({ ...base, primary: remote })).toHaveLength(1)
  })
  it('primary then extras, in order', () => {
    const extra: HeroControl = { kind: 'action', action: act('other') }
    expect(rowControls({ ...base, primary: extra, extras: [remote] }).map((c) => (c.kind === 'action' ? c.action.id : c.id))).toEqual(['other', 'remote.open'])
  })
  it('no primary, no controls', () => {
    expect(rowControls({ ...base, extras: [remote] })).toEqual([])
  })
})

describe('the remote extra', () => {
  it('opens the remote screen', () => {
    mountScreen(
      React.createElement(HeroRowBody, { deviceId: 4, name: 'TV', online: true, model: { ...base, primary: remote, extras: [] }, onOpen: () => undefined, openLabel: 'Open' }),
      { hub: {} },
    )
    fireEvent.click(screen.getByTestId('hero-row-remote-4'))
    const calls = routerCalls()
    expect(calls).toHaveLength(1)
    expect(JSON.stringify(calls[0])).toContain('4')
  })
})

describe('an automation row', () => {
  const enabled = (on: boolean): HeroControl => ({
    kind: 'toggle',
    id: 'automation.enabled',
    label: { en: 'Enabled', it: 'Attiva' },
    on,
    turnOn: act('automation.enable'),
    turnOff: act('automation.disable'),
  })
  const run: HeroControl = { kind: 'action', action: { ...act('automation.run'), label: { en: 'Run now', it: 'Esegui ora' } } }

  it('draws Run now and the enabled switch once each, the switch named by what it does', () => {
    mountScreen(
      React.createElement(HeroRowBody, {
        deviceId: 4,
        name: 'Night light',
        online: true,
        model: { ...base, type: 'automation', primary: run, extras: [enabled(true)] },
        onOpen: () => undefined,
        openLabel: 'Open',
      }),
      { hub: {} },
    )
    expect(screen.getAllByTestId('hero-action-automation.run')).toHaveLength(1)
    const power = screen.getAllByTestId('hero-power-automation.enabled')
    expect(power).toHaveLength(1)
    expect(power[0]?.getAttribute('aria-label')).toBe('automation.disable')
  })
})
