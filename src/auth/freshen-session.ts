/**
 * What a STORED session is worth when it is about to become the active one —
 * on a cold start, or a switch to another saved server.
 *
 * With 2 h access tokens (D812) the stored one has usually expired by the time
 * the app opens again. That is not a signed-out state while a refresh token is
 * kept: the session is renewed first, and only the hub refusing that renewal
 * signs out. A hub that cannot be reached (no network, a slow tunnel) does not
 * hold the launch — the expired token is installed and the renewal is retried
 * when the connection reports it (`ServerProvider.renewSession`).
 */
import type { RenewOutcome } from './refresh-session.js'

export type FreshenedSession =
  | { readonly status: 'ready'; readonly token: string }
  | { readonly status: 'signed-out' }

export interface FreshenInput {
  readonly token: string
  readonly hasRefreshToken: boolean
  readonly isTokenUsable: (token: string) => boolean
  readonly renew: () => Promise<RenewOutcome>
  /** How long the launch waits for a renewal. */
  readonly timeoutMs?: number
}

/** Long enough for a tunnel round trip, short enough not to read as a hang. */
export const FRESHEN_TIMEOUT_MS = 4_000

export async function freshenStoredSession(input: FreshenInput): Promise<FreshenedSession> {
  if (input.isTokenUsable(input.token)) return { status: 'ready', token: input.token }
  if (!input.hasRefreshToken) return { status: 'signed-out' }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), input.timeoutMs ?? FRESHEN_TIMEOUT_MS)
  })
  try {
    const outcome = await Promise.race([input.renew(), timeout])
    if (outcome?.status === 'renewed') return { status: 'ready', token: outcome.token }
    if (outcome?.status === 'refused') return { status: 'signed-out' }
    return { status: 'ready', token: input.token }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
