/**
 * Host-side auto-retry policy — the OUTER of the two retry loops, as a pure
 * decision function.
 *
 * The inner loop lives inside the embed's player: it rebuilds the WebRTC
 * session behind a surface that never went away, and it is fast (1.5 s → 15 s).
 * This one rebuilds the SURFACE — a WebView / iframe reload — which is the only
 * thing that recovers a page that failed to load, or an embed whose script is
 * wedged and therefore cannot retry itself. Without it, exactly those two
 * failures left the operator with a dead player and a manual button as the only
 * way out.
 *
 * Two properties matter and both are pinned by tests:
 *
 *   - the first outer wait OUTLASTS the inner cap. A reload throws away the
 *     session the inner loop is rebuilding, so racing it makes recovery slower,
 *     not faster;
 *   - exhaustion is an ACTION, not a `null` delay. The previous shape of this
 *     logic (inline, in the embed player) returned silently when the budget ran
 *     out — the loop stopped, the surface kept whatever state it last had, and
 *     nothing was logged. A camera stayed dark while looking busy.
 */

export interface HostRetryPolicy {
  readonly baseDelayMs: number
  readonly maxDelayMs: number
  readonly maxAttempts: number
}

/**
 * ONE fast attempt, then 16 s → 32 s → 64 s → 128 s → 240 s (capped).
 *
 * The ladder is generous because the inner loop handles what is transient — but
 * that reasoning only holds for a failure the inner loop can SEE. It rebuilds a
 * WebRTC session, so it runs from an ICE failure; a SIGNALLING failure never
 * creates a session for it to rebuild, and there is no inner loop to race.
 * Measured against the live hub on 2026-08-08: `webrtcSession.createSession`
 * failed 2 of 34 calls with `No broker for stream "614/adaptive"` — a real
 * failure class that produced an error card and then thirteen to nineteen
 * seconds of nothing.
 *
 * So attempt 0 is fast and the ladder starts at attempt 1. It costs one extra
 * `createSession` on a genuinely dead camera and it is the difference between a
 * transient the operator never sees and one they report.
 */
export const FAST_FIRST_DELAY_MS = 2_000

export const HOST_RETRY_POLICY: HostRetryPolicy = {
  baseDelayMs: 16_000,
  maxDelayMs: 240_000,
  /** One fast attempt + the 8 ladder steps. */
  maxAttempts: 9,
}

export type HostRetryAction =
  | { readonly kind: 'retry'; readonly attempt: number; readonly delayMs: number }
  | { readonly kind: 'exhausted'; readonly attempts: number }

/**
 * Decide what attempt number `attempt` (0-based) should do. `random` is the
 * jitter source (unit interval), injectable for tests.
 */
export function nextHostRetry(
  attempt: number,
  random: () => number = Math.random,
): HostRetryAction {
  if (attempt >= HOST_RETRY_POLICY.maxAttempts) {
    return { kind: 'exhausted', attempts: attempt }
  }
  // The one fast attempt. Deliberately NOT jittered: it is a single retry per
  // failure, not a herd — and two seconds is already below the window in which
  // a stampede could matter.
  if (attempt === 0) {
    return { kind: 'retry', attempt, delayMs: FAST_FIRST_DELAY_MS }
  }
  const base = Math.min(
    HOST_RETRY_POLICY.maxDelayMs,
    HOST_RETRY_POLICY.baseDelayMs * 2 ** (attempt - 1),
  )
  // ±20% jitter so a grid of players does not reload in unison and stampede
  // the embed route. Clamped AFTER the jitter: a cap that the jitter is allowed
  // to overshoot is not a cap.
  const delayMs = Math.min(
    HOST_RETRY_POLICY.maxDelayMs,
    Math.round(base * (0.8 + random() * 0.4)),
  )
  return { kind: 'retry', attempt, delayMs }
}
