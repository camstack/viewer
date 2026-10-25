/**
 * events-gallery-layout — the pure geometry and grouping of the native events
 * gallery: how many columns, how big a tile, which rows sit under which day
 * header, and how tall each list item is.
 *
 * ## One list item = one GRID ROW, not one tile
 *
 * The gallery is a uniform square grid, so a row of N tiles has ONE height that
 * is known before anything is measured (`edge` + the optional details block).
 * Chunking the rows here — instead of asking the list for `numColumns` — gives
 * the virtualised list fixed, predictable item sizes (no re-measure on a density
 * change, no span override for the day headers) and keeps every width decision
 * in one pure, testable place.
 *
 * Nothing in here reads React, react-native or the theme.
 */
import type { EventsTrackRow } from '../../../../shared/events/events-track-row.js'
import { calendarDaysAgo } from '../../../lib/day-relative-label.js'

/** The Photos-style hairline between tiles. */
export const GALLERY_GAP = 2

/** The height of a day header (title line + its padding). */
export const GALLERY_HEADER_HEIGHT = 44

/** Which lines the optional details block under a tile draws. */
export interface TileDetails {
  readonly camera: boolean
  readonly zone: boolean
}

export const NO_TILE_DETAILS: TileDetails = Object.freeze({ camera: false, zone: false })

const DETAIL_PAD_TOP = 4
const DETAIL_PAD_BOTTOM = 6
const DETAIL_CAMERA_LINE = 16
const DETAIL_ZONE_CHIP = 20

/**
 * Height of the details block. Deterministic on purpose: every line is a fixed
 * single line (a long camera name truncates), so a row's height never depends
 * on a measurement and the list can lay out without one.
 */
export function tileDetailsHeight(details: TileDetails): number {
  if (!details.camera && !details.zone) return 0
  return (
    DETAIL_PAD_TOP +
    DETAIL_PAD_BOTTOM +
    (details.camera ? DETAIL_CAMERA_LINE : 0) +
    (details.zone ? DETAIL_ZONE_CHIP : 0)
  )
}

/** Square tile edge for `columns` columns across `width`, with the gap between. */
export function tileEdgeFor(width: number, columns: number): number {
  if (!Number.isFinite(width) || width <= 0 || columns < 1) return 0
  return Math.max(1, Math.floor((width - GALLERY_GAP * (columns - 1)) / columns))
}

export interface GalleryHeaderItem {
  readonly type: 'header'
  readonly key: string
  /** Calendar days before the anchor: 0 = today. */
  readonly dayOffset: number
  /** Events loaded for that day, or `null` while the day may still be paging in
   *  (a count that then grows would read as the day changing under you). */
  readonly count: number | null
}

export interface GalleryRowItem {
  readonly type: 'row'
  readonly key: string
  readonly rows: readonly EventsTrackRow[]
}

export type GalleryItem = GalleryHeaderItem | GalleryRowItem

export interface BuildGalleryItemsInput {
  readonly rows: readonly EventsTrackRow[]
  readonly columns: number
  readonly anchorMs: number
  /** The feed has nothing older to page in — the LAST day's count is final. */
  readonly exhausted: boolean
  /**
   * The day the page's filter row already names (its date) and counts (the
   * count line under it): that day's run of tiles gets no header of its own —
   * a second "Today · N events" over the first row said the same thing twice.
   * Older days that page in below it keep theirs, as separators.
   */
  readonly namedDayOffset: number
}

/**
 * Rows → list items.
 *
 * The list is always newest first, so it is cut into days: a header per day,
 * never over the day the filter row already names (`namedDayOffset`).
 * Grouped by `lastSeen` — the clock the list is ordered by and the one the
 * tile's time shows.
 */
export function buildGalleryItems(input: BuildGalleryItemsInput): readonly GalleryItem[] {
  const { rows, columns, anchorMs, exhausted, namedDayOffset } = input
  const perRow = Math.max(1, columns)
  const out: GalleryItem[] = []
  let i = 0
  while (i < rows.length) {
    const first = rows[i]
    if (first === undefined) break
    const offset = Math.max(0, calendarDaysAgo(first.lastSeen, anchorMs))
    let end = i
    while (end < rows.length) {
      const row = rows[end]
      if (row === undefined || Math.max(0, calendarDaysAgo(row.lastSeen, anchorMs)) !== offset) break
      end += 1
    }
    const isLastDay = end >= rows.length
    if (offset !== namedDayOffset) {
      out.push({
        type: 'header',
        key: `h:${offset}`,
        dayOffset: offset,
        count: isLastDay && !exhausted ? null : end - i,
      })
    }
    for (let j = i; j < end; j += perRow) {
      const slice = rows.slice(j, Math.min(end, j + perRow))
      out.push({ type: 'row', key: `r:${slice[0]?.trackId ?? j}`, rows: slice })
    }
    i = end
  }
  return out
}

/** Pixel height of one list item. */
export function galleryItemHeight(item: GalleryItem, edge: number, detailsHeight: number): number {
  return item.type === 'header' ? GALLERY_HEADER_HEIGHT : edge + detailsHeight + GALLERY_GAP
}

/** The media plane resizes in steps of this many pixels' worth of cache: asking
 *  for the exact `edge * dpr` would make every density change, and every phone
 *  with a slightly different width, a fresh set of downloads for identical
 *  pictures. */
const THUMB_BUCKET_PX = 32

/**
 * The `?size=` to ask the media plane for a tile of `edge` points on a screen of
 * `dpr` pixels per point — rounded UP to a bucket so a tile is never blurry and
 * neighbouring layouts share cache entries. Clamping to the plane's own range is
 * the URL builder's job (`clampThumbSize`).
 */
export function thumbPxForEdge(edge: number, dpr: number): number {
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1
  return Math.max(THUMB_BUCKET_PX, Math.ceil((edge * scale) / THUMB_BUCKET_PX) * THUMB_BUCKET_PX)
}
