/**
 * Zoom ladder + focal-anchored pan — pure, RN-free, unit-testable. The hook
 * that uses them is exercised through the jsdom stubs (`use-stream-zoom.spec`);
 * the arithmetic is pinned here, where a case costs a line.
 *
 * Both live here because they answer the same question in two moods: a pinch
 * asks it continuously, a double-tap once. Sharing the arithmetic is the point
 * — the previous copy had the pinch computing its own version inline and the
 * double-tap not computing one at all (it jumped straight back to 1x).
 */

/** Bottom of the ladder: no zoom. */
export const ZOOM_MIN = 1;
/**
 * The three double-tap steps. The fourth tap closes the cycle by returning to
 * {@link ZOOM_MIN} — an operator can always get back to the whole picture with
 * one more tap, never by hunting for a reset.
 */
export const ZOOM_STEPS: readonly number[] = [2, 3, 4];
/** Top of the ladder, and the pinch clamp. Same number on purpose: a pinch and
 *  a double-tap must not disagree about how far in the picture goes. */
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1] ?? 4;

/** Tolerance when asking "is the live pinch scale already at this step?" */
const STEP_EPSILON = 0.01;

/**
 * The next rung for a double-tap, given whatever scale the picture is at —
 * which is often NOT a rung, because a pinch may have left it at 2.6.
 *
 * The answer is the first step strictly above the current scale, so a tap
 * always zooms IN from where the operator is; once past the top the cycle
 * closes and the next tap shows the whole picture again.
 */
export function nextZoomStep(current: number): number {
  "worklet";
  const safe = Number.isFinite(current) ? current : ZOOM_MIN;
  for (const step of ZOOM_STEPS) {
    if (safe < step - STEP_EPSILON) return step;
  }
  return ZOOM_MIN;
}

export interface FocalPanInput {
  /** Focal point NOW, in viewport coordinates (the live finger midpoint, or
   *  the tap position for a double-tap). */
  readonly focalNow: number;
  /** Focal point when the gesture STARTED. Equal to `focalNow` for a tap. */
  readonly focalStart: number;
  /** The point the picture scales about on this axis when the gesture STARTS
   *  — the box centre. */
  readonly center: number;
  /** The same point AFTER: differs from `center` only when the box itself
   *  grows with the gesture (`pinchExpandsHeight`). Defaults to `center`. */
  readonly centerAfter?: number;
  /** Pan when the gesture started. */
  readonly panStart: number;
  /** Total display scales — the pinch times any growth of the box. Only the
   *  ratio matters, so a common factor may be left out. */
  readonly scaleStart: number;
  readonly scaleAfter: number;
}

/**
 * Pan that keeps the content point grabbed at `focalStart` sitting under
 * `focalNow` after scaling to `scaleAfter`.
 *
 * With `screen = s*(x - c) + c + pan`, the content point under the starting
 * focal is `x0 = (focalStart - c0 - panStart)/scaleStart + c0`. Requiring
 * `scaleAfter*(x0 - c0) + c1 + pan = focalNow` gives
 *
 *     pan = (focalNow - c1) - k * ((focalStart - c0) - panStart),  k = sAfter/sStart
 *
 * with `c1 = c0` unless the box grows under the gesture, in which case the
 * centre moves with it and a single-centre formula parks the grabbed point
 * half the growth away from the finger.
 *
 * The two focal terms are DIFFERENT points and that is the whole content of
 * this function. Using the live focal for both — which is what the pinch used
 * to do — re-anchors the gesture on every frame: the picture creeps while the
 * fingers drift, and on release it is not on the point that was grabbed. The
 * `focalNow` term is also what makes a pinch drag the picture, which is the
 * behaviour a two-finger gesture is expected to have.
 */
export function focalPan(input: FocalPanInput): number {
  "worklet";
  const { focalNow, focalStart, center, panStart, scaleStart, scaleAfter } =
    input;
  const centerAfter = input.centerAfter ?? center;
  if (!Number.isFinite(scaleStart) || scaleStart <= 0) return panStart;
  const k = scaleAfter / scaleStart;
  const pan = focalNow - centerAfter - k * (focalStart - center - panStart);
  return Number.isFinite(pan) ? pan : panStart;
}
