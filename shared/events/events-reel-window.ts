export interface ReelPreloadMetrics {
  readonly scrollLeft: number
  readonly viewportWidth: number
  readonly cardWidth: number
  readonly gap: number
  readonly rowsPerColumn: number
}

/**
 * Keep image work to the visible reel interval plus exactly one interval ahead.
 * CSS grid fills each column top-to-bottom, so the pixel column window maps to
 * one contiguous slice of the feed rows.
 */
export function reelPreloadWindow<T>(
  items: readonly T[],
  metrics: ReelPreloadMetrics,
): readonly T[] {
  if (items.length === 0) return items
  const rowsPerColumn = Math.max(1, Math.floor(metrics.rowsPerColumn))
  const stride = Math.max(1, metrics.cardWidth + metrics.gap)
  const firstColumn = Math.max(0, Math.floor(Math.max(0, metrics.scrollLeft) / stride))
  const intervalWidth = metrics.viewportWidth > 0 ? metrics.viewportWidth : metrics.cardWidth
  const lastColumnExclusive = Math.max(
    firstColumn + 1,
    Math.ceil((Math.max(0, metrics.scrollLeft) + intervalWidth * 2) / stride),
  )
  return items.slice(
    firstColumn * rowsPerColumn,
    Math.min(items.length, lastColumnExclusive * rowsPerColumn),
  )
}

// ── gallery ─────────────────────────────────────────────────────────────────
//
// ONE windowing implementation for the gallery, in two layers:
//
//   1. {@link galleryGeometry} — how many COLUMNS the grid has and how wide
//      they are. The page drives the CSS from this rather than letting
//      `auto-fill` decide, because the row window below has to chunk a flat
//      list into grid rows and a column count JS only guessed at would put a
//      spacer in the wrong place.
//   2. {@link galleryVirtualWindow} — which ROWS are rendered, and how much
//      empty space stands in for the rest.
//
// The image preload window ({@link galleryPreloadWindow}) is DERIVED from (2)
// rather than computed from its own estimate. It used to run a second
// scroll→row calculation of its own; two windows over one list, one measured
// and one estimated, drift the moment a caption wraps.

/** Horizontal geometry of the gallery grid, measured from the running view. */
export interface GalleryGeometryMetrics {
  /** The scroller's content width in CSS px. 0 ⇒ not laid out yet. */
  readonly viewportWidth: number
  /** Minimum column width — the grid is `minmax(cardWidth, 1fr)`. */
  readonly cardWidth: number
  readonly gap: number
  /** The host's `columns` config: an explicit count, or `auto` (fit to width). */
  readonly columns?: number | 'auto'
}

export interface GalleryGeometry {
  /** Columns actually rendered. Never below 1. */
  readonly columns: number
  /** Resolved width of one column, CSS px. */
  readonly columnWidth: number
  /**
   * ESTIMATED height of one grid row including its gap, CSS px — what stands in
   * for a row that has not been measured. Only ever an estimate: see
   * {@link GALLERY_CAPTION_PX}.
   */
  readonly rowStridePx: number
}

/**
 * Rough vertical cost of the caption under a gallery tile.
 *
 * The tile is NOT uniform: the camera name is one line (two at the floor size
 * on a very narrow tile) and a zone chip adds another ~14 px; with neither,
 * the tile is the picture alone. So this can only ever be an estimate, and the row window
 * treats it as one — a row that has been rendered is MEASURED, and this is what
 * the rows below the fold are guessed at with until they have been.
 */
const GALLERY_CAPTION_PX = 18

/**
 * Columns, column width and the fallback row stride — ONE answer, shared by the
 * rendered grid, the row window and the preload window, so none of the three
 * can disagree about where a row begins.
 *
 * The `auto` arithmetic is exactly what `repeat(auto-fill, minmax(w, 1fr))`
 * does; expressing it here is what lets the page render explicit tracks and
 * stop having two authorities for the column count.
 */
export function galleryGeometry(metrics: GalleryGeometryMetrics): GalleryGeometry {
  const gap = Math.max(0, metrics.gap)
  const cardWidth = Math.max(1, metrics.cardWidth)
  const width = Math.max(0, metrics.viewportWidth)
  const requested = metrics.columns ?? 'auto'
  const columns =
    requested === 'auto'
      ? Math.max(1, Math.floor((width + gap) / (cardWidth + gap)))
      : Math.max(1, Math.floor(requested))
  // Unmeasured ⇒ the card's own minimum, which is what the first paint uses.
  const columnWidth = width > 0 ? (width - (columns - 1) * gap) / columns : cardWidth
  // The hero is square (`aspectRatio: 1 / 1` at the full column width).
  return { columns, columnWidth, rowStridePx: Math.max(1, columnWidth + GALLERY_CAPTION_PX + gap) }
}

/** Grid rows rendered above and below the visible band, so a flick lands on
 *  mounted cards instead of on a spacer. */
export const GALLERY_OVERSCAN_ROWS = 2

export interface GalleryVirtualMetrics {
  /** Grid rows in the whole list — `ceil(items / columns)`. */
  readonly rowCount: number
  readonly scrollTop: number
  /** The scroller's own height. 0 ⇒ NOT laid out; see the window's contract. */
  readonly viewportHeight: number
  /** Height to assume for a row nobody has measured. Must be > 0. */
  readonly estimatedRowPx: number
  /** Measured heights by ROW INDEX. Absent (or 0) ⇒ use the estimate. */
  readonly measuredPx: ReadonlyMap<number, number>
  readonly overscanRows?: number
}

/**
 * Which rows to render, and the two spacers that keep the scrollbar honest.
 *
 * `padTopPx + (rendered rows) + padBottomPx === totalPx` by construction, so
 * the scroller's `scrollHeight` describes the WHOLE list and not the slice — a
 * virtualised list whose scrollbar describes the slice is a worse list than an
 * unvirtualised one.
 */
export interface GalleryVirtualWindow {
  /** First rendered row, inclusive. */
  readonly startRow: number
  /** Last rendered row, EXCLUSIVE. */
  readonly endRow: number
  readonly padTopPx: number
  readonly padBottomPx: number
  /** Height of the whole list, measured where known and estimated elsewhere. */
  readonly totalPx: number
}

const EMPTY_WINDOW: GalleryVirtualWindow = {
  startRow: 0,
  endRow: 0,
  padTopPx: 0,
  padBottomPx: 0,
  totalPx: 0,
}

/**
 * The rendered row window.
 *
 * Linear in `rowCount` on purpose. At the practical bound (5 000 rows over 3-7
 * columns ⇒ 700-1 700 grid rows) one walk is a few microseconds and runs once
 * per scroll frame; a prefix tree would buy nothing and would have to be
 * invalidated on every measurement. If the bound ever moves by an order of
 * magnitude, THIS is the function to replace.
 *
 * **An unmeasured scroller is not windowed.** `viewportHeight: 0` is a real
 * state — the OTA HTML paints before the native WebView hands it geometry, and
 * a host may render the embed with no layout at all — and a window computed
 * from a viewport of unknown size would hide rows it cannot prove are
 * off-screen. Rendering everything there costs nothing in practice: the page's
 * auto-fill refuses to page a zero-extent scroller, so an unmeasured surface
 * never holds more than the host explicitly loaded.
 */
export function galleryVirtualWindow(metrics: GalleryVirtualMetrics): GalleryVirtualWindow {
  const rowCount = Math.max(0, Math.floor(metrics.rowCount))
  if (rowCount === 0) return EMPTY_WINDOW
  const estimate = metrics.estimatedRowPx > 0 ? metrics.estimatedRowPx : 1
  const heightOf = (row: number): number => {
    const measured = metrics.measuredPx.get(row)
    return measured !== undefined && measured > 0 ? measured : estimate
  }
  let totalPx = 0
  for (let row = 0; row < rowCount; row += 1) totalPx += heightOf(row)
  if (metrics.viewportHeight <= 0) {
    return { startRow: 0, endRow: rowCount, padTopPx: 0, padBottomPx: 0, totalPx }
  }

  const top = Math.max(0, metrics.scrollTop)
  const bottom = top + metrics.viewportHeight
  let firstVisible = 0
  let offset = 0
  while (firstVisible < rowCount - 1 && offset + heightOf(firstVisible) <= top) {
    offset += heightOf(firstVisible)
    firstVisible += 1
  }
  let lastVisible = firstVisible
  let covered = offset
  while (lastVisible < rowCount && covered < bottom) {
    covered += heightOf(lastVisible)
    lastVisible += 1
  }

  const overscan = Math.max(0, Math.floor(metrics.overscanRows ?? GALLERY_OVERSCAN_ROWS))
  const startRow = Math.max(0, firstVisible - overscan)
  const endRow = Math.min(rowCount, lastVisible + overscan)
  let padTopPx = 0
  for (let row = 0; row < startRow; row += 1) padTopPx += heightOf(row)
  let renderedPx = 0
  for (let row = startRow; row < endRow; row += 1) renderedPx += heightOf(row)
  return {
    startRow,
    endRow,
    padTopPx,
    padBottomPx: Math.max(0, totalPx - padTopPx - renderedPx),
    totalPx,
  }
}

/**
 * The height to assume for an unmeasured row: the running average of what HAS
 * been measured, else the geometric estimate.
 *
 * Averaging matters for the scrollbar. The estimate assumes one caption line;
 * a feed of two-line camera names is ~15 px taller per row, and over 700 rows
 * that is a scrollbar off by a screen and a half. One measured screen fixes it.
 */
export function estimateGalleryRowPx(
  measuredPx: ReadonlyMap<number, number>,
  fallbackPx: number,
): number {
  let sum = 0
  let count = 0
  for (const height of measuredPx.values()) {
    if (height > 0) {
      sum += height
      count += 1
    }
  }
  return count === 0 ? Math.max(1, fallbackPx) : Math.max(1, sum / count)
}

/**
 * Hard ceiling on a gallery preload window.
 *
 * The window below is derived from the RENDER window, which is measured — but
 * the bound is still a guarantee rather than a calculation: whatever the
 * arithmetic decides, opening Events cannot queue more than this in the
 * background. Twenty-four is roughly four screens of the smallest tile on the
 * largest phone — generous for prefetch, nowhere near the 60 that started this.
 */
export const GALLERY_PRELOAD_MAX_ITEMS = 24

/** Grid rows warmed BELOW the rendered window — the band a flick lands in
 *  before the cards there have mounted and can fetch for themselves. */
const GALLERY_PRELOAD_ROWS_AHEAD = 2

/**
 * Keep gallery image work to the rendered rows plus a couple ahead.
 *
 * Derived from {@link galleryVirtualWindow} rather than from a second
 * scroll→row calculation: the render window knows the MEASURED heights, so the
 * band it names is where the operator actually is. A preload window with its
 * own estimate pointed somewhere near it and drifted further the more the
 * captions wrapped.
 *
 * Returns a contiguous slice aligned to a ROW boundary, because a CSS grid
 * fills left to right and half a warmed row is a tile fetching on its own.
 */
export function galleryPreloadWindow<T>(
  items: readonly T[],
  window: GalleryVirtualWindow,
  columns: number,
): readonly T[] {
  if (items.length === 0) return items
  const perRow = Math.max(1, Math.floor(columns))
  const start = Math.max(0, window.startRow) * perRow
  const rows = Math.max(1, window.endRow - window.startRow + GALLERY_PRELOAD_ROWS_AHEAD)
  const end = Math.min(items.length, start + Math.min(rows * perRow, GALLERY_PRELOAD_MAX_ITEMS))
  return items.slice(start, end)
}
