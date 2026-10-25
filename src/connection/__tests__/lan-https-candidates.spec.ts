/**
 * lan-https-candidates — the hub offers an `https://<lan>:4443` counterpart for
 * every `http://<lan>:4480` address (D859); the viewer races it, prefers it
 * when both answer, and never lets it hold the connection up when it does not.
 *
 * The advertised palette is the only authority: the Network page toggles the
 * counterpart, so the app never synthesises one the hub did not offer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  classifySecureTwinFailure,
  raceCandidates,
  SECURE_TWIN_GRACE_MS,
  secureTwinUrls,
  type CandidateProbeResult,
  type CandidateRaceOutcome,
} from '../candidate-probe.js'
import type { DiscoveredEndpoint } from '../endpoint-discovery.js'
import { SystemController } from '../system-controller.js'

const { createSystem, endpointsQuery, viewerQuery, probeLog } = vi.hoisted(() => ({
  createSystem: vi.fn(),
  endpointsQuery: vi.fn(),
  viewerQuery: vi.fn(),
  probeLog: vi.fn(),
}))

vi.mock('@camstack/sdk', () => ({ createSystem }))
vi.mock('../lifecycle-trace.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lifecycle-trace.js')>()
  return { ...original, traceCandidateProbe: probeLog }
})

const TUNNEL = 'https://cams.example.com'
const LAN_HTTP = 'http://192.0.2.10:4480'
const LAN_HTTPS = 'https://192.0.2.10:4443'

const lan = (baseUrl: string, priority: number): DiscoveredEndpoint => ({
  label: 'LAN — eth0',
  baseUrl,
  kind: 'lan-ipv4',
  interfaceKind: 'lan',
  plausible: true,
  plausibleReason: '',
  priority,
})
const TUNNEL_EP: DiscoveredEndpoint = {
  label: 'Public tunnel',
  baseUrl: TUNNEL,
  kind: 'public',
  interfaceKind: 'public',
  plausible: true,
  plausibleReason: '',
  priority: 100,
}
const HUB_PORT = { port: 4443, source: 'server-config' } as const

class FakeSystem {
  serverUrl: string
  onConnectionChange: (state: string) => void = () => {}
  readonly trpcClient = {
    localNetwork: {
      getConnectionEndpoints: { query: endpointsQuery },
      getViewerEndpoints: { query: viewerQuery },
    },
  }
  constructor(url: string) {
    this.serverUrl = url
  }
  switchServerUrl(next: string): void {
    this.serverUrl = next
  }
  awaitConnected(): Promise<void> {
    return Promise.resolve()
  }
  reconnect(): void {}
  close(): void {}
}

const probe = (url: string, ok: boolean, error: string | null, ms = 5): CandidateProbeResult => ({
  url,
  ok,
  ms,
  status: ok ? 200 : null,
  error,
})

function raceReturning(
  offered: string[][],
  results: (urls: readonly string[]) => readonly CandidateProbeResult[],
): (urls: readonly string[]) => Promise<CandidateRaceOutcome> {
  return async (urls) => {
    offered.push([...urls])
    const all = results(urls)
    return { winner: all.find((r) => r.ok)?.url ?? null, results: all }
  }
}

beforeEach(() => {
  createSystem.mockReset()
  createSystem.mockImplementation(
    (opts: { serverUrl: string; onConnectionChange: (s: string) => void }) => {
      const sys = new FakeSystem(opts.serverUrl)
      sys.onConnectionChange = opts.onConnectionChange
      return sys
    },
  )
  endpointsQuery.mockReset()
  viewerQuery.mockReset()
  probeLog.mockReset()
  endpointsQuery.mockResolvedValue({
    endpoints: [lan(LAN_HTTP, 0), lan(LAN_HTTPS, 0.5), TUNNEL_EP],
    localPort: HUB_PORT,
  })
  viewerQuery.mockResolvedValue({ baseUrls: [], resolved: [LAN_HTTP, LAN_HTTPS, TUNNEL] })
})

describe('the native app races the hub-advertised https LAN candidate', () => {
  it('offers both the plain and the https address of the LAN host to the race', async () => {
    const offered: string[][] = []
    const ctrl = new SystemController({
      serverUrl: TUNNEL,
      token: 'jwt',
      candidates: [TUNNEL],
      pageProtocol: null,
      raceCandidatesImpl: raceReturning(offered, (urls) =>
        urls.map((u) => probe(u, u === LAN_HTTP, null)),
      ),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    expect(offered.at(-1)).toEqual([LAN_HTTP, LAN_HTTPS, TUNNEL])
  })

  it('never synthesises a counterpart the hub did not advertise (the toggle is the hub’s)', async () => {
    endpointsQuery.mockResolvedValue({
      endpoints: [lan(LAN_HTTP, 0), TUNNEL_EP],
      localPort: HUB_PORT,
    })
    viewerQuery.mockResolvedValue({ baseUrls: [], resolved: [LAN_HTTP, TUNNEL] })
    const offered: string[][] = []
    const ctrl = new SystemController({
      serverUrl: TUNNEL,
      token: 'jwt',
      candidates: [TUNNEL],
      pageProtocol: null,
      raceCandidatesImpl: raceReturning(offered, (urls) =>
        urls.map((u) => probe(u, u === LAN_HTTP, null)),
      ),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    expect(offered.at(-1)).toEqual([LAN_HTTP, TUNNEL])
  })
})

describe('a failed TLS candidate is skipped and explained once per session', () => {
  it('logs tls-untrusted once, however many races follow, and still connects', async () => {
    const offered: string[][] = []
    const ctrl = new SystemController({
      serverUrl: TUNNEL,
      token: 'jwt',
      candidates: [TUNNEL],
      pageProtocol: null,
      raceCandidatesImpl: raceReturning(offered, (urls) =>
        urls.map((u) =>
          u === LAN_HTTPS
            ? probe(u, false, 'TypeError: Network request failed')
            : probe(u, u === LAN_HTTP, null),
        ),
      ),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    await ctrl.reprobe()
    await ctrl.routeSettled()
    const failures = probeLog.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((m) => m['trigger'] === 'secure-twin-failed')
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatchObject({ url: LAN_HTTPS, reason: 'tls-untrusted' })
  })

  it('says unreachable when the host answers on neither address', async () => {
    const ctrl = new SystemController({
      serverUrl: TUNNEL,
      token: 'jwt',
      candidates: [TUNNEL],
      pageProtocol: null,
      raceCandidatesImpl: raceReturning([], (urls) =>
        urls.map((u) => probe(u, u === TUNNEL, u === TUNNEL ? null : 'TypeError: Network request failed')),
      ),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    const failure = probeLog.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((m) => m['trigger'] === 'secure-twin-failed')
    expect(failure).toMatchObject({ url: LAN_HTTPS, reason: 'unreachable' })
  })

  it('classifies by words where the platform gives them, by the sibling where it does not', () => {
    const httpOk = probe(LAN_HTTP, true, null)
    const httpDown = probe(LAN_HTTP, false, 'TypeError: Network request failed')
    const words = probe(LAN_HTTPS, false, 'TypeError: The certificate for this server is invalid')
    const silent = probe(LAN_HTTPS, false, 'TypeError: Network request failed')
    const timeout = probe(LAN_HTTPS, false, 'AbortError: aborted')
    expect(classifySecureTwinFailure(words, [httpDown, words])).toBe('tls-untrusted')
    expect(classifySecureTwinFailure(silent, [httpOk, silent])).toBe('tls-untrusted')
    expect(classifySecureTwinFailure(silent, [httpDown, silent])).toBe('unreachable')
    expect(classifySecureTwinFailure(timeout, [httpOk, timeout])).toBe('unreachable')
    expect(classifySecureTwinFailure(httpOk, [httpOk, silent])).toBeNull()
    expect(classifySecureTwinFailure(silent, [silent])).toBeNull()
  })
})

describe('raceCandidates with a secure twin', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** A fetch that answers 200 after `ms`, or never (until aborted) when `null`. */
  function fakeFetch(answers: Readonly<Record<string, number | null | 'tls-fail'>>) {
    return (url: string, init: { signal: AbortSignal }): Promise<{ status: number }> =>
      new Promise((resolve, reject) => {
        const origin = url.replace(/\/health$/, '')
        const plan = answers[origin]
        if (plan === 'tls-fail') {
          setTimeout(() => reject(new TypeError('Network request failed')), 3)
          return
        }
        init.signal.addEventListener('abort', () => reject(new Error('AbortError: aborted')))
        if (typeof plan === 'number') setTimeout(() => resolve({ status: 200 }), plan)
      })
  }
  const deps = (answers: Readonly<Record<string, number | null | 'tls-fail'>>) => ({
    fetchImpl: fakeFetch(answers),
    now: () => Date.now(),
  })

  it('does not wait for a twin that never answers: the race ends one grace after the first answer', async () => {
    const outcome = raceCandidates([LAN_HTTP, LAN_HTTPS, TUNNEL], 1500, deps({
      [LAN_HTTP]: 20,
      [LAN_HTTPS]: null,
      [TUNNEL]: 40,
    }))
    let settledAt: number | null = null
    void outcome.then(() => {
      settledAt = Date.now()
    })
    const t0 = Date.now()
    await vi.advanceTimersByTimeAsync(20 + SECURE_TWIN_GRACE_MS + 5)
    const result = await outcome
    expect(settledAt).not.toBeNull()
    expect((settledAt ?? 0) - t0).toBeLessThanOrEqual(20 + SECURE_TWIN_GRACE_MS + 5)
    expect(result.winner).toBe(LAN_HTTP)
    expect(result.results.find((r) => r.url === LAN_HTTPS)?.ok).toBe(false)
  })

  it('a twin that fails at once (untrusted certificate) costs nothing', async () => {
    const outcome = raceCandidates([LAN_HTTP, LAN_HTTPS, TUNNEL], 1500, deps({
      [LAN_HTTP]: 20,
      [LAN_HTTPS]: 'tls-fail',
      [TUNNEL]: 40,
    }))
    await vi.advanceTimersByTimeAsync(40)
    const result = await outcome
    expect(result.winner).toBe(LAN_HTTP)
    expect(result.results.find((r) => r.url === LAN_HTTPS)?.error).toContain('Network request failed')
  })

  it('when both addresses of one host answer, https wins even if http was faster', async () => {
    const outcome = raceCandidates([LAN_HTTP, LAN_HTTPS, TUNNEL], 1500, deps({
      [LAN_HTTP]: 10,
      [LAN_HTTPS]: 60,
      [TUNNEL]: 150,
    }))
    await vi.advanceTimersByTimeAsync(400)
    expect((await outcome).winner).toBe(LAN_HTTPS)
  })

  it('an https answer later than the grace does not displace the plain winner', async () => {
    const outcome = raceCandidates([LAN_HTTP, LAN_HTTPS], 1500, deps({
      [LAN_HTTP]: 10,
      [LAN_HTTPS]: 600,
    }))
    await vi.advanceTimersByTimeAsync(700)
    expect((await outcome).winner).toBe(LAN_HTTP)
  })

  it('another host over https is no twin: the fastest answer still wins', async () => {
    const other = 'https://198.51.100.7:4443'
    expect(secureTwinUrls([LAN_HTTP, other, TUNNEL]).size).toBe(0)
    const outcome = raceCandidates([LAN_HTTP, other], 1500, deps({
      [LAN_HTTP]: 30,
      [other]: 10,
    }))
    await vi.advanceTimersByTimeAsync(100)
    expect((await outcome).winner).toBe(other)
  })
})
