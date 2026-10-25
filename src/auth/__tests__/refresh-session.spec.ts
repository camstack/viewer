import { describe, expect, it, vi } from 'vitest'
import { renewSession, type RenewClient } from '../refresh-session.js'
import type { FetchLike } from '../hub-auth-wire.js'

const HUB = 'https://hub.example'

function okJson(json: unknown, status = 200): Response {
  return new Response(JSON.stringify({ result: { data: { json } } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function refusal(status: number, message = 'Session expired — sign in again'): Response {
  return new Response(JSON.stringify({ error: { json: { message, code: -32001 } } }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fetchReturning(response: () => Response): { fetchFn: FetchLike; calls: [string, RequestInit][] } {
  const calls: [string, RequestInit][] = []
  const fetchFn: FetchLike = async (url, init) => {
    calls.push([url, init ?? {}])
    return response()
  }
  return { fetchFn, calls }
}

const REFRESHED = {
  token: 'access-2',
  refreshToken: 'csr_2',
  expiresAt: 1,
  sessionId: 'ls_1',
  sessionExpiresAt: 2,
  user: { id: 'u1', username: 'op', isAdmin: false },
}

/** A live client; each procedure is a spy so a test can say which ran. */
function client(over: {
  create?: (input?: unknown) => Promise<unknown>
  redeem?: (input: unknown) => Promise<unknown>
} = {}): { client: RenewClient; create: ReturnType<typeof vi.fn>; redeem: ReturnType<typeof vi.fn> } {
  const create = vi.fn(over.create ?? (async () => ({ code: 'chc_1', expiresAt: 1 })))
  const redeem = vi.fn(over.redeem ?? (async () => ({ token: 'legacy-2', user: REFRESHED.user })))
  return {
    create,
    redeem,
    client: { auth: { createHandoffCode: { mutate: create }, redeemHandoffCode: { mutate: redeem } } },
  }
}

const unauthorized = (): Error => Object.assign(new Error('UNAUTHORIZED'), { data: { code: 'UNAUTHORIZED' } })
const badRequest = (): Error => Object.assign(new Error('BAD_REQUEST'), { data: { code: 'BAD_REQUEST' } })

describe('renewSession — a refreshing session (D812)', () => {
  it('swaps the refresh token at auth.refreshSession and keeps the ROTATED one', async () => {
    const { fetchFn, calls } = fetchReturning(() => okJson(REFRESHED))
    const live = client()
    const out = await renewSession({
      serverUrl: HUB,
      refreshToken: 'csr_1',
      currentToken: 'access-1',
      client: live.client,
      fetchFn,
    })
    expect(out).toEqual({ status: 'renewed', token: 'access-2', refreshToken: 'csr_2', supersededToken: null })
    expect(calls[0]?.[0]).toBe('https://hub.example/trpc/auth.refreshSession')
    expect(calls[0]?.[1].body).toBe('{"json":{"refreshToken":"csr_1"}}')
    // Public procedure: the refresh token IS the credential.
    expect((calls[0]?.[1].headers as Record<string, string>).authorization).toBeUndefined()
    expect(live.create).not.toHaveBeenCalled()
  })

  it('a 401 is the hub ending the session: refused, and no legacy attempt', async () => {
    const { fetchFn } = fetchReturning(() => refusal(401))
    const live = client()
    const out = await renewSession({ serverUrl: HUB, refreshToken: 'csr_old', currentToken: 'a', client: live.client, fetchFn })
    expect(out).toEqual({ status: 'refused' })
    expect(live.create).not.toHaveBeenCalled()
  })

  it('a network failure or a rate limit is transient: failed, never refused', async () => {
    const offline: FetchLike = async () => {
      throw new TypeError('Network request failed')
    }
    expect((await renewSession({ serverUrl: HUB, refreshToken: 'csr_1', currentToken: 'a', client: null, fetchFn: offline })).status).toBe('failed')
    const limited = fetchReturning(() => refusal(429, 'Too many requests'))
    expect((await renewSession({ serverUrl: HUB, refreshToken: 'csr_1', currentToken: 'a', client: null, fetchFn: limited.fetchFn })).status).toBe('failed')
  })

  it('works with no live connection — a cold start renews before connecting', async () => {
    const { fetchFn } = fetchReturning(() => okJson(REFRESHED))
    const out = await renewSession({ serverUrl: HUB, refreshToken: 'csr_1', currentToken: 'expired', client: null, fetchFn })
    expect(out.status).toBe('renewed')
  })

  it('a hub that lost refreshSession (404) falls back to the handoff renewal and drops the refresh token', async () => {
    const { fetchFn } = fetchReturning(() => new Response('', { status: 404 }))
    const live = client({ create: async (input) => {
      if (input !== undefined) throw badRequest()
      return { code: 'chc_1', expiresAt: 1 }
    } })
    const out = await renewSession({ serverUrl: HUB, refreshToken: 'csr_1', currentToken: 'a', client: live.client, fetchFn })
    expect(out).toEqual({ status: 'renewed', token: 'legacy-2', refreshToken: null, supersededToken: null })
  })
})

describe('renewSession — a session without a refresh token', () => {
  it('on a D812 hub, moves to a refreshing session and names the token it supersedes', async () => {
    const live = client({
      redeem: async () => ({ token: 'access-new', refreshToken: 'csr_new', user: REFRESHED.user }),
    })
    const out = await renewSession({ serverUrl: HUB, refreshToken: null, currentToken: 'legacy-1', client: live.client })
    expect(out).toEqual({ status: 'renewed', token: 'access-new', refreshToken: 'csr_new', supersededToken: 'legacy-1' })
    expect(live.create).toHaveBeenCalledWith({ purpose: 'new-session' })
    expect(live.redeem).toHaveBeenCalledWith({ code: 'chc_1', refreshable: true })
  })

  it('on an older hub (no purpose input), renews the same session the old way', async () => {
    const live = client({ create: async (input) => {
      if (input !== undefined) throw badRequest()
      return { code: 'chc_2', expiresAt: 1 }
    } })
    const out = await renewSession({ serverUrl: HUB, refreshToken: null, currentToken: 'legacy-1', client: live.client })
    expect(out).toEqual({ status: 'renewed', token: 'legacy-2', refreshToken: null, supersededToken: null })
    expect(live.create).toHaveBeenLastCalledWith()
    expect(live.redeem).toHaveBeenLastCalledWith({ code: 'chc_2' })
  })

  it('UNAUTHORIZED from the hub is refused', async () => {
    const live = client({ create: async () => {
      throw unauthorized()
    } })
    expect(await renewSession({ serverUrl: HUB, refreshToken: null, currentToken: 'x', client: live.client })).toEqual({ status: 'refused' })
  })

  it('any other failure is transient', async () => {
    const live = client({ create: async () => {
      throw new Error('socket closed')
    } })
    expect((await renewSession({ serverUrl: HUB, refreshToken: null, currentToken: 'x', client: live.client })).status).toBe('failed')
  })

  it('with no live connection there is nothing to renew with', async () => {
    expect(await renewSession({ serverUrl: HUB, refreshToken: null, currentToken: 'x', client: null })).toEqual({
      status: 'unavailable',
    })
  })

  it('an empty token from the hub is a failure, not a session', async () => {
    const live = client({ create: async (input) => {
      if (input !== undefined) throw badRequest()
      return { code: 'c', expiresAt: 1 }
    }, redeem: async () => ({ token: '' }) })
    expect((await renewSession({ serverUrl: HUB, refreshToken: null, currentToken: 'x', client: live.client })).status).toBe('failed')
  })
})
