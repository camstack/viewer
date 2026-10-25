/**
 * How a zoomed picture is DRAWN when its box may grow — pure, RN-free.
 *
 * With `pinchExpandsHeight` the picture box grows with the pinch, and the
 * video cover-fills it: the bigger the box, the bigger the picture. On iOS the
 * video is a WKWebView, and a WKWebView whose frame changes on every frame of
 * a gesture is a WebKit re-layout per frame — the "scattoso". A transform is
 * composited. So the wrapper the player lives in stays at its REST size (the
 * 16:9 box at 1x) and the growth is folded into the zoom transform here.
 *
 * Rendered result, by construction: the cover box of the grown height, scaled
 * by the pinch, centred on the grown box, plus the pan — pixel for pixel what
 * a wrapper that really grew would have drawn, so the pan clamp
 * (`streamPanExtent(w, boxHeight, aspect, scale, 'cover')`) is unchanged.
 */

export interface FoldGrowthInput {
  /** The pinch scale (1..4). */
  readonly scale: number
  readonly tx: number
  readonly ty: number
  /** The box as the height rule wants it for this scale. */
  readonly boxHeight: number
  /** The wrapper's fixed height: the box at 1x. */
  readonly restHeight: number
}

export interface RenderTransform {
  readonly scale: number
  readonly tx: number
  readonly ty: number
}

/**
 * The render transform for a wrapper of `restHeight` that must LOOK like the
 * cover box of `boxHeight` scaled by `scale` about the box's centre.
 *
 * A scale about a point P equals a scale about the wrapper's own centre plus a
 * translation of (P − centre)·(1 − k)… applied to a wrapper whose centre sits
 * at restHeight/2 while the box's is at boxHeight/2, the whole thing reduces
 * to: total scale = scale · boxHeight/restHeight, and the centre offset
 * (boxHeight − restHeight)/2 added to the pan. RN applies `translate` after
 * the centre-anchored `scale`, which is exactly that order.
 */
export function foldGrowth(input: FoldGrowthInput): RenderTransform {
  'worklet'
  const { scale, tx, ty, boxHeight, restHeight } = input
  const growth = restHeight > 0 && Number.isFinite(boxHeight / restHeight) ? boxHeight / restHeight : 1
  return { scale: scale * growth, tx, ty: ty + (boxHeight - restHeight) / 2 }
}

export interface GrowBoxRule {
  /** Box height at 1x — the 16:9 box. */
  readonly rest: number
  /** Box height from `growScale` up. */
  readonly max: number
  /** The pinch scale at which the box reaches `max`. */
  readonly growScale: number
}

/** The box height the pinch scale asks for: rest at 1x, max from growScale up, linear between. */
export function growBoxHeight(scale: number, rule: GrowBoxRule): number {
  'worklet'
  const span = rule.growScale - 1
  if (!(span > 0) || !Number.isFinite(scale)) return rule.rest
  const t = Math.max(0, Math.min(1, (scale - 1) / span))
  return rule.rest + (rule.max - rule.rest) * t
}
