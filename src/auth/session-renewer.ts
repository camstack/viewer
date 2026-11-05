/**
 * The one place a session is renewed and its new credentials are kept.
 *
 * Two rules a refreshing session (D812) imposes, both of which a scattered
 * caller would break:
 *
 *  - **Single flight, per server.** The scheduled renewal, a query answered
 *    UNAUTHORIZED and a resume can all ask at once. Two concurrent refreshes
 *    with the same token would rotate it twice — the second presenting a
 *    token the first already rotated out. Concurrent callers share one call.
 *  - **The rotated token is never lost.** It is written to the vault before
 *    anyone hears "renewed"; when that write fails (a locked keychain), it is
 *    still remembered in memory and used next time, because the token on disk
 *    is the dead one.
 *
 * The refresh token is read at call time, never held by a caller: another tab
 * of the hub-served viewer may have rotated it since.
 */
import { Platform } from 'react-native'
import { log } from '../lib/logger.js'
import type { SessionCredentials } from '../connection/server-store.js'
import { hasCredentialClaim, isJwtExpired } from './session-token.js'
import { renewSession, type RenewInput, type RenewOutcome } from './refresh-session.js'

/** Where a server's credentials live (the `ServerStore` fits). */
export interface SessionVault {
  /** The stored access token; lets a tab adopt a renewal another tab stored. */
  getToken?(serverId: string): Promise<string | null>
  getRefreshToken(serverId: string): Promise<string | null>
  setSession(serverId: string, session: SessionCredentials): Promise<void>
}

export type RenewRequest = Omit<RenewInput, 'refreshToken'>

export interface SessionRenewer {
  renew(serverId: string, request: RenewRequest): Promise<RenewOutcome>
  /** Forget anything held for a server that was signed out or removed. */
  forget(serverId: string): void
}

/** What a refresh said about the device certificate behind a session (D855 §7). */
export type DeviceRefreshAnswer =
  | { readonly kind: 'success' }
  | { readonly kind: 'refusal'; readonly reason: string }

export interface SessionRenewerDeps {
  readonly vault: SessionVault
  /** Told about every refresh that answered for or against a device credential. */
  readonly onDeviceAnswer?: (serverId: string, serverUrl: string, answer: DeviceRefreshAnswer) => void
  /**
   * The vault is shared with other tabs (web: localStorage). The hub honours a
   * rotated-out refresh token for 30 s, then REVOKES the session — two tabs
   * refreshing with the same token would sign the user out everywhere. So a
   * renewal runs under a cross-tab lock and, once it holds it, adopts a newer
   * live token another tab stored instead of rotating again.
   */
  readonly crossTab?: boolean
  /** The cross-tab lock; default `navigator.locks.request` when the browser has it. */
  readonly withLock?: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  /** Injected for tests. */
  readonly renew?: (input: RenewInput) => Promise<RenewOutcome>
}

/** `navigator.locks` when the browser has it; else no lock (the adopt-stored re-read alone). */
function browserLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
  return locks === undefined ? fn() : locks.request(name, fn)
}

export function createSessionRenewer(deps: SessionRenewerDeps): SessionRenewer {
  const renew = deps.renew ?? renewSession
  const inflight = new Map<string, Promise<RenewOutcome>>()
  /** Rotations the vault refused to store; they outrank the vault's copy. */
  const unsaved = new Map<string, string | null>()

  const crossTab = deps.crossTab ?? Platform.OS === 'web'
  const withLock = deps.withLock ?? browserLock

  /** A live token another tab stored since this tab's `currentToken`: use it, rotate nothing. */
  const adoptStored = async (serverId: string, request: RenewRequest): Promise<RenewOutcome | null> => {
    if (!crossTab || deps.vault.getToken === undefined || unsaved.has(serverId)) return null
    const stored = await deps.vault.getToken(serverId)
    if (stored === null || stored === request.currentToken || isJwtExpired(stored)) return null
    const refreshToken = await deps.vault.getRefreshToken(serverId)
    log.info('session', 'Adopted a session another tab renewed')
    return { status: 'renewed', token: stored, refreshToken, supersededToken: null }
  }

  const run = async (serverId: string, request: RenewRequest): Promise<RenewOutcome> => {
    if (!crossTab) return refresh(serverId, request)
    return withLock(`camstack-session-renew:${serverId}`, async () => {
      const adopted = await adoptStored(serverId, request)
      return adopted ?? refresh(serverId, request)
    })
  }

  const refresh = async (serverId: string, request: RenewRequest): Promise<RenewOutcome> => {
    const refreshToken = unsaved.has(serverId)
      ? (unsaved.get(serverId) ?? null)
      : await deps.vault.getRefreshToken(serverId)
    const outcome = await renew({ ...request, refreshToken })
    if (outcome.status === 'refused' && outcome.deviceRefusal !== undefined) {
      deps.onDeviceAnswer?.(serverId, request.serverUrl, { kind: 'refusal', reason: outcome.deviceRefusal })
    }
    if (outcome.status !== 'renewed') return outcome
    // Only a refresh of a certificate-bound session says anything good about the credential.
    if (hasCredentialClaim(request.currentToken)) deps.onDeviceAnswer?.(serverId, request.serverUrl, { kind: 'success' })
    try {
      await deps.vault.setSession(serverId, { token: outcome.token, refreshToken: outcome.refreshToken })
      unsaved.delete(serverId)
    } catch (err) {
      unsaved.set(serverId, outcome.refreshToken)
      log.warn('session', 'Renewed session could not be stored', {
        message: err instanceof Error ? err.message : String(err),
      })
    }
    return outcome
  }

  return {
    renew: (serverId, request) => {
      const pending = inflight.get(serverId)
      if (pending !== undefined) return pending
      const started = run(serverId, request).finally(() => inflight.delete(serverId))
      inflight.set(serverId, started)
      return started
    },
    forget: (serverId) => {
      unsaved.delete(serverId)
    },
  }
}
