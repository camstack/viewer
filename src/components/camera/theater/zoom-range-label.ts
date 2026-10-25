/**
 * zoom-range-label — how the timeline's visible RANGE is written on the
 * control that sets it.
 *
 * The footer's range button replaced a (−)/(+) pair. The pair's real defect
 * was not that it took two taps: it was that the setting's current value
 * appeared NOWHERE. The operator could only infer "how much time am I looking
 * at" from how tall the rows were, and two buttons that both mean "change the
 * zoom" are two ways to do one thing — the duplication this repo has just
 * finished deleting from the Review page.
 *
 * So the value has to be readable without opening anything, which makes its
 * rendering load-bearing enough to live in its own pure module rather than
 * inside the bar. Separate from `mock-data.ts` because that module is
 * React-free AND i18n-free; separate from `TimelineFooterBar.tsx` because the
 * structural guard in `docked-timeline-chrome.spec.ts` requires that exactly
 * one file import the bar, so nothing else — a test included — may reach into
 * it for a formatter.
 */

import type { ZoomSpanLabel } from './mock-data.js'

/**
 * The pluralisation argument the two span patterns take.
 *
 * The open index signature is what i18next's `t` requires of anything handed
 * to it (`$Dictionary`); without it the real `t` is not assignable to
 * {@link ZoomSpanTranslator} and the narrowing below would have to be bought
 * with a cast.
 */
export interface ZoomSpanCount {
  readonly count: number
  readonly [option: string]: unknown
}

/**
 * Exactly as much of i18next's `t` as this formatter needs.
 *
 * Narrower than `TFunction` on purpose: the wide type is a stack of overloads
 * keyed by the resource tree, so a test that wants to assert the STRING an
 * operator reads would have to fake all of it or cast — and this repo does not
 * cast. A one-line function type is satisfied by the real `t` and by a
 * three-line stub alike.
 */
export type ZoomSpanTranslator = (key: string, options: ZoomSpanCount) => string

/**
 * "30m" / "1h" / "12h" — one short token, for the chip and for the menu row.
 *
 * Through i18n rather than `${value}h`: the unit letter is a translatable
 * fact, and this repo ships no hardcoded UI text. `count` is passed so a
 * language that declines the unit can.
 */
export function formatZoomSpan(span: ZoomSpanLabel, t: ZoomSpanTranslator): string {
  return span.unit === 'minutes'
    ? t('v2.theater.zoomSpanMinutes', { count: span.value })
    : t('v2.theater.zoomSpanHours', { count: span.value })
}
