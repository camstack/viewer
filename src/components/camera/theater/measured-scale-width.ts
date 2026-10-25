/**
 * Which width the timeline scale should be told, and when to change it.
 *
 * `TimelineScaleProvider`'s own docblock says the right thing — *"the container
 * is the only thing that knows how much width it has"* — and then two of its
 * three mounts told it something else. The theater's `stack` branch passed the
 * whole WINDOW width, so the playback bar believed it had room it did not have
 * and drew a tier that clipped: measured on a Mac window where LIVE, the
 * restore button and the big transport pushed the rate control off the edge
 * (2026-09-21).
 *
 * So the wrapper measures itself and reports that. The pure part is here
 * because the interesting half is not the measurement, it is the RULE for
 * accepting one.
 */

/** Sub-pixel jitter that must not cost a re-render. */
export const SCALE_WIDTH_EPSILON = 1

/**
 * Take this measurement?
 *
 * A layout pass reports fractional widths that wobble by fractions of a point
 * as a parent settles; feeding each one back sets state inside layout and
 * re-enters it, which is a loop this app has paid for before (`3629`, the
 * clip-list identity). A measurement is taken when it MOVES the width by a
 * point or more.
 *
 * A non-finite or non-positive measurement is a layout pass that has not
 * happened — never a width of zero, which would pin the bar to its narrowest
 * tier for ever.
 */
export function shouldAcceptScaleWidth(current: number | null, measured: number): boolean {
  if (!Number.isFinite(measured) || measured <= 0) return false
  if (current === null) return true
  return Math.abs(measured - current) >= SCALE_WIDTH_EPSILON
}

/**
 * The width to render at: the measurement when there is one, the caller's
 * estimate until then.
 *
 * The estimate is never DISCARDED in favour of nothing — a first paint with no
 * measurement yet must not fall to the narrowest tier and then visibly grow.
 */
export function scaleWidthToUse(measured: number | null, fallback: number): number {
  return measured !== null && measured > 0 ? measured : fallback
}

/** The style of the wrapper's own box. */
export interface MeasuredScaleBoxStyle {
  readonly flex: 1
  readonly minHeight: 0
}

/**
 * The box `MeasuredTimelineScale` lays out, by what it wraps.
 *
 * Around the TIMELINE BODY (the wide rail) it must fill the rail and be allowed
 * to shrink below its content. The body measures its own height as the
 * timeline's viewport and the scroller sizes its content FROM that viewport, so
 * a content-sized wrapper closes a loop: taller viewport → taller content →
 * taller wrapper. On the hosted PWA that doubled the rail's content per layout
 * pass up to Chrome's 33 554 432 px ceiling (see `measured-scale-box.spec.ts`).
 *
 * Around a toolbar alone (the `stack` mount) it stays content-sized: `flex: 1`
 * inside an auto-height parent collapses to zero under Yoga.
 */
export function measuredScaleBoxStyle(fill: boolean): MeasuredScaleBoxStyle | undefined {
  return fill ? { flex: 1, minHeight: 0 } : undefined
}
