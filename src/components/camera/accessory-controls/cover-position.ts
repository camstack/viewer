/**
 * Cover / valve OPENING percentage — pure, so the one thing that is easy to get
 * backwards is pinned by a test rather than by a comment.
 *
 * **Direction.** `cover.cap.ts` defines `position` as `0 = fully closed,
 * 100 = fully open`, and the value is shown VERBATIM — the same number
 * admin-ui prints (`{display.position}%` in `cover-inline.tsx`). Verified
 * against the live hub on 2026-08-08: device 1453 "Tapparella hall" reported
 * `state: 'closed'` with `position: 0`. Nothing here inverts it, and nothing
 * downstream should either — the two surfaces must not disagree about what
 * "40%" means on the same shutter.
 *
 * **Absent is not zero.** `position` is nullable because a shutter that only
 * opens and closes has no intermediate surface at all, and a garage door
 * usually has none. Those return `null` here so the caller renders nothing,
 * rather than claiming a positionless cover is 0 % open.
 */

/**
 * The opening percentage as a display string (`"40%"`), or `null` when the
 * device reports no position.
 *
 * Non-finite values are rejected rather than printed, and a value outside
 * 0..100 is clamped: a provider that reports 105 is a provider bug, but
 * "105% open" on screen is a viewer bug.
 */
export function formatCoverPosition(position: number | null | undefined): string | null {
  if (position === null || position === undefined) return null
  if (!Number.isFinite(position)) return null
  const clamped = Math.min(100, Math.max(0, position))
  return `${String(Math.round(clamped))}%`
}
