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

import { orderForDisplay } from './activity-jobs.js'
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
  /** When the job reached a final state; `null` while it runs. */
  readonly finishedAt: number | null
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
    finishedAt: typeof raw['finishedAt'] === 'number' ? raw['finishedAt'] : null,
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

function isRetiredExport(item: ActivityItem): boolean {
  return item.kind === 'export' && (item.state === 'expired' || item.state === 'deleted')
}

export interface Reconciled {
  readonly local: ActivityList
  readonly hub: readonly HubJobItem[]
}

/**
 * One row per export. The hub job wins over its device twin — except where the
 * twin is already retired (expired / deleted): the file is gone, so the device
 * row keeps saying so and the hub job, which would offer a Download, is left out.
 */
export function reconcileTwins(local: ActivityList, hub: readonly HubJobItem[]): Reconciled {
  const retired = new Set(
    local.flatMap((item) => (item.kind === 'export' && isRetiredExport(item) ? [item.exportId] : [])),
  )
  const hubKept = hub.filter((job) => job.exportId === null || !retired.has(job.exportId))
  const reported = new Set(hubKept.flatMap((job) => (job.exportId === null ? [] : [job.exportId])))
  const localKept =
    reported.size === 0
      ? local
      : local.filter((item) => !(item.kind === 'export' && reported.has(item.exportId)))
  return { local: localKept, hub: hubKept }
}

const RUNNING = 0
const QUEUED = 1
const REST = 2

function hubRank(job: HubJobItem): number {
  return job.state === 'running' ? RUNNING : job.state === 'queued' ? QUEUED : REST
}

function localRank(item: ActivityItem): number {
  if (item.kind !== 'job') return REST
  return item.state === 'running' ? RUNNING : item.state === 'queued' ? QUEUED : REST
}

/** Interleave two sequences, each already in its own order, by `first`; ties take the device's. */
function interleave(
  device: readonly DisplayItem[],
  hub: readonly HubJobItem[],
  hubFirst: (hubItem: HubJobItem, deviceItem: DisplayItem) => boolean,
): DisplayItem[] {
  const out: DisplayItem[] = []
  let d = 0
  let h = 0
  for (;;) {
    const deviceItem = device[d]
    const hubItem = hub[h]
    if (hubItem !== undefined && (deviceItem === undefined || hubFirst(hubItem, deviceItem))) {
      out.push(hubItem)
      h += 1
    } else if (deviceItem !== undefined) {
      out.push(deviceItem)
      d += 1
    } else {
      break
    }
  }
  return out
}

/**
 * The Activity list as shown: the device's visible items plus the hub's jobs.
 *
 * The device's items keep EXACTLY the order `orderForDisplay` gives them (the
 * store's order for everything that is not a running / queued job — never
 * re-sorted); hub jobs fall into the same three groups (running, queued oldest
 * first, the rest newest first) and are placed among them by creation time.
 * `hub === null` (unknown) leaves the device's items alone.
 */
export function mergeActivity(
  local: ActivityList,
  hub: readonly HubJobItem[] | null,
): readonly DisplayItem[] {
  const ordered = orderForDisplay(local)
  if (hub === null) return ordered
  const twins = reconcileTwins(local.filter(isListed), hub)
  const kept = new Set(twins.local)
  const device = ordered.filter((item) => kept.has(item))
  const group = (rank: number): { d: readonly DisplayItem[]; h: HubJobItem[] } => ({
    d: device.filter((item) => localRank(item) === rank),
    h: twins.hub.filter((job) => hubRank(job) === rank).sort((a, b) => (rank === QUEUED ? a.createdAt - b.createdAt : b.createdAt - a.createdAt)),
  })
  const running = group(RUNNING)
  const queued = group(QUEUED)
  const rest = group(REST)
  const newerFirst = (hubItem: HubJobItem, deviceItem: DisplayItem): boolean => hubItem.createdAt > deviceItem.createdAt
  const olderFirst = (hubItem: HubJobItem, deviceItem: DisplayItem): boolean => hubItem.createdAt < deviceItem.createdAt
  return [
    ...interleave(running.d, running.h, newerFirst),
    ...interleave(queued.d, queued.h, olderFirst),
    ...interleave(rest.d, rest.h, newerFirst),
  ]
}

// ── What is asked for, and what is believed ──────────────────────────────────

/** The full list is read only while the popover is open or the hub says a job runs. */
export function hubListWanted(open: boolean, summary: HubJobsSummary | null): boolean {
  return open || (summary?.running ?? 0) > 0
}

/** Summary cadence: idle, and while a hub job runs. */
export const HUB_SUMMARY_IDLE_POLL_MS = 30_000
export const HUB_SUMMARY_ACTIVE_POLL_MS = 5_000
/** List cadence while it is wanted. */
export const HUB_LIST_POLL_MS = 4_000

/**
 * How often to ask again. `null` is a hub with no `jobs` capability — a real
 * answer, so asking stops (`false`); `undefined` is not yet asked.
 */
export function summaryPollMs(data: HubJobsSummary | null | undefined): number | false {
  if (data === null) return false
  return (data?.running ?? 0) > 0 ? HUB_SUMMARY_ACTIVE_POLL_MS : HUB_SUMMARY_IDLE_POLL_MS
}

export function listPollMs(data: readonly HubJobItem[] | null | undefined): number | false {
  return data === null ? false : HUB_LIST_POLL_MS
}

/**
 * The list as believed: only while it is wanted. A value cached from an earlier
 * fetch is not evidence once nobody is polling it (a stale "running" must not
 * outlive the poll that would have corrected it), so it reads as unknown.
 */
export function hubFromList(
  wanted: boolean,
  cached: readonly HubJobItem[] | null | undefined,
): readonly HubJobItem[] | null {
  return wanted ? (cached ?? null) : null
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
    const twins = reconcileTwins(visible, hub)
    return twins.local.filter(isRunning).length + twins.hub.filter(isHubJobActive).length
  }
  return visible.filter(isRunning).length + (summary?.running ?? 0)
}

/**
 * What the operator has looked at: the newest finish among the finished hub
 * jobs they were shown, and how many there were. The hub has no "seen" call —
 * `unseenFinished` is only "finished and not dismissed" — so this is kept on
 * the device, per server.
 */
export interface HubAck {
  readonly at: number
  readonly count: number
}

export const NO_ACK: HubAck = { at: 0, count: 0 }

export function isFinishedHubJob(job: HubJobItem): boolean {
  return !isHubJobActive(job)
}

/** The acknowledgement for a list the operator is looking at. */
export function ackFromList(hub: readonly HubJobItem[]): HubAck {
  const finished = hub.filter(isFinishedHubJob)
  return {
    at: finished.reduce((newest, job) => Math.max(newest, job.finishedAt ?? job.createdAt), 0),
    count: finished.length,
  }
}

export function sameAck(a: HubAck, b: HubAck): boolean {
  return a.at === b.at && a.count === b.count
}

/**
 * Finished hub jobs not yet looked at. A `null` summary (or measurement) counts
 * nothing; what was acknowledged is taken off the hub's total, so opening the
 * popover puts the dot out and a job that finishes afterwards lights it again.
 */
export function hubUnseenFinished(summary: HubJobsSummary | null, ack: HubAck = NO_ACK): number {
  const total = summary?.unseenFinished ?? 0
  return Math.max(0, total - ack.count)
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
  const twins = reconcileTwins(visible, hub)
  const hubKnown = twins.hub.filter(isHubJobActive).flatMap((job) => {
    const pct = hubProgressPercent(job)
    return pct === null ? [] : [pct]
  })
  return combineProgress(running, [...knownPercents(twins.local), ...hubKnown])
}
