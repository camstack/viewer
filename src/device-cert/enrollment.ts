/**
 * Enrollment (D855): the device generates its own key, the hub signs the
 * public half.
 *
 *  - by CODE: an admin's QR / link (`camstack://enroll?hub=...&code=...`) ->
 *    `auth.completeEnrollment` -> the certificate login opens the session;
 *  - SELF: a signed-in device, after a STEP-UP (a sign-in made just now) ->
 *    `auth.enrollSelf` with the single-use proof.
 *
 * The new key is generated into the SPARE slot and becomes the hub's key only
 * after the hub has answered ok and the record is saved. A refusal, a network
 * failure or a crash deletes only the spare: an existing credential is never
 * touched by an enrollment that did not complete.
 */
import type { DevicePlatform } from '@camstack/types'
import { activeAliasOf, spareAliasFor } from './cert-store.js'
import { loginWithCertificate, type DeviceCertDeps, type DeviceLoginOutcome } from './device-session.js'
import { deviceWire, type IssuedCertificate, type WireDeps } from './device-wire.js'
import { isSecureHub } from './transport.js'
import type { DeviceCall, DeviceTarget } from './types.js'

export type EnrollmentOutcome =
  | { readonly status: 'enrolled'; readonly username: string; readonly notAfter: number }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'failed'; readonly message: string }

export interface EnrollmentRequest {
  readonly target: DeviceTarget
  readonly deviceName: string
  readonly platform: DevicePlatform
}

const wireOf = (deps: DeviceCertDeps, serverUrl: string): WireDeps => ({
  baseUrl: serverUrl,
  ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
})

async function enrollWith(
  deps: DeviceCertDeps,
  request: EnrollmentRequest,
  ask: (publicKeySpki: string) => Promise<DeviceCall<IssuedCertificate>>,
): Promise<EnrollmentOutcome> {
  const { target } = request
  if (!isSecureHub(target.serverUrl)) return { status: 'failed', message: 'Device certificates need an https hub' }
  const previous = await deps.store.get(target.hubKey)
  const spare = spareAliasFor(target.hubKey, previous)
  const dropSpare = async (): Promise<void> => {
    await deps.keys.delete(spare).catch(() => false)
  }
  let issued: DeviceCall<IssuedCertificate>
  let hardwareBacked: boolean
  try {
    await deps.keys.delete(spare)
    const key = await deps.keys.generate(spare)
    hardwareBacked = key.hardwareBacked
    issued = await ask(key.publicKeySpki)
  } catch (err) {
    await dropSpare()
    return { status: 'failed', message: err instanceof Error ? err.message : 'Key generation failed' }
  }
  if (issued.kind !== 'ok') {
    await dropSpare()
    return issued.kind === 'refused'
      ? { status: 'refused', reason: issued.reason }
      : { status: 'failed', message: issued.message }
  }
  const origin = new URL(target.serverUrl).origin
  try {
    await deps.store.put(target.hubKey, {
      credentialId: issued.value.credentialId,
      certPem: issued.value.certPem,
      notAfter: issued.value.notAfter,
      issuedAt: (deps.now ?? Date.now)(),
      enrolledAt: previous?.enrolledAt ?? previous?.issuedAt ?? (deps.now ?? Date.now)(),
      keyHardwareBacked: hardwareBacked,
      username: issued.value.user?.username ?? '',
      definitiveRefusals: 0,
      autoLogin: true,
      keyAlias: spare,
      hubOrigin: origin,
    })
  } catch (err) {
    await dropSpare()
    return { status: 'failed', message: err instanceof Error ? err.message : 'Could not store the certificate' }
  }
  // The swap is done: the old key (if any) is now garbage.
  if (previous !== null) {
    const old = activeAliasOf(target.hubKey, previous)
    if (old !== spare) await deps.keys.delete(old).catch(() => false)
  }
  return { status: 'enrolled', username: issued.value.user?.username ?? '', notAfter: issued.value.notAfter }
}

/** An admin's one-shot code (QR). */
export function enrollWithCode(
  deps: DeviceCertDeps,
  request: EnrollmentRequest & { readonly code: string },
): Promise<EnrollmentOutcome> {
  return enrollWith(deps, request, (publicKeySpki) =>
    deviceWire.completeEnrollment(wireOf(deps, request.target.serverUrl), {
      code: request.code,
      publicKeySpki,
      deviceName: request.deviceName,
      platform: request.platform,
    }),
  )
}

/** The caller's own device: a session AND a step-up proof. */
export function enrollSelf(
  deps: DeviceCertDeps,
  request: EnrollmentRequest & { readonly bearer: string; readonly proof: string },
): Promise<EnrollmentOutcome> {
  return enrollWith(deps, request, (publicKeySpki) =>
    deviceWire.enrollSelf(wireOf(deps, request.target.serverUrl), request.bearer, {
      proof: request.proof,
      publicKeySpki,
      deviceName: request.deviceName,
      platform: request.platform,
    }),
  )
}

/** QR path end to end: enroll, then open the first session with the new certificate. */
export async function enrollByCodeAndSignIn(
  deps: DeviceCertDeps,
  request: EnrollmentRequest & { readonly code: string },
): Promise<
  | { readonly status: 'signed-in'; readonly login: Extract<DeviceLoginOutcome, { status: 'signed-in' }> }
  | { readonly status: 'enrolment-failed'; readonly outcome: Exclude<EnrollmentOutcome, { status: 'enrolled' }> }
  | { readonly status: 'enrolled-not-signed-in'; readonly login: DeviceLoginOutcome }
> {
  const outcome = await enrollWithCode(deps, request)
  if (outcome.status !== 'enrolled') return { status: 'enrolment-failed', outcome }
  const login = await loginWithCertificate(deps, request.target)
  return login.status === 'signed-in'
    ? { status: 'signed-in', login }
    : { status: 'enrolled-not-signed-in', login }
}

/** Step-up through a password: re-authenticate, then trade the token for an enrollment proof. */
export async function proofFromPassword(
  deps: DeviceCertDeps,
  input: { readonly serverUrl: string; readonly bearer: string; readonly password: string },
): Promise<DeviceCall<string>> {
  const wire = wireOf(deps, input.serverUrl)
  const reauth = await deviceWire.reauthenticate(wire, input.bearer, input.password)
  if (reauth.kind !== 'ok') return reauth
  const proof = await deviceWire.proofFromReauth(wire, input.bearer, reauth.value.reauthToken)
  return proof.kind === 'ok' ? { kind: 'ok', value: proof.value.proof } : proof
}

/** Step-up through the app login handoff (`purpose: 'step-up'`). */
export async function proofFromHandoff(
  deps: DeviceCertDeps,
  input: {
    readonly serverUrl: string
    readonly bearer: string
    readonly code: string
    readonly codeVerifier: string
    readonly state: string
  },
): Promise<DeviceCall<string>> {
  const proof = await deviceWire.proofFromHandoff(wireOf(deps, input.serverUrl), input.bearer, {
    code: input.code,
    codeVerifier: input.codeVerifier,
    state: input.state,
  })
  return proof.kind === 'ok' ? { kind: 'ok', value: proof.value.proof } : proof
}
