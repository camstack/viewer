/**
 * plate-review-filters — sort, filter and selection for the Plates page, over
 * the state types the People page already owns (`face-review-filters.ts`:
 * status chips, camera set, picked day, sort key + direction). Only what
 * reads a ROW is re-implemented here.
 *
 * ## What the hub narrows, and what the app does
 *
 * `plateGallery.listPlates` takes `{ deviceId?, limit?, includeCrops? }` and
 * nothing else: no status, no date window, no sort, no cursor. So, unlike
 * People (where the hub applies all of that before `limit`):
 *
 *   • ONE selected camera is pushed to the hub (`deviceId`) — it narrows the
 *     window before `limit`. Several cameras are narrowed in the app.
 *   • Status, the picked day and sort are applied in the app over the loaded
 *     window, which the hub returns newest-first. "Load more" grows `limit`.
 *   • {@link plateReviewWindowIsPartial} says when the app is cutting a window
 *     that has older rows beyond it, so the page can say "among the first N"
 *     instead of "there are none".
 *
 * Pure and RN-free.
 */
import {
  faceReviewDayBounds,
  type FaceReviewFilterState,
  type FaceReviewSort,
} from './face-review-filters.js'
import type { PlateReviewRow } from './plate-review.js'

export interface PlateReviewListInput {
  readonly limit: number
  readonly includeCrops: false
  /** Present only when exactly one camera is selected. */
  readonly deviceId?: number
}

/** What to ask the hub for. Several cameras / status / day / sort stay in the app. */
export function plateReviewListInput(state: FaceReviewFilterState, limit: number): PlateReviewListInput {
  return {
    limit,
    includeCrops: false,
    ...(state.deviceIds.length === 1 && state.deviceIds[0] !== undefined ? { deviceId: state.deviceIds[0] } : {}),
  }
}

/**
 * TRUE when the app cuts the loaded window by something the hub did not and
 * older rows exist beyond it: the grid is then "…among the first N".
 */
export function plateReviewWindowIsPartial(state: FaceReviewFilterState, hasMore: boolean): boolean {
  if (!hasMore) return false
  return state.statuses.length < 3 || state.dayMs !== null || state.deviceIds.length > 1
}

/** Status ∧ camera ∧ day, all ANDed. Empty `statuses` yields nothing. Pure. */
export function applyPlateReviewFilters(rows: readonly PlateReviewRow[], state: FaceReviewFilterState): PlateReviewRow[] {
  if (state.statuses.length === 0) return []
  const wantedStatus = new Set(state.statuses)
  const wantedDevices = state.deviceIds.length > 0 ? new Set(state.deviceIds) : null
  const bounds = faceReviewDayBounds(state.dayMs)
  return rows.filter((row) => {
    if (!wantedStatus.has(row.status)) return false
    if (wantedDevices !== null && !wantedDevices.has(row.deviceId)) return false
    if (bounds !== null && (row.timestamp < bounds.fromMs || row.timestamp > bounds.toMs)) return false
    return true
  })
}

export function comparePlateReviewRows(a: PlateReviewRow, b: PlateReviewRow, sort: FaceReviewSort): number {
  const ascending = sort.key === 'certainty' ? a.score - b.score : a.timestamp - b.timestamp
  const primary = sort.direction === 'desc' ? -ascending : ascending
  if (primary !== 0) return primary
  if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp
  if (a.plateId === b.plateId) return 0
  return a.plateId < b.plateId ? -1 : 1
}

export function sortPlateReviewRows(rows: readonly PlateReviewRow[], sort: FaceReviewSort): PlateReviewRow[] {
  return [...rows].sort((a, b) => comparePlateReviewRows(a, b, sort))
}

export interface PlateReviewCameraOption {
  readonly deviceId: number
  readonly name: string
}

/** Cameras present in the UNFILTERED loaded rows, by name — picking one must not hide the others. */
export function plateReviewCameraOptions(rows: readonly PlateReviewRow[]): PlateReviewCameraOption[] {
  const byId = new Map<number, string>()
  for (const row of rows) {
    const existing = byId.get(row.deviceId)
    const name = row.cameraName ?? `#${String(row.deviceId)}`
    if (existing === undefined || existing.startsWith('#')) byId.set(row.deviceId, name)
  }
  return [...byId.entries()]
    .map(([deviceId, name]) => ({ deviceId, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function togglePlateSelection(selected: ReadonlySet<string>, plateId: string): ReadonlySet<string> {
  const next = new Set(selected)
  if (next.has(plateId)) next.delete(plateId)
  else next.add(plateId)
  return next
}

/** Drop selected ids no longer among `rows`; the SAME set back when nothing dropped. */
export function retainSelectedPlates(selected: ReadonlySet<string>, rows: readonly PlateReviewRow[]): ReadonlySet<string> {
  if (selected.size === 0) return selected
  const visible = new Set(rows.map((r) => r.plateId))
  const kept = [...selected].filter((id) => visible.has(id))
  return kept.length === selected.size ? selected : new Set(kept)
}

/** The selected rows in on-screen order. */
export function selectedPlateRows(rows: readonly PlateReviewRow[], selected: ReadonlySet<string>): PlateReviewRow[] {
  return rows.filter((r) => selected.has(r.plateId))
}
