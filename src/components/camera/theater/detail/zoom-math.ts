/**
 * zoom-math — pure scale/pan clamping for the zoomable detail image.
 *
 * Transform model (matches the live-view `useStreamZoom`): the content is scaled
 * about its center and translated by `(tx, ty)`; the edges stay pinned inside the
 * viewport when `|pan| <= size*(scale-1)/2`. Pan only has room once `scale > 1`.
 *
 * No React, no reanimated — so the clamps are unit-testable without a UI thread.
 *
 * Every export carries the `'worklet'` directive so it can be called from BOTH
 * the JS thread (unit tests, the web wheel handler) AND the UI-thread gesture
 * worklets in `ZoomableImage` (`Gesture.Pinch().onUpdate`). Without it, calling
 * one of these imported functions inside a worklet throws "Tried to
 * synchronously call a non-worklet function on the UI thread" — a hard crash the
 * instant the user pinches. The directive is a react-native-worklets marker, not
 * an import, so the module stays dependency-free. Because the clamps are
 * interdependent (`panLimit`→`clampZoom`, `clampPan`→`panLimit`,
 * `panExtent`→`clampZoom`, `clampPanContent`→`panExtent`, `zoomBy`→`clampZoom`),
 * EVERY one must be a worklet — a marked function that internally calls an
 * unmarked one would still crash on the nested call.
 */
import { ZOOM_MAX, ZOOM_MIN } from '../../../../live/zoom-steps.js'

/**
 * The zoom RANGE has one definition, in `src/live/zoom-steps.ts`, and both
 * surfaces re-export it rather than each stating a number. A still and a live
 * picture that disagree about how far zoom goes is a difference the operator
 * feels and nobody wrote down: this file said 4 and the live hook said 4, and
 * they were two independent 4s.
 */
export const MIN_ZOOM = ZOOM_MIN
export const MAX_ZOOM = ZOOM_MAX

/** Clamp a scale into the allowed zoom range. */
export function clampZoom(scale: number): number {
  'worklet'
  if (!Number.isFinite(scale)) return MIN_ZOOM
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale))
}

/**
 * The maximum |translate| (px) along an axis of length `size` at `scale` that
 * keeps the scaled content covering the viewport (no empty gutter). 0 at 1×.
 *
 * This is the CONTENT-FILLS-CONTAINER special case of {@link panExtent}
 * (`containerDim === contentDim === size`); use `panExtent`/`clampPanContent`
 * when the content is letterboxed (`contentFit="contain"`) inside its box.
 */
export function panLimit(size: number, scale: number): number {
  'worklet'
  if (!Number.isFinite(size) || size <= 0) return 0
  return Math.max(0, (size * (clampZoom(scale) - 1)) / 2)
}

/** Clamp a translate to `±panLimit(size, scale)`. */
export function clampPan(pan: number, size: number, scale: number): number {
  'worklet'
  const lim = panLimit(size, scale)
  if (!Number.isFinite(pan)) return 0
  return Math.max(-lim, Math.min(lim, pan))
}

export interface Size {
  readonly width: number
  readonly height: number
}

/**
 * Rendered content box of a source with aspect `contentAspect` (width / height)
 * placed with `contentFit="contain"` inside a `containerW × containerH` box.
 * Falls back to the container box ("fills exactly") when the aspect is unknown or
 * degenerate — which reduces the clamp below to the plain `panLimit`.
 */
export function containBox(
  containerW: number,
  containerH: number,
  contentAspect: number,
): Size {
  'worklet'
  const cw = Number.isFinite(containerW) && containerW > 0 ? containerW : 0
  const ch = Number.isFinite(containerH) && containerH > 0 ? containerH : 0
  if (!Number.isFinite(contentAspect) || contentAspect <= 0) return { width: cw, height: ch }
  // Fit within the box: the content grows until the first axis touches the box.
  const width = Math.min(cw, ch * contentAspect)
  const height = Math.min(ch, cw / contentAspect)
  return { width, height }
}

/**
 * Max |translate| (px) along one axis so the SCALED content edge can reach — but
 * not pass — the container edge (no gutter). The reference is the RENDERED
 * CONTENT box (letterbox-aware), NOT the element box. 0 when the scaled content
 * is no larger than the container (no room to pan without exposing a border).
 */
export function panExtent(containerDim: number, contentDim: number, scale: number): number {
  'worklet'
  if (!Number.isFinite(containerDim) || !Number.isFinite(contentDim) || !Number.isFinite(scale)) {
    return 0
  }
  return Math.max(0, (clampZoom(scale) * contentDim - containerDim) / 2)
}

/** Clamp a translate to `±panExtent(containerDim, contentDim, scale)`. */
export function clampPanContent(
  pan: number,
  containerDim: number,
  contentDim: number,
  scale: number,
): number {
  'worklet'
  if (!Number.isFinite(pan)) return 0
  const lim = panExtent(containerDim, contentDim, scale)
  return Math.max(-lim, Math.min(lim, pan))
}

/** Multiply the current scale by `factor` (e.g. a wheel notch) and clamp. */
export function zoomBy(scale: number, factor: number): number {
  'worklet'
  return clampZoom(scale * factor)
}

/** One-finger pan: travel (px) before the pan claims the touch. Same figure the
 *  gesture used to pass to `minDistance` when it activated on its own. */
export const PAN_MIN_DISTANCE = 2

export type PanActivation = 'activate' | 'fail' | 'wait'

export interface PanActivationInput {
  readonly scale: number
  /** Travel since the finger went down, on each axis (px). */
  readonly dx: number
  readonly dy: number
}

/**
 * What the one-finger pan does with a touch that has travelled `(dx, dy)` at
 * `scale`. The pan activates MANUALLY (`Gesture.Pan().manualActivation(true)`)
 * so this decision is the only thing that turns a touch into a pan.
 *
 * At 1× the answer is `fail`, and it has to be a FAILURE rather than an
 * activated gesture that does nothing: on iOS a recognizer that activates
 * prevents every other recognizer still deciding, the host UIScrollView's own
 * pan included. The old pan activated after 2 px at any scale and then
 * returned early at 1×, so a drag that started on the picture could never
 * scroll the page, and a two-finger pinch had a scroll view competing for the
 * same touches. Failing hands the touch to the scroll view; once zoomed the
 * pan activates after `PAN_MIN_DISTANCE`, and with the host scroll declared
 * through `blocksExternalGesture` the page holds still while the picture moves.
 */
export function resolvePanActivation(input: PanActivationInput): PanActivation {
  'worklet'
  if (!Number.isFinite(input.scale) || input.scale <= MIN_ZOOM) return 'fail'
  if (!Number.isFinite(input.dx) || !Number.isFinite(input.dy)) return 'wait'
  const travel = Math.hypot(input.dx, input.dy)
  return travel >= PAN_MIN_DISTANCE ? 'activate' : 'wait'
}

export type PinchActivation = 'activate' | 'fail' | 'wait'

export interface PinchActivationInput {
  /** Fingers currently on the picture. */
  readonly touches: number
  /** Travel of the first finger since it went down (px). */
  readonly travel: number
}

/**
 * What the pinch does with the touches it has seen. It activates MANUALLY, so
 * this is the only thing that turns touches into a zoom: two fingers activate
 * it; ONE finger that has travelled `PAN_MIN_DISTANCE` is a scroll or a pan,
 * and the pinch FAILS so it stops holding the host scroll view back.
 *
 * Without this the pinch never failed on a one-finger drag (a pinch recognizer
 * waits for a second finger until the touch ends), and since it blocks the host
 * scroll view (`blocksExternalGesture`) the modal could not be scrolled from a
 * drag that started on the picture. A short wait covers fingers that land a few
 * ms apart: the second one arrives before the first has travelled.
 */
export function resolvePinchActivation(input: PinchActivationInput): PinchActivation {
  'worklet'
  if (input.touches >= 2) return 'activate'
  if (!Number.isFinite(input.travel)) return 'wait'
  return input.travel >= PAN_MIN_DISTANCE ? 'fail' : 'wait'
}

/**
 * The browser `touch-action` of the picture on the web. Unzoomed the picture
 * leaves vertical panning to the browser so a one-finger drag scrolls the
 * container (RNGH defaults to `none`, which swallows it); zoomed the picture
 * owns every drag. Pinch (two fingers) is delivered as pointer events either way.
 */
export function pictureTouchAction(zoomed: boolean): 'none' | 'pan-y' {
  return zoomed ? 'none' : 'pan-y'
}
