/**
 * refresh-throttle — the pure leading+trailing throttle decision shared by the
 * track-feed auto-refresh wiring (reel + events page).
 *
 * Live detection/track events fire many times per second while one subject is in
 * frame, so a naive "refresh on every event" would re-window the feed
 * continuously (a refetch-storm). This module answers ONE question, side-effect
 * free: given the last refresh time, now, the throttle interval, and whether a
 * trailing-edge timer is already pending, should we fire NOW, schedule a
 * trailing fire, or do nothing?
 *
 *   • elapsed >= throttle          → fire immediately (leading edge).
 *   • elapsed <  throttle, no timer → schedule a trailing fire at the window end.
 *   • elapsed <  throttle, timer up → coalesce into the pending fire (no-op).
 *
 * A burst therefore collapses to at most one fire per `throttleMs`: one on the
 * leading edge, then one trailing fire that flushes whatever arrived during the
 * window. Pure + injectable clock → unit-tested in
 * `__tests__/refresh-throttle.spec.ts`.
 */

/** The decision for a single activity tick. */
export interface ThrottleDecision {
  /** Fire the refresh immediately (leading edge — the window had elapsed). */
  readonly fire: boolean
  /** Schedule a trailing fire in this many ms, or null when nothing to schedule
   *  (either we fired now, or a timer is already pending). */
  readonly scheduleInMs: number | null
}

/**
 * Decide what to do with an activity tick under a leading+trailing throttle.
 *
 * @param lastAtMs      Timestamp of the last actual refresh (0 = never).
 * @param nowMs         Current time.
 * @param throttleMs    Minimum gap between two refreshes.
 * @param timerPending  Whether a trailing-edge timer is already scheduled.
 */
export function decideThrottle(
  lastAtMs: number,
  nowMs: number,
  throttleMs: number,
  timerPending: boolean,
): ThrottleDecision {
  const elapsed = nowMs - lastAtMs
  if (elapsed >= throttleMs) return { fire: true, scheduleInMs: null }
  if (timerPending) return { fire: false, scheduleInMs: null }
  return { fire: false, scheduleInMs: throttleMs - elapsed }
}
