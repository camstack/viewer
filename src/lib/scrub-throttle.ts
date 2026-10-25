/**
 * scrub-throttle — the ONE rule for "has enough time passed to emit another
 * scrub sample", plus the interval each surface uses.
 *
 * A drag reports its position on every frame the platform can produce: a native
 * `ScrollView` at the display's refresh rate, a pointer drag on the heatmap the
 * same, a trackpad wheel faster still. Every sample that gets through becomes a
 * `SCRUB_MOVE` dispatch, which re-renders the timeline, the bar, the heatmap
 * and the indicator — and, one layer down, a `scrubTo` at the player. Nothing
 * about the gesture bounds that rate, so each surface has to.
 *
 * They each had their own copy of `now - last >= X` with its own number, which
 * is how "is the other scrub surface braked too?" became a question nobody
 * could answer by reading. One predicate, three named intervals, and a test
 * that folds a real 60 Hz gesture through each of them
 * (`scrub-dispatch-budget.spec.ts`) so the per-gesture count is a measurement
 * rather than a claim.
 */

/**
 * The heatmap strip's interval: ~30 samples a second.
 *
 * The strip is one row of pixels wide-to-narrow, so the cursor moves a long way
 * per pixel and dropping samples costs precision the operator can see. It is
 * the tightest of the three for that reason.
 */
export const HEATMAP_SCRUB_EMIT_MS = 33

/**
 * The vertical timeline's interval: 20 samples a second.
 *
 * Looser than the heatmap because a scroll gesture integrates: every sample
 * feeds the drag mapping (`use-timeline-scrub` maps them all, including the
 * throttled-out ones), and only the EMISSION is skipped — so a dropped sample
 * does not lose the distance it carried.
 */
export const TIMELINE_SCRUB_EMIT_MS = 50

/**
 * The player's interval: 25 targets a second.
 *
 * The furthest downstream and the most expensive per call — it crosses the
 * bridge into the embed and asks the hub's feeder for a frame.
 */
export const PLAYER_SCRUB_EMIT_MS = 40

/** Whether a sample at `nowMs` may be emitted, given the last emission. */
export function shouldEmitScrubSample(
  lastEmitMs: number,
  nowMs: number,
  minIntervalMs: number,
): boolean {
  return nowMs - lastEmitMs >= minIntervalMs
}
