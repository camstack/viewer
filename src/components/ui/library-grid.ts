/**
 * library-grid — THE column rule and tile geometry of every Library grid
 * (Media, People, Plates, Retrain). Pure and RN-free so it is unit testable.
 *
 * Agreed with the operator on 2026-10-21: one tile shape (`LibraryTile`, a
 * 16:9 image) and one column count per width, whatever the page. Each page
 * used to solve its own count from a "target cell width" of its own (108 pt
 * for faces, 150 pt for plates, a fixed 2 for retrain, a one-column list for
 * media), so the same phone showed four different grids under one scope bar.
 *
 * One exception, agreed on 2026-10-22: People draws the events gallery's
 * SQUARE tile (`shape="square"`) and packs by the events column rule
 * (`LibraryColumnRule` `events`), so a face grid reads like the events grid.
 *
 * The width is the LIST's measured width, not the window's: on a tablet the
 * side rail takes its share first, and a rule read off the window would hand
 * an 820 pt iPad in portrait the desktop count.
 */
import { SCREEN_GUTTER } from '../../theme/tokens.js'
import type { GridDensity } from '../../store/settings-store.js'

/** Gap (pt) between tiles, horizontally and vertically. `SPACING.sm`. */
export const LIBRARY_GRID_GAP = 4

/** Padding (pt) either side of a grid row: the screen gutter, so tiles line up with the header row and the scope bar. */
export const LIBRARY_GRID_PADDING = SCREEN_GUTTER

/** The tile image's aspect: a frame, not a square crop. */
export const LIBRARY_TILE_ASPECT = 16 / 9

/** The events gallery's tile aspect: a square (`events-gallery-layout.ts`). */
export const LIBRARY_TILE_SQUARE_ASPECT = 1

/**
 * The tile's image shape. `frame` (16:9) is the Library default — Media,
 * Plates, Retrain. `square` is the events gallery's tile, used by People:
 * a face crop is a subject, not a scene (operator, 2026-10-22).
 */
export type LibraryTileShape = 'frame' | 'square'

/** The image aspect (width / height) of a tile `shape`. */
export function libraryTileAspect(shape: LibraryTileShape): number {
  return shape === 'square' ? LIBRARY_TILE_SQUARE_ASPECT : LIBRARY_TILE_ASPECT
}

/**
 * Which column rule a grid solves its count with. `library` is the Library's
 * own (2 / 3 / 4 / 5 by width). `events` is the events gallery's
 * (`galleryColumns`: the operator's events density × device class × width),
 * so a grid of square tiles packs exactly like the events grid beside it.
 */
export type LibraryColumnRule =
  | { readonly kind: 'library' }
  | { readonly kind: 'events'; readonly density: GridDensity }

export const LIBRARY_COLUMN_RULE: LibraryColumnRule = Object.freeze({ kind: 'library' })

/** Breakpoints of the column rule, by list width (pt), smallest first. */
const COLUMN_STEPS: readonly (readonly [maxWidth: number, columns: number])[] = [
  [600, 2], // phone, portrait or landscape-narrow
  [900, 3], // tablet portrait, a narrow web window
  [1280, 4], // tablet landscape, laptop
]

/** Columns past the last step: a desktop / wide window. */
const WIDE_COLUMNS = 5

/**
 * Columns for a list `width` points wide: 2 on a phone, 3 on a tablet in
 * portrait, 4 on a laptop or a tablet in landscape, 5 on a wide window. A
 * degenerate width (the first layout pass, before measuring) answers the phone
 * count rather than 0, so the first frame is never an empty grid.
 */
export function libraryGridColumns(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return COLUMN_STEPS[0]![1]
  for (const [maxWidth, columns] of COLUMN_STEPS) if (width < maxWidth) return columns
  return WIDE_COLUMNS
}

/** The events gallery's column count for a list width at a density (`galleryColumns`, device class bound). */
export type EventsColumnsAt = (width: number, density: GridDensity) => number

/**
 * Columns for a list `width` points wide under `rule`. `eventsColumnsAt` is
 * the events gallery's own rule, injected so this file stays RN-free (the
 * settings store it lives in is not). Never 0: before the first measurement
 * both rules answer the Library's phone count.
 */
export function libraryGridColumnsFor(width: number, rule: LibraryColumnRule, eventsColumnsAt: EventsColumnsAt): number {
  if (rule.kind === 'library' || !Number.isFinite(width) || width <= 0) return libraryGridColumns(width)
  return eventsColumnsAt(width, rule.density)
}

/**
 * Width of one tile for `columns` columns in a row of `containerWidth`, with
 * `padding` on each side and `gap` between tiles. Floored so the row never
 * overflows by a sub-pixel; never negative. A tile has ONE width, never
 * `flex: 1`: with `numColumns` a flexing tile fills whatever its row has left,
 * so an incomplete last row stretched its single tile across the whole line.
 */
export function libraryTileWidth(
  containerWidth: number,
  columns: number,
  gap: number = LIBRARY_GRID_GAP,
  padding: number = LIBRARY_GRID_PADDING,
): number {
  if (columns < 1) return 0
  const inner = containerWidth - padding * 2 - gap * (columns - 1)
  return Math.max(0, Math.floor(inner / columns))
}

/** What a tile's image area shows. */
export type LibraryTileImageState = 'image' | 'loading' | 'placeholder'

export interface LibraryTileImageInput {
  /** The tile was given something to draw. */
  readonly hasSource: boolean
  /** The source is still being fetched (an older hub's inline bytes). */
  readonly loading: boolean
  /** The image failed to load. */
  readonly broken: boolean
}

/**
 * The image area's state. A tile with no image, or one whose image failed,
 * says so — an icon and "No image" — instead of an empty box that reads as a
 * picture still on its way. Still-loading is the one case drawn as a skeleton:
 * not-yet-known must never look like absent.
 */
export function libraryTileImageState({ hasSource, loading, broken }: LibraryTileImageInput): LibraryTileImageState {
  if (hasSource && !broken) return 'image'
  if (!hasSource && loading) return 'loading'
  return 'placeholder'
}

/** Window width (pt) from which the header's primary "+" also shows its label. */
export const LIBRARY_LABEL_MIN_WIDTH = 600

/**
 * Whether the Library header's primary action wears its label ("+ New
 * person") or is the bare "+". A phone has no room for it beside the chips,
 * the sort and the `⋯`; a tablet or desktop does.
 */
export function libraryPrimaryShowsLabel(windowWidth: number): boolean {
  return Number.isFinite(windowWidth) && windowWidth >= LIBRARY_LABEL_MIN_WIDTH
}

/**
 * Bottom padding (pt) of a Library grid BEFORE the floating tab bar's inset
 * (`useTabScrollPadding` adds that). `SPACING['2xl']`: the last row ends clear
 * of the capsule with air under it, not flush against its top edge.
 */
export const LIBRARY_GRID_BOTTOM_PADDING = 24

/** What a long-press on a Library tile does. */
export type LibraryTileLongPress = 'start-selection' | 'toggle'

/**
 * The long-press rule of every selectable Library page (People, Plates,
 * Retrain): outside selection mode it ENTERS it with this tile selected, inside
 * it toggles membership like a tap. It never opens the detail — that is the tap.
 */
export function libraryTileLongPress(selectionMode: boolean): LibraryTileLongPress {
  return selectionMode ? 'toggle' : 'start-selection'
}
