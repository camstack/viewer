/**
 * route-reporting — the app must SAY which route it is on, and why.
 *
 * The operator asked, on 2026-08-21, "I'm on WiFi — shouldn't this be going
 * over the LAN?", and ninety minutes of shipped logs could not answer him: the
 * only route lines in them were three `race failed`s and no `race won`. On this
 * deployment the difference is 10-30 ms against 47-89 ms for the same query, so
 * the question is worth answering.
 *
 * These tests hold the line at the two ways it can go wrong:
 *  - the route is only mentioned when it CHANGES (the operator's session never
 *    changed it, so nothing was ever said);
 *  - a candidate loses the race and its reason is discarded, which makes "the
 *    device refuses that certificate" and "that network is unreachable" the
 *    same silence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { CandidateRaceOutcome } from '../candidate-probe.js'
import { SystemController, type SystemControllerConfig } from '../system-controller.js'

const { createSystem, raceFastestEndpoint, endpointsQuery, awaitConnected, logInfo, logWarn } = vi.hoisted(
  () => ({
    createSystem: vi.fn(),
    raceFastestEndpoint: vi.fn(),
    endpointsQuery: vi.fn(),
    awaitConnected: vi.fn(),
    logInfo: vi.fn(),
    logWarn: vi.fn(),
  }),
)

vi.mock('@camstack/sdk', () => ({ createSystem }))
vi.mock('../../lib/logger.js', () => ({
  log: { info: logInfo, warn: logWarn, error: vi.fn(), debug: vi.fn() },
}))

const PUBLIC_URL = 'https://hub.example.top'
const LAN_URL = 'https://192.168.0.10:4443'
/**
 * A configured URL that CARRIES its port.
 *
 * Required wherever a LAN candidate must survive against a hub that declares no
 * `localPort` (pre-D226): such a hub echoes the port it is given, so a portless
 * configured URL means the client inferred 443 and every LAN URL it got back is
 * addressed to a socket nobody proved is there. Those are dropped rather than
 * raced — see `dropUnverifiedPortEndpoints`. A hub that DOES declare its port
 * needs none of this; the fixture below covers that case explicitly.
 */
const PUBLIC_URL_WITH_PORT = 'https://hub.example.top:4443'

class FakeSystem {
  serverUrl: string
  closed = false
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
    this.onConnectionChange('connecting')
    queueMicrotask(() => {
      if (!this.closed) this.onConnectionChange('connected')
    })
  }

  awaitConnected(): Promise<void> {
    return awaitConnected() as Promise<void>
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

function config(overrides: Partial<SystemControllerConfig> = {}): SystemControllerConfig {
  return {
    serverUrl: PUBLIC_URL_WITH_PORT,
    token: 'jwt',
    candidates: [LAN_URL, PUBLIC_URL],
    raceCandidatesImpl: raceSeam(),
    ...overrides,
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
  await new Promise((r) => setTimeout(r, 0))
  for (let i = 0; i < 24; i += 1) await Promise.resolve()
}

/** Every `route …` line the run emitted, newest last. */
function routeLines(): readonly Record<string, unknown>[] {
  return logInfo.mock.calls
    .filter((c) => typeof c[1] === 'string' && c[1].startsWith('route '))
    .map((c) => (typeof c[2] === 'object' && c[2] !== null ? c[2] : {}))
}

function probeLines(): readonly Record<string, unknown>[] {
  return [...logInfo.mock.calls, ...logWarn.mock.calls]
    .filter((c) => {
      const msg = c[1]
      const data = c[2]
      if (msg === 'candidate probe') return true
      return typeof data === 'object' && data !== null && 'url' in data && 'ok' in data
    })
    .map((c) => (typeof c[2] === 'object' && c[2] !== null ? (c[2] as Record<string, unknown>) : {}))
}

const HUB_ENDPOINTS = [
  {
    label: 'LAN — eth0',
    baseUrl: LAN_URL,
    kind: 'lan-ipv4',
    interfaceKind: 'lan',
    plausible: true,
    plausibleReason: '',
    priority: 0,
  },
  {
    label: 'Public tunnel',
    baseUrl: PUBLIC_URL,
    kind: 'public',
    interfaceKind: 'public',
    plausible: true,
    plausibleReason: '',
    priority: 100,
  },
]

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  logInfo.mockReset()
  logWarn.mockReset()
  createSystem.mockReset()
  createSystem.mockImplementation(
    (cfg: { serverUrl: string; onConnectionChange: (s: string) => void }) => {
      const sys = new FakeSystem(cfg.serverUrl)
      sys.onConnectionChange = cfg.onConnectionChange
      queueMicrotask(() => sys.onConnectionChange('connected'))
      return sys
    },
  )
  raceFastestEndpoint.mockReset()
  raceFastestEndpoint.mockImplementation(async () => LAN_URL)
  endpointsQuery.mockReset()
  endpointsQuery.mockImplementation(async () => ({ endpoints: HUB_ENDPOINTS }))
  awaitConnected.mockReset()
  awaitConnected.mockImplementation(async () => {})
  fetchMock = vi.fn(async () => ({ status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

describe('the route the app is on is written down', () => {
  it('names the winner AND its channel when the race elects the LAN', async () => {
    const ctrl = new SystemController(config())
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()

    expect(routeLines().at(-1)).toMatchObject({
      url: LAN_URL,
      channel: 'lan',
      reason: 'race-won',
    })
    expect(ctrl.getRoute().channel).toBe('lan')
  })

  it('speaks even when NOTHING changed — the operator\'s session took only this branch', async () => {
    // Candidates already equal to what the hub advertises: `discoverAndApply`
    // short-circuits, no re-race runs, and before this the pass ended in
    // silence with `race failed` as the last word about the route.
    const ctrl = new SystemController(config({ candidates: [LAN_URL, PUBLIC_URL] }))
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()

    // Two lines: the race's decision, then the unchanged pass restating it.
    expect(routeLines().length).toBeGreaterThanOrEqual(2)
    expect(routeLines().at(-1)).toMatchObject({ url: LAN_URL })
  })

  it('a pass that changed nothing does not ERASE the decision that put us here', async () => {
    // `unchanged` overwriting `race-won` would make every settled session read
    // "unchanged" — an answer that is true and says nothing, which is the exact
    // failure mode being fixed.
    const ctrl = new SystemController(config())
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()
    expect(ctrl.getRoute().reason).toBe('race-won')
  })

  it('calls a fallback a FALLBACK when no candidate answered', async () => {
    raceFastestEndpoint.mockImplementation(async () => null)
    const ctrl = new SystemController(config())
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()

    // Same URL as the configured one — and arrived at by giving up, which is
    // the distinction the log could not make.
    expect(routeLines().at(-1)).toMatchObject({
      url: PUBLIC_URL_WITH_PORT,
      channel: 'public',
      reason: 'no-winner',
    })
  })

  it('carries the hub\'s own label so a URL does not have to be recognised by eye', async () => {
    const ctrl = new SystemController(config())
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()
    expect(routeLines().map((l) => l['endpointLabel'])).toContain('LAN — eth0')
  })
})

describe('why a candidate lost', () => {
  it('probes every candidate and keeps the reason when the tunnel wins over a LAN candidate', async () => {
    raceFastestEndpoint.mockImplementation(async () => PUBLIC_URL)
    fetchMock.mockImplementation(async (url: string) => {
      if (url.startsWith(LAN_URL)) throw new TypeError('certificate is not trusted')
      return { status: 200 }
    })
    // No seam here: this one is about the REAL prober keeping a real failure.
    const ctrl = new SystemController(config({ raceCandidatesImpl: undefined }))
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()

    const lan = probeLines().find((l) => l['url'] === LAN_URL)
    expect(lan).toBeDefined()
    // The whole point: a refused certificate and an unroutable network are
    // different strings here, and were the same silence before.
    expect(lan?.['error']).toBe('TypeError: certificate is not trusted')
    expect(lan?.['channel']).toBe('lan')
    expect(lan?.['ok']).toBe(false)
  })

  it('costs NO extra network work — the losers fall out of the race itself', async () => {
    // The first cut ran a second diagnostic pass over every candidate whenever
    // the tunnel won. That doubled the probes on exactly the connection that
    // was already struggling. Now the race keeps its own losers, so the
    // diagnosis is free and there is nothing extra to fire.
    const ctrl = new SystemController(config())
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()
    expect(probeLines().length).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('DROPS a LAN candidate whose port the client invented, instead of racing it', async () => {
    // The operator's exact configuration: a tunnel URL with no port. The hub
    // echoes the inferred 443 onto its LAN address, producing
    // `https://192.168.0.10:443` for a hub listening on 4443 — a candidate born
    // dead. Racing it makes the log read "the LAN lost" when the LAN was never
    // asked; the client has no business claiming a port it cannot know.
    // Seeded with the public URL alone, which is what a portless configuration
    // really persists: last session's LAN endpoint was built on the inferred
    // port too, so it never survived to be stored.
    const ctrl = new SystemController(config({ serverUrl: PUBLIC_URL, candidates: [PUBLIC_URL] }))
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()

    const drop = probeLines().find((l) => l['trigger'] === 'inferred-port')
    expect(drop).toBeDefined()
    expect(drop?.['dropped']).toEqual([LAN_URL])
    expect(drop?.['inferredPort']).toBe(443)
    // And the surviving route is the public one, named as such.
    expect(ctrl.getRoute().channel).toBe('public')
  })

  it('RACES that same LAN candidate once the HUB declares the port (D226)', async () => {
    // Identical configuration — portless tunnel URL, nothing the client can
    // derive a hub port from. The difference is entirely on the other side:
    // the hub now reports the port it actually listens on, so the LAN URL is
    // its statement rather than an echo of our guess, and there is nothing
    // left to distrust.
    endpointsQuery.mockImplementation(async () => ({
      endpoints: HUB_ENDPOINTS,
      localPort: { port: 4443, source: 'server-config' },
    }))
    const ctrl = new SystemController(config({ serverUrl: PUBLIC_URL, candidates: [PUBLIC_URL] }))
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()

    expect(probeLines().find((l) => l['trigger'] === 'inferred-port')).toBeUndefined()
    const declared = probeLines().find((l) => l['trigger'] === 'declared-port')
    expect(declared).toMatchObject({ declaredPort: 4443, declaredPortSource: 'server-config' })
    expect(ctrl.getRoute().channel).toBe('lan')
  })

  it('still distrusts a port the hub only echoed back', async () => {
    // A hub that cannot read its own configuration replays the caller's hint
    // and says so. Same words as before the fix, same treatment.
    endpointsQuery.mockImplementation(async () => ({
      endpoints: HUB_ENDPOINTS,
      localPort: { port: 443, source: 'caller-hint' },
    }))
    const ctrl = new SystemController(config({ serverUrl: PUBLIC_URL, candidates: [PUBLIC_URL] }))
    ctrl.subscribe({ onStateChange: () => {}, onUnauthorized: () => {} })
    await ctrl.connect()
    await settle()

    expect(probeLines().find((l) => l['trigger'] === 'inferred-port')?.['dropped']).toEqual([
      LAN_URL,
    ])
    expect(ctrl.getRoute().channel).toBe('public')
  })
})
