/**
 * Recording scrub-resume math.
 *
 * When the operator releases a scrub drag, playback must rejoin at the EXACT
 * released epoch. The recorder serves an HLS window built from WHOLE segments
 * overlapping `[from, to)`, so the window's media-time-0 is the first segment's
 * start — which is at or BEFORE the requested epoch (up to one segment early).
 * Seeking to `currentTime = 0` therefore lands at the segment head, not the
 * release point. The exact resume offset is the delta from media-time-0 to the
 * target epoch, in seconds.
 *
 * Pure — no DOM, no I/O — so the seek-target computation is unit-testable.
 */

/**
 * Seconds to seek into the loaded HLS window so playback resumes at
 * `targetEpochMs`, given the window's media-time-0 wall-clock (`windowStartMs`,
 * e.g. from `HTMLMediaElement.getStartDate()`). Clamped to `>= 0` and finite:
 * a non-finite input or a window that starts AFTER the target (shouldn't happen
 * — the covering segment precedes the target) collapses to 0 (window head).
 */
export function resumeOffsetSec(targetEpochMs: number, windowStartMs: number): number {
  const offsetSec = (targetEpochMs - windowStartMs) / 1000
  return Number.isFinite(offsetSec) && offsetSec > 0 ? offsetSec : 0
}
