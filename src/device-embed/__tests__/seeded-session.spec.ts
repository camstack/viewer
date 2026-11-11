import { describe, expect, it } from 'vitest'
import { ADMIN_ACCESS_TOKEN_KEY } from '../device-embed-url.js'
import { clearSeededSession, seedSessionIfAbsent, type SessionStorageLike } from '../seeded-session.js'

function memoryStorage(initial: Record<string, string> = {}): SessionStorageLike & { readonly keys: () => string[] } {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
    keys: () => [...map.keys()],
  }
}

describe('the admin session the viewer seeds for the device card', () => {
  it('is removed on sign-out', () => {
    const s = memoryStorage()
    expect(seedSessionIfAbsent(s, 'viewer-tok')).toBe(true)
    expect(s.getItem(ADMIN_ACCESS_TOKEN_KEY)).toBe('viewer-tok')
    expect(clearSeededSession(s)).toBe(true)
    expect(s.keys()).toEqual([])
  })

  it("leaves the admin's own session alone, at seed and at sign-out", () => {
    const s = memoryStorage({ [ADMIN_ACCESS_TOKEN_KEY]: 'admin-tok' })
    expect(seedSessionIfAbsent(s, 'viewer-tok')).toBe(false)
    expect(clearSeededSession(s)).toBe(false)
    expect(s.getItem(ADMIN_ACCESS_TOKEN_KEY)).toBe('admin-tok')
  })

  it('leaves a session the admin replaced after the seed', () => {
    const s = memoryStorage()
    seedSessionIfAbsent(s, 'viewer-tok')
    s.setItem(ADMIN_ACCESS_TOKEN_KEY, 'admin-signed-in')
    expect(clearSeededSession(s)).toBe(false)
    expect(s.keys()).toEqual([ADMIN_ACCESS_TOKEN_KEY])
  })
})
