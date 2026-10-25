/**
 * How many columns the settings page lays its sections out in.
 *
 * One long column is right on a phone and wasteful everywhere else: the page
 * has nine sections, and on a tablet or a desktop window the operator scrolls
 * past all of them to reach Advanced or Info.
 *
 * Thresholds, not a device test. The page is laid out by the WIDTH it was
 * given — a web window can be narrow on a large screen, and a tablet in
 * portrait is narrower than the same tablet in landscape. Asking the window is
 * the same discipline `use-responsive.ts` already applies, and reusing its
 * `DETAIL_WIDE_MIN_WIDTH` for the two-column step keeps the settings page
 * turning wide at the same moment the camera detail does — one visual
 * breakpoint for the app rather than a private one per page.
 *
 * Pure, and deliberately total: the result feeds a percentage width, so a 0
 * would divide by zero and a fraction would lay every section out at a width
 * nothing can render. Both produce a BLANK page rather than a visibly wrong
 * one, which is the worst failure mode a layout rule has.
 */
import { DETAIL_WIDE_MIN_WIDTH } from '../../hooks/sidebar-rules.js'

/** Two columns from the same width at which the camera detail goes wide. */
export const SETTINGS_TWO_COL_MIN = DETAIL_WIDE_MIN_WIDTH
/** Three columns once a third column is still comfortably readable. */
export const SETTINGS_THREE_COL_MIN = 1_500

export function settingsColumns(width: number): number {
  if (!Number.isFinite(width) || width < SETTINGS_TWO_COL_MIN) return 1
  return width >= SETTINGS_THREE_COL_MIN ? 3 : 2
}
