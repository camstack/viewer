import { describe, expect, it } from 'vitest'
import {
  classifyHost,
  describeRoute,
  isLocalRouteChannel,
  normaliseBaseUrl,
  routeSummary,
  type ChannelEndpoint,
} from '../route-channel.js'

const HUB_ENDPOINTS: readonly ChannelEndpoint[] = [
  { baseUrl: 'https://192.168.0.10:4443', label: 'LAN — eth0', kind: 'lan-ipv4' },
  { baseUrl: 'https://camstack.example.top', label: 'Public tunnel', kind: 'public' },
  { baseUrl: 'https://127.0.0.1:4443', label: 'Loopback', kind: 'loopback' },
]

describe('normaliseBaseUrl', () => {
  it('drops trailing slashes so two spellings compare equal', () => {
    expect(normaliseBaseUrl('https://h:4443///')).toBe('https://h:4443')
    expect(normaliseBaseUrl('https://h:4443')).toBe('https://h:4443')
  })
})

describe('classifyHost', () => {
  it('names the private ranges LAN', () => {
    for (const h of ['192.168.0.10:4443', '10.0.0.4', '172.20.3.1', 'hub.local'])
      expect(classifyHost(h)).toBe('lan')
  })

  it('names loopback loopback, PORT AND ALL', () => {
    // `localhost:8081` is the hub-served web build. Comparing it to `localhost`
    // without stripping the port classified it `unknown` — a near-miss that
    // makes the whole diagnostic quietly useless.
    for (const h of ['localhost', 'localhost:8081', '127.0.0.1:4443', '[::1]', '[::1]:4443'])
      expect(classifyHost(h)).toBe('loopback')
  })

  it('names a public DNS name public', () => {
    expect(classifyHost('camstack.example.top')).toBe('public')
  })

  it('refuses to guess at a bare word', () => {
    expect(classifyHost('hub')).toBe('unknown')
  })
})

describe('isLocalRouteChannel', () => {
  it('treats LAN and loopback as local, everything else as remote', () => {
    expect(isLocalRouteChannel('lan')).toBe(true)
    expect(isLocalRouteChannel('loopback')).toBe(true)
    expect(isLocalRouteChannel('public')).toBe(false)
    expect(isLocalRouteChannel('unknown')).toBe(false)
  })
})

describe('describeRoute', () => {
  it("prefers the hub's own kind over the hostname shape", () => {
    const r = describeRoute('https://192.168.0.10:4443', HUB_ENDPOINTS, 'race-won')
    expect(r.channel).toBe('lan')
    expect(r.endpointLabel).toBe('LAN — eth0')
    expect(r.reason).toBe('race-won')
  })

  it('matches through a trailing slash', () => {
    expect(describeRoute('https://camstack.example.top/', HUB_ENDPOINTS, 'unchanged').channel).toBe(
      'public',
    )
  })

  it('classifies by shape when the hub never advertised the URL, and says so', () => {
    const r = describeRoute('https://old-bookmark.example.com', HUB_ENDPOINTS, 'initial')
    expect(r.channel).toBe('public')
    // null endpointLabel is the signal that this URL is not one the hub offers.
    expect(r.endpointLabel).toBeNull()
  })

  it('never throws on an unparseable URL — instrumentation may not crash its subject', () => {
    const r = describeRoute('not a url', [], 'initial')
    expect(r.channel).toBe('unknown')
    expect(r.host).toBe('(unparseable)')
  })

  it('carries the reason so a decision is distinguishable from a leftover', () => {
    const won = describeRoute('https://camstack.example.top', HUB_ENDPOINTS, 'race-won')
    const gaveUp = describeRoute('https://camstack.example.top', HUB_ENDPOINTS, 'no-winner')
    expect(won.url).toBe(gaveUp.url)
    expect(routeSummary(won)).not.toBe(routeSummary(gaveUp))
    expect(routeSummary(gaveUp)).toBe('public:camstack.example.top (no-winner)')
  })
})
