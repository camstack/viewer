/**
 * tooltip-position — pure geometry/timing constants for the universal
 * `Tooltip` component. Kept DOM/RN-free so it is unit-testable.
 */

/** Hover dwell before the tooltip shows (web only). */
export const TOOLTIP_SHOW_DELAY_MS = 400

/** Gap between the anchor's top edge and the tooltip bubble (px). */
export const TOOLTIP_GAP = 6

/**
 * X offset (relative to the anchor's left edge) that centers a tooltip of
 * `tooltipWidth` over an anchor of `anchorWidth`. Negative when the tooltip
 * is wider than the anchor (it overhangs both sides equally).
 */
export function tooltipLeftOffset(anchorWidth: number, tooltipWidth: number): number {
  return Math.round((anchorWidth - tooltipWidth) / 2)
}
