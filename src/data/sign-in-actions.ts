/**
 * The self-service calls whose INPUT differs between hub generations.
 *
 *  - Re-authentication (D813): `beginExternalLink`, `disableOwnTotp` and
 *    `removeOwnPasskey` take a `reauthToken` from `auth.reauthenticate` and
 *    refuse (FORBIDDEN) without one. An older hub has no `reauthenticate`
 *    (NOT_FOUND) and its `disableOwnTotp` takes no input at all, so the proof
 *    is `null` there and the field is left out.
 *
 * `reauthenticate` is called directly, never through a React Query mutation:
 * a wrong password answers UNAUTHORIZED, and the mutation cache would take
 * that for a dead session (`query-client.ts`).
 */
import { isMissingProcedureError } from '../auth/missing-procedure.js'
import { isRecord } from './cap-query.js'
import type { AuthSelfServiceClient } from './sign-in-methods.js'

export type ReauthCredential = { readonly password: string } | { readonly passkeyResponse: Record<string, unknown> }

/** `reauthToken: null` — this hub does not ask for one. */
export interface ReauthProof {
  readonly reauthToken: string | null
}

export async function proveIdentity(client: AuthSelfServiceClient, credential: ReauthCredential): Promise<ReauthProof> {
  let raw: unknown
  try {
    raw = await client.auth.reauthenticate.mutate(credential)
  } catch (err) {
    if (isMissingProcedureError(err)) return { reauthToken: null }
    throw err
  }
  if (!isRecord(raw) || typeof raw.reauthToken !== 'string' || raw.reauthToken.length === 0) {
    throw new Error('The hub answered without a proof')
  }
  return { reauthToken: raw.reauthToken }
}

/** Passkey re-authentication, step 1: the hub's assertion options. */
export async function beginPasskeyProof(client: AuthSelfServiceClient): Promise<Record<string, unknown>> {
  const raw = await client.auth.reauthBeginPasskey.mutate()
  if (!isRecord(raw) || !isRecord(raw.optionsJSON)) throw new Error('The hub answered without passkey options')
  return raw.optionsJSON
}

export async function disableTotp(client: AuthSelfServiceClient, reauthToken: string | null): Promise<void> {
  if (reauthToken === null) await client.auth.disableOwnTotp.mutate()
  else await client.auth.disableOwnTotp.mutate({ reauthToken })
}

export function removePasskeyInput(
  credentialId: string,
  reauthToken: string | null,
): { credentialId: string; reauthToken?: string } {
  return reauthToken === null ? { credentialId } : { credentialId, reauthToken }
}

export interface BeginLinkRequest {
  readonly provider: string
  /** Native (D801): the app's callback. */
  readonly returnTo?: string
}

export function beginLinkInput(
  request: BeginLinkRequest,
  reauthToken: string | null,
): { provider: string; returnTo?: string; reauthToken?: string } {
  return {
    provider: request.provider,
    ...(request.returnTo !== undefined ? { returnTo: request.returnTo } : {}),
    ...(reauthToken !== null ? { reauthToken } : {}),
  }
}
