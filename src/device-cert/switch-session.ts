/**
 * Pairing a phone ends the session it was paired from and continues under the
 * certificate (explicit, so the hub records the credential's first use).
 *
 * Order is the whole point: the certificate session is opened and installed
 * FIRST; only when that worked is the old session ended on the hub. A failure
 * at any step leaves the old session exactly as it was, so there is no moment
 * at which the person is signed out. The explicit sign-in is not an automatic
 * one: it neither respects nor stamps the 10-minute re-login cooldown, and it
 * never touches `autoLogin`.
 */
import { log } from '../lib/logger.js'
import { deviceCertDeps } from './deps.js'
import { loginWithCertificate, type DeviceCertDeps, type DeviceLoginOutcome } from './device-session.js'
import type { DeviceSession, DeviceTarget } from './types.js'

export type SwitchOutcome = 'switched' | 'kept'

export interface SwitchInput<Old> {
  readonly deps?: DeviceCertDeps
  /** Every https route of the hub, the live one first. */
  readonly targets: readonly DeviceTarget[]
  /** The session being replaced (read BEFORE the new one overwrites it); `null` when there is none. */
  readonly captureOld: () => Promise<Old | null>
  /** Make the certificate session the live one. */
  readonly install: (session: DeviceSession) => Promise<void>
  /** End the old session on the hub (`auth.logout`). */
  readonly endOld: (old: Old) => Promise<unknown>
}

async function signInOverRoutes(deps: DeviceCertDeps, targets: readonly DeviceTarget[]): Promise<DeviceLoginOutcome> {
  let outcome: DeviceLoginOutcome = { status: 'none' }
  for (const target of targets) {
    outcome = await loginWithCertificate(deps, target)
    if (outcome.status !== 'unreachable') return outcome
  }
  return outcome
}

export async function switchToCertificateSession<Old>(input: SwitchInput<Old>): Promise<SwitchOutcome> {
  const deps = input.deps ?? deviceCertDeps
  try {
    const old = await input.captureOld()
    const outcome = await signInOverRoutes(deps, input.targets)
    if (outcome.status !== 'signed-in') {
      log.warn('device-cert', 'Certificate session not opened after pairing; keeping the current session', {
        status: outcome.status,
      })
      return 'kept'
    }
    await input.install(outcome.session)
    if (old !== null) {
      await input.endOld(old).catch((err: unknown) =>
        log.warn('device-cert', 'Previous session could not be ended after pairing', {
          message: err instanceof Error ? err.message : String(err),
        }),
      )
    }
    return 'switched'
  } catch (err) {
    log.warn('device-cert', 'Switching to the certificate session failed', {
      message: err instanceof Error ? err.message : String(err),
    })
    return 'kept'
  }
}
