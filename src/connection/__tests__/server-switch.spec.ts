import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { ServerStore, type KvStore } from '../server-store.js'
import { listServerSessions, switchToServer, type SwitchQueryCache } from '../server-switch.js'

function memoryKv(): KvStore {
  const m = new Map<string, string>()
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
  }
}

const A = { id: 'https://a.example.com', label: 'A', serverUrl: 'https://a.example.com' }
const B = { id: 'https://b.example.com', label: 'B', serverUrl: 'https://b.example.com' }
const usable = (token: string): boolean => token !== 'expired'

async function twoServers(): Promise<ServerStore> {
  const store = new ServerStore(memoryKv(), { now: () => 42 })
  await store.upsertServer(A)
  await store.upsertServer(B)
  await store.setSession(A.id, { token: 'tok-a', refreshToken: null })
  await store.setSession(B.id, { token: 'tok-b', refreshToken: null })
  await store.setActive(A.id)
  return store
}

/** Records the order of the cache calls against the store writes. */
function recordingCache(events: string[]): SwitchQueryCache {
  return {
    cancelQueries: async () => void events.push('cancel'),
    clear: () => void events.push('clear'),
  }
}

describe('switchToServer', () => {
  it('switches with the target server\'s OWN token and keeps the previous one', async () => {
    const store = await twoServers()
    const outcome = await switchToServer(B.id, { store, queryCache: recordingCache([]), isTokenUsable: usable })
    expect(outcome).toEqual({ status: 'switched', server: { ...B, lastUsedAt: 42 }, token: 'tok-b' })
    expect((await store.getActiveServer())?.id).toBe(B.id)
    expect(await store.getToken(A.id)).toBe('tok-a')
  })

  it('drops the previous hub\'s cache (cancel, then clear) BEFORE the new server is active', async () => {
    const store = await twoServers()
    const events: string[] = []
    const cache = recordingCache(events)
    const originalSetActive = store.setActive.bind(store)
    store.setActive = async (id: string): Promise<void> => {
      events.push(`setActive:${id}`)
      await originalSetActive(id)
    }
    await switchToServer(B.id, { store, queryCache: cache, isTokenUsable: usable })
    expect(events).toEqual(['cancel', 'clear', `setActive:${B.id}`])
  })

  it('empties a real React Query cache: hub A\'s camera list is gone', async () => {
    const store = await twoServers()
    const client = new QueryClient()
    client.setQueryData(['v2', 'cameras'], [{ id: 101, name: 'hub A camera' }])
    await switchToServer(B.id, { store, queryCache: client, isTokenUsable: usable })
    expect(client.getQueryData(['v2', 'cameras'])).toBeUndefined()
  })

  it('asks for a login, and touches nothing, when the target holds no usable token', async () => {
    const store = await twoServers()
    await store.setSession(B.id, { token: 'expired', refreshToken: null })
    const events: string[] = []
    const outcome = await switchToServer(B.id, { store, queryCache: recordingCache(events), isTokenUsable: usable })
    expect(outcome).toEqual({ status: 'needs-login', serverUrl: B.serverUrl })
    expect(events).toEqual([])
    expect((await store.getActiveServer())?.id).toBe(A.id)
  })

  it('an expired access token with a refresh token is still a session (D812): it switches', async () => {
    const store = await twoServers()
    await store.setSession(B.id, { token: 'expired', refreshToken: 'csr_b' })
    const outcome = await switchToServer(B.id, { store, queryCache: recordingCache([]), isTokenUsable: usable })
    expect(outcome.status).toBe('switched')
  })

  it('is a no-op on the active server and refuses an unknown id', async () => {
    const store = await twoServers()
    const events: string[] = []
    expect(await switchToServer(A.id, { store, queryCache: recordingCache(events), isTokenUsable: usable })).toEqual({
      status: 'already-active',
    })
    expect(await switchToServer('nope', { store, queryCache: recordingCache(events), isTokenUsable: usable })).toEqual({
      status: 'unknown-server',
    })
    expect(events).toEqual([])
  })
})

describe('listServerSessions', () => {
  it('reports which servers hold a usable token', async () => {
    const store = await twoServers()
    await store.clearToken(B.id)
    const sessions = await listServerSessions(store, usable)
    expect(sessions.map((s) => [s.id, s.signedIn])).toEqual([
      [A.id, true],
      [B.id, false],
    ])
  })

  it('counts an expired access token with a refresh token as signed in', async () => {
    const store = await twoServers()
    await store.setSession(B.id, { token: 'expired', refreshToken: 'csr_b' })
    const sessions = await listServerSessions(store, usable)
    expect(sessions.find((s) => s.id === B.id)?.signedIn).toBe(true)
  })
})
