import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CandidateRaceOutcome } from '../candidate-probe.js'
import { SystemController, type SystemControllerConfig } from '../system-controller.js'

const { createSystem, raceFastestEndpoint, endpointsQuery, awaitConnected } = vi.hoisted(() => ({
  createSystem: vi.fn(),
  raceFastestEndpoint: vi.fn(),
  endpointsQuery: vi.fn(),
  awaitConnected: vi.fn(),
}))
vi.mock('@camstack/sdk', () => ({ createSystem }))

const PUBLIC_URL = 'https://hub.example.top:4443'
const LAN_URL = 'https://192.0.2.10:4443'

class FakeSystem {
  serverUrl: string
  closed = false
  switchCount = 0
  reconnectCount = 0
  onConnectionChange: (state: string) => void = () => {}
  readonly trpcClient = { localNetwork: { getConnectionEndpoints: { query: endpointsQuery } } }
  constructor(url: string) { this.serverUrl = url }
  switchServerUrl(next: string): void {
    if (next.replace(/\/+$/, '') === this.serverUrl.replace(/\/+$/, '')) return
    this.serverUrl = next
    this.switchCount += 1
    this.onConnectionChange('connecting')
    setTimeout(() => { if (!this.closed) this.onConnectionChange('connected') }, 20)
  }
  awaitConnected(): Promise<void> { return awaitConnected() as Promise<void> }
  reconnect(): void {
    this.reconnectCount += 1
    this.onConnectionChange('connecting')
    setTimeout(() => { if (!this.closed) this.onConnectionChange('connected') }, 20)
  }
  close(): void { this.closed = true }
}

function raceSeam(): (urls: readonly string[], t: number) => Promise<CandidateRaceOutcome> {
  return async (urls, t) => {
    const picked = await raceFastestEndpoint([...urls], t)
    const winner = picked !== null && urls.includes(picked) ? picked : null
    return {
      winner,
      results: urls.map((url) => ({ url, ok: url === winner, ms: 5, status: url === winner ? 200 : null, error: null })),
    }
  }
}

let live: FakeSystem | null = null
const cfg = (): SystemControllerConfig => ({
  serverUrl: PUBLIC_URL, token: 'jwt', candidates: [LAN_URL, PUBLIC_URL], raceCandidatesImpl: raceSeam(), now: () => Date.now(),
})
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  live = null
  createSystem.mockReset()
  createSystem.mockImplementation((c: { serverUrl: string; onConnectionChange: (s: string) => void }) => {
    const sys = new FakeSystem(c.serverUrl)
    sys.onConnectionChange = c.onConnectionChange
    live = sys
    setTimeout(() => sys.onConnectionChange('connected'), 5)
    return sys
  })
  raceFastestEndpoint.mockReset()
  raceFastestEndpoint.mockImplementation(async () => LAN_URL)
  endpointsQuery.mockReset()
  endpointsQuery.mockImplementation(async () => ({ endpoints: [{ label: 'lan', baseUrl: LAN_URL, kind: 'lan-ipv4', interfaceKind: 'lan', plausible: true, plausibleReason: '', priority: 0 }] }))
  awaitConnected.mockReset()
  awaitConnected.mockImplementation(async () => {})
})

describe('a session renewal reconnects the socket on the route it already holds', () => {
  it('does not run a route pass for the echo of its own reconnect', async () => {
    const ctrl = new SystemController(cfg())
    const states: string[] = []
    ctrl.subscribe({ onStateChange: (s) => states.push(s), onUnauthorized: () => {} })
    await ctrl.connect()
    await ctrl.routeSettled()
    await wait(100)
    raceFastestEndpoint.mockClear()
    endpointsQuery.mockClear()
    const before = states.length

    // What `use-session-renewal.ts` does after a renewal.
    ctrl.getRenewableSystem()?.reconnect()
    await wait(100)
    await ctrl.routeSettled()

    expect(raceFastestEndpoint).not.toHaveBeenCalled()
    expect(endpointsQuery).not.toHaveBeenCalled()
  })

  it('cold start with an expired token: the renewal adds no route pass to the launch', async () => {
    /** The launch with an anonymous first probe; `renew` rebuilds the socket afterwards, as the host does. */
    async function launch(renew: boolean): Promise<{ races: number; probes: number }> {
      raceFastestEndpoint.mockClear()
      endpointsQuery.mockClear()
      awaitConnected.mockImplementationOnce(async () => {
        throw Object.assign(new Error('UNAUTHORIZED'), { data: { code: 'UNAUTHORIZED' } })
      })
      const ctrl = new SystemController(cfg())
      ctrl.subscribe({
        onStateChange: () => {},
        onUnauthorized: () => {
          if (renew) setTimeout(() => ctrl.getRenewableSystem()?.reconnect(), 30)
        },
      })
      await ctrl.connect()
      await wait(300)
      await ctrl.routeSettled()
      return { races: raceFastestEndpoint.mock.calls.length, probes: endpointsQuery.mock.calls.length }
    }
    const withoutRenewal = await launch(false)
    const withRenewal = await launch(true)
    expect(withRenewal).toEqual(withoutRenewal)
  })
})
