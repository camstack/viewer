import { describe, it, expect } from 'vitest'
import { ServerStore, type KvStore, type ServerConfig } from '../server-store.js'

function memoryKv(): KvStore {
  const m = new Map<string, string>()
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
  }
}

const SERVER: ServerConfig = { id: 's1', label: 'Home', serverUrl: 'https://hub.local:4443' }

describe('ServerStore', () => {
  it('round-trips servers + active id + token across instances over the same kv', async () => {
    const kv = memoryKv()
    const store = new ServerStore(kv, { now: () => 1000 })
    await store.upsertServer(SERVER)
    await store.setActive('s1')
    await store.setSession('s1', { token: 'jwt-abc', refreshToken: null })

    const reloaded = new ServerStore(kv)
    const stamped = { ...SERVER, lastUsedAt: 1000 }
    expect(await reloaded.getServers()).toEqual([stamped])
    expect(await reloaded.getActiveServer()).toEqual(stamped)
    expect(await reloaded.getToken('s1')).toBe('jwt-abc')
  })

  it('returns null active server when none set', async () => {
    const store = new ServerStore(memoryKv())
    expect(await store.getActiveServer()).toBeNull()
  })

  it('clears the token on clearToken but keeps servers', async () => {
    const store = new ServerStore(memoryKv())
    await store.upsertServer(SERVER)
    await store.setSession('s1', { token: 'jwt-abc', refreshToken: null })
    await store.clearToken('s1')
    expect(await store.getToken('s1')).toBeNull()
    expect(await store.getServers()).toEqual([SERVER])
  })

  it('round-trips a pinned route URL (null when none)', async () => {
    const kv = memoryKv()
    const store = new ServerStore(kv)
    expect(await store.getPinnedRouteUrl('s1')).toBeNull()
    await store.setPinnedRouteUrl('s1', 'http://192.0.2.10:4480')
    expect(await new ServerStore(kv).getPinnedRouteUrl('s1')).toBe('http://192.0.2.10:4480')
    await store.setPinnedRouteUrl('s1', null)
    expect(await store.getPinnedRouteUrl('s1')).toBeNull()
    expect(await store.getPinnedRouteUrl('other')).toBeNull()
  })

  it('round-trips per-server connection endpoints (empty when none / unreadable)', async () => {
    const kv = memoryKv()
    const store = new ServerStore(kv)
    expect(await store.getEndpoints('s1')).toEqual([])

    const eps = [
      {
        label: 'LAN — en0',
        baseUrl: 'https://192.168.1.5:4443',
        kind: 'lan-ipv4' as const,
        interfaceKind: 'lan' as const,
        plausible: true,
        plausibleReason: '',
        priority: 10,
      },
    ]
    await store.setEndpoints('s1', eps)
    expect(await new ServerStore(kv).getEndpoints('s1')).toEqual(eps)
    // Isolated per server.
    expect(await store.getEndpoints('other')).toEqual([])
  })
})

describe('getLastServerUrl', () => {
  it('returns the active server URL, surviving sign-out', async () => {
    const store = new ServerStore(memoryKv())
    await store.upsertServer({ id: 'a', label: 'A', serverUrl: 'https://a:4443' })
    await store.setActive('a')
    await store.setSession('a', { token: 'tok', refreshToken: null })
    await store.clearToken('a')
    expect(await store.getLastServerUrl()).toBe('https://a:4443')
  })

  it('falls back to the most recently saved server when none is active', async () => {
    const store = new ServerStore(memoryKv())
    await store.upsertServer({ id: 'a', label: 'A', serverUrl: 'https://a' })
    await store.upsertServer({ id: 'b', label: 'B', serverUrl: 'https://b' })
    expect(await store.getLastServerUrl()).toBe('https://b')
  })

  it('returns null on a fresh install', async () => {
    const store = new ServerStore(memoryKv())
    expect(await store.getLastServerUrl()).toBeNull()
  })
})

describe('setLastServerUrl (attempt-time persistence)', () => {
  it('an explicit attempt wins over the active server', async () => {
    const store = new ServerStore(memoryKv())
    await store.upsertServer({ id: 'a', label: 'A', serverUrl: 'https://a' })
    await store.setActive('a')
    await store.setLastServerUrl('https://typed-but-never-logged-in')
    expect(await store.getLastServerUrl()).toBe('https://typed-but-never-logged-in')
  })
})
