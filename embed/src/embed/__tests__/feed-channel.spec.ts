import { describe, expect, it } from 'vitest'
import { describeFeedChannel } from '../feed-channel'

describe('describeFeedChannel', () => {
  it('names a private address LAN', () => {
    expect(describeFeedChannel('https://192.168.0.10:4443')).toBe('lan:192.168.0.10:4443')
    expect(describeFeedChannel('https://10.1.2.3')).toBe('lan:10.1.2.3')
    expect(describeFeedChannel('https://hub.local:4443')).toBe('lan:hub.local:4443')
  })

  it('names a public hostname a tunnel', () => {
    expect(describeFeedChannel('https://camstack.example.top')).toBe('public:camstack.example.top')
  })

  it('names loopback loopback — hub-served web is not a LAN session', () => {
    expect(describeFeedChannel('https://127.0.0.1:4443')).toBe('loopback:127.0.0.1:4443')
    expect(describeFeedChannel('http://localhost:8081')).toBe('loopback:localhost:8081')
  })

  it('keeps the PORT — 4443 and 443 are two different routes to one hub', () => {
    expect(describeFeedChannel('https://192.168.0.10:4443')).toContain(':4443')
  })

  it('never throws on a URL the host bridge mangled', () => {
    expect(describeFeedChannel('')).toBe('unknown:(unparseable)')
    expect(describeFeedChannel('not a url')).toBe('unknown:(unparseable)')
  })

  it('agrees with the host app vocabulary — the two classifiers must not need translating', () => {
    // Same four words as src/connection/route-channel.ts.
    for (const url of ['https://192.168.0.10', 'https://a.b', 'https://localhost', 'https://hub'])
      expect(describeFeedChannel(url).split(':')[0]).toMatch(/^(lan|public|loopback|unknown)$/)
  })
})
