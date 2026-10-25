/**
 * The double-tap on the player — pure, platform-free, worklet-safe.
 *
 * Imported by BOTH the app's live/recorded stage (`src/live/use-stream-zoom.ts`,
 * run on the UI thread inside the tap's worklet) and the embed's per-tile
 * `ZoomPan` (a browser bundle). So: no imports, no DOM, no React, and every
 * function carries the `'worklet'` directive.
 *
 * ## The behaviour (operator, 2026-10-22)
 *
 * - From the whole picture (scale at its minimum), a double tap zooms IN to
 *   the scale at which the video FILLS the player — the bars of a letterbox or
 *   pillarbox are gone — anchored on the tap. When the picture already fills
 *   the player (same aspect, or a box that is drawn cover-cropped) there is no
 *   bar to remove, and the tap takes the fixed fallback step instead.
 * - From anywhere above the minimum, a double tap goes back to the whole
 *   picture, pan reset. One tap in, one tap out: no ladder to count.
 *
 * It replaces a 1x → 2x → 3x → 4x → 1x ladder that nobody discovered — an
 * operator left zoomed in had to tap four times to see the whole camera again.
 */

/** How a box renders its picture. Same vocabulary as `stream-zoom-clamp.ts`. */
export type ZoomFit = 'contain' | 'cover'

export interface CoverScaleInput {
  /** The player box, in any unit (both axes the same unit). */
  readonly viewportWidth: number
  readonly viewportHeight: number
  /** The picture's width / height. */
  readonly contentAspect: number
  /**
   * How the picture is drawn at rest. `contain` letterboxes (the bars this
   * helper removes); `cover` already fills the box, so its cover scale is 1.
   */
  readonly fit: ZoomFit
}

/**
 * The zoom, relative to the picture at rest, at which it fills the whole
 * player box: the ratio of the two aspects, the larger way round. `1` when
 * the picture already fills it (equal aspect, a `cover` box) and whenever an
 * input is not a usable number — a size not measured yet must never zoom.
 *
 * A 16:9 picture in a 19.5:9 landscape phone → 1.22; in a 4:3 iPad → 1.33;
 * in a 9:19.5 portrait screen → 3.85.
 */
export function coverScale(input: CoverScaleInput): number {
  'worklet'
  const { viewportWidth: w, viewportHeight: h, contentAspect: a, fit } = input
  if (fit === 'cover') return 1
  if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(a)) return 1
  if (w <= 0 || h <= 0 || a <= 0) return 1
  const ratio = w / h / a
  return ratio >= 1 ? ratio : 1 / ratio
}

/** Tolerance on "already at the minimum" and on "cover equals fit". */
export const DOUBLE_TAP_EPSILON = 0.01

export interface DoubleTapInput {
  /** The scale the picture is at now (a pinch may have left it anywhere). */
  readonly current: number
  /** The whole picture: the bottom of the zoom range. */
  readonly minScale: number
  /** The top of the zoom range; a cover scale past it is clamped to it. */
  readonly maxScale: number
  /** {@link coverScale} for the box the tap landed in. */
  readonly cover: number
  /** The step taken when cover equals fit, so the tap still zooms. */
  readonly fallbackStep: number
}

/** What a double tap does: back to the whole picture, or in to `scale`. */
export type DoubleTapTarget =
  | { readonly kind: 'fit' }
  | { readonly kind: 'zoom'; readonly scale: number }

/** The double-tap decision. The anchor (the tap point) is the caller's. */
export function doubleTapTarget(input: DoubleTapInput): DoubleTapTarget {
  'worklet'
  const { minScale, maxScale, cover, fallbackStep } = input
  const current = Number.isFinite(input.current) ? input.current : minScale
  if (current > minScale + DOUBLE_TAP_EPSILON) return { kind: 'fit' }
  const wanted = Number.isFinite(cover) && cover > minScale + DOUBLE_TAP_EPSILON ? cover : fallbackStep
  return { kind: 'zoom', scale: Math.max(minScale, Math.min(maxScale, wanted)) }
}
