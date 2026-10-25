/**
 * library-filters — what each Library page REMEMBERS of its filter bar, on
 * THIS install (operator, 2026-10-23: "the filters in the Library pages persist
 * on the device"). Pure and RN-free: the parsers and the stale-id pruning are
 * unit-tested in `__tests__/library-filters.spec.ts`; the storage is
 * `library-filter-store.ts`.
 *
 * Per section, one DEVICE-level document per hub (`<key>@<serverId>` — camera
 * ids are per hub). What persists and what deliberately does not:
 *
 *   section    persists                                  not persisted
 *   events     cameras, classes, Faces/Plates, the marks  the day, the search text
 *              (`events-filter-store`; parked rows stay an ACCOUNT setting)
 *   artifacts  cameras, kinds                             the day
 *   faces      cameras, status, the sort                  the day
 *   plates     cameras, status, the sort                  the day
 *   retrain    camera, collection                         —
 *
 * The DAY is never remembered: a picked day is a question about that day, and
 * a page that reopened tomorrow on yesterday (or, for Media, on "N days back"
 * from a different today) would show an answer to a question nobody asked.
 * Every page opens on its default day. What a TILE shows (the eye's switches)
 * is already an ACCOUNT setting (`settings.review`, `settings.events`).
 *
 * A stored value is parsed field by field: an unknown token is dropped, a
 * malformed field is its default, a malformed document is all defaults.
 */
import {
  DEFAULT_FACE_REVIEW_FILTERS,
  DEFAULT_FACE_REVIEW_SORT,
  FACE_REVIEW_SORT_KEYS,
  FACE_REVIEW_STATUSES,
  type FaceReviewSort,
  type FaceReviewSortDirection,
} from '../data/face-review-filters.js'
import type { FaceReviewStatus } from '../data/face-cluster-review.js'
import { LIBRARY_KIND_ORDER, type LibraryItemKind } from '../screens/artifacts/library-items.js'

/** The Library pages with a remembered filter bar besides Events (whose filter
 *  is `events-filter-store`'s). */
export type LibraryFilterSection = 'artifacts' | 'faces' | 'plates' | 'retrain'

export const LIBRARY_FILTER_SECTIONS: readonly LibraryFilterSection[] = ['artifacts', 'faces', 'plates', 'retrain']

// One base key per section, each stored per hub (`storage-levels.ts`, device).
export const ARTIFACTS_FILTER_STORAGE_KEY = 'camstack.v2.library-filter.artifacts'
export const FACES_FILTER_STORAGE_KEY = 'camstack.v2.library-filter.faces'
export const PLATES_FILTER_STORAGE_KEY = 'camstack.v2.library-filter.plates'
export const RETRAIN_FILTER_STORAGE_KEY = 'camstack.v2.library-filter.retrain'

export const LIBRARY_FILTER_STORAGE_KEYS: Readonly<Record<LibraryFilterSection, string>> = {
  artifacts: ARTIFACTS_FILTER_STORAGE_KEY,
  faces: FACES_FILTER_STORAGE_KEY,
  plates: PLATES_FILTER_STORAGE_KEY,
  retrain: RETRAIN_FILTER_STORAGE_KEY,
}

// ── Shapes ────────────────────────────────────────────────────────────────────

/** Media (artifacts): the remembered half of `ArtifactFilterState`. */
export interface ArtifactsRemembered {
  readonly kinds: readonly LibraryItemKind[]
  readonly deviceIds: readonly number[]
}

/** People and Plates: the remembered half of `FaceReviewFilterState`, plus the sort. */
export interface ReviewRemembered {
  readonly statuses: readonly FaceReviewStatus[]
  readonly deviceIds: readonly number[]
  readonly sort: FaceReviewSort
}

/** Retrain: one camera, one collection, each `null` for "all". */
export interface RetrainRemembered {
  readonly deviceId: number | null
  readonly collectionId: string | null
}

export const ARTIFACTS_REMEMBERED_DEFAULTS: ArtifactsRemembered = Object.freeze({ kinds: [], deviceIds: [] })

export const REVIEW_REMEMBERED_DEFAULTS: ReviewRemembered = Object.freeze({
  statuses: DEFAULT_FACE_REVIEW_FILTERS.statuses,
  deviceIds: DEFAULT_FACE_REVIEW_FILTERS.deviceIds,
  sort: DEFAULT_FACE_REVIEW_SORT,
})

export const RETRAIN_REMEMBERED_DEFAULTS: RetrainRemembered = Object.freeze({ deviceId: null, collectionId: null })

// ── Parsers ───────────────────────────────────────────────────────────────────

function isRecord(raw: unknown): raw is Readonly<Record<string, unknown>> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw)
}

function cameraIds(raw: unknown): readonly number[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((v): v is number => typeof v === 'number' && Number.isInteger(v)))]
}

/** Members of `vocabulary` only, in stored order, deduplicated. */
function tokens<T extends string>(raw: unknown, vocabulary: readonly T[]): readonly T[] {
  if (!Array.isArray(raw)) return []
  const out: T[] = []
  for (const v of raw) {
    const known = vocabulary.find((token) => token === v)
    if (known !== undefined && !out.includes(known)) out.push(known)
  }
  return out
}

const SORT_DIRECTIONS: readonly FaceReviewSortDirection[] = ['desc', 'asc']

function parseSort(raw: unknown): FaceReviewSort {
  if (!isRecord(raw)) return DEFAULT_FACE_REVIEW_SORT
  const key = FACE_REVIEW_SORT_KEYS.find((k) => k === raw['key'])
  const direction = SORT_DIRECTIONS.find((d) => d === raw['direction'])
  if (key === undefined || direction === undefined) return DEFAULT_FACE_REVIEW_SORT
  return { key, direction }
}

export function parseArtifactsRemembered(raw: unknown): ArtifactsRemembered {
  if (!isRecord(raw)) return ARTIFACTS_REMEMBERED_DEFAULTS
  return { kinds: tokens(raw['kinds'], LIBRARY_KIND_ORDER), deviceIds: cameraIds(raw['deviceIds']) }
}

export function parseReviewRemembered(raw: unknown): ReviewRemembered {
  if (!isRecord(raw)) return REVIEW_REMEMBERED_DEFAULTS
  return {
    // An EMPTY stored list is the operator's own (empty) selection and is kept;
    // only an absent or malformed one is the default.
    statuses: Array.isArray(raw['statuses'])
      ? tokens(raw['statuses'], FACE_REVIEW_STATUSES)
      : REVIEW_REMEMBERED_DEFAULTS.statuses,
    deviceIds: cameraIds(raw['deviceIds']),
    sort: parseSort(raw['sort']),
  }
}

export function parseRetrainRemembered(raw: unknown): RetrainRemembered {
  if (!isRecord(raw)) return RETRAIN_REMEMBERED_DEFAULTS
  const deviceId = raw['deviceId']
  const collectionId = raw['collectionId']
  return {
    deviceId: typeof deviceId === 'number' && Number.isInteger(deviceId) ? deviceId : null,
    collectionId: typeof collectionId === 'string' && collectionId.length > 0 ? collectionId : null,
  }
}

// ── Stale ids ─────────────────────────────────────────────────────────────────

/**
 * The ids that still exist. `known === undefined` means the list has NOT
 * answered yet, and then nothing is dropped — an unanswered query is not an
 * empty one, and pruning against it would wipe every remembered camera on a
 * cold start. Returns the SAME array when nothing was dropped, so a caller can
 * compare by reference.
 */
export function pruneKnownIds<T>(ids: readonly T[], known: ReadonlySet<T> | undefined): readonly T[] {
  if (known === undefined || ids.every((id) => known.has(id))) return ids
  return ids.filter((id) => known.has(id))
}

/** A single remembered id that no longer exists becomes `null` ("all"). */
export function pruneKnownId<T>(id: T | null, known: ReadonlySet<T> | undefined): T | null {
  if (id === null || known === undefined) return id
  return known.has(id) ? id : null
}

export function pruneArtifactsRemembered(
  value: ArtifactsRemembered,
  knownCameras: ReadonlySet<number> | undefined,
): ArtifactsRemembered {
  const deviceIds = pruneKnownIds(value.deviceIds, knownCameras)
  return deviceIds === value.deviceIds ? value : { ...value, deviceIds }
}

export function pruneReviewRemembered(
  value: ReviewRemembered,
  knownCameras: ReadonlySet<number> | undefined,
): ReviewRemembered {
  const deviceIds = pruneKnownIds(value.deviceIds, knownCameras)
  return deviceIds === value.deviceIds ? value : { ...value, deviceIds }
}

export function pruneRetrainRemembered(
  value: RetrainRemembered,
  knownCameras: ReadonlySet<number> | undefined,
  knownCollections: ReadonlySet<string> | undefined,
): RetrainRemembered {
  const deviceId = pruneKnownId(value.deviceId, knownCameras)
  const collectionId = pruneKnownId(value.collectionId, knownCollections)
  return deviceId === value.deviceId && collectionId === value.collectionId ? value : { deviceId, collectionId }
}
