/**
 * artifact-filters — the artifacts gallery's filter STATE, factored out as a
 * pure (RN-free) module so the state→wire mapping is unit-testable in the repo's
 * node environment. The screen owns a `ArtifactFilterState` and derives the
 * query's {@link NcArtifactFilters} from it through {@link toArtifactFilters}.
 *
 * The surface matches Events: a day cursor + kind chips + camera multiselect.
 * Poster kinds (`timelapse-preview`, `event-still`) are never a chip — they
 * are the thumbnail of a video/gif tile, not a gallery row.
 *
 * Every transition returns a NEW state — nothing here mutates, so a render that
 * reads the previous value cannot see a half-applied change.
 */
import {
  NC_GALLERY_ARTIFACT_KINDS,
  type NcArtifactFilters,
  type NcArtifactKind,
} from '../../data/nc-artifacts.js'
import {
  LIBRARY_KIND_ORDER,
  artifactKindsOf,
  type LibraryFilterCriteria,
  type LibraryItemKind,
} from './library-items.js'

const DAY_MS = 86_400_000

/** What the operator has narrowed the gallery to. */
export interface ArtifactFilterState {
  /** Selected Type chips — artifact kinds AND `export`, because the gallery is
   *  one list of both. EMPTY means every kind. */
  readonly kinds: readonly LibraryItemKind[]
  /** Selected cameras. EMPTY means every camera. */
  readonly deviceIds: readonly number[]
  /** 0 = today; N = N local calendar days back. Same cursor Events uses. */
  readonly dayOffset: number
}

/** The unfiltered gallery — what the screen opens on. */
export const EMPTY_ARTIFACT_FILTERS: ArtifactFilterState = {
  kinds: [],
  deviceIds: [],
  dayOffset: 0,
}

/** The ARTIFACT half of the chip row — gallery tiles only, never posters. The
 *  row the operator actually sees is {@link LIBRARY_KIND_ORDER}, which appends
 *  `export`. */
export const ARTIFACT_KIND_ORDER: readonly NcArtifactKind[] = NC_GALLERY_ARTIFACT_KINDS

/** Every Type chip the merged gallery offers. Re-exported so the filter UI has
 *  one import for the whole filter contract. */
export { LIBRARY_KIND_ORDER }

/**
 * Local-midnight bounds for the day under the cursor.
 *
 * Inclusive on both ends so a `capturedAt` exactly on midnight tomorrow is the
 * NEXT day's row, not this one's.
 */
export function artifactDayBounds(
  dayOffset: number,
  nowMs: number,
): { readonly fromMs: number; readonly toMs: number } {
  const start = new Date(nowMs)
  start.setHours(0, 0, 0, 0)
  const fromMs = start.getTime() - dayOffset * DAY_MS
  return { fromMs, toMs: fromMs + DAY_MS - 1 }
}

/**
 * State → wire filters.
 *
 * An empty kind selection is omitted: the hub's unfiltered list already drops
 * poster kinds. An empty camera list is omitted for the same "no chip = all"
 * reason. The day cursor ALWAYS sends a window — Events is a day feed, and
 * this gallery is too.
 */
export function toArtifactFilters(state: ArtifactFilterState, nowMs: number): NcArtifactFilters {
  const { fromMs, toMs } = artifactDayBounds(state.dayOffset, nowMs)
  // `export` is not an artifact kind and must never reach the wire. The SOURCE
  // gate is `wantsArtifacts`: a selection of nothing but `export` leaves this
  // subset empty, and an empty subset is omitted — which the hub reads as "every
  // kind", not "none".
  const kinds = artifactKindsOf(state.kinds)
  return {
    ...(kinds.length > 0 ? { kinds } : {}),
    ...(state.deviceIds.length > 0 ? { deviceIds: state.deviceIds } : {}),
    fromMs,
    toMs,
  }
}

/** Add/remove one kind. Returns a new state. */
export function toggleArtifactKind(
  state: ArtifactFilterState,
  kind: LibraryItemKind,
): ArtifactFilterState {
  const selected = state.kinds.includes(kind)
  return {
    ...state,
    kinds: selected ? state.kinds.filter((k) => k !== kind) : [...state.kinds, kind],
  }
}

/** Add/remove one camera. Returns a new state. */
export function toggleArtifactDevice(
  state: ArtifactFilterState,
  deviceId: number,
): ArtifactFilterState {
  const selected = state.deviceIds.includes(deviceId)
  return {
    ...state,
    deviceIds: selected
      ? state.deviceIds.filter((id) => id !== deviceId)
      : [...state.deviceIds, deviceId],
  }
}

/** Set the day cursor. Returns a new state. */
export function setArtifactDayOffset(
  state: ArtifactFilterState,
  dayOffset: number,
): ArtifactFilterState {
  return { ...state, dayOffset: Math.max(0, Math.round(dayOffset)) }
}

/** Clear everything back to {@link EMPTY_ARTIFACT_FILTERS}. */
export function clearArtifactFilters(): ArtifactFilterState {
  return EMPTY_ARTIFACT_FILTERS
}

/**
 * How many filters are ACTIVE — the badge on the Filters chip.
 *
 * The day cursor is navigation, not a filter (same as Events). Each list
 * counts as one regardless of how many members it has.
 */
export function activeArtifactFilterCount(state: ArtifactFilterState): number {
  return (state.kinds.length > 0 ? 1 : 0) + (state.deviceIds.length > 0 ? 1 : 0)
}

/**
 * Snap `now` to a bucket so the derived day bounds stay stable across renders
 * that straddle a clock tick but not midnight.
 */
export const ARTIFACT_RANGE_BUCKET_MS = 30_000

/** Snap an epoch down to the {@link ARTIFACT_RANGE_BUCKET_MS} grid. */
export function bucketArtifactNow(nowMs: number): number {
  return Math.floor(nowMs / ARTIFACT_RANGE_BUCKET_MS) * ARTIFACT_RANGE_BUCKET_MS
}

/**
 * State → the criteria BOTH halves of the merged list are judged by.
 *
 * The artifact half is narrowed twice — once on the hub through
 * {@link toArtifactFilters} and again here — and that is deliberate: the
 * predicate is the same for both sources, so a row can never survive in the list
 * on the grounds that its source happened to be filtered somewhere else.
 */
export function toLibraryCriteria(state: ArtifactFilterState, nowMs: number): LibraryFilterCriteria {
  const { fromMs, toMs } = artifactDayBounds(state.dayOffset, nowMs)
  return { kinds: state.kinds, deviceIds: state.deviceIds, fromMs, toMs }
}
