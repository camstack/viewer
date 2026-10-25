/**
 * Silent session renewal — one decision for every hub generation.
 *
 * A hub with login sessions (D812) hands a refreshing client a short access
 * token (2 h by default) and an opaque `csr_` refresh token. Renewal swaps the
 * refresh token at the PUBLIC `auth.refreshSession` for a new access token and
 * a ROTATED refresh token; presenting a rotated-out one again (after a 30 s
 * grace) revokes the whole session, so the caller must keep the new one before
 * anything else (`session-renewer.ts` does).
 *
 * A session with no refresh token — signed in on an older hub, or by an app
 * build from before D812 — renews over the live connection with the handoff
 * pair (`auth.createHandoffCode` + `auth.redeemHandoffCode`). On a D812 hub
 * that pair can also OPEN a refreshing session (`purpose: 'new-session'`,
 * `refreshable: true`), which is how an installed app moves over without a
 * sign-in; the answer names the token it supersedes so the caller can end the
 * old session once the transport has moved. An older hub refuses the
 * `purpose` input, and the plain pair renews the same session as before.
 *
 * Outcomes are the caller's decision table: only `refused` means "signed out".
 */
import { deviceRefusalFromMessage } from '@camstack/types/client'
import { isUnauthorizedError } from './unauthorized.js'
import { postTrpcMutation, type FetchLike } from './hub-auth-wire.js'

export type RenewOutcome =
  | {
      readonly status: 'renewed'
      readonly token: string
      /** The refresh token to keep from now on; `null` = the session has none. */
      readonly refreshToken: string | null
      /** The access token of a session this renewal REPLACED (a move to a
       *  refreshing session), to be ended once nothing uses it; else `null`. */
      readonly supersededToken: string | null
    }
  /** The hub ended this session: sign in again. `deviceRefusal` names why when
   *  the session was bound to a device certificate that no longer stands (D855). */
  | { readonly status: 'refused'; readonly deviceRefusal?: string }
  /** No refresh token and no live connection: nothing to renew with now. */
  | { readonly status: 'unavailable' }
  /** Transient (network, rate limit, a hub hiccup): try again later. */
  | { readonly status: 'failed'; readonly message: string }

/**
 * The two handoff procedures, reached through a documented structural
 * boundary: the installed `AppRouter` type predates their inputs.
 */
export interface RenewClient {
  readonly auth: {
    readonly createHandoffCode: { mutate: (input?: { purpose: 'new-session' }) => Promise<unknown> }
    readonly redeemHandoffCode: {
      mutate: (input: { code: string; refreshable?: true }) => Promise<unknown>
    }
  }
}

export interface RenewInput {
  /** Where to reach the hub — the live route when connected. */
  readonly serverUrl: string
  readonly refreshToken: string | null
  /** The access token in use now. */
  readonly currentToken: string
  /** The live, authenticated client; `null` when not connected. */
  readonly client: RenewClient | null
  readonly fetchFn?: FetchLike
}

function readString(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null
  const field: unknown = Reflect.get(value, key)
  return typeof field === 'string' && field.length > 0 ? field : null
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * A refresh that never answers would hold the renewal's single flight open for
 * the rest of the session and every later UNAUTHORIZED would join it.
 */
const REFRESH_TIMEOUT_MS = 20_000

type RefreshStep = RenewOutcome | { readonly status: 'missing' }

async function refreshWithToken(
  serverUrl: string,
  refreshToken: string,
  fetchFn: FetchLike | undefined,
): Promise<RefreshStep> {
  const outcome = await postTrpcMutation({
    baseUrl: serverUrl,
    procedure: 'auth.refreshSession',
    input: { refreshToken },
    ...(fetchFn !== undefined ? { fetchFn } : {}),
    timeoutMs: REFRESH_TIMEOUT_MS,
  })
  switch (outcome.status) {
    case 'ok': {
      const token = readString(outcome.data, 'token')
      const rotated = readString(outcome.data, 'refreshToken')
      if (token === null || rotated === null) {
        return { status: 'failed', message: 'Session refresh answered without tokens' }
      }
      return { status: 'renewed', token, refreshToken: rotated, supersededToken: null }
    }
    case 'unauthorized': {
      const deviceRefusal = outcome.message === null ? null : deviceRefusalFromMessage(outcome.message)
      return deviceRefusal === null ? { status: 'refused' } : { status: 'refused', deviceRefusal }
    }
    case 'missing':
      return { status: 'missing' }
    case 'forbidden':
      return { status: 'failed', message: outcome.message ?? 'HTTP 403' }
    case 'error':
      return { status: 'failed', message: outcome.message }
  }
}

/** Mint + redeem one handoff code; `upgrade` asks for a refreshing session. */
async function redeemHandoff(
  client: RenewClient,
  upgrade: boolean,
): Promise<{ token: string; refreshToken: string | null }> {
  const minted = upgrade
    ? await client.auth.createHandoffCode.mutate({ purpose: 'new-session' })
    : await client.auth.createHandoffCode.mutate()
  const code = readString(minted, 'code')
  if (code === null) throw new Error('Handoff answered without a code')
  const redeemed = upgrade
    ? await client.auth.redeemHandoffCode.mutate({ code, refreshable: true })
    : await client.auth.redeemHandoffCode.mutate({ code })
  const token = readString(redeemed, 'token')
  if (token === null) throw new Error('Session refresh returned an empty token')
  return { token, refreshToken: readString(redeemed, 'refreshToken') }
}

async function renewOverConnection(client: RenewClient, currentToken: string): Promise<RenewOutcome> {
  try {
    const moved = await redeemHandoff(client, true)
    return { status: 'renewed', ...moved, supersededToken: currentToken }
  } catch (err) {
    if (isUnauthorizedError(err)) return { status: 'refused' }
    // An older hub refuses the `purpose` input: renew the same session.
  }
  try {
    const renewed = await redeemHandoff(client, false)
    return { status: 'renewed', token: renewed.token, refreshToken: null, supersededToken: null }
  } catch (err) {
    return isUnauthorizedError(err) ? { status: 'refused' } : { status: 'failed', message: message(err) }
  }
}

/** Renew the session — see the module doc for which path runs when. */
export async function renewSession(input: RenewInput): Promise<RenewOutcome> {
  if (input.refreshToken !== null) {
    const refreshed = await refreshWithToken(input.serverUrl, input.refreshToken, input.fetchFn)
    // A hub that no longer has refreshSession (a downgrade) renews the old way.
    if (refreshed.status !== 'missing') return refreshed
  }
  if (input.client === null) return { status: 'unavailable' }
  return renewOverConnection(input.client, input.currentToken)
}
