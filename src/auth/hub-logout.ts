/**
 * Ending a session on the hub (D812): `auth.logout` revokes it there, so its
 * access AND refresh tokens stop working at once — dropping them on the phone
 * alone left a 30-day refresh token alive on the hub.
 *
 * Over the raw wire with the access token as bearer, because a sign-out runs
 * when there may be no connection (a server that is not the active one, an
 * app that cannot reach the hub). An access token that has already expired is
 * renewed first with the refresh token — otherwise the session it belongs to
 * would outlive the sign-out by up to 30 days.
 *
 * `everywhere` ends every session of the user. An older hub's `logout` takes
 * no input and refuses that one: `unsupported`, so the screen can say so
 * instead of pretending.
 */
import { postTrpcMutation, type FetchLike, type WireOutcome } from './hub-auth-wire.js'

export type LogoutOutcome = 'done' | 'unsupported' | 'failed'

export interface LogoutInput {
  readonly serverUrl: string
  readonly token: string
  readonly refreshToken: string | null
  readonly everywhere: boolean
  readonly fetchFn?: FetchLike
}

function post(input: LogoutInput, bearer: string): Promise<WireOutcome> {
  return postTrpcMutation({
    baseUrl: input.serverUrl,
    procedure: 'auth.logout',
    input: input.everywhere ? { everywhere: true } : undefined,
    bearer,
    ...(input.fetchFn !== undefined ? { fetchFn: input.fetchFn } : {}),
  })
}

function verdict(outcome: WireOutcome, everywhere: boolean): LogoutOutcome {
  if (outcome.status === 'ok') return 'done'
  if (everywhere && outcome.status === 'error' && outcome.httpStatus === 400) return 'unsupported'
  return 'failed'
}

async function renewed(input: LogoutInput, refreshToken: string): Promise<string | 'ended' | null> {
  const outcome = await postTrpcMutation({
    baseUrl: input.serverUrl,
    procedure: 'auth.refreshSession',
    input: { refreshToken },
    ...(input.fetchFn !== undefined ? { fetchFn: input.fetchFn } : {}),
  })
  if (outcome.status === 'unauthorized') return 'ended'
  if (outcome.status !== 'ok' || typeof outcome.data !== 'object' || outcome.data === null) return null
  const token: unknown = Reflect.get(outcome.data, 'token')
  return typeof token === 'string' && token.length > 0 ? token : null
}

export async function logoutFromHub(input: LogoutInput): Promise<LogoutOutcome> {
  const first = await post(input, input.token)
  if (first.status !== 'unauthorized') return verdict(first, input.everywhere)
  // The access token is no longer accepted. Without a refresh token that IS
  // the session being over; with one, the session may still be alive.
  if (input.refreshToken === null) return 'done'
  const fresh = await renewed(input, input.refreshToken)
  if (fresh === 'ended') return 'done'
  if (fresh === null) return 'failed'
  return verdict(await post(input, fresh), input.everywhere)
}
