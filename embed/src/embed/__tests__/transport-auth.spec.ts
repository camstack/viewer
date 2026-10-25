/**
 * The credential-less mode: a config is valid WITHOUT a token when, and only
 * when, `serverUrl` is a same-origin path served through an authenticating
 * relay. See `transport-auth.ts` for why the token must not reach the browser
 * on that path.
 */
import { describe, expect, it } from 'vitest'
import {
  authorizationHeaders,
  embedServerUrl,
  isTransportAuthenticated,
} from '../transport-auth'
import { parseGridConfig } from '../embed-grid-config'
import { parseEventsConfig } from '../events-config'
import { EVENTS_EMBED_PATH, parseEventsUrlConfig } from '../events-url-config'

const RELAY = '/api/camstack/p/2f1c9a'
const HUB = 'https://hub.local:4443'

describe('isTransportAuthenticated', () => {
  it('is true only for a same-origin path', () => {
    expect(isTransportAuthenticated(RELAY)).toBe(true)
    expect(isTransportAuthenticated('/')).toBe(true)
  })

  it('is false for anything that leaves this origin', () => {
    expect(isTransportAuthenticated(HUB)).toBe(false)
    expect(isTransportAuthenticated('http://hub.local')).toBe(false)
    // Protocol-relative: another authority, so nothing on the way injects.
    expect(isTransportAuthenticated('//hub.local/api')).toBe(false)
    expect(isTransportAuthenticated('')).toBe(false)
  })
})

describe('authorizationHeaders', () => {
  it('sends nothing when the page holds no credential', () => {
    expect(authorizationHeaders(undefined)).toEqual({})
    expect(authorizationHeaders('')).toEqual({})
  })

  it('sends the bearer when it does', () => {
    expect(authorizationHeaders('tok_abc')).toEqual({ Authorization: 'Bearer tok_abc' })
  })
})

describe('embedServerUrl', () => {
  it('keeps the prefix the document was served under', () => {
    expect(embedServerUrl('https://ha.local:8123', `${RELAY}${EVENTS_EMBED_PATH}`, EVENTS_EMBED_PATH)).toBe(
      RELAY,
    )
  })

  it('falls back to the origin when the hub serves the bundle at the root', () => {
    expect(embedServerUrl(HUB, EVENTS_EMBED_PATH, EVENTS_EMBED_PATH)).toBe(HUB)
  })

  it('falls back to the origin on an unrecognised path (dev server, directory index)', () => {
    expect(embedServerUrl(HUB, '/embed/', EVENTS_EMBED_PATH)).toBe(HUB)
  })
})

describe('grid config without a token', () => {
  const base = {
    devices: [7],
    layout: 'auto',
    quality: 'auto',
    showName: true,
    showBadges: true,
    muted: true,
    paused: false,
  }

  it('is accepted behind the relay, and carries no token at all', () => {
    const r = parseGridConfig({ ...base, serverUrl: RELAY })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.config.serverUrl).toBe(RELAY)
      expect(r.config.token).toBeUndefined()
    }
  })

  it('is still REFUSED for a direct hub address', () => {
    const r = parseGridConfig({ ...base, serverUrl: HUB })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('token')
  })

  it('an empty token is refused on either path — absent is the only allowance', () => {
    expect(parseGridConfig({ ...base, serverUrl: RELAY, token: '' }).ok).toBe(false)
    expect(parseGridConfig({ ...base, serverUrl: HUB, token: '' }).ok).toBe(false)
  })
})

describe('events config without a token', () => {
  it('is accepted behind the relay', () => {
    const r = parseEventsConfig({ serverUrl: RELAY })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.config.token).toBeUndefined()
  })

  it('is still REFUSED for a direct hub address', () => {
    expect(parseEventsConfig({ serverUrl: HUB }).ok).toBe(false)
  })
})

describe('parseEventsUrlConfig behind the relay', () => {
  const search = `?mode=events&v=1&devices=1,5`
  const pathname = `${RELAY}${EVENTS_EMBED_PATH}`

  it('builds a WHOLE config from a URL with no `#t=` at all', () => {
    const r = parseEventsUrlConfig(search, '', 'https://ha.local:8123', pathname)
    expect(r).not.toBeNull()
    expect(r?.ok).toBe(true)
    if (r?.ok) {
      // The relay prefix, not the Home Assistant origin: an origin-only base
      // would send `/trpc` to Home Assistant, which knows nothing about it.
      expect(r.config.serverUrl).toBe(RELAY)
      expect(r.config.token).toBeUndefined()
      expect(r.config.deviceIds).toEqual([1, 5])
    }
  })

  it('still falls through (null) when the hub serves it directly and no `#t=` is given', () => {
    expect(parseEventsUrlConfig(search, '', HUB, EVENTS_EMBED_PATH)).toBeNull()
  })

  it('still honours a `#t=` link served directly by the hub', () => {
    const r = parseEventsUrlConfig(search, '#t=tok_abc', HUB, EVENTS_EMBED_PATH)
    expect(r?.ok).toBe(true)
    if (r?.ok) {
      expect(r.config.serverUrl).toBe(HUB)
      expect(r.config.token).toBe('tok_abc')
    }
  })
})
