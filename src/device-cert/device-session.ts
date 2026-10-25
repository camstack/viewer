/**
 * The device-certificate life cycle (D855): sign in with it, renew it, give it
 * up, and the revocation contract that decides when it dies.
 *
 * Everything here is injected (`DeviceCertDeps`) so the contract is specified
 * without a phone: a fake key module, an in-memory store, a scripted fetch.
 *
 * Rules of the whole file:
 *  - NEVER delete a key on a guess. Deletion happens on three consecutive
 *    definitive hub answers, on the operator pressing "Disconnect this
 *    device", on removing the hub, or when the key itself is provably gone.
 *  - NEVER over plain http (the wire refuses; callers hide the path).
 *  - A hub is ONE credential (`DeviceTarget.hubKey`); the endpoint dialled is
 *    whichever route is live, and the challenge must name one of the hub's
 *    known origins.
 *  - An AUTOMATIC sign-in happens at most once per cooldown, so an admin who
 *    ends a device's sessions is not undone within seconds. (True lock-out is
 *    revoking the device in Identity -> Certificates.)
 */
import { DEVICE_CERT_RENEW_WINDOW_DAYS, buildDeviceSignatureMessage } from '@camstack/types/client'
import type { DeviceSignaturePurpose } from '@camstack/types'
import type { FetchLike } from '../auth/hub-auth-wire.js'
import { sameHubOrigin } from '../connection/hub-origin.js'
import { log } from '../lib/logger.js'
import { activeAliasOf, allAliasesFor, type DeviceCertStore } from './cert-store.js'
import { deviceWire, type WireDeps } from './device-wire.js'
import { judgeAnswer, type DeviceAnswer } from './revocation-policy.js'
import { isSecureHub } from './transport.js'
import type { DeviceCall, DeviceCertRecord, DeviceKeyModule, DeviceSession, DeviceTarget } from './types.js'

export interface DeviceCertDeps {
  readonly keys: DeviceKeyModule
  readonly store: DeviceCertStore
  readonly fetchFn?: FetchLike
  readonly now?: () => number
}

const DAY_MS = 24 * 60 * 60 * 1000
/** One automatic certificate sign-in per hub per this long. */
export const AUTO_RELOGIN_COOLDOWN_MS = 10 * 60 * 1000
const nowOf = (deps: DeviceCertDeps): number => (deps.now ?? Date.now)()

const wireOf = (deps: DeviceCertDeps, serverUrl: string): WireDeps => ({
  baseUrl: serverUrl,
  ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
})

/** Is the certificate inside its renewal window (or past it)? */
export function isRenewalDue(notAfter: number, now: number): boolean {
  return notAfter - now < DEVICE_CERT_RENEW_WINDOW_DAYS * DAY_MS
}

/** May an automatic sign-in run now? */
export function mayAutoSignIn(record: { readonly lastAutoReloginAt?: number }, now: number): boolean {
  return record.lastAutoReloginAt === undefined || now - record.lastAutoReloginAt >= AUTO_RELOGIN_COOLDOWN_MS
}

export type DeviceLoginOutcome =
  /** No certificate for this hub (or none usable here: plain http, paused, cooling down). */
  | { readonly status: 'none' }
  | { readonly status: 'signed-in'; readonly session: DeviceSession }
  /** The third consecutive definitive answer: key and certificate are gone. */
  | { readonly status: 'disconnected'; readonly reason: string }
  /** The hub said no, but not for good (or not yet for the third time). */
  | { readonly status: 'refused'; readonly reason: string }
  /** No answer: offline, a 5xx, a hub that is not ours. Nothing was counted. */
  | { readonly status: 'unreachable'; readonly message: string }

/** Delete every key slot and the record of one hub. The only deleting path. */
export async function forgetDevice(deps: DeviceCertDeps, hubKey: string): Promise<void> {
  for (const alias of allAliasesFor(hubKey)) await deps.keys.delete(alias)
  await deps.store.clear(hubKey)
}

/**
 * Count one hub answer towards the revocation contract. Returns true when the
 * credential was deleted because of it.
 */
export async function recordDeviceAnswer(deps: DeviceCertDeps, hubKey: string, answer: DeviceAnswer): Promise<boolean> {
  const record = await deps.store.get(hubKey)
  if (record === null) return false
  const verdict = judgeAnswer(record.definitiveRefusals, answer)
  if (verdict.deleteCredential) {
    log.warn('device-cert', 'Device credential deleted after repeated definitive refusals', {
      reason: answer.kind === 'refusal' ? answer.reason : 'n/a',
    })
    await forgetDevice(deps, hubKey)
    return true
  }
  if (verdict.count !== record.definitiveRefusals) {
    await deps.store.put(hubKey, { ...record, definitiveRefusals: verdict.count })
  }
  return false
}

type Signed = { readonly nonce: string; readonly signature: string }

/** Challenge -> origin check -> signature. A challenge naming an origin the hub is not known by is refused. */
async function signChallenge(
  deps: DeviceCertDeps,
  target: DeviceTarget,
  record: DeviceCertRecord,
  purpose: DeviceSignaturePurpose,
): Promise<DeviceCall<Signed>> {
  const challenge = await deviceWire.getChallenge(wireOf(deps, target.serverUrl))
  if (challenge.kind !== 'ok') return challenge
  const { nonce, origin } = challenge.value
  const known = record.hubOrigin === undefined ? target.allowedOrigins : [...target.allowedOrigins, record.hubOrigin]
  if (!known.some((o) => sameHubOrigin(o, origin))) {
    log.warn('device-cert', 'Challenge names an origin this hub is not known by', { challengeOrigin: origin })
    return { kind: 'transient', message: 'The hub named an origin it is not known by' }
  }
  try {
    const signature = await deps.keys.sign(
      activeAliasOf(target.hubKey, record),
      buildDeviceSignatureMessage({ purpose, origin, nonce }),
    )
    return { kind: 'ok', value: { nonce, signature } }
  } catch (err) {
    return { kind: 'transient', message: err instanceof Error ? err.message : 'Signing failed' }
  }
}

function answerOf<T>(call: DeviceCall<T>): DeviceAnswer {
  switch (call.kind) {
    case 'ok':
      return { kind: 'success' }
    case 'refused':
      return { kind: 'refusal', reason: call.reason }
    case 'transient':
      return { kind: 'unreachable' }
  }
}

/** Renew the certificate when it is inside the window; any failure keeps the old one. */
export async function renewIfDue(deps: DeviceCertDeps, target: DeviceTarget): Promise<'renewed' | 'not-due' | 'kept'> {
  if (!isSecureHub(target.serverUrl)) return 'not-due'
  const record = await deps.store.get(target.hubKey)
  if (record === null || !isRenewalDue(record.notAfter, nowOf(deps))) return 'not-due'
  return renewNow(deps, target, record)
}

async function renewNow(deps: DeviceCertDeps, target: DeviceTarget, record: DeviceCertRecord): Promise<'renewed' | 'kept'> {
  const signed = await signChallenge(deps, target, record, 'renew')
  if (signed.kind !== 'ok') return 'kept'
  const renewed = await deviceWire.renew(wireOf(deps, target.serverUrl), { certPem: record.certPem, ...signed.value })
  if (renewed.kind !== 'ok') {
    log.info('device-cert', 'Certificate renewal not done; keeping the current one', {
      reason: renewed.kind === 'refused' ? renewed.reason : renewed.message,
    })
    return 'kept'
  }
  // Re-read: a sign-in may have touched the record while the renewal was in flight.
  const current = (await deps.store.get(target.hubKey)) ?? record
  await deps.store.put(target.hubKey, {
    ...current,
    credentialId: renewed.value.credentialId,
    certPem: renewed.value.certPem,
    notAfter: renewed.value.notAfter,
    issuedAt: nowOf(deps),
  })
  return 'renewed'
}

/**
 * Sign in with the stored certificate. Renewal is NOT done here: the session
 * is returned first and the caller renews afterwards ({@link renewIfDue}),
 * outside whatever time budget the sign-in ran under.
 *
 * `automatic` marks a sign-in nobody asked for (launch, a session the hub
 * ended): it respects the pause after a sign-out and the cooldown.
 */
export async function loginWithCertificate(
  deps: DeviceCertDeps,
  target: DeviceTarget,
  options: { readonly automatic?: boolean } = {},
): Promise<DeviceLoginOutcome> {
  if (!isSecureHub(target.serverUrl)) return { status: 'none' }
  const record = await deps.store.get(target.hubKey)
  if (record === null) return { status: 'none' }
  if (options.automatic === true) {
    if (!record.autoLogin) return { status: 'none' }
    if (!mayAutoSignIn(record, nowOf(deps))) {
      log.info('device-cert', 'Automatic certificate sign-in is cooling down')
      return { status: 'none' }
    }
  }
  if (!(await hasKeySafely(deps, activeAliasOf(target.hubKey, record)))) {
    // A certificate with no key (restored from a backup onto another device):
    // useless, and not a hub answer. Forget it so the login screen is honest.
    log.warn('device-cert', 'Certificate without its key; forgetting it')
    await forgetDevice(deps, target.hubKey)
    return { status: 'none' }
  }
  const stamped =
    options.automatic === true ? { ...record, lastAutoReloginAt: nowOf(deps) } : record
  if (stamped !== record) await deps.store.put(target.hubKey, stamped)
  const first = await attemptLogin(deps, target, stamped)
  if (first.status === 'refused' && first.reason === 'superseded') {
    // A renewed certificate replaced this one: fetch the newest and try once more.
    if ((await renewNow(deps, target, stamped)) === 'renewed') {
      const fresh = await deps.store.get(target.hubKey)
      if (fresh !== null) return finishLogin(deps, target, await attemptLogin(deps, target, fresh))
    }
  }
  return finishLogin(deps, target, first)
}

async function hasKeySafely(deps: DeviceCertDeps, alias: string): Promise<boolean> {
  try {
    return await deps.keys.has(alias)
  } catch {
    // The key store hiccuped: that is not "the key is gone".
    return true
  }
}

async function finishLogin(
  deps: DeviceCertDeps,
  target: DeviceTarget,
  outcome: DeviceLoginOutcome,
): Promise<DeviceLoginOutcome> {
  if (outcome.status === 'signed-in') await setAutoLogin(deps, target.hubKey, true)
  return outcome
}

/** Allow or stop the certificate from signing in on its own (a sign-out stops it, a password login restores it). */
export async function setAutoLogin(deps: DeviceCertDeps, hubKey: string, autoLogin: boolean): Promise<void> {
  const record = await deps.store.get(hubKey)
  if (record === null || record.autoLogin === autoLogin) return
  await deps.store.put(hubKey, { ...record, autoLogin })
}

async function attemptLogin(
  deps: DeviceCertDeps,
  target: DeviceTarget,
  record: DeviceCertRecord,
): Promise<DeviceLoginOutcome> {
  const signed = await signChallenge(deps, target, record, 'login')
  let result: DeviceCall<{ token: string; refreshToken: string | null; username: string; certNotAfter: number }>
  if (signed.kind !== 'ok') {
    result = signed
  } else {
    const login = await deviceWire.login(wireOf(deps, target.serverUrl), { certPem: record.certPem, ...signed.value })
    result =
      login.kind === 'ok'
        ? {
            kind: 'ok',
            value: {
              token: login.value.token,
              refreshToken: login.value.refreshToken ?? null,
              username: login.value.user.username,
              certNotAfter: login.value.certNotAfter,
            },
          }
        : login
  }
  // A challenge refusal (rate-limited...) is an answer too; a transport failure is none.
  const deleted = await recordDeviceAnswer(deps, target.hubKey, answerOf(result))
  switch (result.kind) {
    case 'ok': {
      const current = (await deps.store.get(target.hubKey)) ?? record
      if (current.notAfter !== result.value.certNotAfter) {
        await deps.store.put(target.hubKey, { ...current, notAfter: result.value.certNotAfter })
      }
      return {
        status: 'signed-in',
        session: {
          token: result.value.token,
          refreshToken: result.value.refreshToken,
          username: result.value.username,
          certNotAfter: result.value.certNotAfter,
        },
      }
    }
    case 'refused':
      return deleted
        ? { status: 'disconnected', reason: result.reason }
        : { status: 'refused', reason: result.reason }
    case 'transient':
      return { status: 'unreachable', message: result.message }
  }
}

export type DisconnectOutcome =
  | { readonly status: 'disconnected' }
  | { readonly status: 'failed'; readonly message: string }

/**
 * "Disconnect this device": the hub revokes the credential (signed, no
 * session needed), then key and certificate go at once. A hub that already
 * considers the credential gone is the answer the operator wanted too.
 */
export async function disconnectThisDevice(deps: DeviceCertDeps, target: DeviceTarget): Promise<DisconnectOutcome> {
  const record = await deps.store.get(target.hubKey)
  if (record === null) return { status: 'disconnected' }
  const signed = await signChallenge(deps, target, record, 'revoke')
  if (signed.kind !== 'ok') return failure(signed)
  const revoked = await deviceWire.revokeOwn(wireOf(deps, target.serverUrl), { certPem: record.certPem, ...signed.value })
  if (revoked.kind === 'ok' || (revoked.kind === 'refused' && revoked.definitive)) {
    await forgetDevice(deps, target.hubKey)
    return { status: 'disconnected' }
  }
  return failure(revoked)
}

function failure(call: DeviceCall<unknown>): DisconnectOutcome {
  if (call.kind === 'refused') return { status: 'failed', message: call.reason }
  if (call.kind === 'transient') return { status: 'failed', message: call.message }
  return { status: 'failed', message: 'unexpected' }
}
