/**
 * hub-jobs-model — the hub's jobs ledger (`jobs.list` / `jobs.getSummary`) as
 * rows of the Activity list, as pure functions.
 *
 * Hub jobs are NOT kept in the device's persisted Activity list: the hub is the
 * authority for them, so they are read, merged for display and forgotten. What
 * this module pins:
 *
 * - **Unknown is not empty.** A hub list that did not answer is `null`, and the
 *   merge shows the device's own items only; it never reads as "no hub jobs".
 *   A summary whose `unseenFinished` is `null` counts nothing there and never
 *   throws (the admin shell crashed on exactly that).
 * - **One row per piece of work.** An export the hub also reports as a job is
 *   shown once, as the hub job (it wins), matched by the export's hub id.
 * - **One order.** Running first, then queued (oldest first, the order they
 *   run), then everything else newest first — the order the device's own list
 *   already used, with hub jobs placed by their creation time.
 */
import type { JobState } from '@camstack/types'

import {
  combineProgress,
  isListed,
  isRunning,
  knownPercents,
  type ActivityItem,
  type ActivityList,
  type OverallProgress,
} from './activity-model.js'

/** The entity kind under which a producer reports a recording export. */
export const EXPORT_ENTITY_KIND = 'export'

const JOB_STATES: readonly JobState[] = ['queued', 'running', 'done', 'failed', 'cancelled']

export interface HubJobProgress {
  readonly done: number
  /** `null` = unknown (never `0`). */
  readonly total: number | null
  readonly unit: string
}

/** One job of the hub's ledger, as the Activity list draws it. */
export interface HubJobItem {
  readonly kind: 'hub-job'
  /** `hub:<jobId>`: never collides with a device item id. */
  readonly id: string
  readonly jobId: string
  /** The producer's job kind (`adoption`…); labels the row when no title key is known. */
  readonly jobKind: string
  readonly titleKey: string
  readonly titleParams: Readonly<Record<string, string | number>>
  readonly state: JobState
  readonly failureMessage: string | null
  readonly progress: HubJobProgress | null
  readonly cancellable: boolean
  readonly createdAt: number
  /** The hub export this job is about, when it is one. */
  readonly exportId: string | null
}

export type DisplayItem = ActivityItem | HubJobItem

/** `jobs.getSummary`, validated. */
export interface HubJobsSummary {
  readonly running: number
  /** `null` = could not be measured. */
  readonly unseenFinished: number | null
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function isJobState(v: unknown): v is JobState {
  return typeof v === 'string' && JOB_STATES.some((state) => state === v)
}

function parseParams(raw: unknown): Readonly<Record<string, string | number>> {
  if (!isObject(raw)) return {}
  const out: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' || typeof value === 'number') out[key] = value
  }
  return out
}

function parseProgress(raw: unknown): HubJobProgress | null {
  if (!isObject(raw) || typeof raw['done'] !== 'number') return null
  const total = raw['total']
  return {
    done: raw['done'],
    total: typeof total === 'number' ? total : null,
    unit: typeof raw['unit'] === 'string' ? raw['unit'] : '',
  }
}

function exportIdFrom(subject: unknown): string | null {
  if (!isObject(subject) || !isObject(subject['entity'])) return null
  const { kind, id } = subject['entity']
  return kind === EXPORT_ENTITY_KIND && typeof id === 'string' ? id : null
}

/** One `jobs.list` entry; anything unreadable is dropped, never guessed at. */
export function parseHubJob(raw: unknown): HubJobItem | null {
  if (!isObject(raw)) return null
  const { jobId, kind, titleKey, state, createdAt } = raw
  if (typeof jobId !== 'string' || typeof kind !== 'string' || !isJobState(state)) return null
  if (typeof createdAt !== 'number') return null
  const failure = raw['failure']
  return {
    kind: 'hub-job',
    id: `hub:${jobId}`,
    jobId,
    jobKind: kind,
    titleKey: typeof titleKey === 'string' ? titleKey : '',
    titleParams: parseParams(raw['titleParams']),
    state,
    failureMessage: isObject(failure) && typeof failure['message'] === 'string' ? failure['message'] : null,
    progress: parseProgress(raw['progress']),
    cancellable: raw['cancellable'] === true,
    createdAt,
    exportId: exportIdFrom(raw['subject']),
  }
}

/**
 * The jobs of a `jobs.list` answer. `null` — the query did not answer, or the
 * answer is not a list — stays `null`: unknown, never an empty list.
 */
export function parseHubJobs(raw: unknown): readonly HubJobItem[] | null {
  if (!Array.isArray(raw)) return null
  return raw.flatMap((entry) => parseHubJob(entry) ?? [])
}

/** A summary answer; anything unreadable is unknown (`null`), not zero. */
export function parseHubSummary(raw: unknown): HubJobsSummary | null {
  if (!isObject(raw) || typeof raw['running'] !== 'number') return null
  const unseen = raw['unseenFinished']
  return { running: raw['running'], unseenFinished: typeof unseen === 'number' ? unseen : null }
}

export function isHubJobActive(job: HubJobItem): boolean {
  return job.state === 'queued' || job.state === 'running'
}

/** 0–100, or `null` where the job reports no real fraction (indeterminate). */
export function hubProgressPercent(job: HubJobItem): number | null {
  const progress = job.progress
  if (progress === null || progress.total === null || progress.total <= 0) return null
  return Math.round(Math.min(100, Math.max(0, (progress.done / progress.total) * 100)))
}

/** "3/10" for a running job with a known total, "3" with an unknown one, else `null`. */
export function hubCountLabel(job: HubJobItem): string | null {
  const progress = job.progress
  if (job.state !== 'running' || progress === null) return null
  if (progress.total === null || progress.total <= 0) return String(progress.done)
  return `${String(progress.done)}/${String(progress.total)}`
}

/** What the row's X does: stop a running job that allows it, hide a finished one, nothing otherwise. */
export type HubJobClear = 'cancel' | 'dismiss' | null

export function hubJobClear(job: HubJobItem): HubJobClear {
  if (isHubJobActive(job)) return job.cancellable ? 'cancel' : null
  return 'dismiss'
}

type CancelReason =
  | 'not-found'
  | 'not-cancellable'
  | 'terminal'
  | 'not-allowed'
  | 'producer-refused'
  | 'producer-unreachable'

const CANCEL_REFUSAL: Readonly<Record<CancelReason, string>> = {
  'not-found': 'v2.activity.cancelRefused.notFound',
  'not-cancellable': 'v2.activity.cancelRefused.notCancellable',
  terminal: 'v2.activity.cancelRefused.terminal',
  'not-allowed': 'v2.activity.cancelRefused.notAllowed',
  'producer-refused': 'v2.activity.cancelRefused.producerRefused',
  'producer-unreachable': 'v2.activity.cancelRefused.producerUnreachable',
}

function isCancelReason(v: unknown): v is CancelReason {
  return typeof v === 'string' && v in CANCEL_REFUSAL
}

/** The i18n key naming why a cancel was refused. An unreadable answer is the generic refusal. */
export function cancelRefusalKey(reason: unknown): string {
  return isCancelReason(reason) ? CANCEL_REFUSAL[reason] : 'v2.activity.cancelRefused.unknown'
}

// ── Merge ────────────────────────────────────────────────────────────────────

/** Local rows whose export the hub already reports as a job drop out: the hub job wins. */
function withoutReportedExports(list: ActivityList, hub: readonly HubJobItem[]): ActivityList {
  const reported = new Set(hub.flatMap((job) => (job.exportId === null ? [] : [job.exportId])))
  if (reported.size === 0) return list
  return list.filter((item) => !(item.kind === 'export' && reported.has(item.exportId)))
}

const RUNNING = 0
const QUEUED = 1
const REST = 2

function rank(item: DisplayItem): number {
  if (item.kind === 'hub-job') {
    return item.state === 'running' ? RUNNING : item.state === 'queued' ? QUEUED : REST
  }
  if (item.kind !== 'job') return REST
  return item.state === 'running' ? RUNNING : item.state === 'queued' ? QUEUED : REST
}

/**
 * The Activity list as shown: the device's visible items plus the hub's jobs.
 * `hub === null` (unknown) leaves the device's items alone.
 */
export function mergeActivity(
  local: ActivityList,
  hub: readonly HubJobItem[] | null,
): readonly DisplayItem[] {
  const visible = local.filter(isListed)
  const items: readonly DisplayItem[] =
    hub === null ? visible : [...withoutReportedExports(visible, hub), ...hub]
  // Array.prototype.sort is stable: ties keep their order.
  return [...items].sort((a, b) => {
    const byRank = rank(a) - rank(b)
    if (byRank !== 0) return byRank
    return rank(a) === QUEUED ? a.createdAt - b.createdAt : b.createdAt - a.createdAt
  })
}

// ── Counts ───────────────────────────────────────────────────────────────────

/**
 * How many things are running, device and hub together. With the hub list in
 * hand the count is exact (an export the hub reports counts once). Without it
 * the hub's own summary stands in for the hub half: `running` from the summary,
 * nothing when even that is unknown.
 */
export function runningCount(
  local: ActivityList,
  hub: readonly HubJobItem[] | null,
  summary: HubJobsSummary | null,
): number {
  const visible = local.filter(isListed)
  if (hub !== null) {
    const localRunning = withoutReportedExports(visible, hub).filter(isRunning).length
    return localRunning + hub.filter(isHubJobActive).length
  }
  return visible.filter(isRunning).length + (summary?.running ?? 0)
}

/** Finished hub jobs not yet dismissed. A `null` summary (or measurement) counts nothing. */
export function hubUnseenFinished(summary: HubJobsSummary | null): number {
  return summary?.unseenFinished ?? 0
}

/** The ring's reading for device and hub work together. */
export function mergedProgress(
  local: ActivityList,
  hub: readonly HubJobItem[] | null,
  summary: HubJobsSummary | null,
): OverallProgress {
  const visible = local.filter(isListed)
  const running = runningCount(local, hub, summary)
  if (hub === null) return combineProgress(running, knownPercents(visible))
  const hubKnown = hub.filter(isHubJobActive).flatMap((job) => {
    const pct = hubProgressPercent(job)
    return pct === null ? [] : [pct]
  })
  return combineProgress(running, [...knownPercents(withoutReportedExports(visible, hub)), ...hubKnown])
}
