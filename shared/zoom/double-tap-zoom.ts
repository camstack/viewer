/**
 * The double-tap on the player — pure, platform-free, worklet-safe.
 *
 * Imported by BOTH the app's live/recorded stage (`src/live/use-stream-zoom.ts`,
 * run on the UI thread inside the tap's worklet) and the embed's per-tile
 * `ZoomPan` (a browser bundle). So: no imports, no DOM, no React, and every
 * function carries the `'worklet'` directive.
 *
 * ## The behaviour (operator, 2026-11-08) — the classic gallery
 *
 * - At the whole picture (scale at its minimum), a double tap zooms to FULL
 *   zoom (the maximum scale), centred on the tapped point.
 * - At any other scale, a double tap goes back to the whole picture.
 * - The pinch is plain zoom in and out, clamped to [min, max]; it snaps to
 *   nothing and has no thresholds.
 */

/** Tolerance on "already at the minimum". */
export const DOUBLE_TAP_EPSILON = 0.01

export interface DoubleTapInput {
  /** The scale the picture is at now (a pinch may have left it anywhere). */
  readonly current: number
  /** The whole picture: the bottom of the zoom range. */
  readonly minScale: number
  /** The top of the zoom range: where a double tap from the minimum lands. */
  readonly maxScale: number
}

/** What a double tap does: back to the whole picture, or in to `scale`. */
export type DoubleTapTarget =
  | { readonly kind: 'fit' }
  | { readonly kind: 'zoom'; readonly scale: number }

/** The double-tap decision. The anchor (the tap point) is the caller's. */
export function doubleTapTarget(input: DoubleTapInput): DoubleTapTarget {
  'worklet'
  const { minScale, maxScale } = input
  const current = Number.isFinite(input.current) ? input.current : minScale
  if (current > minScale + DOUBLE_TAP_EPSILON) return { kind: 'fit' }
  return { kind: 'zoom', scale: maxScale }
}
