/**
 * activity-jobs — the local queue's state machine, as pure functions.
 *
 * A job walks `queued → running → done | failed` and nothing walks back. The
 * list is the only record of it; the function that does the work is held in
 * memory by the store (a closure cannot be persisted), which is why
 * {@link interruptStaleJobs} exists: whatever was `queued` or `running` when the
 * app was closed has lost its function and can only be reported as interrupted.
 *
 * Every function returns the SAME list when nothing changed so the store does
 * not notify (or write to storage) for a no-op.
 */
import {
  isListed,
  type ActivityList,
  type JobActivityItem,
  type JobKind,
  type JobProgress,
} from './activity-model.js'

export interface JobSpec {
  readonly id: string
  readonly jobKind: JobKind
  /** Already translated. */
  readonly title: string
  readonly now: number
}

/** The item for a job just handed to the queue. */
export function queuedJob(spec: JobSpec): JobActivityItem {
  return {
    kind: 'job',
    id: spec.id,
    jobKind: spec.jobKind,
    title: spec.title,
    state: 'queued',
    progress: null,
    startedAt: null,
    finishedAt: null,
    summary: null,
    error: null,
    interrupted: false,
    dismissed: false,
    createdAt: spec.now,
    seen: false,
  }
}

function jobById(list: ActivityList, id: string): JobActivityItem | null {
  const found = list.find((item) => item.id === id)
  return found !== undefined && found.kind === 'job' ? found : null
}

function replaceJob(list: ActivityList, next: JobActivityItem): ActivityList {
  return list.map((item) => (item.id === next.id ? next : item))
}

/** The oldest queued job whose function is still in memory (`runnable`). */
export function nextQueuedJob(list: ActivityList, runnable: (id: string) => boolean): JobActivityItem | null {
  let best: JobActivityItem | null = null
  for (const item of list) {
    if (item.kind !== 'job' || item.state !== 'queued' || !runnable(item.id)) continue
    if (best === null || item.createdAt <= best.createdAt) best = item
  }
  return best
}

export function startJob(list: ActivityList, id: string, now: number): ActivityList {
  const job = jobById(list, id)
  if (job === null || job.state !== 'queued') return list
  return replaceJob(list, { ...job, state: 'running', startedAt: now })
}

export function progressJob(list: ActivityList, id: string, progress: JobProgress): ActivityList {
  const job = jobById(list, id)
  if (job === null || job.state !== 'running') return list
  if (job.progress?.done === progress.done && job.progress.total === progress.total) return list
  return replaceJob(list, { ...job, progress })
}

export interface JobFinish {
  readonly summary: string | null
  readonly error: string | null
}

/** A finished job re-arms the "ready" dot: the operator has not seen it yet. */
export function finishJob(list: ActivityList, id: string, finish: JobFinish, now: number): ActivityList {
  const job = jobById(list, id)
  if (job === null || job.state !== 'running') return list
  const failed = finish.error !== null
  return replaceJob(list, {
    ...job,
    state: failed ? 'failed' : 'done',
    progress: failed ? job.progress : finalProgress(job.progress),
    finishedAt: now,
    summary: failed ? null : finish.summary,
    error: finish.error,
    seen: false,
  })
}

/** A done job reads as complete: the last reported fraction is not left at 90%. */
function finalProgress(progress: JobProgress | null): JobProgress | null {
  return progress === null ? null : { done: progress.total, total: progress.total }
}

/**
 * Whatever a previous run left queued or running cannot continue: mark it failed
 * and interrupted. Called on the list READ from storage, never on the live one.
 */
export function interruptStaleJobs(list: ActivityList, now: number): ActivityList {
  let changed = false
  const next = list.map((item) => {
    if (item.kind !== 'job' || (item.state !== 'queued' && item.state !== 'running')) return item
    changed = true
    return {
      ...item,
      state: 'failed' as const,
      finishedAt: now,
      summary: null,
      error: null,
      interrupted: true,
      seen: false,
    }
  })
  return changed ? next : list
}

/**
 * Clear one job. A finished one is hidden (kept as history); a queued one is
 * CANCELLED — removed, since it never ran. A running one cannot be cleared: it
 * has not finished.
 */
export function dismissJob(list: ActivityList, id: string): ActivityList {
  const job = jobById(list, id)
  if (job === null || job.dismissed || job.state === 'running') return list
  if (job.state === 'queued') return list.filter((item) => item.id !== id)
  return replaceJob(list, { ...job, dismissed: true })
}

/** Hide every job that has finished (done or failed). */
export function dismissFinishedJobs(list: ActivityList): ActivityList {
  let changed = false
  const next = list.map((item) => {
    if (item.kind !== 'job' || item.dismissed) return item
    if (item.state !== 'done' && item.state !== 'failed') return item
    changed = true
    return { ...item, dismissed: true }
  })
  return changed ? next : list
}

/** Whether "clear finished" has anything to clear. */
export function hasFinishedJobs(list: ActivityList): boolean {
  return list.some((item) => item.kind === 'job' && !item.dismissed && (item.state === 'done' || item.state === 'failed'))
}

/**
 * The order the list is DRAWN in: the running job, then the queued ones in the
 * order they will run, then everything else newest first. (The stored order is
 * newest first, which would show the last queued job above the one running.)
 */
export function orderForDisplay(list: ActivityList): ActivityList {
  const visible = list.filter(isListed)
  const running = visible.filter((item) => item.kind === 'job' && item.state === 'running')
  const queued = visible
    .filter((item) => item.kind === 'job' && item.state === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt)
  const rest = visible.filter((item) => !running.includes(item) && !queued.includes(item))
  return [...running, ...queued, ...rest]
}

/** Whether a job of this kind is queued or running (to keep a button from queueing it twice). */
export function hasActiveJob(list: ActivityList, jobKind: JobKind): boolean {
  return list.some(
    (item) => item.kind === 'job' && item.jobKind === jobKind && (item.state === 'queued' || item.state === 'running'),
  )
}
