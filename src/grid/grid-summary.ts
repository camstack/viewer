/**
 * grid-summary — everything the grids LIST can honestly say about a grid,
 * derived in one pure place so the card only renders it.
 *
 * Two questions the old card got wrong by not asking them:
 *
 *  1. **Unknown is not missing.** The list resolves `grid.cameraIds` against
 *     the `useCameras` query. That query answers `undefined` until the hub
 *     replies, and the card used to resolve every id against an empty map and
 *     silently show a shorter strip — a grid of twelve cameras looked like a
 *     grid of none for as long as the hub took. A camera list that has not
 *     answered is `null` here, and a `null` list yields `health: 'unknown'`
 *     with NO counts claimed. Only an ANSWERED list can say a camera is gone.
 *
 *  2. **The wall shows the members minus the grid's hidden set.** Health is
 *     therefore counted over the VISIBLE members: a camera the operator
 *     deliberately hid off the wall being offline is not a fault of the wall.
 *
 * Nothing here invents a fact. There is no "last opened" — the grid document
 * (`store/grid-store.ts`) has never carried one and nothing else records it.
 */
import type { CameraInfo } from '../data/use-cameras.js'
import type { Grid } from '../store/grid-store.js'
import { SPACING } from '../theme/tokens.js'

/** One resolved member of a grid, in the grid's display order. */
export interface GridMemberRef {
  readonly id: number
  readonly name: string
  readonly online: boolean
  readonly disabled: boolean
  /** Hidden from this grid's live wall (still a member). */
  readonly hidden: boolean
}

/**
 * How the grid looks right now:
 *  • `empty`    — the grid has no cameras at all,
 *  • `unknown`  — the camera list has not answered, so nothing can be judged,
 *  • `degraded` — a visible member is offline, disabled, or no longer exists,
 *  • `ok`       — every visible member resolved and is up.
 */
export type GridHealth = 'empty' | 'unknown' | 'degraded' | 'ok'

export interface GridSummary {
  /** Resolved members, grid order. EMPTY while the camera list is unknown. */
  readonly members: readonly GridMemberRef[]
  /** Members per the grid DOCUMENT — known without the camera list. */
  readonly memberCount: number
  /** Members that will actually be tiled on the wall. */
  readonly visibleCount: number
  /** Members the operator hid from this grid's wall. */
  readonly hiddenCount: number
  /** Visible members the hub reports offline (a disabled one is not counted). */
  readonly offlineCount: number
  /** Visible members the operator soft-disabled. */
  readonly disabledCount: number
  /** Member ids an ANSWERED camera list does not carry: removed on the hub, or
   *  outside this user's access scope. Always empty while unknown. */
  readonly unknownIds: readonly number[]
  /** Visible members' display names, grid order — the card's "which cameras". */
  readonly visibleNames: readonly string[]
  /** Distinct operator locations among the members, first-seen order. */
  readonly locations: readonly string[]
  readonly health: GridHealth
}

/**
 * Summarise one grid against the camera list.
 *
 * `cameras` is `null` when the list has not answered yet — see the header.
 */
export function summarizeGrid(
  grid: Grid,
  cameras: ReadonlyMap<number, CameraInfo> | null,
): GridSummary {
  const memberCount = grid.cameraIds.length
  const memberSet = new Set(grid.cameraIds)
  const hiddenIds = (grid.hiddenCameraIds ?? []).filter((id) => memberSet.has(id))
  const hidden = new Set(hiddenIds)

  if (cameras === null) {
    return {
      members: [],
      memberCount,
      visibleCount: memberCount - hidden.size,
      hiddenCount: hidden.size,
      offlineCount: 0,
      disabledCount: 0,
      unknownIds: [],
      visibleNames: [],
      locations: [],
      health: memberCount === 0 ? 'empty' : 'unknown',
    }
  }

  const members: GridMemberRef[] = []
  const unknownIds: number[] = []
  const visibleNames: string[] = []
  const locations: string[] = []
  let offlineCount = 0
  let disabledCount = 0

  for (const id of grid.cameraIds) {
    const camera = cameras.get(id)
    if (camera === undefined) {
      unknownIds.push(id)
      continue
    }
    const isHidden = hidden.has(id)
    members.push({
      id: camera.id,
      name: camera.name,
      online: camera.online,
      disabled: camera.disabled,
      hidden: isHidden,
    })
    if (camera.location !== null && !locations.includes(camera.location)) locations.push(camera.location)
    if (isHidden) continue
    visibleNames.push(camera.name)
    // Disabled is the stronger statement and the one the operator made: a
    // camera they switched off must not also be reported as broken (D62).
    if (camera.disabled) disabledCount += 1
    else if (!camera.online) offlineCount += 1
  }

  const visibleCount = memberCount - hidden.size
  const degraded = offlineCount > 0 || disabledCount > 0 || unknownIds.length > 0

  return {
    members,
    memberCount,
    visibleCount,
    hiddenCount: hidden.size,
    offlineCount,
    disabledCount,
    unknownIds,
    visibleNames,
    locations,
    health: memberCount === 0 ? 'empty' : degraded ? 'degraded' : 'ok',
  }
}

// ── Responsive geometry ──────────────────────────────────────────────────────

/**
 * Grid cards carry more text than a camera tile, so they stop one step short of
 * the cameras list (which goes to 6). The COLUMN COUNT itself still comes from
 * `useGridColumns` — one breakpoint rule for the whole app, capped here.
 */
export const GRID_CARD_MAX_COLUMNS = 3

/** Cap the shared cameras-list column count for the grids list. */
export function gridCardColumns(columns: number): number {
  if (!Number.isFinite(columns)) return 1
  return Math.max(1, Math.min(GRID_CARD_MAX_COLUMNS, Math.floor(columns)))
}

/** Width (pt) of one grid card: the viewport minus the list's horizontal
 *  padding, minus the gaps between columns, split evenly. */
export function gridCardWidth(viewportWidth: number, columns: number): number {
  const cols = gridCardColumns(columns)
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0
  const usable = viewportWidth - SPACING.md * 2 - SPACING.md * (cols - 1)
  return Math.max(0, usable / cols)
}

/** Narrowest a preview thumb may get before it stops reading as a camera. */
const PREVIEW_THUMB_MIN_WIDTH = 64
export const GRID_PREVIEW_MIN_THUMBS = 3
export const GRID_PREVIEW_MAX_THUMBS = 6

/**
 * How many snapshot thumbs the preview strip shows for a card of this width.
 *
 * A fixed four was right for exactly one viewport: on a phone (one full-width
 * card) it wasted half the strip, and on a 3-column desktop it squeezed four
 * thumbs into ~110 pt each. An unmeasured width (0 / NaN, first frame) falls
 * back to the MINIMUM — asking for six snapshots on a guess is the expensive
 * mistake, not the cheap one.
 */
export function gridPreviewThumbCount(cardWidthPt: number): number {
  if (!Number.isFinite(cardWidthPt) || cardWidthPt <= 0) return GRID_PREVIEW_MIN_THUMBS
  const inner = cardWidthPt - SPACING.md * 2
  const fits = Math.floor((inner + SPACING.xs) / (PREVIEW_THUMB_MIN_WIDTH + SPACING.xs))
  return Math.max(GRID_PREVIEW_MIN_THUMBS, Math.min(GRID_PREVIEW_MAX_THUMBS, fits))
}
