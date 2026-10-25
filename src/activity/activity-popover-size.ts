/**
 * activity-popover-size — how tall the Activity popover is.
 *
 * It used to be about half the window whatever it held, so two rows floated in
 * a tall card of empty space. The card is now as tall as its rows, up to
 * {@link activityPopoverMaxHeight}, and scrolls inside past that.
 *
 * `AnchoredMenu` places the card from an ESTIMATED height (a menu opening above
 * its anchor is positioned by `anchor.y - height`), so the estimate must follow
 * the content: before the list has been laid out it is derived from the row
 * count, afterwards from the list's measured content height.
 */
import { MENU_MAX_ESTIMATE } from '../components/ui/AnchoredMenu.js'

/** Height of the popover's own header row, px. */
export const ACTIVITY_HEADER_PX = 52
/** Vertical chrome `AnchoredMenu` adds around the body, px. */
export const ACTIVITY_CHROME_PX = 8
/** First-frame guess for one row (head + progress strip), px. */
export const ACTIVITY_ROW_ESTIMATE_PX = 84
/** Gap between rows and the list's bottom padding, px (mirrors the list style). */
export const ACTIVITY_ROW_GAP_PX = 12
/** Body height of the empty state, px. */
export const ACTIVITY_EMPTY_BODY_PX = 150
/** Never shorter than this, so a one-row card still has room to breathe. */
const MIN_SHEET_PX = 160

/** The tallest the whole card may be: about half the window, capped. */
export function activityPopoverMaxHeight(windowHeight: number): number {
  return Math.min(MENU_MAX_ESTIMATE, Math.max(MIN_SHEET_PX + ACTIVITY_HEADER_PX, Math.round(windowHeight * 0.5)))
}

export interface ActivityPopoverSize {
  /** The card's height, header included — what `AnchoredMenu` places by. */
  readonly sheetHeight: number
  /** The most the list body may take before it scrolls. */
  readonly maxBodyHeight: number
}

/**
 * @param rowCount rows listed (0 = the empty state)
 * @param measuredBodyPx the list's measured content height, or `null` before the first layout
 */
export function activityPopoverSize(
  rowCount: number,
  measuredBodyPx: number | null,
  windowHeight: number,
): ActivityPopoverSize {
  const maxSheet = activityPopoverMaxHeight(windowHeight)
  const maxBodyHeight = maxSheet - ACTIVITY_HEADER_PX - ACTIVITY_CHROME_PX
  const natural =
    rowCount === 0
      ? ACTIVITY_EMPTY_BODY_PX
      : (measuredBodyPx ?? rowCount * ACTIVITY_ROW_ESTIMATE_PX + (rowCount + 1) * ACTIVITY_ROW_GAP_PX)
  const body = Math.min(maxBodyHeight, Math.round(natural))
  return { sheetHeight: ACTIVITY_HEADER_PX + ACTIVITY_CHROME_PX + body, maxBodyHeight }
}
