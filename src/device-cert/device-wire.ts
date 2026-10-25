/**
 * The hub's device-certificate endpoints over the raw tRPC wire (they run when
 * no System exists: a cold start, a hub that is not the active one). Every
 * answer is narrowed to a {@link DeviceCall}: a typed refusal is an answer, a
 * transport failure is none.
 */
import { z } from 'zod'
import { deviceRefusalFromMessage } from '@camstack/types/client'
import { postTrpcMutation, type FetchLike, type WireOutcome } from '../auth/hub-auth-wire.js'
import { isDefinitiveReason } from './revocation-policy.js'
import { isSecureHub } from './transport.js'
import type { DeviceCall } from './types.js'

const RefusalSchema = z.object({
  ok: z.literal(false),
  reason: z.string(),
  retryAfterSeconds: z.number().optional(),
})

const ChallengeSchema = z.object({
  ok: z.literal(true),
  nonce: z.string().min(1),
  origin: z.string().min(1),
  expiresAt: z.number(),
})
export type Challenge = z.infer<typeof ChallengeSchema>

const LoginSchema = z.object({
  ok: z.literal(true),
  token: z.string().min(1),
  refreshToken: z.string().min(1).optional(),
  user: z.object({ id: z.string(), username: z.string() }),
  certNotAfter: z.number(),
})
export type DeviceLogin = z.infer<typeof LoginSchema>

const IssuedSchema = z.object({
  ok: z.literal(true),
  credentialId: z.string().min(1),
  certPem: z.string().min(1),
  notAfter: z.number(),
  user: z.object({ id: z.string(), username: z.string() }).optional(),
})
export type IssuedCertificate = z.infer<typeof IssuedSchema>

const OkSchema = z.object({ ok: z.literal(true) })

const ProofSchema = z.object({ proof: z.string().min(1), expiresAt: z.number() })
export type EnrollProof = z.infer<typeof ProofSchema>

export interface WireDeps {
  readonly baseUrl: string
  readonly fetchFn?: FetchLike
}

/** Not a hub reason: the app's name for "the session this call rode on is dead" (never definitive). */
export const SESSION_ENDED_REASON = 'session-ended'

function refusalOf(reason: string, retryAfterSeconds?: number): DeviceCall<never> {
  return {
    kind: 'refused',
    reason,
    definitive: isDefinitiveReason(reason),
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  }
}

/** Narrow one wire outcome through `schema`; a refusal body is an answer. */
function narrow<S extends z.ZodType>(outcome: WireOutcome, schema: S, sessionBound: boolean): DeviceCall<z.infer<S>> {
  switch (outcome.status) {
    case 'ok': {
      const refusal = RefusalSchema.safeParse(outcome.data)
      if (refusal.success) return refusalOf(refusal.data.reason, refusal.data.retryAfterSeconds)
      const parsed = schema.safeParse(outcome.data)
      return parsed.success
        ? { kind: 'ok', value: parsed.data }
        : { kind: 'transient', message: 'Unexpected response shape' }
    }
    case 'unauthorized': {
      // A credential-bound session refused on its credential says why.
      const reason = outcome.message === null ? null : deviceRefusalFromMessage(outcome.message)
      if (reason !== null) return refusalOf(reason)
      // A call made under the caller's session that the hub answers 401 means
      // that session is gone — never "wrong password", never a retryable blip.
      return sessionBound
        ? refusalOf(SESSION_ENDED_REASON)
        : { kind: 'transient', message: outcome.message ?? 'Unauthorized' }
    }
    case 'forbidden':
      return { kind: 'transient', message: outcome.message ?? 'HTTP 403' }
    case 'missing':
      return { kind: 'transient', message: 'This hub has no device certificates' }
    case 'error':
      return { kind: 'transient', message: outcome.message }
  }
}

async function call<S extends z.ZodType>(
  deps: WireDeps,
  procedure: string,
  input: unknown,
  schema: S,
  bearer?: string,
  sessionBound = false,
): Promise<DeviceCall<z.infer<S>>> {
  // Never a signature, a proof or a certificate over plain http.
  if (!isSecureHub(deps.baseUrl)) return { kind: 'transient', message: 'Device certificates need an https hub' }
  return narrow(
    await postTrpcMutation({
      baseUrl: deps.baseUrl,
      procedure,
      ...(input !== undefined ? { input } : {}),
      ...(bearer !== undefined ? { bearer } : {}),
      ...(deps.fetchFn ? { fetchFn: deps.fetchFn } : {}),
    }),
    schema,
    sessionBound,
  )
}

export const deviceWire = {
  getChallenge: (deps: WireDeps) => call(deps, 'auth.getDeviceChallenge', undefined, ChallengeSchema),
  login: (deps: WireDeps, input: { certPem: string; nonce: string; signature: string }) =>
    call(deps, 'auth.loginWithDeviceCertificate', { ...input, refreshable: true }, LoginSchema),
  renew: (deps: WireDeps, input: { certPem: string; nonce: string; signature: string }) =>
    call(deps, 'auth.renewDeviceCertificate', input, IssuedSchema),
  revokeOwn: (deps: WireDeps, input: { certPem: string; nonce: string; signature: string }) =>
    call(deps, 'auth.revokeOwnDeviceCertificate', input, OkSchema),
  completeEnrollment: (
    deps: WireDeps,
    input: { code: string; publicKeySpki: string; deviceName: string; platform: string },
  ) => call(deps, 'auth.completeEnrollment', input, IssuedSchema),
  enrollSelf: (
    deps: WireDeps,
    bearer: string,
    input: { proof: string; publicKeySpki: string; deviceName: string; platform: string },
  ) => call(deps, 'auth.enrollSelf', input, IssuedSchema, bearer, true),
  proofFromReauth: (deps: WireDeps, bearer: string, reauthToken: string) =>
    call(deps, 'auth.deviceEnrollProofFromReauth', { reauthToken }, ProofSchema, bearer, true),
  proofFromHandoff: (
    deps: WireDeps,
    bearer: string,
    input: { code: string; codeVerifier: string; state: string },
  ) => call(deps, 'auth.deviceEnrollProofFromHandoff', input, ProofSchema, bearer, true),
  reauthenticate: (deps: WireDeps, bearer: string, password: string) =>
    call(deps, 'auth.reauthenticate', { password }, z.object({ reauthToken: z.string().min(1) }), bearer),
}
