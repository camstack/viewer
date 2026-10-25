import { describe, it, expect } from 'vitest'
import { ServerStore, secretKeySafe, type KvStore } from '../server-store.js'

interface MemoryKv extends KvStore {
  readonly map: Map<string, string>
}

function memoryKv(): MemoryKv {
  const map = new Map<string, string>()
  return {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
  }
}

/** A secrets store that, like the native secure store, refuses keys outside
 *  `[A-Za-z0-9._-]`. */
function strictSecrets(): MemoryKv {
  const inner = memoryKv()
  const check = (k: string): void => {
    if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error(`invalid secure-store key: ${k}`)
  }
  return {
    map: inner.map,
    getItem: async (k) => (check(k), inner.getItem(k)),
    setItem: async (k, v) => (check(k), inner.setItem(k, v)),
    removeItem: async (k) => (check(k), inner.removeItem(k)),
  }
}

const A = { id: 'https://a.example.com', label: 'A', serverUrl: 'https://a.example.com' }
const B = { id: 'https://b.example.com:4443', label: 'B', serverUrl: 'https://b.example.com:4443' }

describe('per-server tokens', () => {
  it('each server keeps its own token; signing out of one keeps the other', async () => {
    const store = new ServerStore(memoryKv(), { secrets: strictSecrets() })
    await store.upsertServer(A)
    await store.upsertServer(B)
    await store.setSession(A.id, { token: 'tok-a', refreshToken: null })
    await store.setSession(B.id, { token: 'tok-b', refreshToken: null })

    expect(await store.getToken(A.id)).toBe('tok-a')
    expect(await store.getToken(B.id)).toBe('tok-b')

    await store.clearToken(A.id)
    expect(await store.getToken(A.id)).toBeNull()
    expect(await store.getToken(B.id)).toBe('tok-b')
  })

  it('tokens go to the secrets store, never to the plain kv', async () => {
    const kv = memoryKv()
    const secrets = strictSecrets()
    const store = new ServerStore(kv, { secrets })
    await store.setSession(A.id, { token: 'tok-a', refreshToken: null })
    expect([...kv.map.values()]).not.toContain('tok-a')
    expect([...secrets.map.values()]).toEqual(['tok-a'])
  })

  it('removeServer forgets the server, its token and its caches; the active one leaves none active', async () => {
    const kv = memoryKv()
    const store = new ServerStore(kv, { secrets: strictSecrets() })
    await store.upsertServer(A)
    await store.upsertServer(B)
    await store.setSession(A.id, { token: 'tok-a', refreshToken: null })
    await store.setSession(B.id, { token: 'tok-b', refreshToken: null })
    await store.setPinnedRouteUrl(A.id, 'http://10.0.0.2:4480')
    await store.setActive(A.id)

    await store.removeServer(A.id)

    expect((await store.getServers()).map((s) => s.id)).toEqual([B.id])
    expect(await store.getToken(A.id)).toBeNull()
    expect(await store.getPinnedRouteUrl(A.id)).toBeNull()
    expect(await store.getActiveServer()).toBeNull()
    expect(await store.getToken(B.id)).toBe('tok-b')
  })

  it('setActive stamps lastUsedAt and upsert keeps it', async () => {
    let now = 10
    const store = new ServerStore(memoryKv(), { now: () => now })
    await store.upsertServer(A)
    await store.setActive(A.id)
    now = 20
    await store.upsertServer({ ...A, label: 'renamed' })
    expect(await store.getActiveServer()).toEqual({ ...A, label: 'renamed', lastUsedAt: 10 })
  })

  it('finds a saved server by origin, ignoring a trailing slash', async () => {
    const store = new ServerStore(memoryKv())
    await store.upsertServer({ ...A, serverUrl: 'https://a.example.com/' })
    expect((await store.findServerByOrigin('https://a.example.com'))?.id).toBe(A.id)
    expect(await store.findServerByOrigin('https://other.example.com')).toBeNull()
  })
})

describe('per-server refresh tokens (D812)', () => {
  it('a session is stored as a pair, in the secrets store only', async () => {
    const kv = memoryKv()
    const secrets = strictSecrets()
    const store = new ServerStore(kv, { secrets })
    await store.upsertServer(A)
    await store.setSession(A.id, { token: 'access-a', refreshToken: 'csr_a' })
    expect(await store.getToken(A.id)).toBe('access-a')
    expect(await store.getRefreshToken(A.id)).toBe('csr_a')
    expect([...kv.map.values()].some((v) => v.includes('csr_a'))).toBe(false)
    expect([...secrets.map.values()]).toContain('csr_a')
  })

  it('a session without a refresh token clears the previous one, so it never renews a stranger', async () => {
    const store = new ServerStore(memoryKv(), { secrets: strictSecrets() })
    await store.setSession(A.id, { token: 'access-a', refreshToken: 'csr_a' })
    await store.setSession(A.id, { token: 'legacy-a', refreshToken: null })
    expect(await store.getRefreshToken(A.id)).toBeNull()
  })

  it('the refresh token is written BEFORE the access token, so a failed write never loses a rotation', async () => {
    const order: string[] = []
    const secrets = strictSecrets()
    const store = new ServerStore(memoryKv(), {
      secrets: {
        ...secrets,
        setItem: async (k, v) => {
          order.push(k.includes('refresh') ? 'refresh' : 'access')
          await secrets.setItem(k, v)
        },
      },
    })
    await store.setSession(A.id, { token: 'access-a', refreshToken: 'csr_a' })
    expect(order).toEqual(['refresh', 'access'])
  })

  it('signing out of one server drops its refresh token and keeps the other server\'s', async () => {
    const store = new ServerStore(memoryKv(), { secrets: strictSecrets() })
    await store.setSession(A.id, { token: 'a', refreshToken: 'csr_a' })
    await store.setSession(B.id, { token: 'b', refreshToken: 'csr_b' })
    await store.clearToken(A.id)
    expect(await store.getRefreshToken(A.id)).toBeNull()
    expect(await store.getRefreshToken(B.id)).toBe('csr_b')
  })

  it('forgetting a server forgets its refresh token', async () => {
    const store = new ServerStore(memoryKv(), { secrets: strictSecrets() })
    await store.upsertServer(A)
    await store.setSession(A.id, { token: 'a', refreshToken: 'csr_a' })
    await store.removeServer(A.id)
    expect(await store.getRefreshToken(A.id)).toBeNull()
  })
})

describe('secretKeySafe', () => {
  it('maps a URL id onto the secure-store alphabet, injectively', () => {
    const a = secretKeySafe('https://hub.local:4443')
    expect(a).toMatch(/^[A-Za-z0-9._-]+$/)
    expect(secretKeySafe('a_b')).not.toBe(secretKeySafe('a:b'))
    expect(secretKeySafe('a_003ab')).not.toBe(secretKeySafe('a:b'))
  })
})

describe('legacy v2.token migration', () => {
  it('moves the global token into the ACTIVE server slot and deletes the legacy key', async () => {
    const kv = memoryKv()
    const store = new ServerStore(kv, { secrets: strictSecrets() })
    await store.upsertServer(A)
    await store.upsertServer(B)
    await store.setActive(A.id)
    kv.map.set('v2.token', 'legacy-jwt')

    expect(await store.migrateLegacyToken()).toBe('migrated')
    expect(await store.getToken(A.id)).toBe('legacy-jwt')
    expect(await store.getToken(B.id)).toBeNull()
    expect(kv.map.has('v2.token')).toBe(false)
  })

  it('is idempotent', async () => {
    const kv = memoryKv()
    const store = new ServerStore(kv)
    await store.upsertServer(A)
    await store.setActive(A.id)
    kv.map.set('v2.token', 'legacy-jwt')
    await store.migrateLegacyToken()
    expect(await store.migrateLegacyToken()).toBe('none')
    expect(await store.getToken(A.id)).toBe('legacy-jwt')
  })

  it('never overwrites a token the slot already holds', async () => {
    const kv = memoryKv()
    const store = new ServerStore(kv)
    await store.upsertServer(A)
    await store.setActive(A.id)
    await store.setSession(A.id, { token: 'newer', refreshToken: null })
    kv.map.set('v2.token', 'legacy-jwt')
    expect(await store.migrateLegacyToken()).toBe('dropped')
    expect(await store.getToken(A.id)).toBe('newer')
    expect(kv.map.has('v2.token')).toBe(false)
  })

  it('drops a legacy token that belongs to no active server', async () => {
    const kv = memoryKv()
    const store = new ServerStore(kv)
    kv.map.set('v2.token', 'orphan')
    expect(await store.migrateLegacyToken()).toBe('dropped')
    expect(kv.map.has('v2.token')).toBe(false)
  })

  it('keeps the legacy token when the secure write fails, so the next boot retries', async () => {
    const kv = memoryKv()
    const failing: KvStore = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('keychain unavailable')
      },
      removeItem: async () => undefined,
    }
    const store = new ServerStore(kv, { secrets: failing })
    await store.upsertServer(A)
    await store.setActive(A.id)
    kv.map.set('v2.token', 'legacy-jwt')
    await expect(store.migrateLegacyToken()).rejects.toThrow('keychain unavailable')
    expect(kv.map.get('v2.token')).toBe('legacy-jwt')
  })
})
