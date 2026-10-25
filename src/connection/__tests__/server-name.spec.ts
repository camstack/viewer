import { describe, expect, it } from 'vitest'
import { customServerName, fetchCustomServerName, serverLabelForUrl, serverLabelOf } from '../server-name.js'
import { ServerStore, type KvStore } from '../server-store.js'

function memoryKv(): KvStore {
  const m = new Map<string, string>()
  return {
    getItem: async (k) => m.get(k) ?? null,
    setItem: async (k, v) => void m.set(k, v),
    removeItem: async (k) => void m.delete(k),
  }
}

const answer = (json: unknown, status = 200) => async () =>
  new Response(JSON.stringify({ result: { data: { json } } }), { status })

describe('server name (D861)', () => {
  it('is shown only when the operator set one', () => {
    expect(customServerName({ name: 'Casa', isDefault: false })).toBe('Casa')
    expect(customServerName({ name: 'CamStack', isDefault: true })).toBeNull()
    expect(customServerName({ name: '  ', isDefault: false })).toBeNull()
    expect(customServerName({ nope: 1 })).toBeNull()
  })

  it('asks the public query and validates the answer', async () => {
    expect(await fetchCustomServerName('https://hub/', answer({ name: 'Casa', isDefault: false }))).toBe('Casa')
    expect(await fetchCustomServerName('https://hub', answer({ name: 'x', isDefault: true }))).toBeNull()
    expect(await fetchCustomServerName('https://hub', answer({ name: 5 }))).toBeNull()
  })

  it('falls back silently on an old hub or a network failure', async () => {
    expect(await fetchCustomServerName('https://hub', async () => new Response('{}', { status: 404 }))).toBeNull()
    expect(
      await fetchCustomServerName('https://hub', async () => {
        throw new Error('offline')
      }),
    ).toBeNull()
  })

  it('labels a server by its name, else its host, and looks a URL up among saved ones', () => {
    expect(serverLabelOf({ serverUrl: 'https://hub.local:4443' })).toBe('hub.local:4443')
    expect(serverLabelOf({ serverUrl: 'https://hub.local:4443', name: 'Casa' })).toBe('Casa')
    const saved = [{ serverUrl: 'https://hub.local:4443', name: 'Casa' }]
    expect(serverLabelForUrl(saved, 'https://hub.local:4443')).toBe('Casa')
    expect(serverLabelForUrl(saved, 'https://other.example')).toBe('other.example')
  })

  it('refreshes the stored name on connect, survives a re-save, and clears when the hub reverts to default', async () => {
    const store = new ServerStore(memoryKv())
    const base = { id: 's1', label: 'x', serverUrl: 'https://hub.local' }
    await store.upsertServer(base)
    await store.setServerName('s1', 'Casa')
    await store.upsertServer(base)
    expect((await store.getServers())[0]?.name).toBe('Casa')
    await store.setServerName('s1', 'Villa')
    expect((await store.getServers())[0]?.name).toBe('Villa')
    await store.setServerName('s1', null)
    expect((await store.getServers())[0]).not.toHaveProperty('name')
  })
})
