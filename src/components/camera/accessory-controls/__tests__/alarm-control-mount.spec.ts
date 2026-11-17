/**
 * @vitest-environment jsdom
 *
 * The alarm control, mounted over the real hooks with only the wire faked.
 *
 * What only a mount can say:
 *  - Arm anyway sends `nc.armAlarmAnyway` with THE refusal id the card showed,
 *    once per press however fast the second tap comes, and an arm that
 *    excluded devices names them;
 *  - Disarm on a SOUNDING panel is pressable while the role is still unanswered,
 *    and goes through the device cap (C1).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
import React from 'react'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'

import { mountScreen } from '../../../../testing/mount.js'
import { hubCalls } from '../../../../testing/hub-stub.js'
import { AlarmControl } from '../controls-alarm.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const PANEL = 1201

function field(input: unknown, key: string): unknown {
  if (input === null || typeof input !== 'object' || !(key in input)) return undefined
  return Object.entries(input).find(([k]) => k === key)?.[1]
}

function status(state: string): Record<string, unknown> {
  return { state, availableModes: ['home', 'away', 'night'], codeRequired: false, lastChangedAt: 1 }
}

function customCalls(action: string): readonly unknown[] {
  return hubCalls()
    .filter((c) => c.path === 'addons.custom' && field(c.input, 'action') === action)
    .map((c) => field(c.input, 'input'))
}

/**
 * `laggingLive`: the nc live view answers, but keeps serving the PRE-arm
 * snapshot (disarmed, nothing excluded) after the arm — a poll that has not
 * caught up.
 */
function adminHub(laggingLive = false): Readonly<Record<string, unknown>> {
  let panelState = 'disarmed'
  const preArmLive = {
    state: 'disarmed',
    targetMode: null,
    availableModes: ['home', 'away', 'night'],
    openings: [],
    exclusions: [],
  }
  return {
    'auth.me': { id: 'u1', username: 'operator', isAdmin: true },
    'alarmPanel.getStatus': () => status(panelState),
    'addons.custom': (input?: unknown): unknown => {
      const action = field(input, 'action')
      if (action === 'nc.getAlarmStatus') return { deviceId: PANEL, live: laggingLive ? preArmLive : null }
      if (action === 'nc.armAlarm') {
        return {
          outcome: 'refused',
          refusalId: 'refusal-1',
          blocking: [{ deviceId: 42, name: 'Porch', state: 'open' }],
        }
      }
      if (action === 'nc.armAlarmAnyway') {
        panelState = 'armed_away'
        return { outcome: 'armed', excluded: [{ deviceId: 42, name: 'Porch', state: 'open' }] }
      }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

function isDisabled(el: HTMLElement): boolean {
  return el.getAttribute('aria-disabled') === 'true'
}

describe('AlarmControl — a refused arm, and Arm anyway', () => {
  it('Arm anyway sends exactly the refusal id, once, and names what it excluded', async () => {
    mountScreen(React.createElement(AlarmControl, { deviceId: PANEL, online: true }), { hub: adminHub() })
    const away = await dom.findByRole('button', { name: 'Away' })
    await vi.waitFor(() => expect(isDisabled(away)).toBe(false))
    await act(async () => {
      fireEvent.click(away)
    })
    await dom.findByText('Not armed — open: Porch (open)')
    const anyway = dom.getByRole('button', { name: 'Arm anyway' })
    await act(async () => {
      // A double tap: the second must be dropped, not sent.
      fireEvent.click(anyway)
      fireEvent.click(anyway)
    })
    await dom.findByText('Armed — excluded: Porch')
    expect(customCalls('nc.armAlarmAnyway')).toEqual([{ refusalId: 'refusal-1' }])
    expect(dom.queryByText('Not armed — open: Porch (open)')).toBeNull()
  })
})

describe('AlarmControl — the excluded line survives a lagging live view', () => {
  it('right after Arm anyway, a live view still reading pre-arm does not blank it', async () => {
    mountScreen(React.createElement(AlarmControl, { deviceId: PANEL, online: true }), { hub: adminHub(true) })
    const away = await dom.findByRole('button', { name: 'Away' })
    await vi.waitFor(() => expect(isDisabled(away)).toBe(false))
    await act(async () => {
      fireEvent.click(away)
    })
    await act(async () => {
      fireEvent.click(await dom.findByRole('button', { name: 'Arm anyway' }))
    })
    await dom.findByText('Armed — excluded: Porch')
    // The nc status is re-read on settle; wait for that refetch to land and
    // prove the line is still there once the lagging snapshot is the newest.
    await vi.waitFor(() => expect(customCalls('nc.getAlarmStatus').length).toBeGreaterThanOrEqual(2))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(dom.getByText('Armed — excluded: Porch')).toBeTruthy()
  })
})

describe('AlarmControl — Disarm never waits on a read (C1)', () => {
  it('a triggered panel is disarmable while auth.me is unanswered — through the cap', async () => {
    mountScreen(React.createElement(AlarmControl, { deviceId: PANEL, online: true }), {
      hub: {
        'auth.me': () => new Promise(() => undefined),
        'alarmPanel.getStatus': status('triggered'),
        'alarmPanel.disarm': null,
      },
    })
    const disarm = await dom.findByRole('button', { name: 'Disarm' })
    expect(isDisabled(disarm)).toBe(false)
    await act(async () => {
      fireEvent.click(disarm)
    })
    await vi.waitFor(() =>
      expect(hubCalls().filter((c) => c.path === 'alarmPanel.disarm').map((c) => c.input)).toEqual([{ deviceId: PANEL }]),
    )
    expect(customCalls('nc.disarmAlarm')).toEqual([])
  })
})

describe('AlarmControl — Disarm waits on nothing (N1, N2)', () => {
  it('a status read that never answers still leaves Disarm pressable, and it sends', async () => {
    mountScreen(React.createElement(AlarmControl, { deviceId: PANEL, online: true }), {
      hub: {
        'auth.me': { id: 'u1', username: 'operator', isAdmin: false },
        'alarmPanel.getStatus': () => new Promise(() => undefined),
        'alarmPanel.disarm': null,
      },
    })
    const disarm = await dom.findByRole('button', { name: 'Disarm' })
    await vi.waitFor(() => expect(isDisabled(disarm)).toBe(false))
    await act(async () => {
      fireEvent.click(disarm)
    })
    await vi.waitFor(() =>
      expect(hubCalls().filter((c) => c.path === 'alarmPanel.disarm').map((c) => c.input)).toEqual([{ deviceId: PANEL }]),
    )
  })

  it('an arm stuck in flight on this row does not block Disarm', async () => {
    // The arm call hangs AFTER the panel moved (or it was armed elsewhere):
    // the panel reads armed, and Disarm must answer, whatever this row's arm
    // is still waiting for.
    let panelState = 'disarmed'
    let client: QueryClient | null = null
    function Probe(): null {
      client = useQueryClient()
      return null
    }
    mountScreen(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Probe),
        React.createElement(AlarmControl, { deviceId: PANEL, online: true }),
      ),
      {
        hub: {
          'auth.me': { id: 'u1', username: 'operator', isAdmin: false },
          'alarmPanel.getStatus': () => status(panelState),
          'alarmPanel.arm': () => new Promise(() => undefined),
          'alarmPanel.disarm': null,
        },
      },
    )
    const away = await dom.findByRole('button', { name: 'Away' })
    await vi.waitFor(() => expect(isDisabled(away)).toBe(false))
    await act(async () => {
      fireEvent.click(away)
    })
    panelState = 'armed_away'
    await act(async () => {
      await client?.invalidateQueries({ queryKey: ['v2', 'cap-status', 'alarmPanel', PANEL] })
    })
    const disarm = dom.getByRole('button', { name: 'Disarm' })
    await vi.waitFor(() => expect(isDisabled(disarm)).toBe(false))
    await act(async () => {
      fireEvent.click(disarm)
    })
    await vi.waitFor(() =>
      expect(hubCalls().filter((c) => c.path === 'alarmPanel.disarm').map((c) => c.input)).toEqual([{ deviceId: PANEL }]),
    )
  })
})

/**
 * The hub renamed `requiresCode: boolean` to `codeRequired: boolean | null`
 * (null = not known). The viewer reads both names, new first, and an unknown
 * answer is a coded panel — never a code-less one that offers Arm and sends a
 * code-less disarm.
 */
describe('AlarmControl — the PIN flag under both hub names', () => {
  const CAP_PANEL = 77

  function codedHub(slice: Record<string, unknown>): Readonly<Record<string, unknown>> {
    return {
      'auth.me': { id: 'u1', username: 'operator', isAdmin: false },
      'alarmPanel.getStatus': { state: 'disarmed', availableModes: ['home', 'away', 'night'], lastChangedAt: 1, ...slice },
    }
  }

  async function settled(): Promise<void> {
    await vi.waitFor(() => expect(hubCalls().some((c) => c.path === 'alarmPanel.getStatus')).toBe(true))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
  }

  it.each([
    ['an older hub, requiresCode: false', { requiresCode: false }],
    ['a newer hub, codeRequired: false', { codeRequired: false }],
  ])('%s → the status is read and Arm is offered', async (_label, slice) => {
    mountScreen(React.createElement(AlarmControl, { deviceId: CAP_PANEL, online: true }), { hub: codedHub(slice) })
    await dom.findByRole('button', { name: 'Away' })
    expect(dom.queryByText('Panel state unknown')).toBeNull()
  })

  it.each([
    ['an older hub, requiresCode: true', { requiresCode: true }],
    ['a newer hub, codeRequired: true', { codeRequired: true }],
    ['a newer hub, codeRequired: null (unknown)', { codeRequired: null }],
    ['a newer hub wins over the old name it also sends', { codeRequired: null, requiresCode: false }],
  ])('%s → a coded panel: the status is read, no inline Arm', async (_label, slice) => {
    mountScreen(React.createElement(AlarmControl, { deviceId: CAP_PANEL, online: true }), { hub: codedHub(slice) })
    await settled()
    expect(dom.queryByText('Panel state unknown')).toBeNull()
    expect(dom.queryByRole('button', { name: 'Away' })).toBeNull()
    expect(dom.getByRole('button', { name: 'Disarm' })).toBeTruthy()
  })
})
