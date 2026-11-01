/**
 * library-layout — where the Library timeline puts its stills, as pure
 * arithmetic.
 *
 * Two arrangements, decided once from the window:
 *
 *   strip   — a PHONE. The timeline owns the page; the stills are a thin strip
 *             at the top that a drag handle pulls down to at most half the
 *             window, where it turns into the grid of the selected cameras.
 *   column  — a TABLET or a wide window. A full-height timeline with the stills
 *             in a right column the operator resizes from its left edge.
 *
 * "Tablet" and "wide" are the theater's own definitions (`resolveDetailLayoutMode`
 * and `isTabletViewport`), so this page never decides them a second time.
 */
import { isTabletViewport, type ViewportInput } from '../../hooks/sidebar-rules.js'
import { resolveDetailLayoutMode } from '../camera-detail/detail-layout.js'

export type LibraryArrangement = 'strip' | 'column'

/** Height of the collapsed strip (pt): a caption line and a small picture. */
export const STRIP_COLLAPSED_HEIGHT = 104
/** The strip never grows past this share of the window. */
export const STRIP_MAX_FRACTION = 0.5
/** Past this height the strip stops being a row and becomes the grid. */
export const STRIP_GRID_THRESHOLD = STRIP_COLLAPSED_HEIGHT + 48

/** The right column's floor (pt), its ceiling (share of the width) and start. */
export const COLUMN_MIN_WIDTH = 160
export const COLUMN_MAX_FRACTION = 0.5
export const COLUMN_DEFAULT_WIDTH = 280

export function resolveLibraryArrangement(input: ViewportInput): LibraryArrangement {
  const mode = resolveDetailLayoutMode({ ...input, fullscreen: false })
  return mode === 'wide' || isTabletViewport(input) ? 'column' : 'strip'
}

/** The tallest the strip may be in a window of this height. */
export function stripMaxHeight(windowHeight: number): number {
  return Math.max(STRIP_COLLAPSED_HEIGHT, Math.floor(windowHeight * STRIP_MAX_FRACTION))
}

/** A dragged height, held between the collapsed strip and half the window. */
export function clampStripHeight(height: number, windowHeight: number): number {
  return Math.min(stripMaxHeight(windowHeight), Math.max(STRIP_COLLAPSED_HEIGHT, height))
}

/** Does this height show the grid (true) or the one-row strip (false)? */
export function stripShowsGrid(height: number): boolean {
  return height >= STRIP_GRID_THRESHOLD
}

/** On release the strip settles to a rest: collapsed, or fully expanded. */
export function settleStripHeight(height: number, windowHeight: number): number {
  const max = stripMaxHeight(windowHeight)
  const clamped = clampStripHeight(height, windowHeight)
  return clamped - STRIP_COLLAPSED_HEIGHT > (max - STRIP_COLLAPSED_HEIGHT) / 2 ? max : STRIP_COLLAPSED_HEIGHT
}

/** A dragged column width, held between the floor and half the window. */
export function clampColumnWidth(width: number, windowWidth: number): number {
  const max = Math.max(COLUMN_MIN_WIDTH, Math.floor(windowWidth * COLUMN_MAX_FRACTION))
  return Math.min(max, Math.max(COLUMN_MIN_WIDTH, width))
}
