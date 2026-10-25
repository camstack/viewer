/**
 * "The hub ended this session" — the two ways the app finds out.
 *
 *  (a) the hub CLOSES the WebSocket with {@link SESSION_ENDED_CLOSE_CODE}
 *      (`session-ended`) when the login session behind it is revoked (sign out
 *      everywhere, an admin revoke, a deleted user, a revoked device
 *      certificate) or when a socket presents a bearer that resolves to nobody;
 *  (b) a call on an authenticated connection is answered `UNAUTHORIZED`.
 *
 * Either one means "renew once, and sign out if the hub refuses" — the single
 * path in `app/use-session-renewal.ts`. This module only RECOGNISES the signal
 * and reports it; it decides nothing.
 *
 * Why (b) needs a reporter and not only the query cache: most of the app's
 * polls go through `capQuery` (and a few hooks with their own `catch`), which
 * turn every failure into `null` BY DESIGN ("unknown" renders happily). A
 * revoked session therefore never reached the cache's `onError`, and the app
 * kept polling as an anonymous principal until it was killed (2026-10-16).
 */
import { isUnauthorizedError } from './unauthorized.js'
import { signalUnauthorized } from './unauthorized-signal.js'

/** WebSocket close code the hub uses for "your session ended" (server `session-connections.ts`). */
export const SESSION_ENDED_CLOSE_CODE = 4401

const MAX_CAUSE_DEPTH = 4

/**
 * True when `value` is, or wraps through `cause`, a WebSocket close with the
 * session-ended code. A request in flight when the hub closes the socket
 * rejects with a closed-error whose `cause` is the `CloseEvent`; the
 * connection-state error nests it one level deeper. Structural on purpose: the
 * error classes are not stable across the SDK boundary.
 */
export function isSessionEndedClose(value: unknown): boolean {
  let current: unknown = value
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return false
    if (Reflect.get(current, 'code') === SESSION_ENDED_CLOSE_CODE) return true
    current = Reflect.get(current, 'cause')
  }
  return false
}

/** An error that says the session is gone: an `UNAUTHORIZED` answer or a session-ended close. */
export function isSessionEndedError(err: unknown): boolean {
  return isUnauthorizedError(err) || isSessionEndedClose(err)
}

/**
 * Tell the renewal path about a failure a caller is about to swallow. Returns
 * whether it was a session-ended signal. Cheap and synchronous; the burst
 * handling lives in the signal (one renewal for fifty reports).
 */
export function reportSessionEnded(err: unknown): boolean {
  if (!isSessionEndedError(err)) return false
  signalUnauthorized()
  return true
}

/** The slice of the tRPC `WebSocketClient` the watcher reads. */
export interface SocketStateSource {
  readonly connectionState: {
    subscribe(observer: { next(state: unknown): void }): { unsubscribe(): void }
  }
}

/**
 * Watch one socket's connection state for a session-ended close. The close is
 * what the hub does to a revoked session's socket; the client's own reconnect
 * would otherwise retry with the dead token. Returns the stop function.
 */
export function watchSessionEndedClose(source: SocketStateSource, onEnded: () => void): () => void {
  const subscription = source.connectionState.subscribe({
    next: (state) => {
      if (typeof state !== 'object' || state === null) return
      if (isSessionEndedClose(Reflect.get(state, 'error'))) onEnded()
    },
  })
  return () => subscription.unsubscribe()
}
