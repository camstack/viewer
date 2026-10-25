/**
 * The app closes its subscriptions on the way out and reopens them on the way
 * back — and the round trip is ROUTINE: the operator must not be shown a fault
 * for a departure the app itself decided on.
 *
 * See `background-suspend.ts` for the 88 MB this exists to stop feeding.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { SystemController } from '../system-controller.js'
import type { ConnState } from '../recheck-policy.js'
import type { CandidateRaceOutcome } from '../candidate-probe.js'

const { close, reconnect, authMe, createSystem, connectionChange } = vi.hoisted(() => {
  const close = vi.fn()
  const reconnect = vi.fn()
  const authMe = vi.fn(async () => ({ id: 1 }))
  /** The SDK's `onConnectionChange`, captured so a spec can emit the echoes a
   *  real socket emits (the `disconnected` a `close()` produces, above all). */
  const connectionChange: { current: ((state: string) => void) | null } = { current: null }
  return {
    close,
    reconnect,
    authMe,
    connectionChange,
    createSystem: vi.fn((config: { onConnectionChange?: (state: string) => void }) => {
      connectionChange.current = config.onConnectionChange ?? null
      return {
        serverUrl: 'https://public:4443',
        switchServerUrl: vi.fn(),
        reconnect,
        trpcClient: { auth: { me: { query: authMe } } },
        // A WebSocket transport. `wsClient` is `null` on the HTTP one, and the
        // difference decides whether there is anything to close at all.
        wsClient: { close: vi.fn(), connectionState: { subscribe: () => ({ unsubscribe: vi.fn() }) } },
        close,
      }
    }),
  }
})

vi.mock('@camstack/sdk', () => ({ createSystem }))

/** No route optimisation in these specs: a race that elects nothing leaves the
 *  transport where it is, which is all this file cares about. */
function raceSeam(): (urls: readonly string[], timeoutMs: number) => Promise<CandidateRaceOutcome> {
  return async () => ({ winner: null, results: [] })
}

interface Harness {
  readonly ctrl: SystemController
  readonly states: ConnState[]
}

async function connected(): Promise<Harness> {
  const ctrl = new SystemController({
    serverUrl: 'https://public:4443',
    candidates: ['https://public:4443'],
    raceCandidatesImpl: raceSeam(),
  })
  const states: ConnState[] = []
  ctrl.subscribe({ onStateChange: (s) => states.push(s), onUnauthorized: () => undefined })
  await ctrl.connect()
  await ctrl.routeSettled()
  states.length = 0
  return { ctrl, states }
}

beforeEach(() => {
  close.mockClear()
  reconnect.mockClear()
  authMe.mockClear()
  authMe.mockImplementation(async () => ({ id: 1 }))
  connectionChange.current = null
  createSystem.mockClear()
})

describe('going into the background', () => {
  it('closes the socket instead of leaving it open for a reader that is asleep', async () => {
    const { ctrl } = await connected()
    expect(ctrl.suspendForBackground()).toBe('suspend')
    expect(close).toHaveBeenCalledTimes(1)
    expect(ctrl.isSuspended()).toBe(true)
  })

  it('does not close twice for one departure', async () => {
    const { ctrl } = await connected()
    ctrl.suspendForBackground()
    expect(ctrl.suspendForBackground()).toBe('already-suspended')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('names a departure with no transport rather than doing nothing quietly', () => {
    const ctrl = new SystemController({
      serverUrl: 'https://public:4443',
      candidates: [],
      raceCandidatesImpl: raceSeam(),
    })
    expect(ctrl.suspendForBackground()).toBe('no-transport')
    expect(close).not.toHaveBeenCalled()
  })

  it('reports the departure as `connecting`, never as `disconnected`', async () => {
    const { ctrl, states } = await connected()
    ctrl.suspendForBackground()
    // The close's own WS echo, which is what used to reach the banner.
    connectionChange.current?.('disconnected')
    expect(states).not.toContain('disconnected')
    expect(states[0]).toBe('connecting')
  })
})

describe('coming back', () => {
  it('rebuilds the transport we took away, without spending a probe on it', async () => {
    const { ctrl } = await connected()
    ctrl.suspendForBackground()
    connectionChange.current?.('disconnected')
    authMe.mockClear()
    expect(await ctrl.handleForeground(120_000)).toBe('resumed')
    expect(reconnect).toHaveBeenCalledTimes(1)
    // Nothing to ask: the socket is gone because we closed it.
    expect(authMe).not.toHaveBeenCalled()
    expect(ctrl.isSuspended()).toBe(false)
  })

  it('still probes a resume that WE did not cause', async () => {
    const { ctrl } = await connected()
    expect(await ctrl.handleForeground(120_000)).toBe('healthy')
    expect(authMe).toHaveBeenCalledTimes(1)
  })

  it('hears the transport again afterwards — the silence is not a latch', async () => {
    const { ctrl, states } = await connected()
    ctrl.suspendForBackground()
    connectionChange.current?.('disconnected')
    await ctrl.handleForeground(120_000)
    states.length = 0
    connectionChange.current?.('disconnected')
    expect(states).toContain('disconnected')
  })
})
