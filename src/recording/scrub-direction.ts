/**
 * scrub-direction — which way the operator is dragging, derived from the scrub
 * target the machine already keeps.
 *
 * ## Why this reads the existing target instead of watching the gesture
 *
 * There is exactly one authority for "where the drag is pointing":
 * `PlaybackState.seekTarget`, replaced on every `SCRUB_MOVE`. A second signal
 * fed from the scroll offset (or from the gesture reducer's `lastEpoch`) would
 * be a parallel truth that can disagree with the one the indicator, the cursor
 * and the `scrubTo` emit all read — and the disagreement would only ever show
 * up as an arrow pointing the wrong way, which nobody would trace back.
 *
 * So the direction is a fold over the SAME retarget the machine already
 * performs: previous target → next target.
 *
 * ## The dead zone
 *
 * Scroll frames arrive every ~50 ms and a finger resting on the timeline still
 * emits them, with sub-pixel deltas that alternate sign. Recomputing the
 * direction from those flickers the glyph between ⏩ and ⏪ at frame rate, which
 * is strictly worse than showing the play button. Below the dead zone the
 * current direction is HELD, never cleared: a drag that pauses mid-flight has
 * not reversed, it has stopped moving.
 */

/** Which way through time the drag is heading. */
export type ScrubDirection = 'forward' | 'backward'

/**
 * Movement at or below this (timeline ms between two consecutive targets) is
 * jitter, not intent.
 *
 * Sized against the scroll cadence rather than against pixels: at the coarsest
 * zoom a single scroll frame legitimately covers minutes, at the finest a
 * deliberate slow drag still clears a quarter second per frame.
 */
export const SCRUB_DIRECTION_DEADZONE_MS = 250

/**
 * Fold one retarget into a direction.
 *
 * @param previousTarget The target the drag was pointing at, or `null` when the
 *   drag has no reference yet (a scrub begun from the live edge, where there is
 *   no playhead either). With no reference the current direction is kept — the
 *   FIRST move of a live scrub therefore shows play/pause, and the second shows
 *   the arrow, which is honest: one sample cannot have a direction.
 * @param nextTarget The target this move is asking for.
 * @param current The direction currently displayed, held through the dead zone.
 */
export function resolveScrubDirection(
  previousTarget: number | null,
  nextTarget: number,
  current: ScrubDirection | null,
  deadzoneMs: number = SCRUB_DIRECTION_DEADZONE_MS,
): ScrubDirection | null {
  if (previousTarget === null) return current
  const delta = nextTarget - previousTarget
  if (Math.abs(delta) <= deadzoneMs) return current
  return delta > 0 ? 'forward' : 'backward'
}
