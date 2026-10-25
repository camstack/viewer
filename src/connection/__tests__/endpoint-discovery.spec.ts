import { describe, it, expect, vi } from 'vitest'
import {
  parsePortScheme,
  dropUnverifiedPortEndpoints,
  dropLoopbackEndpoints,
  dropIpv6Endpoints,
  filterViewerRaceEndpoints,
  endpointsToCandidates,
  discoverEndpoints,
  type DiscoveredEndpoint,
} from '../endpoint-discovery.js'

function ep(over: Partial<DiscoveredEndpoint> & { baseUrl: string; priority: number }): DiscoveredEndpoint {
  return {
    label: over.label ?? over.baseUrl,
    baseUrl: over.baseUrl,
    kind: over.kind ?? 'lan-ipv4',
    interfaceKind: over.interfaceKind ?? 'lan',
    plausible: over.plausible ?? true,
    plausibleReason: over.plausibleReason ?? '',
    priority: over.priority,
  }
}

describe('parsePortScheme', () => {
  it('reads an explicit port + scheme', () => {
    expect(parsePortScheme('https://hub.example:4443')).toEqual({ port: 4443, scheme: 'https', explicitPort: true })
    expect(parsePortScheme('http://192.168.1.5:8080')).toEqual({ port: 8080, scheme: 'http', explicitPort: true })
  })

  it('defaults the port from the scheme when absent', () => {
    expect(parsePortScheme('https://hub.example')).toEqual({ port: 443, scheme: 'https', explicitPort: false })
    expect(parsePortScheme('http://hub.example')).toEqual({ port: 80, scheme: 'http', explicitPort: false })
  })

  it('falls back to 4443/https on an unparseable URL', () => {
    expect(parsePortScheme('not a url')).toEqual({ port: 4443, scheme: 'https', explicitPort: false })
  })
})

describe('endpointsToCandidates', () => {
  const serverUrl = 'https://public.example:4443'

  it('orders plausible endpoints by priority, then serverUrl, then non-plausible', () => {
    const eps = [
      ep({ baseUrl: 'https://10.0.0.5:4443', priority: 20 }),
      ep({ baseUrl: 'https://192.168.1.5:4443', priority: 10 }),
      ep({ baseUrl: 'https://172.17.0.2:4443', priority: 5, plausible: false, interfaceKind: 'docker' }),
    ]
    expect(endpointsToCandidates(eps, serverUrl)).toEqual([
      'https://192.168.1.5:4443', // plausible, priority 10
      'https://10.0.0.5:4443', // plausible, priority 20
      serverUrl, // guaranteed fallback
      'https://172.17.0.2:4443', // non-plausible, last
    ])
  })

  it('always includes serverUrl and dedupes it if also advertised', () => {
    const eps = [ep({ baseUrl: serverUrl, priority: 1, kind: 'public', interfaceKind: 'public' })]
    expect(endpointsToCandidates(eps, serverUrl)).toEqual([serverUrl])
  })

  it('returns just the serverUrl when there are no endpoints', () => {
    expect(endpointsToCandidates([], serverUrl)).toEqual([serverUrl])
  })

  it('keeps hub-advertised HTTP LAN URLs even when the configured URL is HTTPS', () => {
    const eps = [ep({ baseUrl: 'http://192.0.2.10:4480', priority: 1 })]
    expect(endpointsToCandidates(eps, 'https://camstack.example.top')).toEqual([
      'http://192.0.2.10:4480',
      'https://camstack.example.top',
    ])
  })
})

describe('dropLoopbackEndpoints', () => {
  it('drops kind=loopback and 127.0.0.1 / ::1 even when mis-tagged as LAN', () => {
    const kept = dropLoopbackEndpoints([
      ep({ baseUrl: 'http://192.0.2.10:4480', kind: 'lan-ipv4', priority: 0 }),
      ep({ baseUrl: 'http://127.0.0.1:4443', kind: 'loopback', plausible: false, priority: 1000 }),
      ep({ baseUrl: 'http://127.0.0.1:4480', kind: 'lan-ipv4', priority: 2 }),
      ep({ baseUrl: 'http://[::1]:4480', kind: 'lan-ipv6', priority: 3 }),
      ep({ baseUrl: 'http://[2a02:908:3614:bfa0::2]:4480', kind: 'lan-ipv6', priority: 11 }),
    ])
    expect(kept.map((e) => e.baseUrl)).toEqual([
      'http://192.0.2.10:4480',
      'http://[2a02:908:3614:bfa0::2]:4480',
    ])
  })
})

describe('dropIpv6Endpoints', () => {
  it('drops kind=lan-ipv6 and bracketed IPv6 literals, keeps v4 and public', () => {
    const kept = dropIpv6Endpoints([
      ep({ baseUrl: 'http://192.0.2.10:4480', kind: 'lan-ipv4', priority: 0 }),
      ep({ baseUrl: 'http://[2a02:908:3614:bfa0::2]:4480', kind: 'lan-ipv6', priority: 11 }),
      ep({ baseUrl: 'https://camstack.example.top', kind: 'public', interfaceKind: 'public', priority: 100 }),
      ep({ baseUrl: 'https://hub.tail.ts.net:4443', kind: 'public', interfaceKind: 'vpn', priority: 150 }),
    ])
    expect(kept.map((e) => e.baseUrl)).toEqual([
      'http://192.0.2.10:4480',
      'https://camstack.example.top',
      'https://hub.tail.ts.net:4443',
    ])
  })
})

describe('filterViewerRaceEndpoints', () => {
  const palette = [
    ep({ baseUrl: 'http://192.0.2.10:4480', kind: 'lan-ipv4', priority: 0 }),
    ep({ baseUrl: 'https://camstack.example.top', kind: 'public', interfaceKind: 'public', priority: 100 }),
    ep({ baseUrl: 'https://hub.tail.ts.net:4443', kind: 'public', interfaceKind: 'vpn', priority: 150 }),
  ]

  it('with no hub resolved set, AUTO is LAN IPv4 + public tunnel', () => {
    expect(filterViewerRaceEndpoints(palette, null).map((e) => e.baseUrl)).toEqual([
      'http://192.0.2.10:4480',
      'https://camstack.example.top',
    ])
  })

  it('with a hub resolved set, keeps only those URLs', () => {
    expect(
      filterViewerRaceEndpoints(palette, ['https://hub.tail.ts.net:4443']).map((e) => e.baseUrl),
    ).toEqual(['https://hub.tail.ts.net:4443'])
  })

  it('keeps an operator-enabled IPv6 URL when the hub resolved set includes it', () => {
    const withIpv6 = [
      ...palette,
      ep({ baseUrl: 'http://[2a02:908:3614:bfa0::2]:4480', kind: 'lan-ipv6', priority: 11 }),
    ]
    expect(
      filterViewerRaceEndpoints(withIpv6, [
        'http://192.0.2.10:4480',
        'http://[2a02:908:3614:bfa0::2]:4480',
      ]).map((e) => e.baseUrl),
    ).toEqual(['http://192.0.2.10:4480', 'http://[2a02:908:3614:bfa0::2]:4480'])
  })
})

describe('discoverEndpoints', () => {
  const eps = [ep({ baseUrl: 'https://192.168.1.5:4443', priority: 10 })]

  it('calls the localNetwork cap with port + scheme and returns its endpoints', async () => {
    const query = vi.fn(async () => ({ endpoints: eps }))
    const system = { trpcClient: { localNetwork: { getConnectionEndpoints: { query } } } }
    const out = await discoverEndpoints(system, 4443, 'https')
    // The port is still SENT: a hub older than the declared-port contract
    // requires it, and omitting it would turn a working old hub into a
    // validation error — a worse regression than the one being fixed.
    expect(query).toHaveBeenCalledWith({ port: 4443, scheme: 'https', includeLoopback: false })
    expect(out.endpoints).toEqual(eps)
  })

  it('strips loopback even if an older hub still advertises it', async () => {
    const query = vi.fn(async () => ({
      endpoints: [
        ...eps,
        ep({ baseUrl: 'http://127.0.0.1:4443', kind: 'loopback', plausible: false, priority: 1000 }),
      ],
    }))
    const system = { trpcClient: { localNetwork: { getConnectionEndpoints: { query } } } }
    const out = await discoverEndpoints(system, 4443, 'https')
    expect(out.endpoints.map((e) => e.kind)).not.toContain('loopback')
  })

  it('reports the port the hub declared, with its source', async () => {
    const query = vi.fn(async () => ({
      endpoints: eps,
      localPort: { port: 4443, source: 'server-config' },
    }))
    const system = { trpcClient: { localNetwork: { getConnectionEndpoints: { query } } } }
    const out = await discoverEndpoints(system, 443, 'https')
    expect(out.localPort).toEqual({ port: 4443, source: 'server-config' })
  })

  it('reports no declared port when the hub is too old to send one', async () => {
    const query = vi.fn(async () => ({ endpoints: eps }))
    const system = { trpcClient: { localNetwork: { getConnectionEndpoints: { query } } } }
    expect((await discoverEndpoints(system, 4443, 'https')).localPort).toBeNull()
  })

  it('refuses a malformed declared port rather than trusting it', async () => {
    const query = vi.fn(async () => ({ endpoints: eps, localPort: { port: 'nope' } }))
    const system = { trpcClient: { localNetwork: { getConnectionEndpoints: { query } } } }
    expect((await discoverEndpoints(system, 4443, 'https')).localPort).toBeNull()
  })

  it('returns nothing when the cap is absent (older hub)', async () => {
    const out = await discoverEndpoints({ trpcClient: {} }, 4443, 'https')
    expect(out).toEqual({ endpoints: [], localPort: null })
  })

  it('returns nothing when the query throws', async () => {
    const query = vi.fn(async () => { throw new Error('boom') })
    const system = { trpcClient: { localNetwork: { getConnectionEndpoints: { query } } } }
    expect(await discoverEndpoints(system, 4443, 'https')).toEqual({ endpoints: [], localPort: null })
  })

  it('AUTO drops advertised IPv6 when the hub has no explicit viewer resolved set', async () => {
    const query = vi.fn(async () => ({
      endpoints: [
        ep({ baseUrl: 'http://192.0.2.10:4480', kind: 'lan-ipv4', priority: 0 }),
        ep({ baseUrl: 'http://[2a02:908:3614:bfa0::2]:4480', kind: 'lan-ipv6', priority: 11 }),
      ],
    }))
    const system = { trpcClient: { localNetwork: { getConnectionEndpoints: { query } } } }
    const out = await discoverEndpoints(system, 4480, 'http')
    expect(out.endpoints.map((e) => e.kind)).toEqual(['lan-ipv4'])
  })

  it('keeps advertised IPv6 when the hub resolved set includes it', async () => {
    const ipv6 = 'http://[2a02:908:3614:bfa0::2]:4480'
    const query = vi.fn(async () => ({
      endpoints: [
        ep({ baseUrl: 'http://192.0.2.10:4480', kind: 'lan-ipv4', priority: 0 }),
        ep({ baseUrl: ipv6, kind: 'lan-ipv6', priority: 11 }),
      ],
    }))
    const viewerQuery = vi.fn(async () => ({
      baseUrls: [ipv6],
      resolved: [ipv6],
    }))
    const system = {
      trpcClient: {
        localNetwork: {
          getConnectionEndpoints: { query },
          getViewerEndpoints: { query: viewerQuery },
        },
      },
    }
    const out = await discoverEndpoints(system, 4480, 'http')
    expect(out.endpoints.map((e) => e.baseUrl)).toEqual([ipv6])
  })

  it('races only the hub viewer resolved set when the cap exists', async () => {
    const query = vi.fn(async () => ({
      endpoints: [
        ep({ baseUrl: 'http://192.0.2.10:4480', kind: 'lan-ipv4', priority: 0 }),
        ep({ baseUrl: 'https://camstack.example.top', kind: 'public', interfaceKind: 'public', priority: 100 }),
        ep({ baseUrl: 'https://hub.tail.ts.net:4443', kind: 'public', interfaceKind: 'vpn', priority: 150 }),
      ],
    }))
    const viewerQuery = vi.fn(async () => ({
      baseUrls: ['https://hub.tail.ts.net:4443'],
      resolved: ['https://hub.tail.ts.net:4443'],
    }))
    const system = {
      trpcClient: {
        localNetwork: {
          getConnectionEndpoints: { query },
          getViewerEndpoints: { query: viewerQuery },
        },
      },
    }
    const out = await discoverEndpoints(system, 4443, 'https')
    expect(out.endpoints.map((e) => e.baseUrl)).toEqual(['https://hub.tail.ts.net:4443'])
  })
})

describe('parsePortScheme — was the port THERE, or did we make it up?', () => {
  it('reports an explicit port as explicit', () => {
    expect(parsePortScheme('https://192.0.2.10:4443')).toEqual({
      port: 4443,
      scheme: 'https',
      explicitPort: true,
    })
  })

  it('marks a scheme-derived port as INFERRED — this is the whole bug', () => {
    // `https://camstack.example.top` → 443, which is right for the tunnel's
    // proxy and wrong for the hub's LAN socket. The hub echoes whatever it is
    // given, so this 443 came back as `https://192.0.2.10:443` for a hub
    // listening on 4443.
    expect(parsePortScheme('https://camstack.example.top')).toEqual({
      port: 443,
      scheme: 'https',
      explicitPort: false,
    })
    expect(parsePortScheme('http://hub.example')).toMatchObject({ port: 80, explicitPort: false })
  })

  it('never claims an unparseable URL gave us a port', () => {
    expect(parsePortScheme('nonsense').explicitPort).toBe(false)
  })
})

describe('dropUnverifiedPortEndpoints', () => {
  const eps = [
    { label: 'LAN', baseUrl: 'https://192.0.2.10:443', kind: 'lan-ipv4', interfaceKind: 'lan', plausible: true, plausibleReason: '', priority: 0 },
    { label: 'Public tunnel', baseUrl: 'https://t.example.top', kind: 'public', interfaceKind: 'public', plausible: true, plausibleReason: '', priority: 100 },
    { label: 'Loopback', baseUrl: 'https://127.0.0.1:443', kind: 'loopback', interfaceKind: 'loopback', plausible: false, plausibleReason: '', priority: 1000 },
  ] as const

  it('keeps everything when the port was really in the URL', () => {
    const { kept, dropped } = dropUnverifiedPortEndpoints(eps, { explicitPort: true, declared: null })
    expect(kept).toHaveLength(3)
    expect(dropped).toHaveLength(0)
  })

  it('drops the port-dependent endpoints when nobody can vouch for the port', () => {
    const { kept, dropped } = dropUnverifiedPortEndpoints(eps, { explicitPort: false, declared: null })
    expect(kept.map((e) => e.kind)).toEqual(['public'])
    expect(dropped.map((e) => e.kind)).toEqual(['lan-ipv4', 'loopback'])
  })

  it('never drops the PUBLIC endpoint — the hub builds that one from its own tunnel config', () => {
    // Losing it would leave the app with no candidates at all, which is a
    // worse failure than the one being fixed.
    const { kept } = dropUnverifiedPortEndpoints(eps, { explicitPort: false, declared: null })
    expect(kept.some((e) => e.kind === 'public')).toBe(true)
  })

  it('keeps the LAN candidate when the HUB declared the port, port-less URL or not', () => {
    // The whole point of the server half: the client no longer needs the port
    // to have been in its own configuration, because the hub sent its own.
    const { kept, dropped } = dropUnverifiedPortEndpoints(eps, {
      explicitPort: false,
      declared: { port: 4443, source: 'server-config' },
    })
    expect(kept).toHaveLength(3)
    expect(dropped).toHaveLength(0)
  })

  it('trusts a port read off the hub environment too', () => {
    const { kept } = dropUnverifiedPortEndpoints(eps, {
      explicitPort: false,
      declared: { port: 4443, source: 'server-env' },
    })
    expect(kept).toHaveLength(3)
  })

  it('does NOT trust a port the hub merely echoed back at us', () => {
    // `caller-hint` means the hub could not read its own config and replayed
    // our guess. Trusting it would be trusting ourselves twice.
    const { kept } = dropUnverifiedPortEndpoints(eps, {
      explicitPort: false,
      declared: { port: 443, source: 'caller-hint' },
    })
    expect(kept.map((e) => e.kind)).toEqual(['public'])
  })
})
