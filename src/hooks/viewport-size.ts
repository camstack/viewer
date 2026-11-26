/**
 * Which measurement this app calls "the window" — the rule, pure.
 *
 * ## Two sources, and the night they disagreed
 *
 * On native there are two ways to learn the window's shape, and they are not
 * the same fact:
 *
 *  - `useWindowDimensions()` — `Dimensions.window`, which `RCTDeviceInfo`
 *    refreshes when a NOTIFICATION arrives (`UIDeviceOrientationDidChange`,
 *    app-active, a KVO on the frame of whatever window was key when the module
 *    initialised). A notification can be late, or never come.
 *  - the safe-area frame — `SafeAreaProvider`'s own view, measured in its
 *    `layoutSubviews` and re-published whenever the frame actually changes. A
 *    fact about the view tree, the same tree the operator is looking at.
 *
 * The `theater:layout` report from the tablet (2026-09-09 22:06, 2026-09-10
 * 21:52) has the two apart: the theater's root measured 1122 pt wide — the
 * landscape width minus the side nav — while `useWindowDimensions` reported
 * 834×1194 for 28 s, and then for the rest of the session until the operator
 * killed the app. Every consumer of the window laid out for portrait inside a
 * landscape tree; the timeline dropped under the picture. See
 * `screens/camera-detail/__tests__/detail-rotation-source.spec.ts`.
 *
 * So on native the frame is the authority whenever it is a measurement at all.
 * The window remains the fallback for a frame that has not laid out yet, and
 * the ONLY source on web: `NativeSafeAreaProvider.web` reads the document once
 * at mount and on a CSS transition end, so there it is the frame that would go
 * stale on a resize.
 */

/** A measured size. */
export interface MeasuredSize {
  readonly width: number
  readonly height: number
}

/** Where the resolved viewport came from — carried into `theater:layout`. */
export type ViewportSource = 'frame' | 'window' | 'held'

export interface ResolvedViewport extends MeasuredSize {
  readonly source: ViewportSource
}

export interface ViewportSizeInput {
  readonly isWeb: boolean
  /** `useWindowDimensions()`. */
  readonly window: MeasuredSize
  /** `useSafeAreaFrame()`, or `null` where none is available. */
  readonly frame: MeasuredSize | null
  /**
   * The last viewport that was COHERENT (both sources agreed, or one was the
   * other turned on its side), or `null` before the first one. Only used to
   * judge a rotation in flight — see {@link resolveViewportSize}.
   */
  readonly settled?: MeasuredSize | null
}

const SAME_PT = 1

function sameSize(a: MeasuredSize, b: MeasuredSize): boolean {
  return Math.abs(a.width - b.width) <= SAME_PT && Math.abs(a.height - b.height) <= SAME_PT
}

function turned(a: MeasuredSize): MeasuredSize {
  return { width: a.height, height: a.width }
}

/** `a` is `b`, or `b` turned on its side — a COMPLETE shape, never a half-way one. */
function isCompleteShapeOf(a: MeasuredSize, b: MeasuredSize): boolean {
  return sameSize(a, b) || sameSize(a, turned(b))
}

/**
 * A viewport both sources vouch for: equal, or one the other turned on its
 * side (the stale-`Dimensions` rotation of 2026-09-10, which the frame wins).
 * The provider view IS the app's window, so in steady state the two are equal.
 */
export function isCoherentViewport(window: MeasuredSize, frame: MeasuredSize): boolean {
  return isCompleteShapeOf(frame, window)
}

/** Both sides real and positive — the same bar `sidebar-rules.ts` applies. */
function isMeasured({ width, height }: MeasuredSize): boolean {
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0
}

/** The viewport a layout decision should read. See the module docblock. */
export function resolveViewportSize({
  isWeb,
  window,
  frame,
  settled = null,
}: ViewportSizeInput): ResolvedViewport {
  if (!isWeb && frame !== null && isMeasured(frame)) {
    if (!isMeasured(window) || isCoherentViewport(window, frame)) {
      return { width: frame.width, height: frame.height, source: 'frame' }
    }
    // The two disagree and neither is the other turned over: a rotation in
    // flight (planning#748 — frame 430x430 next to a window of 430x932, the
    // height still the landscape one). Deciding on that half-way pair sized the
    // player and the timeline from a box that never existed. Take a source
    // only when it is a COMPLETE shape of the last settled viewport; otherwise
    // keep the settled one until a source completes. No timer: the next frame
    // or window update re-enters here.
    if (settled !== null && isMeasured(settled)) {
      if (isCompleteShapeOf(window, settled)) {
        return { width: window.width, height: window.height, source: 'window' }
      }
      if (isCompleteShapeOf(frame, settled)) {
        return { width: frame.width, height: frame.height, source: 'frame' }
      }
      return { width: settled.width, height: settled.height, source: 'held' }
    }
    return { width: frame.width, height: frame.height, source: 'frame' }
  }
  return { width: window.width, height: window.height, source: 'window' }
}

/**
 * The two raw sources side by side, for the `theater:layout` line.
 *
 * `-1` for a frame that was not consulted (web) rather than `undefined`, so
 * the value survives JSON and stays greppable — the same convention as the
 * rest of that payload.
 */
export interface ViewportReadout {
  /** Which source {@link resolveViewportSize} picked. */
  readonly source: ViewportSource
  /** `useWindowDimensions()`, raw. */
  readonly dimWidth: number
  readonly dimHeight: number
  /** `useSafeAreaFrame()`, raw; `-1` where it is not consulted. */
  readonly frameWidth: number
  readonly frameHeight: number
  /** The two sources agree (equal, or turned) — `false` is a rotation in flight. */
  readonly coherent: boolean
}

export function describeViewportSources(input: ViewportSizeInput): ViewportReadout {
  const { isWeb, window, frame } = input
  return {
    source: resolveViewportSize(input).source,
    coherent: input.frame === null || input.isWeb || isCoherentViewport(input.window, input.frame),
    dimWidth: window.width,
    dimHeight: window.height,
    frameWidth: isWeb || frame === null ? -1 : frame.width,
    frameHeight: isWeb || frame === null ? -1 : frame.height,
  }
}
