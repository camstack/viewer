/**
 * @vitest-environment jsdom
 *
 * `useAdminVerdict` over the REAL `useMe` query (final review I1, I2).
 *
 * The verdict is the authority for a destructive save policy: an admin's save
 * keeps other users' targets on a global rule, anyone else's drops them
 * (`target-ownership.ts`). So:
 *
 *  - I1: a read that never happened (no system handle) and an `auth.me` that
 *    answered WITHOUT an identity are failures to know, never "not admin".
 *    Cached as `null` with `staleTime: Infinity`, they used to read as
 *    'not-admin' for the rest of the session.
 *  - I2: the verdict belongs to ONE session. Signing in as someone else, or on
 *    another hub, must ask again — a 30-minute-old answer for the previous
 *    user is somebody else's role.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React, { useEffect } from 'react'

import { mountScreen } from '../../testing/mount.js'
import { resetStubConnection, setStubConnection } from '../../testing/connection-stub.js'
import { useServer, type ServerContextValue } from '../../app/ServerProvider.js'
import { useAdminVerdict, type AdminVerdict } from '../use-me.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

interface Seen {
  verdict: AdminVerdict | null
  server: ServerContextValue | null
}
const seen: Seen = { verdict: null, server: null }

function Probe(): null {
  const verdict = useAdminVerdict()
  const server = useServer()
  useEffect(() => {
    seen.verdict = verdict
    seen.server = server
  })
  return null
}

afterEach(() => {
  cleanup()
  resetStubConnection()
  seen.verdict = null
  seen.server = null
})

describe('useAdminVerdict — no answer is not an answer (I1)', () => {
  it('connected but with NO system handle: unknown, never not-admin', async () => {
    setStubConnection({ hasSystem: false })
    mountScreen(React.createElement(Probe), { hub: { 'auth.me': { id: 'u1', username: 'op', isAdmin: true } } })
    await vi.waitFor(() => expect(seen.verdict).toBe('unknown'))
  })

  it('auth.me answered without an identity: unknown, never not-admin', async () => {
    mountScreen(React.createElement(Probe), { hub: { 'auth.me': { isAdmin: true } } })
    await vi.waitFor(() => expect(seen.verdict).toBe('unknown'))
  })

  it('a well-formed answer still decides', async () => {
    mountScreen(React.createElement(Probe), { hub: { 'auth.me': { id: 'u1', username: 'op', isAdmin: false } } })
    await vi.waitFor(() => expect(seen.verdict).toBe('not-admin'))
  })
})

describe('useAdminVerdict — one session, one verdict (I2)', () => {
  it('signing in as another user asks auth.me again instead of reusing the previous role', async () => {
    const who = { isAdmin: true }
    mountScreen(React.createElement(Probe), {
      hub: { 'auth.me': () => ({ id: who.isAdmin ? 'admin' : 'user', username: 'x', isAdmin: who.isAdmin }) },
    })
    const hub = { id: 'http://hub.test:8080', label: 'hub', serverUrl: 'http://hub.test:8080' }
    await act(async () => {
      await seen.server?.save(hub, { token: 'token-user-a', refreshToken: null })
    })
    await vi.waitFor(() => expect(seen.verdict).toBe('admin'))

    // SAME hub, another account: only the session token differs.
    who.isAdmin = false
    await act(async () => {
      await seen.server?.save(hub, { token: 'token-user-b', refreshToken: null })
    })
    await vi.waitFor(() => expect(seen.verdict).toBe('not-admin'))
  })

  it('switching hub asks again too', async () => {
    const who = { isAdmin: false }
    mountScreen(React.createElement(Probe), {
      hub: { 'auth.me': () => ({ id: 'u', username: 'x', isAdmin: who.isAdmin }) },
    })
    await act(async () => {
      await seen.server?.save({ id: 'http://a.test', label: 'a', serverUrl: 'http://a.test' }, { token: 'token-a', refreshToken: null })
    })
    await vi.waitFor(() => expect(seen.verdict).toBe('not-admin'))

    who.isAdmin = true
    await act(async () => {
      await seen.server?.save({ id: 'http://b.test', label: 'b', serverUrl: 'http://b.test' }, { token: 'token-b', refreshToken: null })
    })
    await vi.waitFor(() => expect(seen.verdict).toBe('admin'))
  })
})
