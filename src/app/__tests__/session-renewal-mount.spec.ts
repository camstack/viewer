/**
 * @vitest-environment jsdom
 *
 * Refreshing sessions (D812) through the real `ServerProvider`: what a cold
 * start does with an expired access token, what a refused renewal does, and
 * what signing out tells the hub. Only `fetch` (the raw auth wire) is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React, { useEffect } from 'react'

import { mountScreen } from '../../testing/mount.js'
import { useServer, type ServerContextValue } from '../ServerProvider.js'
import { ServerStore } from '../../connection/server-store.js'
import { asyncKvStore } from '../kv-async-storage.js'
import { secureKvStore } from '../kv-secure-storage.js'
import { capQuery } from '../../data/cap-query.js'
import { useSessionNotice } from '../../auth/session-notice-store.js'
import { signalUnauthorized } from '../../auth/unauthorized-signal.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const HUB = { id: 'http://hub.test:8080', label: 'hub', serverUrl: 'http://hub.test:8080' }

/** A JWT whose only meaningful claim is `exp` (seconds). */
function jwt(expSec: number): string {
  return `h.${Buffer.from(JSON.stringify({ exp: expSec })).toString('base64')}.s`
}
const EXPIRED = jwt(Math.floor(Date.now() / 1000) - 3600)
const LIVE = jwt(Math.floor(Date.now() / 1000) + 7200)

interface WireCall {
  readonly url: string
  readonly body: string
  readonly authorization: string | undefined
}

/** What the hub says to the public `auth.getServerName` the provider asks on connect; `null` = an old hub. */
let serverNameAnswer: { name: string; isDefault: boolean } | null = null

function stubWire(answer: (procedure: string) => { status: number; json?: unknown }): WireCall[] {
  const calls: WireCall[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      // The name query is not part of the session wire under test.
      if (url.endsWith('/auth.getServerName')) {
        return serverNameAnswer === null
          ? new Response('{}', { status: 404 })
          : new Response(JSON.stringify({ result: { data: { json: serverNameAnswer } } }), { status: 200 })
      }
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push({ url, body: String(init?.body ?? ''), authorization: headers.authorization })
      const procedure = url.slice(url.lastIndexOf('/') + 1)
      const { status, json } = answer(procedure)
      const body =
        status < 300
          ? { result: { data: { json: json ?? null } } }
          : { error: { json: { message: `refused ${procedure}` } } }
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    }),
  )
  return calls
}

const store = new ServerStore(asyncKvStore, { secrets: secureKvStore })

async function seed(token: string, refreshToken: string | null): Promise<void> {
  await store.upsertServer(HUB)
  await store.setSession(HUB.id, { token, refreshToken })
  await store.setActive(HUB.id)
}

const seen: { server: ServerContextValue | null } = { server: null }
function Probe(): null {
  const server = useServer()
  useEffect(() => {
    seen.server = server
  })
  return null
}

async function mountLoaded(): Promise<void> {
  mountScreen(React.createElement(Probe))
  await vi.waitFor(() => expect(seen.server?.loading).toBe(false))
}

beforeEach(async () => {
  serverNameAnswer = null
  await store.removeServer(HUB.id)
})
afterEach(() => {
  cleanup()
  seen.server = null
  vi.unstubAllGlobals()
})

describe('the hub server name on connect (D861)', () => {
  it('stores a custom name next to the saved server and shows it', async () => {
    serverNameAnswer = { name: 'Casa', isDefault: false }
    await seed(LIVE, null)
    stubWire(() => ({ status: 200 }))
    await mountLoaded()
    await vi.waitFor(() => expect(seen.server?.server?.name).toBe('Casa'))
    expect((await store.getServers())[0]?.name).toBe('Casa')
  })

  it.each([
    ['a default name', { name: 'CamStack', isDefault: true }],
    ['an old hub', null],
  ])('keeps the host label on %s', async (_label, answer) => {
    serverNameAnswer = answer
    await seed(LIVE, null)
    stubWire(() => ({ status: 200 }))
    await mountLoaded()
    await new Promise((r) => setTimeout(r, 20))
    expect(seen.server?.server?.name).toBeUndefined()
  })
})

describe('cold start with an expired access token', () => {
  it('renews FIRST with the refresh token, and keeps the rotated one', async () => {
    await seed(EXPIRED, 'csr_1')
    const calls = stubWire(() => ({ status: 200, json: { token: LIVE, refreshToken: 'csr_2' } }))
    await mountLoaded()
    expect(seen.server?.token).toBe(LIVE)
    expect(seen.server?.sessionToken).toBe(LIVE)
    expect(calls.map((c) => c.url)).toEqual(['http://hub.test:8080/trpc/auth.refreshSession'])
    expect(calls[0]?.body).toBe('{"json":{"refreshToken":"csr_1"}}')
    expect(await store.getRefreshToken(HUB.id)).toBe('csr_2')
  })

  it('signs out only when the hub refuses the renewal — and forgets both tokens', async () => {
    await seed(EXPIRED, 'csr_revoked')
    stubWire(() => ({ status: 401 }))
    await mountLoaded()
    expect(seen.server?.token).toBeNull()
    expect(await store.getToken(HUB.id)).toBeNull()
    expect(await store.getRefreshToken(HUB.id)).toBeNull()
  })

  it('an unreachable hub keeps the session (the renewal is retried once connected)', async () => {
    await seed(EXPIRED, 'csr_1')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Network request failed')
      }),
    )
    await mountLoaded()
    expect(seen.server?.token).toBe(EXPIRED)
    expect(await store.getRefreshToken(HUB.id)).toBe('csr_1')
  })

  it('an expired token with no refresh token (an older session) is signed out without a round trip', async () => {
    await seed(EXPIRED, null)
    const calls = stubWire(() => ({ status: 200 }))
    await mountLoaded()
    expect(seen.server?.token).toBeNull()
    expect(calls).toEqual([])
  })
})

describe('renewSession', () => {
  it('a refused renewal after UNAUTHORIZED signs out', async () => {
    await seed(LIVE, 'csr_1')
    stubWire(() => ({ status: 401 }))
    await mountLoaded()
    await act(async () => {
      await seen.server?.renewSession('unauthorized')
    })
    expect(seen.server?.token).toBeNull()
  })

  it('UNAUTHORIZED answers right after a renewal are the old token\'s stragglers: no second refresh', async () => {
    await seed(LIVE, 'csr_1')
    const calls = stubWire(() => ({ status: 200, json: { token: LIVE, refreshToken: 'csr_2' } }))
    await mountLoaded()
    await act(async () => {
      await seen.server?.renewSession('unauthorized')
    })
    await act(async () => {
      await seen.server?.renewSession('unauthorized')
    })
    expect(calls.filter((c) => c.url.endsWith('auth.refreshSession'))).toHaveLength(1)
    expect(seen.server?.token).toBe(LIVE)
  })

  it('a failed renewal (offline) never signs out', async () => {
    await seed(LIVE, 'csr_1')
    stubWire(() => ({ status: 503 }))
    await mountLoaded()
    await act(async () => {
      await seen.server?.renewSession('unauthorized')
    })
    expect(seen.server?.token).toBe(LIVE)
  })
})

describe('signing out ends the session on the hub', () => {
  it('auth.logout with the live token as bearer, then the tokens are gone here', async () => {
    await seed(LIVE, 'csr_1')
    const calls = stubWire(() => ({ status: 200, json: { success: true, revoked: 1 } }))
    await mountLoaded()
    let outcome: string | undefined
    await act(async () => {
      outcome = await seen.server?.signOut()
    })
    expect(outcome).toBe('done')
    expect(calls[0]?.url).toBe('http://hub.test:8080/trpc/auth.logout')
    expect(calls[0]?.authorization).toBe(`Bearer ${LIVE}`)
    expect(seen.server?.token).toBeNull()
    expect(await store.getRefreshToken(HUB.id)).toBeNull()
  })

  it('a hub that cannot be reached still signs out here', async () => {
    await seed(LIVE, 'csr_1')
    stubWire(() => ({ status: 502 }))
    await mountLoaded()
    await act(async () => {
      await seen.server?.signOut()
    })
    expect(seen.server?.token).toBeNull()
  })

  it('"everywhere" on a hub that cannot do it leaves this device signed in, and says so', async () => {
    await seed(LIVE, 'csr_1')
    const calls = stubWire(() => ({ status: 400 }))
    await mountLoaded()
    let outcome: string | undefined
    await act(async () => {
      outcome = await seen.server?.signOut({ everywhere: true })
    })
    expect(outcome).toBe('unsupported')
    expect(calls[0]?.body).toBe('{"json":{"everywhere":true}}')
    expect(seen.server?.token).toBe(LIVE)
  })
})


/** A tRPC client whose every query is answered UNAUTHORIZED, as the hub answers a revoked session. */
function revokedClient(): Record<string, unknown> {
  const refused = Object.assign(new Error('Session ended - sign in again'), { data: { code: 'UNAUTHORIZED' } })
  return { battery: { getStatus: { query: async () => Promise.reject(refused) } } }
}

describe('a revoked session is heard even when the call swallows the error (2026-10-16)', () => {
  beforeEach(() => useSessionNotice.getState().clear())

  it('fifty swallowed UNAUTHORIZED polls are ONE refresh, then the person is signed out with a notice', async () => {
    await seed(LIVE, 'csr_revoked')
    const calls = stubWire(() => ({ status: 401 }))
    await mountLoaded()
    const client = revokedClient()
    await act(async () => {
      // capQuery turns the failure into null by design; the revocation must still be reported.
      const answers = await Promise.all(
        Array.from({ length: 50 }, () => capQuery(client, 'battery', 'getStatus', { deviceId: 1 })),
      )
      expect(answers.every((a) => a === null)).toBe(true)
    })
    await vi.waitFor(() => expect(seen.server?.token).toBeNull())
    expect(calls.filter((c) => c.url.endsWith('auth.refreshSession'))).toHaveLength(1)
    expect(useSessionNotice.getState().endedServer).toBe('hub')
    expect(await store.getToken(HUB.id)).toBeNull()
  })

  it('a hub that cannot be reached is asked once per cool-down, not once per poll, and never signs out', async () => {
    await seed(LIVE, 'csr_1')
    const calls = stubWire(() => ({ status: 503 }))
    await mountLoaded()
    await act(async () => {
      for (let i = 0; i < 20; i += 1) {
        signalUnauthorized()
        await Promise.resolve()
      }
      await seen.server?.renewSession('unauthorized')
    })
    await act(async () => {
      for (let i = 0; i < 20; i += 1) await seen.server?.renewSession('unauthorized')
    })
    expect(calls.filter((c) => c.url.endsWith('auth.refreshSession'))).toHaveLength(1)
    expect(seen.server?.token).toBe(LIVE)
  })
})
