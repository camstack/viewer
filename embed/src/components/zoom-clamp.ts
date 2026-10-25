/**
 * zoom-clamp — pure pan/zoom clamp math for the per-tile stream ZoomPan.
 *
 * The bug this fixes: the clamp was `(scale-1)*containerDim/2`, i.e. it referenced
 * the CONTAINER (element) box. The `<video>` renders `object-fit: contain`, so the
 * actual picture is LETTERBOXED inside that box — its rendered content box differs
 * from the element box on the letterboxed axis. Clamping against the element box
 * lets the pan drift into the letterbox gutter (black border) instead of pinning to
 * the real frame edge.
 *
 * Correct model (matches the viewer `zoom-math`): scale the content about its center
 * and translate by `pan`; the content edge meets — but never passes — the container
 * edge when `|pan| <= (scale·contentDim − containerDim)/2`. The reference is the
 * RENDERED CONTENT box (letterbox-aware), NOT the element box. When the scaled
 * content is still smaller than the container on an axis, there is no room to pan
 * without exposing a gutter, so the limit is 0 (stay centered).
 *
 * No DOM, no React — unit-testable in isolation.
 */

export interface Size {
  readonly width: number
  readonly height: number
}

/**
 * The rendered content box of a source with intrinsic size `intrinsicW × intrinsicH`
 * placed with `object-fit: contain` inside a `containerW × containerH` box. Falls
 * back to the container box (i.e. "fills exactly") when the intrinsic size is
 * unknown or degenerate — that reduces the clamp to the plain `(scale-1)*dim/2`.
 */
export function containBox(
  containerW: number,
  containerH: number,
  intrinsicW: number,
  intrinsicH: number,
): Size {
  const cw = Number.isFinite(containerW) && containerW > 0 ? containerW : 0
  const ch = Number.isFinite(containerH) && containerH > 0 ? containerH : 0
  if (
    !Number.isFinite(intrinsicW) ||
    !Number.isFinite(intrinsicH) ||
    intrinsicW <= 0 ||
    intrinsicH <= 0
  ) {
    return { width: cw, height: ch }
  }
  const fit = Math.min(cw / intrinsicW, ch / intrinsicH)
  return { width: intrinsicW * fit, height: intrinsicH * fit }
}

/**
 * Max `|translate|` (px) along one axis so the SCALED content edge can reach — but
 * not pass — the container edge. 0 when the scaled content is no larger than the
 * container (no room to pan without a gutter).
 */
export function panExtent(containerDim: number, contentDim: number, scale: number): number {
  if (!Number.isFinite(containerDim) || !Number.isFinite(contentDim) || !Number.isFinite(scale)) {
    return 0
  }
  return Math.max(0, (scale * contentDim - containerDim) / 2)
}

/** Clamp a translate to `±panExtent(containerDim, contentDim, scale)`. */
export function clampPan(
  pan: number,
  containerDim: number,
  contentDim: number,
  scale: number,
): number {
  if (!Number.isFinite(pan)) return 0
  const lim = panExtent(containerDim, contentDim, scale)
  return Math.max(-lim, Math.min(lim, pan))
}
