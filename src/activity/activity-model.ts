/**
 * activity-model — the Activity centre's list, as pure functions.
 *
 * The Activity centre is "what this DEVICE asked for and may want to collect":
 * exports it queued on the hub, snapshots it cut from the player. It is a
 * per-server, per-install list (a second phone has its own), so nothing here
 * is a fact about the hub — the hub only answers, through `reconcileExports`,
 * how far each export it was asked for has come.
 *
 * Every function is pure and immutable (the store is glue): the list is small
 * (capped), but the rules — what survives a restart, what a hub answer may and
 * may not erase — are the part worth pinning with specs.
 *
 * ## Local jobs
 *
 * Besides the two kinds of file, the list holds `job` items: long actions this
 * device runs ONE AFTER ANOTHER (a face recompute, a batch assignment). A job
 * is metadata here — the function that runs it lives in memory, in the store —
 * so a job still `queued` or `running` when the app was closed can never
 * resume: it is read back as failed / interrupted, never silently lost.
 *
 * ## What a hub answer may NOT do
 *
 * An export missing from the hub's list is left exactly as it was. The list
 * query degrades to `[]` when the capability is unreachable, so absence from it
 * is not evidence the export is gone (the same rule `recordingKnownAt` keeps:
 * an unread window is unknown, never empty). Only an explicit `deleted` /
 * `expired` state moves an item there, and such an item is dropped once the
 * operator has SEEN it that way.
 */
import type { ExportRecord, ExportState } from '../data/use-exports.js'

/** How many items one server's list keeps; the oldest are pruned past it. */
export const ACTIVITY_CAP = 50

export interface ActivityBase {
  /** Unique within a server's list (`export:<hubId>` / `snapshot:<uuid>` / `job:<id>`). */
  readonly id: string
  readonly createdAt: number
  /**
   * The operator has looked at this item in its CURRENT state. A transition to
   * a finished state clears it, which is what lights the "ready" dot.
   */
  readonly seen: boolean
}

/** An item about one camera's footage (an export, a snapshot). */
export interface CameraActivityBase extends ActivityBase {
  readonly deviceId: number
  readonly cameraName: string
}

export interface ExportActivityItem extends CameraActivityBase {
  readonly kind: 'export'
  readonly exportId: string
  readonly fromMs: number
  readonly toMs: number
  readonly state: ExportState
  /** 0..100 from the hub, `null` where no real fraction exists (never `0`). */
  readonly progressPct: number | null
  readonly error: string | null
}

export interface SnapshotActivityItem extends CameraActivityBase {
  readonly kind: 'snapshot'
  /** The instant the frame shows (epoch ms): the playhead, or now when live. */
  readonly atMs: number
  /** `file://` URI in the app cache (a data URL on the web). */
  readonly fileUri: string
  readonly mime: string
}

/** The long actions the queue knows how to run (picks the row's icon). */
export type JobKind =
  | 'face-rescore'
  | 'face-assign'
  | 'face-apply-suggestions'
  | 'face-analyze-assign'
  | 'face-delete'
  | 'plate-assign'
  | 'plate-apply-suggestions'
  | 'plate-delete'

export type JobState = 'queued' | 'running' | 'done' | 'failed'

/** How far a running job is, in its own units (faces, groups). */
export interface JobProgress {
  readonly done: number
  readonly total: number
}

/** A long action this device runs from the local queue. */
export interface JobActivityItem extends ActivityBase {
  readonly kind: 'job'
  readonly jobKind: JobKind
  /** Already translated: what the operator asked for. */
  readonly title: string
  readonly state: JobState
  /** `null` where the job reports no fraction (never `0`). */
  readonly progress: JobProgress | null
  readonly startedAt: number | null
  readonly finishedAt: number | null
  /** Already translated one-line outcome of a `done` job. */
  readonly summary: string | null
  /** Why a `failed` job failed; `null` for an interrupted one (see below). */
  readonly error: string | null
  /** The app closed while the job was queued or running. */
  readonly interrupted: boolean
  /** The operator cleared it: kept as history, hidden from the list. */
  readonly dismissed: boolean
}

export type AppUpdateState = 'checking' | 'downloading' | 'ready' | 'failed'

/**
 * The app's own update (an OTA), as an Activity row. A fact about THIS launch
 * of THIS device: never persisted, never read back as interrupted, and it
 * follows the operator across servers. One item at most, id `app-update`.
 */
export interface AppUpdateActivityItem extends ActivityBase {
  readonly kind: 'app-update'
  readonly state: AppUpdateState
  /** 0..1 while downloading; `null` where none is known (never `0`). */
  readonly progress: number | null
  readonly version: string | null
  readonly error: string | null
  /** "Later": hidden until the update changes state. */
  readonly dismissed: boolean
}

/** What the update source reports; the model turns it into the item. */
export interface AppUpdateDraft {
  readonly state: AppUpdateState
  readonly progress: number | null
  readonly version: string | null
  readonly error: string | null
}

export const APP_UPDATE_ID = 'app-update'

export type ActivityItem =
  | ExportActivityItem
  | SnapshotActivityItem
  | JobActivityItem
  | AppUpdateActivityItem

export type ActivityList = readonly ActivityItem[]

/** An export being produced, or a job queued / running. */
export function isRunning(item: ActivityItem): boolean {
  if (item.kind === 'job') return item.state === 'queued' || item.state === 'running'
  if (item.kind === 'app-update') return item.state === 'checking' || item.state === 'downloading'
  return item.kind === 'export' && (item.state === 'queued' || item.state === 'rendering')
}

/** A finished item the operator can act on or must hear about. */
export function isFinished(item: ActivityItem): boolean {
  if (item.kind === 'job') return item.state === 'done' || item.state === 'failed'
  if (item.kind === 'app-update') return item.state === 'ready' || item.state === 'failed'
  return item.kind === 'snapshot' || item.state === 'ready' || item.state === 'failed'
}

/** The items the list shows: a dismissed job is history, not a row. */
export function isListed(item: ActivityItem): boolean {
  return (item.kind !== 'job' && item.kind !== 'app-update') || !item.dismissed
}

/**
 * Whether the Activity icon belongs in the top bar: there is something not yet
 * dismissed (running, queued, or finished and not cleared).
 */
export function hasUndismissedItems(list: ActivityList): boolean {
  return list.some(isListed)
}

function isLiveJob(item: ActivityItem): boolean {
  if (item.kind === 'app-update') return true
  return item.kind === 'job' && (item.state === 'queued' || item.state === 'running')
}

/**
 * Newest first, capped. A queued or running JOB is never pruned for room (its
 * function is still waiting to run): the oldest other items go first. Equal
 * timestamps keep their relative order.
 */
function normalise(items: readonly ActivityItem[]): ActivityList {
  const newestFirst = (a: ActivityItem, b: ActivityItem): number => b.createdAt - a.createdAt
  const sorted = [...items].sort(newestFirst)
  if (sorted.length <= ACTIVITY_CAP) return sorted
  const live = sorted.filter(isLiveJob)
  const room = Math.max(0, ACTIVITY_CAP - live.length)
  const rest = sorted.filter((item) => !isLiveJob(item)).slice(0, room)
  return [...live, ...rest].sort(newestFirst)
}

/** Add one item (replacing any with the same id), newest first, pruned. */
export function addItem(list: ActivityList, item: ActivityItem): ActivityList {
  return normalise([item, ...list.filter((existing) => existing.id !== item.id)])
}

export function removeItem(list: ActivityList, id: string): ActivityList {
  return list.filter((item) => item.id !== id)
}

/**
 * The operator opened the list: every item is seen in its present state, and an
 * export the hub already called deleted/expired was SHOWN that way, so it goes.
 *
 * Called on opening — the items they just looked at are exactly the ones whose
 * dot clears; a later transition clears `seen` again.
 */
export function markAllSeen(list: ActivityList): ActivityList {
  return list.map((item) => (item.seen ? item : { ...item, seen: true }))
}

/** Drop what the hub retired AND the operator has already seen retired. */
export function dropRetiredSeen(list: ActivityList): ActivityList {
  return list.filter((item) => !(isRetired(item) && item.seen))
}

function isRetired(item: ActivityItem): boolean {
  return item.kind === 'export' && (item.state === 'deleted' || item.state === 'expired')
}

/** Fold the hub's answer for one export into its item. */
function applyRecord(item: ExportActivityItem, record: ExportRecord): ExportActivityItem {
  const stateChanged = record.state !== item.state
  // A transition into something worth looking at (done, failed, retired)
  // re-arms the dot; progress ticks within the same state never do.
  const arrived = stateChanged && !isRunningState(record.state)
  return {
    ...item,
    state: record.state,
    progressPct: isRunningState(record.state) ? record.progressPct : null,
    error: record.state === 'failed' ? (record.error ?? item.error) : null,
    seen: arrived ? false : item.seen,
  }
}

function isRunningState(state: ExportState): boolean {
  return state === 'queued' || state === 'rendering'
}

/**
 * Reconcile the exports in the list with what the hub reports.
 *
 * `records` are matched by export id. Items with no matching record are left
 * untouched (see the module note). Returns the SAME array when nothing changed
 * so the store does not notify on every poll.
 */
export function reconcileExports(
  list: ActivityList,
  records: readonly ExportRecord[],
): ActivityList {
  if (records.length === 0) return list
  const byId = new Map(records.map((record) => [record.id, record]))
  let changed = false
  const next = list.map((item) => {
    if (item.kind !== 'export') return item
    const record = byId.get(item.exportId)
    if (record === undefined) return item
    const merged = applyRecord(item, record)
    if (
      merged.state === item.state &&
      merged.progressPct === item.progressPct &&
      merged.error === item.error
    ) {
      return item
    }
    changed = true
    return merged
  })
  return changed ? next : list
}

/** Overall progress of the running exports: mean of the known fractions. */
export type OverallProgress =
  | { readonly kind: 'idle' }
  | { readonly kind: 'indeterminate'; readonly running: number }
  | { readonly kind: 'known'; readonly running: number; readonly fraction: number }

export function overallProgress(list: ActivityList): OverallProgress {
  const running = list.filter(isRunning)
  if (running.length === 0) return { kind: 'idle' }
  const known = running.flatMap((item) => {
    if (item.kind === 'export') return item.progressPct !== null ? [item.progressPct] : []
    if (item.kind === 'job' && item.progress !== null && item.progress.total > 0) {
      return [(item.progress.done / item.progress.total) * 100]
    }
    if (item.kind === 'app-update' && item.progress !== null) return [item.progress * 100]
    return []
  })
  if (known.length === 0) return { kind: 'indeterminate', running: running.length }
  const mean = known.reduce((sum, pct) => sum + pct, 0) / known.length
  return { kind: 'known', running: running.length, fraction: Math.min(1, Math.max(0, mean / 100)) }
}

/** Finished items the operator has not opened since they finished. */
export function unseenFinishedCount(list: ActivityList): number {
  return list.filter((item) => isListed(item) && isFinished(item) && !item.seen).length
}

// ── Persistence ──────────────────────────────────────────────────────────────

/** The storage key of one server's list. */
export function activityStorageKey(serverId: string): string {
  return `camstack.activity.v1.${serverId}`
}

/** The list as stored. The app update is not in it: it is not about this server's history. */
export function serializeActivity(list: ActivityList): string {
  return JSON.stringify(list.filter((item) => item.kind !== 'app-update'))
}

function isExportState(v: string): v is ExportState {
  return (
    v === 'queued' ||
    v === 'rendering' ||
    v === 'ready' ||
    v === 'failed' ||
    v === 'expired' ||
    v === 'deleted'
  )
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

const JOB_KINDS: readonly string[] = [
  'face-rescore',
  'face-assign',
  'face-apply-suggestions',
  'face-analyze-assign',
  'face-delete',
  'plate-assign',
  'plate-apply-suggestions',
  'plate-delete',
]
const JOB_STATES: readonly string[] = ['queued', 'running', 'done', 'failed']

function isJobKind(v: string): v is JobKind {
  return JOB_KINDS.includes(v)
}

function isJobState(v: string): v is JobState {
  return JOB_STATES.includes(v)
}

function numberOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}

function stringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function parseProgress(raw: unknown): JobProgress | null {
  if (!isObject(raw)) return null
  const { done, total } = raw
  return typeof done === 'number' && typeof total === 'number' ? { done, total } : null
}

function parseJob(raw: Record<string, unknown>, base: ActivityBase): JobActivityItem | null {
  const { jobKind, title, state } = raw
  if (typeof jobKind !== 'string' || !isJobKind(jobKind)) return null
  if (typeof title !== 'string' || typeof state !== 'string' || !isJobState(state)) return null
  return {
    ...base,
    kind: 'job',
    jobKind,
    title,
    state,
    progress: parseProgress(raw['progress']),
    startedAt: numberOrNull(raw['startedAt']),
    finishedAt: numberOrNull(raw['finishedAt']),
    summary: stringOrNull(raw['summary']),
    error: stringOrNull(raw['error']),
    interrupted: raw['interrupted'] === true,
    dismissed: raw['dismissed'] === true,
  }
}

function parseItem(raw: unknown): ActivityItem | null {
  if (!isObject(raw)) return null
  const { id, kind, createdAt, deviceId, cameraName, seen } = raw
  if (typeof id !== 'string' || typeof createdAt !== 'number') return null
  const base = { id, createdAt, seen: seen === true }
  if (kind === 'job') return parseJob(raw, base)
  if (typeof deviceId !== 'number' || typeof cameraName !== 'string') return null
  const cameraBase = { ...base, deviceId, cameraName }
  if (kind === 'export') {
    const { exportId, fromMs, toMs, state, progressPct, error } = raw
    if (typeof exportId !== 'string' || typeof fromMs !== 'number' || typeof toMs !== 'number') {
      return null
    }
    if (typeof state !== 'string' || !isExportState(state)) return null
    return {
      ...cameraBase,
      kind: 'export',
      exportId,
      fromMs,
      toMs,
      state,
      progressPct: typeof progressPct === 'number' ? progressPct : null,
      error: typeof error === 'string' ? error : null,
    }
  }
  if (kind === 'snapshot') {
    const { atMs, fileUri, mime } = raw
    if (typeof atMs !== 'number' || typeof fileUri !== 'string' || typeof mime !== 'string') {
      return null
    }
    // A web blob URL dies with the page that made it: keeping it would show a
    // row whose Download can only fail.
    if (fileUri.startsWith('blob:')) return null
    return { ...cameraBase, kind: 'snapshot', atMs, fileUri, mime }
  }
  return null
}

/** A persisted list. Anything unreadable is an empty list, never a throw. */
export function parseActivity(raw: string | null): ActivityList {
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return normalise(parsed.flatMap((entry) => parseItem(entry) ?? []))
  } catch {
    return []
  }
}

// ── Construction ─────────────────────────────────────────────────────────────

/** The item for an export the hub just queued for this device. */
export function exportItemFrom(
  record: ExportRecord,
  cameraName: string,
  now: number,
): ExportActivityItem {
  return {
    kind: 'export',
    id: `export:${record.id}`,
    exportId: record.id,
    createdAt: now,
    deviceId: record.deviceId,
    cameraName,
    fromMs: record.fromMs,
    toMs: record.toMs,
    state: record.state,
    progressPct: isRunningState(record.state) ? record.progressPct : null,
    error: record.error,
    seen: false,
  }
}

export interface SnapshotItemInput {
  readonly uid: string
  readonly deviceId: number
  readonly cameraName: string
  readonly atMs: number
  readonly fileUri: string
  readonly mime: string
  readonly now: number
}

/**
 * The item for a frame cut from the player. Ready on arrival, and `seen`: the
 * operator is looking at the notice that announces it, so a "ready" dot would
 * claim news they already have.
 */
export function snapshotItemFrom(input: SnapshotItemInput): SnapshotActivityItem {
  return {
    kind: 'snapshot',
    id: `snapshot:${input.uid}`,
    createdAt: input.now,
    deviceId: input.deviceId,
    cameraName: input.cameraName,
    atMs: input.atMs,
    fileUri: input.fileUri,
    mime: input.mime,
    seen: true,
  }
}

/**
 * Fold what the update source reports into the list: `null` removes the item.
 * A tick within the same state keeps its place and its "later"; a new state
 * is news again (visible, unseen).
 */
export function upsertAppUpdate(
  list: ActivityList,
  draft: AppUpdateDraft | null,
  now: number,
): ActivityList {
  const rest = list.filter((item) => item.kind !== 'app-update')
  if (draft === null) return rest.length === list.length ? list : rest
  const existing = list.find((item) => item.kind === 'app-update')
  const same = existing?.kind === 'app-update' && existing.state === draft.state
  const next: AppUpdateActivityItem = {
    kind: 'app-update',
    id: APP_UPDATE_ID,
    createdAt: same ? existing.createdAt : now,
    seen: same ? existing.seen : !isFinished({ ...BLANK_UPDATE, state: draft.state }),
    state: draft.state,
    progress: draft.progress,
    version: draft.version,
    error: draft.error,
    dismissed: same ? existing.dismissed : false,
  }
  if (same && sameUpdate(existing, next)) return list
  return normalise([next, ...rest])
}

const BLANK_UPDATE: AppUpdateActivityItem = {
  kind: 'app-update',
  id: APP_UPDATE_ID,
  createdAt: 0,
  seen: true,
  state: 'checking',
  progress: null,
  version: null,
  error: null,
  dismissed: false,
}

function sameUpdate(a: AppUpdateActivityItem, b: AppUpdateActivityItem): boolean {
  return a.progress === b.progress && a.version === b.version && a.error === b.error
}

/** "Later": hide the update row until it changes state. */
export function dismissAppUpdate(list: ActivityList): ActivityList {
  const item = list.find((entry) => entry.kind === 'app-update')
  if (item === undefined || item.kind !== 'app-update' || item.dismissed) return list
  return list.map((entry) => (entry === item ? { ...item, dismissed: true } : entry))
}
