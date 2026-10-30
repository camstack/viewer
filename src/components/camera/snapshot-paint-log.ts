/**
 * snapshot-paint-log — which snapshot paints get a log line: only the slow ones.
 *
 * `image displayed` used to be logged for every slow or stale paint plus a 1-in-10
 * sample of healthy ones (~520 lines an hour from one viewer). The feature is
 * stable, so a healthy paint never logs; a paint at or above {@link SLOW_PAINT_MS}
 * is individually interesting and still does. A stale FRAME is not a slow PAINT
 * (an offline camera repaints its old frame on every refresh), so it is not a
 * reason to log here — the tile state trail says it.
 */

/** At or above this, a paint is slow enough to be worth a line every time. */
export const SLOW_PAINT_MS = 2_000

/** Decides whether one paint is logged. */
export type PaintLogSampler = (ms: number, frameAgeMs: number | null) => boolean

export function createPaintLogSampler(): PaintLogSampler {
  return (ms: number): boolean => ms >= SLOW_PAINT_MS
}

/** The sampler used by `SnapshotImage`. */
export const shouldLogPaint: PaintLogSampler = createPaintLogSampler()
