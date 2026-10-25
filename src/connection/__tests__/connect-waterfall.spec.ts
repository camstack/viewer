/**
 * connect-waterfall — what a COLD launch actually costs, counted.
 *
 * The operator's report is "several seconds before a picture, as if the session
 * isn't warmed on open". The server half was measured and is not the problem
 * (codec negotiated 13 ms after the offer lands). So the cost is on the client,
 * in `SystemController.connect()`.
 *
 * The existing `system-controller.spec.ts` fake is NOT faithful: its
 * `switchServerUrl` is a bare `vi.fn()` that emits nothing. The real
 * `System.switchServerUrl` calls `reconnect()`, which tears the WebSocket down,
 * emits `'connecting'`, rebuilds the client and emits `'connected'` again when
 * the new socket opens. That echo is fed straight back into
 * `handleStateChange`, and `shouldRerace('connecting','connected')` is TRUE —
 * so the transport re-races itself, re-probes the hub, and can switch again.
 *
 * A fake that cannot emit that echo can never show the loop. This file supplies
 * one that can, and asserts the counts. The numbers, not the prose, are the
 * finding.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { CandidateRaceOutcome } from '../candidate-probe.js'
import { SystemController, type SystemControllerConfig } from '../system-controller.js'
import { STALE_SWITCH_CLOSE_MS } from '../recheck-policy.js'

const { createSystem, raceFastestEndpoint, endpointsQuery, awaitConnected } = vi.hoisted(() => ({
  createSystem: vi.fn(),
  raceFastestEndpoint: vi.fn(),
  endpointsQuery: vi.fn(),
  awaitConnected: vi.fn(),
}))

vi.mock('@camstack/sdk', () => ({ createSystem }))

/** Carries its port: against a hub that declares no `localPort` (pre-D226) the
 *  port is echoed back, so a portless configured URL has its LAN candidates
 *  dropped rather than raced (`dropUnverifiedPortEndpoints`). The waterfall
 *  counts below are about racing, not about that filter, so this one is
 *  explicit. */
const PUBLIC_URL = 'https://hub.example.top:4443'
const LAN_URL = 'https://192.0.2.10:4443'

/**
 * A `System` fake that reproduces the ONE behaviour that matters here:
 * `switchServerUrl` is a full transport rebuild, and it emits
 * `connecting` → `connected` back at its owner.
 */
class FakeSystem {
  serverUrl: string
  closed = false
  switchCount = 0
  onConnectionChange: (state: string) => void = () => {}
  readonly trpcClient = {
    localNetwork: { getConnectionEndpoints: { query: endpointsQuery } },
  }

  constructor(url: string) {
    this.serverUrl = url
  }

  switchServerUrl(next: string): void {
    if (next.replace(/\/+$/, '') === this.serverUrl.replace(/\/+$/, '')) return
    this.serverUrl = next
    this.switchCount += 1
    // `reconnect()`: emit 'connecting' synchronously, then 'connected' when the
    // replacement socket opens.
    this.onConnectionChange('connecting')
    queueMicrotask(() => {
      if (!this.closed) this.onConnectionChange('connected')
    })
  }

  awaitConnected(): Promise<void> {
    return awaitConnected() as Promise<void>
  }

  reconnectCount = 0
  reconnect(): void {
    this.reconnectCount += 1
    this.onConnectionChange('connecting')
    queueMicrotask(() => {
      if (!this.closed) this.onConnectionChange('connected')
    })
  }

  close(): void {
    this.closed = true
  }
}


/**
 * The controller races on its own now (`/health`, not the SDK's `/trpc/health`
 * which 404s), so the race arrives through an injected seam. The spy keeps its
 * meaning — ONE call per race — and every count below still asserts what it did.
 */
function raceSeam(): (urls: readonly string[], timeoutMs: number) => Promise<CandidateRaceOutcome> {
  return async (urls, timeoutMs) => {
    // Args forwarded so the existing `toHaveBeenCalledWith(candidates, ms)`
    // assertions keep testing the candidate set the race was given.
    const picked = await raceFastestEndpoint([...urls], timeoutMs)
    // A race can only elect a candidate it was OFFERED. Honouring the list is
    // what makes the seam able to show a dropped candidate not winning.
    const winner = picked !== null && urls.includes(picked) ? picked : null
    return {
      winner,
      results: urls.map((url) => ({
        url,
        ok: url === winner,
        ms: url === winner ? 5 : 9,
        status: url === winner ? 200 : null,
        error: url === winner ? null : 'Error: probe failed',
      })),
    }
  }
}

let live: FakeSystem | null = null
let clock = 0

function config(overrides: Partial<SystemControllerConfig> = {}): SystemControllerConfig {
  return {
    serverUrl: PUBLIC_URL,
    token: 'jwt',
    candidates: [LAN_URL, PUBLIC_URL],
    raceCandidatesImpl: raceSeam(),
    now: () => clock,
    ...overrides,
  }
}

/** Let every queued microtask + the fire-and-forget tails settle. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
}

beforeEach(() => {
  live = null
  clock = 0
  createSystem.mockReset()
  createSystem.mockImplementation((cfg: { serverUrl: string; onConnectionChange: (s: string) => void }) => {
    const sys = new FakeSystem(cfg.serverUrl)
    sys.onConnectionChange = cfg.onConnectionChange
    live = sys
    // The real WS opens shortly after construction.
    queueMicrotask(() => sys.onConnectionChange('connected'))
    return sys
  })
  raceFastestEndpoint.mockReset()
  raceFastestEndpoint.mockImplementation(async () => LAN_URL)
  endpointsQuery.mockReset()
  // A hub that advertises exactly the routes we already had — the steady state
  // from launch two onwards, once the previous session persisted them.
  endpointsQuery.mockImplementation(async () => ({
    endpoints: [
      {
        label: 'lan',
        baseUrl: LAN_URL,
        kind: 'lan-ipv4',
        interfaceKind: 'lan',
        plausible: true,
        plausibleReason: '',
        priority: 0,
      },
    ],
  }))
  awaitConnected.mockReset()
  awaitConnected.mockImplementation(async () => {})
})

describe('cold-launch connect waterfall', () => {
  it('races the endpoints ONCE, not three times', async () => {
    const ctrl = new SystemController(config())
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()

    // One route decision per launch. Every extra race is a full
    // `Promise.any` over the candidate set — up to RACE_TIMEOUT_MS of
    // wallclock each, on the critical path to the first picture.
    expect(raceFastestEndpoint).toHaveBeenCalledTimes(1)
  })

  it('probes the hub for its endpoints ONCE, not repeatedly', async () => {
    const ctrl = new SystemController(config())
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()

    // `getConnectionEndpoints` is an AUTHENTICATED tRPC round-trip. Issued
    // against a socket that is mid-rebuild it queues behind the WS handshake
    // and the connectionParams exchange — the measured 2.3-7.3 s.
    expect(endpointsQuery).toHaveBeenCalledTimes(1)
  })

  it('rebuilds the WebSocket at most ONCE on a cold launch', async () => {
    const ctrl = new SystemController(config())
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()

    // Each `switchServerUrl` disposes the tRPC client, the device mirror and
    // every live event subscription, and re-runs the WS auth handshake. One
    // (public → LAN) is the price of a fast route. More than one is waste.
    expect(live?.switchCount ?? 0).toBeLessThanOrEqual(1)
  })

  it('does not re-race in response to its OWN transport switch', async () => {
    // The discriminating shape: the switch fires the `connecting → connected`
    // echo, and the whole settled launch must still show exactly one of each.
    // A controller that treats the echo as a recovery re-races and re-probes
    // from inside `handleStateChange` — and each of those switches again,
    // which is the feedback loop the counts above measured at four passes.
    const ctrl = new SystemController(config())
    const states: string[] = []
    ctrl.subscribe({ onStateChange: (s) => states.push(s), onUnauthorized: () => {} })
    await ctrl.connect()
    await ctrl.routeSettled()
    await settle()

    // The echo really did happen — otherwise this test proves nothing.
    expect(states).toContain('connecting')
    expect(live?.switchCount).toBe(1)
    expect(raceFastestEndpoint).toHaveBeenCalledTimes(1)
    expect(endpointsQuery).toHaveBeenCalledTimes(1)
  })

  it('ignores the self-switch echo even when it arrives AFTER the pass settled', async () => {
    // The single-flight guard alone is not enough, and a fake whose socket
    // reopens on a microtask cannot show why: the echo lands while the pass is
    // still running and is absorbed for free. In production the WS rebuild
    // takes hundreds of milliseconds — comfortably longer than the race and
    // the endpoints probe — so the echo arrives with NO pass in flight, and
    // `shouldRerace('connecting','connected')` then starts a fresh one that
    // races, probes and can switch again. That is the loop.
    let openLateSocket: () => void = () => {}
    createSystem.mockImplementation(
      (cfg: { serverUrl: string; onConnectionChange: (s: string) => void }) => {
        const sys = new FakeSystem(cfg.serverUrl)
        sys.onConnectionChange = cfg.onConnectionChange
        live = sys
        // The replacement socket takes REAL time to open.
        sys.switchServerUrl = (next: string): void => {
          if (next.replace(/\/+$/, '') === sys.serverUrl.replace(/\/+$/, '')) return
          sys.serverUrl = next
          sys.switchCount += 1
          sys.onConnectionChange('connecting')
          openLateSocket = () => sys.onConnectionChange('connected')
        }
        queueMicrotask(() => sys.onConnectionChange('connected'))
        return sys
      },
    )

    const ctrl = new SystemController(config())
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await ctrl.routeSettled()
    await settle()

    raceFastestEndpoint.mockClear()
    endpointsQuery.mockClear()

    // Now the new socket finally opens — long after the route pass finished.
    openLateSocket()
    await settle()
    await ctrl.routeSettled()

    expect(raceFastestEndpoint).not.toHaveBeenCalled()
    expect(endpointsQuery).not.toHaveBeenCalled()
  })

  it('re-races when the hub advertises a candidate set we have not raced', async () => {
    // First launch: nothing persisted, so the only seed is the configured URL
    // and discovery genuinely adds a route. That second race is earned.
    const NEW_LAN = 'https://192.0.2.20:4443'
    endpointsQuery.mockImplementation(async () => ({
      endpoints: [
        {
          label: 'lan',
          baseUrl: NEW_LAN,
          kind: 'lan-ipv4',
          interfaceKind: 'lan',
          plausible: true,
          plausibleReason: '',
          priority: 0,
        },
      ],
    }))
    const ctrl = new SystemController(config({ candidates: [PUBLIC_URL] }))
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await ctrl.routeSettled()
    await settle()

    expect(raceFastestEndpoint).toHaveBeenCalledTimes(2)
    expect(raceFastestEndpoint).toHaveBeenLastCalledWith(
      [NEW_LAN, PUBLIC_URL],
      expect.any(Number),
    )
  })

  it('still re-races after a GENUINE drop and recovery', async () => {
    const ctrl = new SystemController(config())
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()
    raceFastestEndpoint.mockClear()

    // A real network change, after the previous socket would have closed.
    clock += STALE_SWITCH_CLOSE_MS
    await ctrl.handleStateChange('disconnected')
    await ctrl.handleStateChange('connected')
    await settle()

    expect(raceFastestEndpoint).toHaveBeenCalledTimes(1)
  })

  it('does not take the previous socket\'s onClose as a drop of the new one', async () => {
    // Production (1.0.375): /health 3/3, race wins LAN HTTP, tRPC succeeds for
    // ~300ms, then connected → disconnected (selfSwitchEcho: false). The old
    // tunnel WS onClose lands after the new LAN WS is already open. Queries
    // then disable themselves because they gate on `state === 'connected'`.
    const ctrl = new SystemController(config())
    const states: string[] = []
    ctrl.subscribe({ onStateChange: (s) => states.push(s), onUnauthorized: () => {} })
    await ctrl.connect()
    await ctrl.routeSettled()
    await settle()
    expect(states.at(-1)).toBe('connected')

    clock += 318
    await ctrl.handleStateChange('disconnected')

    expect(states.at(-1)).toBe('connected')
    expect(states.filter((s) => s === 'disconnected')).toEqual([])
  })

  it('rebuilds the WebSocket when health still wins the current URL while disconnected', async () => {
    // Settings re-probe after the false drop: race won LAN, switched: false,
    // because switchServerUrl is a no-op when the URL matches. The dead-looking
    // UI then never gets a new socket.
    const ctrl = new SystemController(config())
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await ctrl.routeSettled()
    await settle()
    clock += STALE_SWITCH_CLOSE_MS
    await ctrl.handleStateChange('disconnected')
    expect(live?.reconnectCount ?? 0).toBe(0)

    await ctrl.reprobe()
    await ctrl.routeSettled()
    await settle()

    expect(live?.reconnectCount).toBe(1)
    expect(live?.serverUrl).toBe(LAN_URL)
  })

  it('exposes a hub identity that is available before connect and survives a switch', async () => {
    // The cold-launch camera-list cache keys on this. `getSystem()?.serverUrl`
    // — what it used to key on — is null here, and becomes the LAN URL two
    // lines later. Both of those were silent cache misses.
    const ctrl = new SystemController(config())
    expect(ctrl.getSystem()).toBeNull()
    expect(ctrl.configuredServerUrl).toBe(PUBLIC_URL)

    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await ctrl.routeSettled()
    await settle()

    expect(live?.serverUrl).toBe(LAN_URL)
    expect(ctrl.configuredServerUrl).toBe(PUBLIC_URL)
  })

  it('re-races after a failed switch instead of latching', async () => {
    // A switch onto a URL whose socket never opens leaves the self-switch flag
    // armed. If only `connected` disarmed it, route recovery would be dead for
    // the rest of the session — the stale-latch shape this codebase has been
    // bitten by before.
    const ctrl = new SystemController(config())
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await ctrl.routeSettled()
    await settle()
    raceFastestEndpoint.mockClear()

    // The switch's socket failed rather than opening.
    clock += STALE_SWITCH_CLOSE_MS
    await ctrl.handleStateChange('disconnected')
    await ctrl.handleStateChange('connected')
    await ctrl.routeSettled()

    expect(raceFastestEndpoint).toHaveBeenCalled()
  })

  it('does not make the caller wait on the route decision', async () => {
    // The picture cannot start until the app has a usable transport. It does
    // NOT need the FASTEST transport to start. A race that blocks `connect()`
    // puts its whole timeout budget in front of the first frame.
    let releaseRace: (url: string) => void = () => {}
    raceFastestEndpoint.mockImplementation(
      () => new Promise<string>((resolve) => { releaseRace = resolve }),
    )

    const ctrl = new SystemController(config())
    const seen: string[] = []
    ctrl.subscribe({ onStateChange: (s) => seen.push(s), onUnauthorized: () => {} })

    let settled = false
    void ctrl.connect().then(() => { settled = true })
    await settle()

    expect(settled).toBe(true)
    expect(ctrl.getSystem()).not.toBeNull()
    releaseRace(LAN_URL)
  })
})
