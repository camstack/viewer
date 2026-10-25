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
import { log } from '../lib/logger.js'
import type { SessionCredentials } from '../connection/server-store.js'
import { hasCredentialClaim } from './session-token.js'
import { renewSession, type RenewInput, type RenewOutcome } from './refresh-session.js'

/** Where a server's credentials live (the `ServerStore` fits). */
export interface SessionVault {
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
  /** Injected for tests. */
  readonly renew?: (input: RenewInput) => Promise<RenewOutcome>
}

export function createSessionRenewer(deps: SessionRenewerDeps): SessionRenewer {
  const renew = deps.renew ?? renewSession
  const inflight = new Map<string, Promise<RenewOutcome>>()
  /** Rotations the vault refused to store; they outrank the vault's copy. */
  const unsaved = new Map<string, string | null>()

  const run = async (serverId: string, request: RenewRequest): Promise<RenewOutcome> => {
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
