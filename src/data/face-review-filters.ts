/**
 * face-review-filters — the face review tab's SORT, FILTER and SELECTION
 * state, split out of `face-cluster-review.ts` (which keeps row derivation and
 * the look-alike clustering the Analyze modal runs on).
 *
 * ## Where each narrowing is applied
 *
 * `faceGallery.listRecentFaces` takes the status `filter`, `deviceIds`,
 * `since` / `until`, `sortBy` and `sortDirection`, and applies them as store
 * predicates BEFORE `limit` — so `limit` counts rows that PASSED, and the
 * most certain suggestions are the first page however old they are.
 * {@link faceReviewListInput} builds that input; the rows that come back are
 * filtered and sorted again here, which is then a no-op except for one case:
 * the hub's status filter has three useful values (`unassigned`,
 * `identified`, `all`) and the screen has three independent chips, so
 * "Suggested only" is `unassigned` on the wire and the suggested rows are cut
 * out client-side ({@link faceReviewWindowIsPartial} says when that matters).
 *
 * Pure and RN-free — unit-tested under the node vitest env in
 * `__tests__/face-review-filters.spec.ts`.
 */
import type { FaceReviewRow, FaceReviewStatus } from './face-cluster-review.js'
import { localDayBounds } from '../lib/local-day.js'

// ─────────────────────────────────────────────────────────────────────────
// Sorting
// ─────────────────────────────────────────────────────────────────────────

/** What the rows are ordered BY. `certainty` is the suggestion's own score
 *  (`FaceReviewRow.suggestedMatchScore`) — never a group's. */
export type FaceReviewSortKey = 'certainty' | 'date'

export type FaceReviewSortDirection = 'desc' | 'asc'

export interface FaceReviewSort {
  readonly key: FaceReviewSortKey
  readonly direction: FaceReviewSortDirection
}

export const FACE_REVIEW_SORT_KEYS: readonly FaceReviewSortKey[] = ['certainty', 'date']

/** What People and Plates open on when nothing is remembered: the most
 *  certain match (People) / the most confident read (Plates) first (operator,
 *  2026-10-23). A sort the operator picked is remembered on this device and
 *  wins over this (`store/library-filters.ts`); the date is one pick away. */
export const DEFAULT_FACE_REVIEW_SORT: FaceReviewSort = { key: 'certainty', direction: 'desc' }

export function toggleFaceReviewSortDirection(sort: FaceReviewSort): FaceReviewSort {
  return { key: sort.key, direction: sort.direction === 'desc' ? 'asc' : 'desc' }
}

export function setFaceReviewSortKey(sort: FaceReviewSort, key: FaceReviewSortKey): FaceReviewSort {
  return { key, direction: sort.direction }
}

/**
 * A row with no suggestion has no certainty — NOT a certainty of zero, which
 * would interleave it with genuinely bad suggestions. `-1` parks the whole
 * unscored population strictly below every real score, so descending puts
 * them last and ascending puts them first, both of which are honest readings
 * of "least certain".
 */
function certaintyValue(row: FaceReviewRow): number {
  return row.suggestedMatchScore ?? -1
}

/**
 * Comparator for one explicit {@link FaceReviewSort}. Deliberately does NOT
 * rank by status first: the operator asked for "by certainty" and "by date",
 * and a hidden status grouping would make a date sort silently non-monotonic.
 * Status still reads at a glance — the review tile (`ReviewTile`) draws a
 * different shape for each.
 *
 * Ties fall back to newest-first and then `faceId`, so the order is total and
 * a re-render cannot shuffle equal rows. Pure.
 */
export function compareFaceReviewRows(a: FaceReviewRow, b: FaceReviewRow, sort: FaceReviewSort): number {
  const ascending = sort.key === 'certainty' ? certaintyValue(a) - certaintyValue(b) : a.timestamp - b.timestamp
  const primary = sort.direction === 'desc' ? -ascending : ascending
  if (primary !== 0) return primary
  if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp
  if (a.faceId === b.faceId) return 0
  return a.faceId < b.faceId ? -1 : 1
}

export function sortFaceReviewRows(rows: readonly FaceReviewRow[], sort: FaceReviewSort): FaceReviewRow[] {
  return [...rows].sort((a, b) => compareFaceReviewRows(a, b, sort))
}

// ─────────────────────────────────────────────────────────────────────────
// Date
// ─────────────────────────────────────────────────────────────────────────

export interface FaceReviewDateBounds {
  readonly fromMs: number
  /** INCLUSIVE — the last millisecond of the day. */
  readonly toMs: number
}

/**
 * The `[fromMs, toMs]` window of the picked day (a local midnight — the
 * Library date control's calendar), or `null` for every day (no bound at all
 * — NOT a huge window, so a caller cannot accidentally clip anything). Local,
 * not UTC: the operator reasons in the timezone the cameras are in. Pure.
 */
export function faceReviewDayBounds(dayMs: number | null): FaceReviewDateBounds | null {
  return dayMs === null ? null : localDayBounds(dayMs)
}

// ─────────────────────────────────────────────────────────────────────────
// Filter state
// ─────────────────────────────────────────────────────────────────────────

export interface FaceReviewFilterState {
  /** Status chips. EMPTY means "nothing selected" and yields NO rows — an
   *  operator who unchecked everything asked for an empty page, not for
   *  everything. Unchanged from the behaviour the status chips already had
   *  before camera and date joined them. */
  readonly statuses: readonly FaceReviewStatus[]
  /** Selected cameras. EMPTY means every camera (the usual "no narrowing"
   *  convention, matching `ArtifactFilterState.deviceIds`). */
  readonly deviceIds: readonly number[]
  /** The picked day (a local midnight), or `null` for every day. */
  readonly dayMs: number | null
}

export const FACE_REVIEW_STATUSES: readonly FaceReviewStatus[] = ['assigned', 'suggested', 'unassigned']

/** Default: the two categories that still need a decision, every camera, no
 *  time bound. */
export const DEFAULT_FACE_REVIEW_FILTERS: FaceReviewFilterState = {
  statuses: ['suggested', 'unassigned'],
  deviceIds: [],
  dayMs: null,
}

export function toggleFaceReviewStatus(
  state: FaceReviewFilterState,
  status: FaceReviewStatus,
): FaceReviewFilterState {
  const statuses = state.statuses.includes(status)
    ? state.statuses.filter((s) => s !== status)
    : [...state.statuses, status]
  return { ...state, statuses }
}

export function toggleFaceReviewDevice(state: FaceReviewFilterState, deviceId: number): FaceReviewFilterState {
  const deviceIds = state.deviceIds.includes(deviceId)
    ? state.deviceIds.filter((d) => d !== deviceId)
    : [...state.deviceIds, deviceId]
  return { ...state, deviceIds }
}

export function setFaceReviewDay(state: FaceReviewFilterState, dayMs: number | null): FaceReviewFilterState {
  return { ...state, dayMs }
}

/** Narrowings ON TOP of the default — what the "clear" affordance would undo.
 *  A non-default status selection counts as one. Pure. */
export function activeFaceReviewFilterCount(state: FaceReviewFilterState): number {
  let count = 0
  if (state.deviceIds.length > 0) count += 1
  if (state.dayMs !== null) count += 1
  const defaults = DEFAULT_FACE_REVIEW_FILTERS.statuses
  const sameStatuses =
    state.statuses.length === defaults.length && defaults.every((s) => state.statuses.includes(s))
  if (!sameStatuses) count += 1
  return count
}

/**
 * Status ∧ camera ∧ date. Every predicate is an AND — an operator narrowing
 * twice expects fewer rows, never more. Pure.
 */
export function applyFaceReviewFilters(rows: readonly FaceReviewRow[], state: FaceReviewFilterState): FaceReviewRow[] {
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

/** The hub's `filter` value for a set of status chips, or `null` when no chip
 *  is on (nothing to ask for). `unassigned` covers suggested + unassigned (a
 *  suggestion is never an assignment); `identified` is every face holding an
 *  identity, manual assignments included. */
export type FaceReviewServerFilter = 'unassigned' | 'identified' | 'all'

export function faceReviewServerFilter(statuses: readonly FaceReviewStatus[]): FaceReviewServerFilter | null {
  if (statuses.length === 0) return null
  if (!statuses.includes('assigned')) return 'unassigned'
  return statuses.length === 1 ? 'identified' : 'all'
}

/** How many status chips the hub's filter for `statuses` already covers. */
const SERVER_FILTER_STATUS_COUNT: Readonly<Record<FaceReviewServerFilter, number>> = {
  unassigned: 2,
  identified: 1,
  all: 3,
}

/** The `listRecentFaces` input for the screen's filters and sort. */
export interface FaceReviewListInput {
  readonly filter: FaceReviewServerFilter
  readonly limit: number
  readonly includeCrops: false
  readonly sortBy: 'suggestionConfidence' | 'timestamp'
  readonly sortDirection: FaceReviewSortDirection
  readonly deviceIds?: readonly number[]
  readonly since?: number
  readonly until?: number
}

/**
 * What to ask the hub for, or `null` when the status chips select nothing.
 * Cameras and the day are sent only when narrowed: an absent
 * `deviceIds` is "every camera" on the wire, an empty one would be NOTHING.
 */
export function faceReviewListInput(
  state: FaceReviewFilterState,
  sort: FaceReviewSort,
  limit: number,
): FaceReviewListInput | null {
  const filter = faceReviewServerFilter(state.statuses)
  if (filter === null) return null
  const bounds = faceReviewDayBounds(state.dayMs)
  // Certainty is a SUGGESTION's score, and the hub sorts a row without one
  // last in both directions. Without the Suggested chip no wanted row has a
  // score, so a certainty order would queue every wanted row behind every
  // suggestion the client then cuts: ask for the newest instead.
  const byCertainty = sort.key === 'certainty' && state.statuses.includes('suggested')
  return {
    filter,
    limit,
    includeCrops: false,
    sortBy: byCertainty ? 'suggestionConfidence' : 'timestamp',
    sortDirection: byCertainty || sort.key === 'date' ? sort.direction : 'desc',
    ...(state.deviceIds.length > 0 ? { deviceIds: state.deviceIds } : {}),
    ...(bounds !== null ? { since: bounds.fromMs, until: bounds.toMs } : {}),
  }
}

/**
 * EVERY call the grid makes for its filters and sort — {@link faceReviewListInput}
 * first, then, under a certainty order that mixes Suggested with a chip whose
 * rows carry no score (Assigned, Unassigned), a second call for those chips
 * alone, newest first. The hub sorts a score-less row last in both directions,
 * so in one call they would sit behind every suggestion and a full page of
 * suggestions would show none of them. The rows are merged by face id
 * ({@link mergeFaceReviewPages}); the client order is applied after. Empty
 * when no chip is on.
 */
export function faceReviewListInputs(
  state: FaceReviewFilterState,
  sort: FaceReviewSort,
  limit: number,
): readonly FaceReviewListInput[] {
  const primary = faceReviewListInput(state, sort, limit)
  if (primary === null) return []
  if (primary.sortBy !== 'suggestionConfidence') return [primary]
  const scoreless = state.statuses.filter((status) => status !== 'suggested')
  const filter = scoreless.length === 0 ? null : scorelessServerFilter(scoreless)
  if (filter === null) return [primary]
  return [primary, { ...primary, filter, sortBy: 'timestamp', sortDirection: 'desc' }]
}

/** The hub filter for the score-less chips alone (Assigned and/or Unassigned). */
function scorelessServerFilter(statuses: readonly FaceReviewStatus[]): FaceReviewServerFilter {
  const assigned = statuses.includes('assigned')
  const unassigned = statuses.includes('unassigned')
  if (assigned && unassigned) return 'all'
  return assigned ? 'identified' : 'unassigned'
}

/** The pages of {@link faceReviewListInputs}, merged: each face once, first page's order first. */
export function mergeFaceReviewPages<T extends { readonly faceId: string }>(pages: readonly (readonly T[])[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const page of pages) {
    for (const face of page) {
      if (seen.has(face.faceId)) continue
      seen.add(face.faceId)
      out.push(face)
    }
  }
  return out
}

/**
 * TRUE when the status chips narrow below what the hub's filter returns — the
 * cut is made on the loaded rows, so while more pages exist the grid is "…among
 * the first N", not "all of them". Cameras and dates are server-side now and
 * never make the window partial. Pure.
 */
export function faceReviewWindowIsPartial(state: FaceReviewFilterState, hasMore: boolean): boolean {
  if (!hasMore) return false
  const filter = faceReviewServerFilter(state.statuses)
  return filter !== null && state.statuses.length < SERVER_FILTER_STATUS_COUNT[filter]
}

// ─────────────────────────────────────────────────────────────────────────
// Camera options
// ─────────────────────────────────────────────────────────────────────────

export interface FaceReviewCameraOption {
  readonly deviceId: number
  readonly name: string
}

/**
 * The camera chips, derived from the cameras that actually appear in the
 * LOADED rows — never the whole fleet (this app stopped asking for the fleet
 * on purpose; see `perf(events,devices)`). Built from the UNFILTERED rows so
 * that picking one camera does not make the others vanish from the chip row,
 * which would trap the operator in their own filter.
 *
 * A row whose camera name never resolved falls back to `#<deviceId>` rather
 * than being dropped: an unnamed camera is still a camera you may want to
 * filter to. Sorted by name for a stable chip order. Pure.
 */
export function faceReviewCameraOptions(rows: readonly FaceReviewRow[]): FaceReviewCameraOption[] {
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

// ─────────────────────────────────────────────────────────────────────────
// Multi-selection
// ─────────────────────────────────────────────────────────────────────────

/** Flip one face's membership. Always a NEW set — a mutated set would not
 *  re-render the grid. Pure. */
export function toggleFaceSelection(selected: ReadonlySet<string>, faceId: string): ReadonlySet<string> {
  const next = new Set(selected)
  if (next.has(faceId)) next.delete(faceId)
  else next.add(faceId)
  return next
}

/**
 * Drop selected ids that are no longer among `rows` — a filter change, an
 * assignment or a refetch can take a selected face off screen, and a count
 * that includes faces the operator can no longer see is the count lying.
 *
 * Returns the SAME set instance when nothing was dropped, so a caller can use
 * it in a `useMemo`/`useEffect` without looping. Pure.
 */
export function retainSelectedFaces(
  selected: ReadonlySet<string>,
  rows: readonly FaceReviewRow[],
): ReadonlySet<string> {
  if (selected.size === 0) return selected
  const visible = new Set(rows.map((r) => r.faceId))
  const kept = [...selected].filter((id) => visible.has(id))
  if (kept.length === selected.size) return selected
  return new Set(kept)
}

/** The selected rows IN THE ORDER THEY APPEAR on screen — the carousel pages
 *  must follow the grid the operator picked them from, not set iteration
 *  order. Pure. */
export function selectedFaceRows(
  rows: readonly FaceReviewRow[],
  selected: ReadonlySet<string>,
): FaceReviewRow[] {
  return rows.filter((r) => selected.has(r.faceId))
}
