import { describe, it, expect } from 'vitest'
import {
  buildHandoffLoginUrl,
  canonicalizeCallbackUrl,
  extractHandoffCode,
  isValidServerUrl,
  redeemHandoffCode,
} from '../handoff.js'
import type { FetchLike } from '../hub-auth-wire.js'

describe('buildHandoffLoginUrl', () => {
  it('points at the admin-ui login with the encoded app callback', () => {
    expect(buildHandoffLoginUrl('https://hub.example:4443', 'camstack://auth-callback')).toBe(
      'https://hub.example:4443/login?redirect=camstack%3A%2F%2Fauth-callback',
    )
  })

  it('tolerates a trailing slash on the server URL', () => {
    expect(buildHandoffLoginUrl('https://hub.example/', 'camstack://auth-callback')).toBe(
      'https://hub.example/login?redirect=camstack%3A%2F%2Fauth-callback',
    )
  })
})

describe('extractHandoffCode', () => {
  it('pulls the code off the callback deep link', () => {
    expect(extractHandoffCode('camstack://auth-callback?code=chc_abc123')).toBe('chc_abc123')
    expect(extractHandoffCode('camstack:///auth-callback?code=chc_abc123')).toBe('chc_abc123')
    expect(extractHandoffCode('camstack.dev://auth-callback?code=chc_x&y=1')).toBe('chc_x')
  })

  it('URL-decodes the code', () => {
    expect(extractHandoffCode('camstack://auth-callback?code=chc_a%2Bb')).toBe('chc_a+b')
  })

  it('returns null when absent or empty', () => {
    expect(extractHandoffCode('camstack://auth-callback')).toBeNull()
    expect(extractHandoffCode('camstack://auth-callback?code=')).toBeNull()
    expect(extractHandoffCode('camstack://auth-callback?other=1')).toBeNull()
  })
})

describe('redeemHandoffCode', () => {
  function fakeFetch(status: number, body: string): { fetchFn: FetchLike; calls: unknown[][] } {
    const calls: unknown[][] = []
    const fetchFn: FetchLike = async (url, init) => {
      calls.push([url, init])
      return new Response(body, { status, headers: { 'content-type': 'application/json' } })
    }
    return { fetchFn, calls }
  }

  it('POSTs the code and returns the session token', async () => {
    const { fetchFn, calls } = fakeFetch(
      200,
      JSON.stringify({
        result: {
          data: { json: { token: 'jwt-2', user: { id: 'u-1', username: 'alice', isAdmin: true } } },
        },
      }),
    )
    const outcome = await redeemHandoffCode('https://hub.example', 'chc_abc', fetchFn)
    expect(outcome).toEqual({ status: 'ok', token: 'jwt-2', username: 'alice', refreshToken: null })

    const [url, init] = calls[0] as [string, RequestInit]
    expect(url).toBe('https://hub.example/trpc/auth.redeemHandoffCode')
    // Asks for a refreshing session (D812); an older hub strips the flag.
    expect(init.body).toBe('{"json":{"code":"chc_abc","refreshable":true}}')
    // No ambient cookies needed — the code IS the credential.
    expect(init.credentials).toBeUndefined()
  })

  it('carries the refresh token a D812 hub answers with', async () => {
    const { fetchFn } = fakeFetch(
      200,
      JSON.stringify({
        result: {
          data: {
            json: {
              token: 'jwt-3',
              refreshToken: 'csr_1',
              user: { id: 'u-1', username: 'alice', isAdmin: false },
            },
          },
        },
      }),
    )
    expect(await redeemHandoffCode('https://hub.example', 'chc_abc', fetchFn)).toEqual({
      status: 'ok',
      token: 'jwt-3',
      username: 'alice',
      refreshToken: 'csr_1',
    })
  })

  it('maps 401 (expired / used / forged code) to unauthorized', async () => {
    const { fetchFn } = fakeFetch(401, JSON.stringify({ error: { json: {} } }))
    expect(await redeemHandoffCode('https://hub.example', 'chc_dead', fetchFn)).toEqual({
      status: 'unauthorized',
    })
  })
})

describe('canonicalizeCallbackUrl', () => {
  it('normalizes the expo-linking triple-slash standalone form', () => {
    expect(canonicalizeCallbackUrl('camstack:///auth-callback')).toBe('camstack://auth-callback')
    expect(canonicalizeCallbackUrl('camstack.dev:///auth-callback')).toBe(
      'camstack.dev://auth-callback',
    )
    expect(canonicalizeCallbackUrl('camstack://auth-callback/')).toBe('camstack://auth-callback')
    expect(canonicalizeCallbackUrl('camstack://auth-callback')).toBe('camstack://auth-callback')
  })

  it('buildHandoffLoginUrl encodes the CANONICAL callback', () => {
    expect(buildHandoffLoginUrl('https://hub:4443/', 'camstack:///auth-callback')).toBe(
      'https://hub:4443/login?redirect=camstack%3A%2F%2Fauth-callback',
    )
  })
})

describe('isValidServerUrl', () => {
  it('accepts plausible http(s) base URLs', () => {
    expect(isValidServerUrl('https://hub.example.com:4443')).toBe(true)
    expect(isValidServerUrl('http://192.0.2.10')).toBe(true)
  })
  it('rejects empty, scheme-only prefill, and garbage', () => {
    expect(isValidServerUrl('')).toBe(false)
    expect(isValidServerUrl('https://')).toBe(false)
    expect(isValidServerUrl('not a url')).toBe(false)
    expect(isValidServerUrl('ftp://x')).toBe(false)
  })
})
