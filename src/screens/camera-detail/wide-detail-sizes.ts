/** Pure sizing math for the camera-detail WIDE layout (stream column left +
 *  vertical timeline rail right). React-free so vitest covers it directly.
 *  See docs spec 2026-07-13-cam-view-web-wide-layout-spec.md §4. */

/**
 * Fixed rail width — fits the full TimelineToolbarInline row plus ~200px 16:9
 * cluster cards.
 *
 * Was 380, on the note that it "comfortably fits the full row (it fits a
 * 390pt phone today)". Controls were added since and it stopped being true:
 * photographed on the operator's iPad on 2026-09-19 the row had WRAPPED —
 * back, ‹, date, ›, activity, light, move, list on the first line, Auto and
 * help pushed onto a second — and the profile menu opening from it was
 * clipped by the rail's edge. A wrapped toolbar eats the vertical space the
 * timeline itself needs, and a clipped menu cannot be read at all.
 */
export const TIMELINE_RAIL_WIDTH = 420

/** Narrower rail fallback so the stream column keeps ≥600px on smaller
 *  wide windows (1000–1179) — 1180 − 380 = 800, still well clear. */
export const TIMELINE_RAIL_WIDTH_NARROW = 380
export const RAIL_NARROW_BELOW = 1180

/** The stream box never grows past this fraction of the viewport height —
 *  what remains below is the info area (state strip + tabs, Phase 4). */
export const STREAM_MAX_HEIGHT_FRACTION = 0.62

export interface WideDetailSizesInput {
  /** Measured width of the screen container (excludes the app sidebar). */
  readonly containerWidth: number
  /** Window height (the stream height cap keys off the viewport). */
  readonly viewportHeight: number
}

export interface WideDetailSizes {
  readonly railWidth: number
  /** Stream box width: column width capped by the 16:9 box whose height is
   *  STREAM_MAX_HEIGHT_FRACTION of the viewport. */
  readonly streamWidth: number
  /** Always streamWidth * 9/16 (the box stays true 16:9 on wide). */
  readonly streamHeight: number
}

export function computeWideDetailSizes({
  containerWidth,
  viewportHeight,
}: WideDetailSizesInput): WideDetailSizes {
  const railWidth =
    containerWidth < RAIL_NARROW_BELOW ? TIMELINE_RAIL_WIDTH_NARROW : TIMELINE_RAIL_WIDTH
  const columnWidth = Math.max(0, containerWidth - railWidth)
  const heightCappedWidth = (viewportHeight * STREAM_MAX_HEIGHT_FRACTION * 16) / 9
  const streamWidth = Math.min(columnWidth, heightCappedWidth)
  return { railWidth, streamWidth, streamHeight: (streamWidth * 9) / 16 }
}
