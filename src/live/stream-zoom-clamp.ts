/**
 * Pan bounds for the live-stream pinch zoom — pure, RN-free, unit-testable.
 * The hook that uses them is exercised through the jsdom stubs
 * (`use-stream-zoom.spec`); the arithmetic is pinned here.
 *
 * The video renders `object-fit: contain`, so the picture does NOT fill its
 * wrapper: it letterboxes or pillarboxes inside it. Clamping to the ELEMENT box
 * (`w * (s - 1) / 2`) is therefore wrong on both axes at once — a drag runs into
 * the black bars on the axis with bars, and stops short of the picture edge on
 * the other. The operator's report: "at full zoom the whole stream is not
 * navigable, the sides are locked" (2026-07-30).
 *
 * Same model the embed's `zoom-clamp.ts` and the detail view's `zoom-math.ts`
 * already use; this axis was the last copy still measuring the box.
 */

/**
 * How the wrapper renders the picture inside its box. NOT a detail: it decides
 * the content dimensions the pan clamps against, and getting it wrong makes the
 * travel a fraction of what the operator can see.
 *
 * `contain` — fill / wide, where the wrapper is an absolute-fill and the video
 *   letterboxes inside it.
 * `cover`   — the mobile stacked box (`videoCoverStyle`), chosen so the video
 *   fills a pinch-grown box with NO internal bars; the picture overflows the
 *   box and is cropped at the sides.
 */
export type StreamFit = 'contain' | 'cover'

/** The `object-fit: contain` box of `aspect` content inside `w × h`. */
export function containBox(w: number, h: number, aspect: number): { width: number; height: number } {
  'worklet'
  if (!Number.isFinite(aspect) || aspect <= 0) return { width: w, height: h }
  return { width: Math.min(w, h * aspect), height: Math.min(h, w / aspect) }
}

/** The `object-fit: cover` box of `aspect` content inside `w × h` — the content
 *  OVERFLOWS on one axis, which is travel the operator can reach. */
export function coverBox(w: number, h: number, aspect: number): { width: number; height: number } {
  'worklet'
  if (!Number.isFinite(aspect) || aspect <= 0) return { width: w, height: h }
  return { width: Math.max(w, h * aspect), height: Math.max(h, w / aspect) }
}

/** Max |translate| so the scaled CONTENT edge reaches the container edge, no further. */
export function panExtent(containerDim: number, contentDim: number, scale: number): number {
  'worklet'
  if (!Number.isFinite(containerDim) || !Number.isFinite(contentDim) || !Number.isFinite(scale)) {
    return 0
  }
  return Math.max(0, (scale * contentDim - containerDim) / 2)
}

/** Both axes at once — what the gesture handlers clamp against. */
export function streamPanExtent(
  w: number,
  h: number,
  aspect: number,
  scale: number,
  fit: StreamFit = 'contain',
): { x: number; y: number } {
  'worklet'
  const box = fit === 'cover' ? coverBox(w, h, aspect) : containBox(w, h, aspect)
  return { x: panExtent(w, box.width, scale), y: panExtent(h, box.height, scale) }
}

export interface ClampPanInput {
  readonly tx: number
  readonly ty: number
  readonly w: number
  readonly h: number
  readonly aspect: number
  readonly scale: number
  readonly fit: StreamFit
}

/**
 * A committed pan, re-limited against the box the picture will be DRAWN in.
 *
 * With `pinchExpandsHeight` the box follows the committed scale, so a pinch
 * ends in one box and lands in another: a pinch-OUT was legal in the taller
 * box it began in and not in the shorter one it leaves behind — the operator's
 * log read `panExtentX: 131, tx: 198`, the picture sat 67pt past its own edge
 * and the wrapper showed black. The gesture end runs this against the
 * destination box (`viewport.heightFor(committedScale)`).
 */
export function clampPan(input: ClampPanInput): { x: number; y: number } {
  'worklet'
  // At 1x nothing can be panned: a cover box still overflows by a point or
  // two, and the gesture itself recentres there (`s1 <= MIN_SCALE`).
  if (input.scale <= 1) return { x: 0, y: 0 }
  const { x: limX, y: limY } = streamPanExtent(input.w, input.h, input.aspect, input.scale, input.fit)
  return {
    x: Math.max(-limX, Math.min(limX, input.tx)),
    y: Math.max(-limY, Math.min(limY, input.ty)),
  }
}
