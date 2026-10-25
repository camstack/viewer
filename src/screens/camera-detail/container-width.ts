/**
 * The width the camera-detail COLUMN has to lay out in — the input every
 * `wide` size is derived from (`wide-detail-sizes.ts`).
 *
 * ## Why this is a function and not a `useState` holding an `onLayout`
 *
 * It was `useState<number | null>(null)`, written by an unguarded `onLayout`
 * and read as `containerWidth ?? winWidth`. Three things were wrong with that,
 * and all three are permanent rather than first-frame, because this screen is
 * NEVER UNMOUNTED: the tab stack runs `freezeOnBlur: false`, so a value latched
 * once outlives every later navigation and every rotation.
 *
 *  1. **A degenerate pass latched forever.** `setContainerWidth` accepted
 *     whatever arrived, `0` included — and `?? winWidth` only rescues `null`,
 *     never `0`. One layout pass taken while the route is covered or mid
 *     transition and the rail goes narrow, `columnWidth` goes to `0` and the
 *     picture is sized to nothing, for the rest of the screen's life.
 *     `GridViewScreen` has guarded its own `onLayout` with `width > 0` since it
 *     was written; this one never did.
 *  2. **A measurement outlived the window it was taken in.** Nothing re-seeded
 *     it on a rotation, so the number measured in one window shape governed the
 *     next one until another layout pass happened to land. A measurement is
 *     therefore stamped with the window width it was taken in and is refused
 *     for any other.
 *  3. **The fallback ignored the rail.** `winWidth` is the WINDOW; this screen
 *     draws `SideNavRail` beside the column, so the real column is narrower by
 *     `sideNavFootprint()`. On an iPad 11" (1194pt) the unmeasured frame
 *     computed a 380pt rail and an 814pt picture for a column that is 1122pt
 *     wide with a 340pt rail — the picture overlapping the rail — and then
 *     jumped when the measurement arrived.
 *
 * Keyed on the window WIDTH and not on its height on purpose: a soft keyboard
 * shrinks the height without moving this column, and invalidating on it would
 * throw away a good measurement several times per keystroke.
 */
import { sideNavFootprint, type SideNavFootprintInput } from '../../navigation/side-nav-metrics.js'

export interface MeasuredContainerWidth {
  /** What `onLayout` reported. */
  readonly width: number
  /** The window width it was measured in — its expiry date. */
  readonly windowWidth: number
}

export interface ContainerWidthInput {
  /** The last accepted layout pass, or `null` before the first one. */
  readonly measured: MeasuredContainerWidth | null
  readonly windowWidth: number
  /** What the side nav takes out of the window right now. */
  readonly sideNav: SideNavFootprintInput
}

/** `true` when a layout pass is worth keeping: a real, positive width. */
export function isUsableMeasurement(width: number): boolean {
  return Number.isFinite(width) && width > 0
}

/** Which of the two branches below produced the width. */
export type ContainerWidthSource = 'measured' | 'derived'

/**
 * Whether a stored measurement may govern THIS window: rules (a) and (b) of the
 * docblock, as one predicate.
 *
 * Factored out so {@link containerWidthSource} can report the branch without
 * restating it. A second copy of this test is exactly how a diagnostic starts
 * lying: it would keep saying `measured` after the rule that refuses stale
 * measurements changed, which is the one thing this screen's history says a
 * reader must be able to trust.
 */
export function acceptsMeasurement(
  measured: MeasuredContainerWidth | null,
  windowWidth: number,
): measured is MeasuredContainerWidth {
  return (
    measured !== null &&
    isUsableMeasurement(measured.width) &&
    measured.windowWidth === windowWidth
  )
}

/**
 * Where {@link resolveContainerWidth} got its answer — `measured` is a live
 * layout pass for this window, `derived` is window minus rail.
 *
 * The reported symptom has been blamed on a LATCHED width twice; a report that
 * says `derived` proves no measurement was in play at all.
 */
export function containerWidthSource({
  measured,
  windowWidth,
}: ContainerWidthInput): ContainerWidthSource {
  return acceptsMeasurement(measured, windowWidth) ? 'measured' : 'derived'
}

/**
 * The column width to size `wide` from: the live measurement when there is a
 * trustworthy one for THIS window, the derived width otherwise.
 */
export function resolveContainerWidth({
  measured,
  windowWidth,
  sideNav,
}: ContainerWidthInput): number {
  if (acceptsMeasurement(measured, windowWidth)) {
    return measured.width
  }
  const derived = windowWidth - sideNavFootprint(sideNav)
  return derived > 0 ? derived : Math.max(0, windowWidth)
}
