/**
 * Signing in with the device certificate on behalf of the app's session
 * machinery (boot, a session the hub ended, removing a hub): the certificate
 * login, bounded in time, then the session stored like any other.
 *
 * The hub is dialled at its saved address first and then at the routes the app
 * has learned for it; the credential is the same whichever answers.
 */
import type { ServerConfig, ServerStore } from '../connection/server-store.js'
import { log } from '../lib/logger.js'
import { deviceCertDeps } from './deps.js'
import { useDeviceNotice } from './device-notice-store.js'
import {
  disconnectThisDevice,
  forgetDevice,
  loginWithCertificate,
  recordDeviceAnswer,
  renewIfDue,
  type DeviceLoginOutcome,
} from './device-session.js'
import type { DeviceAnswer } from './revocation-policy.js'
import { deviceTarget, isSecureHub } from './transport.js'
import type { DeviceTarget } from './types.js'

/** A launch must not wait on a slow hub for this. */
export const DEVICE_SIGN_IN_BOOT_TIMEOUT_MS = 8_000
/** Removing a hub waits this long for the hub to hear the revoke. */
export const DEVICE_FORGET_TIMEOUT_MS = 5_000

/** Every https route the app knows for `server`, the saved address first. */
export async function deviceTargetsFor(store: ServerStore, server: ServerConfig): Promise<readonly DeviceTarget[]> {
  const learned = (await store.getEndpoints(server.id)).map((e) => e.baseUrl)
  const urls = [...new Set([server.serverUrl, ...learned])].filter(isSecureHub)
  return urls.map((liveUrl) => deviceTarget({ hubKey: server.id, liveUrl, knownUrls: urls }))
}

function logFailure(message: string, err: unknown): void {
  log.warn('device-cert', message, { message: err instanceof Error ? err.message : String(err) })
}

/** Try each route until one ANSWERS (an unreachable one is no answer). */
async function loginOverRoutes(targets: readonly DeviceTarget[]): Promise<DeviceLoginOutcome> {
  let outcome: DeviceLoginOutcome = { status: 'none' }
  for (const [index, target] of targets.entries()) {
    // Only the first attempt is the automatic one: it carries the cooldown stamp.
    outcome = await loginWithCertificate(deviceCertDeps, target, { automatic: index === 0 })
    if (outcome.status !== 'unreachable') return outcome
  }
  return outcome
}

/**
 * The access token of a fresh certificate session for `server`, stored; or
 * `null`. Never throws: a failure here only means "show the login screen".
 * Renewal of a near-expiry certificate runs AFTER this returns, in the background.
 */
export async function signInWithDeviceCertificate(
  store: ServerStore,
  server: ServerConfig,
  timeoutMs: number = DEVICE_SIGN_IN_BOOT_TIMEOUT_MS,
): Promise<string | null> {
  try {
    const targets = await deviceTargetsFor(store, server)
    if (targets.length === 0) return null
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true
        resolve(null)
      }, timeoutMs)
    })
    try {
      const outcome = await Promise.race([loginOverRoutes(targets), timeout])
      if (outcome === null || timedOut) return null
      if (outcome.status === 'disconnected') {
        useDeviceNotice.getState().setDisconnected(true)
        return null
      }
      if (outcome.status !== 'signed-in') return null
      await store.setSession(server.id, { token: outcome.session.token, refreshToken: outcome.session.refreshToken })
      const first = targets[0]
      if (first !== undefined) renewInBackground(first)
      return outcome.session.token
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  } catch (err) {
    logFailure('Certificate sign-in failed', err)
    return null
  }
}

/** Renew a near-expiry certificate without holding anything up. */
export function renewInBackground(target: DeviceTarget): void {
  void renewIfDue(deviceCertDeps, target).catch((err: unknown) => logFailure('Certificate renewal failed', err))
}

/** Feed a refresh's verdict on the device credential to the revocation contract (https hubs only). */
export function noteDeviceRefreshAnswer(hubKey: string, serverUrl: string, answer: DeviceAnswer): void {
  if (!isSecureHub(serverUrl)) return
  void recordDeviceAnswer(deviceCertDeps, hubKey, answer)
    .then((deleted) => {
      if (deleted) useDeviceNotice.getState().setDisconnected(true)
    })
    .catch((err: unknown) => logFailure('Could not record a device answer', err))
}

/** Removing a hub: revoke the credential if the hub answers in time, then forget key and certificate either way. */
export async function forgetDeviceForServer(store: ServerStore, server: ServerConfig): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const [target] = await deviceTargetsFor(store, server)
    if (target !== undefined) {
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, DEVICE_FORGET_TIMEOUT_MS)
      })
      const revoke = disconnectThisDevice(deviceCertDeps, target).then(() => undefined)
      await Promise.race([revoke, timeout])
    }
  } catch (err) {
    logFailure('Could not revoke the device credential before removing the hub', err)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    await forgetDevice(deviceCertDeps, server.id).catch((err: unknown) => logFailure('Could not forget the device credential', err))
  }
}
