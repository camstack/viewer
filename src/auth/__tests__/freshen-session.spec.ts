import { describe, expect, it, vi } from 'vitest'
import { freshenStoredSession } from '../freshen-session.js'
import type { RenewOutcome } from '../refresh-session.js'

const usable = (t: string): boolean => t !== 'expired'

describe('freshenStoredSession — a stored session on cold start or a switch', () => {
  it('a live access token is used as is, without a round trip', async () => {
    const renew = vi.fn()
    expect(await freshenStoredSession({ token: 'live', hasRefreshToken: true, isTokenUsable: usable, renew })).toEqual({
      status: 'ready',
      token: 'live',
    })
    expect(renew).not.toHaveBeenCalled()
  })

  it('an expired token with no refresh token is signed out (an older session)', async () => {
    const renew = vi.fn()
    expect(await freshenStoredSession({ token: 'expired', hasRefreshToken: false, isTokenUsable: usable, renew })).toEqual({
      status: 'signed-out',
    })
    expect(renew).not.toHaveBeenCalled()
  })

  it('an expired token with a refresh token is renewed FIRST', async () => {
    const renew = async (): Promise<RenewOutcome> => ({ status: 'renewed', token: 'fresh', refreshToken: 'csr_2', supersededToken: null })
    expect(await freshenStoredSession({ token: 'expired', hasRefreshToken: true, isTokenUsable: usable, renew })).toEqual({
      status: 'ready',
      token: 'fresh',
    })
  })

  it('only the hub refusing the renewal signs out', async () => {
    const renew = async (): Promise<RenewOutcome> => ({ status: 'refused' })
    expect(await freshenStoredSession({ token: 'expired', hasRefreshToken: true, isTokenUsable: usable, renew })).toEqual({
      status: 'signed-out',
    })
  })

  it('an unreachable hub keeps the session: the renewal is retried once connected', async () => {
    const renew = async (): Promise<RenewOutcome> => ({ status: 'failed', message: 'offline' })
    expect(await freshenStoredSession({ token: 'expired', hasRefreshToken: true, isTokenUsable: usable, renew })).toEqual({
      status: 'ready',
      token: 'expired',
    })
  })

  it('a renewal that never answers does not hold the boot', async () => {
    const renew = (): Promise<RenewOutcome> => new Promise(() => undefined)
    expect(
      await freshenStoredSession({ token: 'expired', hasRefreshToken: true, isTokenUsable: usable, renew, timeoutMs: 10 }),
    ).toEqual({ status: 'ready', token: 'expired' })
  })
})
