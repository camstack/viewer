import { describe, expect, it } from 'vitest'
import { decodeJwtExpMs, isJwtExpired, refreshDelayMs } from '../session-token.js'

function makeToken(payload: Record<string, unknown>): string {
  const b64 = (o: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(o)).toString('base64')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.signature`
}

describe('decodeJwtExpMs', () => {
  it('returns the exp claim in epoch milliseconds', () => {
    const token = makeToken({ userId: 'u1', exp: 1_800_000_000 })
    expect(decodeJwtExpMs(token)).toBe(1_800_000_000 * 1000)
  })

  it('returns null when the token has no numeric exp', () => {
    expect(decodeJwtExpMs(makeToken({ userId: 'u1' }))).toBeNull()
    expect(decodeJwtExpMs(makeToken({ exp: 'soon' }))).toBeNull()
  })

  it('returns null for a malformed token (never throws)', () => {
    expect(decodeJwtExpMs('not-a-jwt')).toBeNull()
    expect(decodeJwtExpMs('')).toBeNull()
    expect(decodeJwtExpMs('a.!!!.c')).toBeNull()
  })
})

describe('isJwtExpired', () => {
  const now = 1_000_000_000_000

  it('is true when exp is at or before now', () => {
    expect(isJwtExpired(makeToken({ exp: now / 1000 - 10 }), now)).toBe(true)
  })

  it('is false when exp is in the future', () => {
    expect(isJwtExpired(makeToken({ exp: now / 1000 + 10 }), now)).toBe(false)
  })

  it('treats a token with no exp as not expired (server is authority)', () => {
    expect(isJwtExpired(makeToken({ userId: 'u1' }), now)).toBe(false)
  })
})

describe('refreshDelayMs', () => {
  const now = 1_000_000_000_000

  it('returns null when the token has no exp', () => {
    expect(refreshDelayMs(makeToken({ userId: 'u1' }), now)).toBeNull()
  })

  it('returns null when the token is already expired', () => {
    expect(refreshDelayMs(makeToken({ exp: now / 1000 - 1 }), now)).toBeNull()
  })

  it('caps a long-lived token at 24h', () => {
    // 7d remaining → half-life 3.5d, clamped to the 24h max.
    const sevenDays = 7 * 24 * 60 * 60
    const delay = refreshDelayMs(makeToken({ exp: now / 1000 + sevenDays }), now)
    expect(delay).toBe(24 * 60 * 60_000)
  })

  it('floors a nearly-fresh token at 30s', () => {
    // 20s remaining → half is 10s, floored to the 30s minimum.
    const delay = refreshDelayMs(makeToken({ exp: now / 1000 + 20 }), now)
    expect(delay).toBe(30_000)
  })
})
