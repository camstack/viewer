import { describe, it, expect, vi } from 'vitest'
import {
  shouldAttemptHubSessionExchange,
  shouldBounceToHubLogin,
  exchangeHubSession,
  buildHubLoginUrl,
  EXCHANGE_SESSION_HEADER,
} from '../hub-session-exchange.js'
import type { FetchLike } from '../hub-auth-wire.js'

function okBody(token = 'jwt-1', username = 'alice'): string {
  return JSON.stringify({
    result: { data: { json: { token, user: { id: 'u-1', username, isAdmin: false } } } },
  })
}

function fakeFetch(status: number, body: string): { fetchFn: FetchLike; calls: unknown[][] } {
  const calls: unknown[][] = []
  const fetchFn: FetchLike = async (url, init) => {
    calls.push([url, init])
    return new Response(body, {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { fetchFn, calls }
}

describe('shouldAttemptHubSessionExchange', () => {
  const base = {
    platform: 'web',
    pathname: '/viewer/camstack/',
    webBasePath: '/viewer',
    hasServerConfigured: false,
    standalone: false,
  }

  it('attempts on web, under the built base path, with no server configured', () => {
    expect(shouldAttemptHubSessionExchange(base)).toBe(true)
    expect(shouldAttemptHubSessionExchange({ ...base, pathname: '/viewer' })).toBe(true)
    expect(
      shouldAttemptHubSessionExchange({ ...base, pathname: '/viewer/camstack/cameras' }),
    ).toBe(true)
  })

  it('never attempts when a server is already configured (non-invasive)', () => {
    expect(shouldAttemptHubSessionExchange({ ...base, hasServerConfigured: true })).toBe(false)
  })

  it('never attempts off-web', () => {
    expect(shouldAttemptHubSessionExchange({ ...base, platform: 'ios' })).toBe(false)
    expect(shouldAttemptHubSessionExchange({ ...base, platform: 'android' })).toBe(false)
  })

  it('requires the hub mount path', () => {
    expect(shouldAttemptHubSessionExchange({ ...base, pathname: '/' })).toBe(false)
    expect(shouldAttemptHubSessionExchange({ ...base, pathname: '/viewerx/app' })).toBe(false)
    expect(shouldAttemptHubSessionExchange({ ...base, pathname: null })).toBe(false)
  })

  it('falls back to the well-known /viewer/ prefix when no base path was baked in', () => {
    expect(
      shouldAttemptHubSessionExchange({ ...base, webBasePath: null, pathname: '/viewer/camstack/' }),
    ).toBe(true)
    expect(shouldAttemptHubSessionExchange({ ...base, webBasePath: '', pathname: '/other/' })).toBe(
      false,
    )
  })

  it('still attempts the exchange in a standalone web app', () => {
    // One request, and on Android the installed app shares the browser's
    // cookie jar, so it can succeed there. Only the BOUNCE is standalone-gated.
    expect(shouldAttemptHubSessionExchange({ ...base, standalone: true })).toBe(true)
  })
})

/**
 * An installed iOS web app has its own cookie jar, so its first launch is
 * always unauthenticated. Bouncing it to `/login` — OUTSIDE the manifest
 * scope `/viewer/camstack/` — opened the admin login in the in-app browser
 * sheet, whose cookies are Safari's, not the app's: the login could not
 * provision the PWA, the redirect back loaded a second viewer inside the
 * sheet, and the app itself came back with `bounced=1` and showed the manual
 * login it should have shown at once.
 */
describe('shouldBounceToHubLogin', () => {
  it('bounces a browser tab — the admin login shares its cookie jar', () => {
    expect(shouldBounceToHubLogin({ standalone: false })).toBe(true)
  })

  it('never bounces a standalone web app', () => {
    expect(shouldBounceToHubLogin({ standalone: true })).toBe(false)
  })
})

describe('exchangeHubSession', () => {
  it('POSTs the tRPC mutation with cookie credentials + CSRF header and returns the token', async () => {
    const { fetchFn, calls } = fakeFetch(200, okBody())
    const outcome = await exchangeHubSession('https://hub.example', fetchFn)
    expect(outcome).toEqual({ status: 'ok', token: 'jwt-1', username: 'alice', refreshToken: null })

    const [url, init] = calls[0] as [string, RequestInit]
    expect(url).toBe('https://hub.example/trpc/auth.exchangeSession')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.body).toBe('{"json":{"refreshable":true}}')
    const headers = init.headers as Record<string, string>
    expect(headers[EXCHANGE_SESSION_HEADER]).toBe('1')
    expect(headers['content-type']).toBe('application/json')
  })

  it('maps 401 to unauthorized (no session cookie)', async () => {
    const { fetchFn } = fakeFetch(401, JSON.stringify({ error: { json: {} } }))
    expect(await exchangeHubSession('https://hub.example', fetchFn)).toEqual({
      status: 'unauthorized',
    })
  })

  it('maps 403 to unauthorized (CSRF gate)', async () => {
    const { fetchFn } = fakeFetch(403, JSON.stringify({ error: { json: {} } }))
    expect(await exchangeHubSession('https://hub.example', fetchFn)).toEqual({
      status: 'unauthorized',
    })
  })

  it('maps a 500 and a malformed body to error', async () => {
    const { fetchFn } = fakeFetch(500, 'boom')
    expect((await exchangeHubSession('https://hub.example', fetchFn)).status).toBe('error')

    const malformed = fakeFetch(200, JSON.stringify({ nope: true }))
    expect((await exchangeHubSession('https://hub.example', malformed.fetchFn)).status).toBe(
      'error',
    )
  })

  it('maps a network failure to error (never throws)', async () => {
    const fetchFn: FetchLike = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await exchangeHubSession('https://hub.example', fetchFn)).toEqual({
      status: 'error',
      message: 'offline',
    })
  })
})

describe('buildHubLoginUrl', () => {
  it('targets the admin-ui login with the encoded return path', () => {
    expect(buildHubLoginUrl('https://hub.example', '/viewer/camstack/')).toBe(
      'https://hub.example/login?redirect=%2Fviewer%2Fcamstack%2F',
    )
  })
})
