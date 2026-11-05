import { describe, expect, it, vi } from 'vitest'
import { createSessionRenewer, type SessionVault } from '../session-renewer.js'
import type { RenewInput, RenewOutcome } from '../refresh-session.js'

function jwt(expSec: number): string {
  return `h.${Buffer.from(JSON.stringify({ exp: expSec })).toString('base64')}.s`
}
const OLD = jwt(Math.floor(Date.now() / 1000) - 3600)

/** One localStorage-like vault shared by two "tabs" (two renewers). */
function sharedVault(): SessionVault & { readonly refresh: () => string | null } {
  let token: string | null = OLD
  let refresh: string | null = 'csr_1'
  return {
    getToken: async () => token,
    getRefreshToken: async () => refresh,
    setSession: async (_id, s) => {
      token = s.token
      refresh = s.refreshToken
    },
    refresh: () => refresh,
  }
}

/** A hub that honours ONLY the current refresh token, and revokes on reuse. */
function rotatingHub(vaultRefresh: () => string | null) {
  let current = 'csr_1'
  let n = 1
  const seen: string[] = []
  let revoked = false
  const renew = vi.fn(async (input: RenewInput): Promise<RenewOutcome> => {
    seen.push(String(input.refreshToken))
    await new Promise((r) => setTimeout(r, 5))
    if (input.refreshToken !== current) {
      revoked = true
      return { status: 'refused' }
    }
    n += 1
    current = `csr_${n}`
    return { status: 'renewed', token: jwt(Math.floor(Date.now() / 1000) + 7200 + n), refreshToken: current, supersededToken: null }
  })
  void vaultRefresh
  return { renew, seen, revoked: () => revoked }
}

const REQUEST = { serverUrl: 'https://hub', currentToken: OLD, client: null }

/** `navigator.locks` for two tabs of one origin: exclusive per name. */
function lockManager(): (name: string, fn: () => Promise<unknown>) => Promise<unknown> {
  const tails = new Map<string, Promise<unknown>>()
  return (name, fn) => {
    const next = (tails.get(name) ?? Promise.resolve()).then(fn, fn)
    tails.set(name, next.catch(() => undefined))
    return next
  }
}

describe('two tabs of the web viewer renewing the same session', () => {
  it.each([
    ['with navigator.locks', true],
    ['without it (re-read the vault, adopt a newer stored token)', false],
  ])('rotate the refresh token ONCE, never twice with the same one — %s', async (_label, withLocks) => {
    const vault = sharedVault()
    const hub = rotatingHub(vault.refresh)
    const locks = lockManager()
    const tab = () =>
      createSessionRenewer({
        vault,
        renew: hub.renew,
        crossTab: true,
        ...(withLocks ? { withLock: (name, fn) => locks(name, fn) as ReturnType<typeof fn> } : {}),
      })
    const a = tab()
    const b = tab()
    // Tab B starts after A took the lock / began; without locks it begins after A stored.
    const pa = a.renew('s1', REQUEST)
    if (!withLocks) await pa
    const pb = b.renew('s1', REQUEST)
    const [oa, ob] = await Promise.all([pa, pb])

    expect(hub.revoked()).toBe(false)
    expect(hub.seen).toEqual(['csr_1'])
    expect(oa.status).toBe('renewed')
    expect(ob.status).toBe('renewed')
    expect(ob).toEqual(oa)
  })
})
