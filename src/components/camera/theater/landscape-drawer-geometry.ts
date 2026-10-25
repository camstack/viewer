/**
 * Geometry for the landscape timeline drawer, kept pure so it can be asserted
 * without rendering.
 *
 * The first cut of this overlay was a BOTTOM sheet whose handle was positioned
 * at `bottom: sheetHeight + insetBottom - 14` and then translated DOWN by
 * `sheetHeight` when closed — landing it at `insetBottom - 14`, i.e. half of a
 * 28pt pill below the screen edge on any device without a bottom inset. The
 * control that opens the timeline was therefore invisible, which reads exactly
 * like "the timeline never appears".
 *
 * A later cut was a vertical TAB on the RIGHT edge. On a notched iPhone in
 * landscape that strip is the sensor housing, so the tab vanished again
 * (1.0.267), then a sibling disc that ignored chrome visibility. The
 * closed-state trigger is now an OverlayDiscGroup item on the stream,
 * bottom-LEFT, in the same language as mute and talk.
 *
 * The rule that prevents a repeat: the toggle is an on-video control in
 * the same group as the other discs, never a sibling and never from the
 * edge the drawer slides from.
 */

/**
 * Never wider than this, so the video keeps most of a landscape screen.
 *
 * Narrowed from 420 on operator feedback: at 46% of the window the drawer
 * "covers too much stream". The panel is an OVERLAY on the video, so its width
 * is taken straight out of what the operator is watching — the timeline's own
 * elements scale from the available width (`cardWidth → sizePx`), so a
 * narrower drawer makes them shorter rather than cramped.
 */
const MAX_DRAWER_WIDTH = 340
/** Never narrower than this, or the timeline's own controls start wrapping. */
const MIN_DRAWER_WIDTH = 240
/** Share of the window the drawer takes when it fits between the bounds. */
const DRAWER_WIDTH_FRACTION = 0.34

/**
 * Drawer width for a window width. Clamped at both ends: a phone in landscape
 * gets a usable panel, a tablet does not get a half-screen one.
 */
export function drawerWidth(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) return MIN_DRAWER_WIDTH
  const wanted = Math.round(windowWidth * DRAWER_WIDTH_FRACTION)
  const capped = Math.min(MAX_DRAWER_WIDTH, Math.max(MIN_DRAWER_WIDTH, wanted))
  // A window narrower than the minimum still must not overflow it.
  return Math.min(capped, windowWidth)
}

/**
 * Stacking order of the drawer overlay. It MUST out-rank the stream slot (50,
 * `stream-slot.ts`): in fill mode the picture is an opaque black box over the
 * whole window, and a sibling without a higher z paints underneath it — the
 * drawer was once mounted, correct, and completely invisible for that reason.
 * The relation between the two numbers is asserted in the spec rather than
 * left as two literals in two files.
 */
export const DRAWER_OVERLAY_Z = 60

/**
 * The drawer's box. ONE derivation, because the defect it retires was two
 * numbers that had to agree and did not.
 *
 * ## The PANEL reserves nothing horizontally
 *
 * The panel is anchored `right: 0` and paints an opaque scrim over the video.
 * Every version before 2026-08-08 also reserved `insets.right` inside it: first
 * as a `paddingRight` taken OUT of the content (which rendered 59pt short of the
 * edge), then by widening the panel by the inset and keeping the padding, which
 * changed how much timeline you got but not the fact that the rightmost 59pt of
 * the drawer was scrim with nothing drawn on it. On a notched phone in landscape
 * that is a black band down the right edge, reported three times.
 *
 * So: `contentWidth === panelWidth`, always. There is no region of the panel the
 * content does not fill, and no inset can open one. The notch overlaps a narrow
 * band of the timeline's right edge — the operator's stated preference over the
 * band. The vertical insets stay: `paddingTop`/`paddingBottom` are the status
 * bar and the home indicator, and nothing is drawn under either.
 *
 * The toggle is no longer derived from this box: it is an OverlayDiscGroup
 * item in the stream overlay's left cluster.
 */
export interface DrawerPanelBox {
  /** The panel itself, anchored `right: 0`. */
  readonly panelWidth: number
  /** What its content gets — equal to `panelWidth`, by construction. */
  readonly contentWidth: number
}

export function drawerPanelBox(windowWidth: number): DrawerPanelBox {
  const width = drawerWidth(windowWidth)
  return {
    panelWidth: width,
    contentWidth: width,
  }
}
