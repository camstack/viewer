import { describe, expect, it } from 'vitest'
import { logoutFromHub } from '../hub-logout.js'
import type { FetchLike } from '../hub-auth-wire.js'

interface Step {
  readonly status: number
  readonly json?: unknown
}

function scripted(steps: readonly Step[]): { fetchFn: FetchLike; calls: [string, RequestInit][] } {
  const calls: [string, RequestInit][] = []
  let i = 0
  const fetchFn: FetchLike = async (url, init) => {
    calls.push([url, init ?? {}])
    const step = steps[i++] ?? { status: 500 }
    const body =
      step.status < 300
        ? JSON.stringify({ result: { data: { json: step.json ?? null } } })
        : JSON.stringify({ error: { json: { message: 'refused' } } })
    return new Response(body, { status: step.status, headers: { 'content-type': 'application/json' } })
  }
  return { fetchFn, calls }
}

const header = (init: RequestInit, name: string): string | undefined =>
  (init.headers as Record<string, string>)[name]

describe('logoutFromHub', () => {
  it('ends THIS session with the access token as bearer, sending a void input', async () => {
    const { fetchFn, calls } = scripted([{ status: 200, json: { success: true, revoked: 1 } }])
    const out = await logoutFromHub({ serverUrl: 'https://hub/', token: 'access', refreshToken: null, everywhere: false, fetchFn })
    expect(out).toBe('done')
    expect(calls[0]?.[0]).toBe('https://hub/trpc/auth.logout')
    expect(header(calls[0]![1], 'authorization')).toBe('Bearer access')
    // An older hub's logout takes no input: a void body works on both.
    expect(calls[0]?.[1].body).toBe('{"json":null,"meta":{"values":["undefined"],"v":1}}')
  })

  it('"everywhere" asks for every session of the user', async () => {
    const { fetchFn, calls } = scripted([{ status: 200, json: { success: true, revoked: 3 } }])
    await logoutFromHub({ serverUrl: 'https://hub', token: 'a', refreshToken: null, everywhere: true, fetchFn })
    expect(calls[0]?.[1].body).toBe('{"json":{"everywhere":true}}')
  })

  it('an expired access token is renewed with the refresh token, then the session is ended', async () => {
    const { fetchFn, calls } = scripted([
      { status: 401 },
      { status: 200, json: { token: 'fresh', refreshToken: 'csr_2' } },
      { status: 200, json: { success: true, revoked: 1 } },
    ])
    const out = await logoutFromHub({ serverUrl: 'https://hub', token: 'stale', refreshToken: 'csr_1', everywhere: false, fetchFn })
    expect(out).toBe('done')
    expect(calls.map((c) => c[0])).toEqual([
      'https://hub/trpc/auth.logout',
      'https://hub/trpc/auth.refreshSession',
      'https://hub/trpc/auth.logout',
    ])
    expect(header(calls[2]![1], 'authorization')).toBe('Bearer fresh')
  })

  it('a session the hub already ended is done', async () => {
    const { fetchFn } = scripted([{ status: 401 }, { status: 401 }])
    expect(
      await logoutFromHub({ serverUrl: 'https://hub', token: 'stale', refreshToken: 'csr_dead', everywhere: false, fetchFn }),
    ).toBe('done')
  })

  it('an older hub cannot end every session: unsupported, never a silent success', async () => {
    const { fetchFn } = scripted([{ status: 400 }])
    expect(
      await logoutFromHub({ serverUrl: 'https://hub', token: 'a', refreshToken: null, everywhere: true, fetchFn }),
    ).toBe('unsupported')
  })

  it('a network failure is failed', async () => {
    const fetchFn: FetchLike = async () => {
      throw new TypeError('Network request failed')
    }
    expect(
      await logoutFromHub({ serverUrl: 'https://hub', token: 'a', refreshToken: null, everywhere: false, fetchFn }),
    ).toBe('failed')
  })
})
