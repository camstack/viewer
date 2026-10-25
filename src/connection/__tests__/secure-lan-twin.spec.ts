/**
 * secure-lan-twin — the hosted PWA (an `https:` page) must still race the LAN.
 *
 * Operator report 2026-10-07: on https://camstack.zentik.app the probe showed
 * "1/1" and the app never used the hub's LAN address. With LAN HTTP on, the
 * hub advertises every LAN address only as `http://<ip>:4480`; the page drops
 * that as mixed content and only the tunnel was left. The fixtures below are
 * the LIVE shapes the hub returned that day.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { CandidateRaceOutcome } from '../candidate-probe.js'
import {
  pinnableRouteEndpoints,
  secureLanTwin,
  withSecureLanTwins,
  type AdvertisedLocalPort,
  type DiscoveredEndpoint,
} from '../endpoint-discovery.js'
import { SystemController } from '../system-controller.js'

const { createSystem, endpointsQuery, viewerQuery } = vi.hoisted(() => ({
  createSystem: vi.fn(),
  endpointsQuery: vi.fn(),
  viewerQuery: vi.fn(),
}))

vi.mock('@camstack/sdk', () => ({ createSystem }))

const TUNNEL = 'https://camstack.example.com'
const LAN_HTTP = 'http://192.0.2.10:4480'
const LAN_HTTPS = 'https://192.0.2.10:4443'

const LIVE_LAN: DiscoveredEndpoint = {
  label: 'LAN — eth0',
  baseUrl: LAN_HTTP,
  kind: 'lan-ipv4',
  interfaceKind: 'lan',
  plausible: true,
  plausibleReason: '',
  priority: 0,
}
const LIVE_TUNNEL: DiscoveredEndpoint = {
  label: 'Public tunnel',
  baseUrl: TUNNEL,
  kind: 'public',
  interfaceKind: 'public',
  plausible: true,
  plausibleReason: '',
  priority: 100,
}
const HUB_PORT: AdvertisedLocalPort = { port: 4443, source: 'server-config' }

describe('secureLanTwin', () => {
  it('moves a plain-http LAN address onto the port the hub declared for itself', () => {
    expect(secureLanTwin(LIVE_LAN, HUB_PORT)).toEqual({ ...LIVE_LAN, baseUrl: LAN_HTTPS })
  })

  it('handles an IPv6 literal', () => {
    const v6: DiscoveredEndpoint = { ...LIVE_LAN, kind: 'lan-ipv6', baseUrl: 'http://[fd00::9]:4480' }
    expect(secureLanTwin(v6, HUB_PORT)?.baseUrl).toBe('https://[fd00::9]:4443')
  })

  it('never builds on a port the hub did not state as its own', () => {
    expect(secureLanTwin(LIVE_LAN, null)).toBeNull()
    expect(secureLanTwin(LIVE_LAN, { port: 443, source: 'caller-hint' })).toBeNull()
    expect(secureLanTwin(LIVE_LAN, { port: 4443, source: 'default' })).toBeNull()
    expect(secureLanTwin(LIVE_LAN, { port: 4443, source: 'server-env' })?.baseUrl).toBe(LAN_HTTPS)
  })

  it('leaves non-LAN kinds and already-https addresses alone', () => {
    expect(secureLanTwin(LIVE_TUNNEL, HUB_PORT)).toBeNull()
    expect(secureLanTwin({ ...LIVE_LAN, kind: 'loopback', baseUrl: 'http://127.0.0.1:4480' }, HUB_PORT)).toBeNull()
    expect(secureLanTwin({ ...LIVE_LAN, baseUrl: LAN_HTTPS }, HUB_PORT)).toBeNull()
  })
})

describe('withSecureLanTwins', () => {
  it('on an https page replaces the http LAN in place, keeping its rank', () => {
    expect(withSecureLanTwins([LIVE_LAN, LIVE_TUNNEL], HUB_PORT, 'https:')).toEqual([
      { ...LIVE_LAN, baseUrl: LAN_HTTPS },
      LIVE_TUNNEL,
    ])
  })

  it('is a no-op natively and on an http page — the fast http listener stays', () => {
    expect(withSecureLanTwins([LIVE_LAN, LIVE_TUNNEL], HUB_PORT, null)).toEqual([LIVE_LAN, LIVE_TUNNEL])
    expect(withSecureLanTwins([LIVE_LAN, LIVE_TUNNEL], HUB_PORT, 'http:')).toEqual([LIVE_LAN, LIVE_TUNNEL])
  })

  it('does not duplicate a twin the hub already advertised', () => {
    const httpsLan = { ...LIVE_LAN, baseUrl: LAN_HTTPS, label: 'LAN — eth0 (TLS)' }
    expect(withSecureLanTwins([LIVE_LAN, httpsLan, LIVE_TUNNEL], HUB_PORT, 'https:').map((e) => e.baseUrl)).toEqual([
      LAN_HTTPS,
      TUNNEL,
    ])
  })
})

describe('pinnableRouteEndpoints', () => {
  it('never offers an address the https page would refuse to pin', () => {
    expect(pinnableRouteEndpoints([LIVE_LAN, LIVE_TUNNEL], 'https:')).toEqual([LIVE_TUNNEL])
    expect(pinnableRouteEndpoints([LIVE_LAN, LIVE_TUNNEL], null)).toEqual([LIVE_LAN, LIVE_TUNNEL])
  })

  it('never offers loopback, on any page', () => {
    const loopback: DiscoveredEndpoint = { ...LIVE_LAN, kind: 'loopback', baseUrl: 'https://127.0.0.1:4443' }
    expect(pinnableRouteEndpoints([loopback, LIVE_TUNNEL], null)).toEqual([LIVE_TUNNEL])
    expect(pinnableRouteEndpoints([loopback, LIVE_TUNNEL], 'https:')).toEqual([LIVE_TUNNEL])
  })
})

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

function recordingRace(offered: string[][]): (urls: readonly string[]) => Promise<CandidateRaceOutcome> {
  return async (urls) => {
    offered.push([...urls])
    const winner = urls[0] ?? null
    return {
      winner,
      results: urls.map((url) => ({ url, ok: url === winner, ms: 5, status: 200, error: null })),
    }
  }
}

beforeEach(() => {
  createSystem.mockReset()
  createSystem.mockImplementation((opts: { serverUrl: string; onConnectionChange: (s: string) => void }) => {
    const sys = new FakeSystem(opts.serverUrl)
    sys.onConnectionChange = opts.onConnectionChange
    return sys
  })
  endpointsQuery.mockReset()
  endpointsQuery.mockResolvedValue({ endpoints: [LIVE_LAN, LIVE_TUNNEL], localPort: HUB_PORT })
  viewerQuery.mockReset()
  viewerQuery.mockResolvedValue({ baseUrls: [], resolved: [LAN_HTTP, TUNNEL] })
})

describe('SystemController against the live hub shape', () => {
  it('on the hosted PWA races the LAN over HTTPS, ahead of the tunnel', async () => {
    const offered: string[][] = []
    const discovered: DiscoveredEndpoint[][] = []
    const ctrl = new SystemController({
      serverUrl: TUNNEL,
      token: 'jwt',
      candidates: [TUNNEL],
      pageProtocol: 'https:',
      raceCandidatesImpl: recordingRace(offered),
      onEndpointsDiscovered: (e) => discovered.push([...e]),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    expect(offered.flat()).not.toContain(LAN_HTTP)
    expect(offered.at(-1)).toEqual([LAN_HTTPS, TUNNEL])
    // What Settings lists (and what is persisted) is the usable twin.
    expect(discovered.at(-1)?.map((e) => e.baseUrl)).toEqual([LAN_HTTPS, TUNNEL])
    // The diagnose probe sees two routes, not "1/1".
    const probes = await ctrl.diagnoseRoutes()
    expect(probes.map((p) => p.url).sort()).toEqual([LAN_HTTPS, TUNNEL].sort())
  })

  it('natively keeps racing the plain-http LAN listener', async () => {
    const offered: string[][] = []
    const ctrl = new SystemController({
      serverUrl: TUNNEL,
      token: 'jwt',
      candidates: [TUNNEL],
      pageProtocol: null,
      raceCandidatesImpl: recordingRace(offered),
    })
    await ctrl.connect()
    await ctrl.routeSettled()
    expect(offered.at(-1)).toEqual([LAN_HTTP, TUNNEL])
  })

  it('refuses a plain-http pin on an https page and SAYS so', async () => {
    const ctrl = new SystemController({
      serverUrl: TUNNEL,
      token: 'jwt',
      candidates: [TUNNEL],
      pageProtocol: 'https:',
      raceCandidatesImpl: recordingRace([]),
    })
    await expect(ctrl.setPinnedRouteUrl(LAN_HTTP)).resolves.toEqual({ kind: 'refused', reason: 'mixed-content' })
    expect(ctrl.getPinnedRouteUrl()).toBeNull()
    await expect(ctrl.setPinnedRouteUrl(LAN_HTTPS)).resolves.toEqual({ kind: 'applied' })
    expect(ctrl.getPinnedRouteUrl()).toBe(LAN_HTTPS)
  })
})
