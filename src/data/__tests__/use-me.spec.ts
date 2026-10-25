/**
 * `toSessionUser` / `useIsAdmin` — the parse that decides whether admin
 * affordances (track flags, camera switches, filter chips) are drawn.
 *
 * Fail-closed is the contract (`isAdmin === true` only). The live bug was
 * not the parse: `auth.me` answers `{ id, username, isAdmin: true, … }`
 * for the operator, and this function already reads that. The swallow was
 * upstream — `capQuery` turned a void-input rejection into `null`, and
 * `toSessionUser(null)` correctly returned null, which `useIsAdmin` then
 * read as "not admin". These tests lock the parse so a later "fix" cannot
 * start requiring a field the hub does not send, or treating a missing
 * `isAdmin` as true.
 */
import { describe, expect, it } from 'vitest'
import { adminVerdictFrom, meQueryKey, toSessionUser } from '../use-me.js'

/** The shape `auth.me` actually returns on this hub (2026-08-23). */
const LIVE_ME = {
  id: '1476a68a-9864-4aa7-bfb5-a779f9d24ff3',
  username: 'alice',
  isAdmin: true,
  isApiKey: false,
  permissions: { isAdmin: true, allowedProviders: '*', allowedDevices: {} },
  scope: {
    isAdmin: true,
    allDevicesViewable: true,
    viewableDeviceCount: 12,
    device: {
      view: { all: true, deviceCount: 12 },
      create: { all: true, deviceCount: 12 },
      delete: { all: true, deviceCount: 12 },
    },
    system: [],
    capabilities: [],
    addons: [],
  },
}

describe('toSessionUser', () => {
  it('accepts the live hub shape and keeps isAdmin', () => {
    const user = toSessionUser(LIVE_ME)
    expect(user).toEqual({
      id: LIVE_ME.id,
      username: LIVE_ME.username,
      isAdmin: true,
      scope: expect.objectContaining({ isAdmin: true }),
    })
  })

  it('is fail-closed: anything other than the boolean true is not admin', () => {
    expect(toSessionUser({ ...LIVE_ME, isAdmin: false })?.isAdmin).toBe(false)
    expect(toSessionUser({ ...LIVE_ME, isAdmin: 'true' })?.isAdmin).toBe(false)
    expect(toSessionUser({ id: LIVE_ME.id, username: LIVE_ME.username })?.isAdmin).toBe(false)
  })

  it('rejects a payload without identity rather than inventing one', () => {
    expect(toSessionUser(null)).toBeNull()
    expect(toSessionUser(undefined)).toBeNull()
    expect(toSessionUser({ username: 'alice', isAdmin: true })).toBeNull()
    expect(toSessionUser({ id: 'u-1', isAdmin: true })).toBeNull()
  })

  it('still yields the user when scope is absent — an older hub is not a demotion', () => {
    const { scope: _scope, ...noScope } = LIVE_ME
    const user = toSessionUser(noScope)
    expect(user?.isAdmin).toBe(true)
    expect(user?.username).toBe(LIVE_ME.username)
    expect(user?.scope).toBeNull()
  })
})

describe('adminVerdictFrom — an ERRORED read is its own answer (Task 12 fix round 3)', () => {
  // A failed `auth.me` used to read as 'not-admin'. For VISIBILITY that is the
  // right fail-closed answer, but a save policy that keys on it would treat a
  // real admin as a user — and a user's save drops targets outside his list.
  it('in flight is pending', () => {
    expect(adminVerdictFrom({ isPending: true, isError: false, data: undefined })).toBe('pending')
  })
  it('a rejected read with nothing cached is unknown', () => {
    expect(adminVerdictFrom({ isPending: false, isError: true, data: undefined })).toBe('unknown')
  })
  it('an answer decides — even if a later refetch errored', () => {
    const admin = { id: 'u', username: 'a', isAdmin: true, scope: null }
    expect(adminVerdictFrom({ isPending: false, isError: true, data: admin })).toBe('admin')
    expect(adminVerdictFrom({ isPending: false, isError: false, data: { ...admin, isAdmin: false } })).toBe('not-admin')
    expect(adminVerdictFrom({ isPending: false, isError: false, data: null })).toBe('not-admin')
  })
})

describe('meQueryKey — one key per session, and never the secret (final review I2 follow-up)', () => {
  const TOKEN_A = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.c2lnbmF0dXJlLWE'
  const TOKEN_B = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLWI'

  it('carries no part of the token — keys surface in devtools, logs and error reports', () => {
    const key = JSON.stringify(meQueryKey('http://hub', TOKEN_A))
    expect(key).not.toContain(TOKEN_A)
    for (const part of TOKEN_A.split('.')) expect(key).not.toContain(part)
  })

  it('a different session is a different key; the same session the same key', () => {
    expect(meQueryKey('http://hub', TOKEN_A)).not.toEqual(meQueryKey('http://hub', TOKEN_B))
    expect(meQueryKey('http://hub', TOKEN_A)).not.toEqual(meQueryKey('http://other', TOKEN_A))
    expect(meQueryKey('http://hub', TOKEN_A)).toEqual(meQueryKey('http://hub', TOKEN_A))
    expect(meQueryKey('http://hub', null)).not.toEqual(meQueryKey('http://hub', TOKEN_A))
  })
})
