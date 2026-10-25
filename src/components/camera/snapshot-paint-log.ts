/**
 * snapshot-paint-log — which snapshot paints get a log line.
 *
 * ## Why this is not just `if (ms >= 1000)`
 *
 * `SnapshotImage` logged `image displayed` only when the paint took a SECOND or
 * more. That is the right shape for alerting and the wrong shape for
 * measurement: it records the tail and nothing else, so there is no p50. Every
 * healthy paint — which is the population a fix has to move — was invisible,
 * and "did the snapshot gate get faster" could not be answered from the logs at
 * all. That was the state when the invalidation storm was taking an unrelated
 * 50 ms RPC to 6000 ms: the slow lines proved something was wrong and could not
 * show what normal looked like before or after.
 *
 * ## The shape
 *
 * Log EVERY slow or stale paint (unchanged — never sample the tail, those lines
 * are individually interesting), and sample the fast ones at 1-in-10.
 *
 * Sampling is COUNTER-based, not random. A counter gives an exact rate rather
 * than an approximate one, so a fast-paint line stands for exactly ten paints
 * and a percentile can be reconstructed by weighting `ms < SLOW_PAINT_MS` lines
 * by {@link FAST_PAINT_SAMPLE_RATE}. The threshold is carried in the line's own
 * `ms` field, so no extra field is needed to tell a sampled line from a
 * complete one — which keeps the log shape exactly as it was.
 */

/** At or above this, a paint is slow enough to be worth a line every time. */
export const SLOW_PAINT_MS = 1_000

/** At or above this, the FRAME was old regardless of how fast it painted. */
export const STALE_FRAME_MS = 30_000

/** One line per this many fast paints. */
export const FAST_PAINT_SAMPLE_RATE = 10

/** Decides whether one paint is logged. Stateful: it counts fast paints. */
export type PaintLogSampler = (ms: number, frameAgeMs: number | null) => boolean

/**
 * Build a sampler. One instance is shared by every snapshot surface, so the
 * 1-in-10 applies to the app's paint stream as a whole rather than per card —
 * a grid of twelve cameras must not multiply the sample rate by twelve.
 *
 * @param sampleEvery Log one in this many fast paints (must be >= 1).
 */
export function createPaintLogSampler(
  sampleEvery: number = FAST_PAINT_SAMPLE_RATE,
): PaintLogSampler {
  let fastPaints = 0
  return (ms: number, frameAgeMs: number | null): boolean => {
    if (ms >= SLOW_PAINT_MS) return true
    if (frameAgeMs !== null && frameAgeMs >= STALE_FRAME_MS) return true
    fastPaints += 1
    if (fastPaints < sampleEvery) return false
    fastPaints = 0
    return true
  }
}

/** The app-wide sampler used by `SnapshotImage`. */
export const shouldLogPaint: PaintLogSampler = createPaintLogSampler()
