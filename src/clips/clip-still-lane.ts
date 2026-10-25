/**
 * clip-still-lane — ONE still request in the air per camera.
 *
 * ## Why
 *
 * A clip still is cut from the camera's own replay on demand, and on an
 * Amcrest that replay is the camera's scarcest resource: it shares one session
 * budget with the hub's live main and sub streams. On 2026-09-25 (3836) every
 * mounted tile asked at once, each deferral came back on its own ladder, and
 * the provider's lane turned that into ~70 s of back-to-back replays until the
 * camera stopped answering the live streams' keepalives. The provider now
 * queues its replays itself; this is the client's half — a page of tiles is
 * asked for one at a time, so the provider's queue holds at most one request
 * from this app per camera.
 *
 * ## What it does
 *
 * - **Per camera, FIFO, concurrency 1.** The camera is the mint URL without
 *   its clip key ({@link clipStillLaneKey}) — true of every provider's route
 *   (`/addon/<id>/clip-thumb/<deviceId>/<clipKey>`).
 * - **Shared per URL.** Two tiles for one clip (a remount racing its own
 *   unmount) make one request.
 * - **Withdrawn when nobody wants it.** A tile that unmounts while queued
 *   leaves the queue and is never asked for; one whose request is already in
 *   the air aborts it, which takes it out of the provider's queue too.
 * - **A deferral rests the camera.** The server's `retry-after` (bounded by
 *   {@link CLIP_STILL_RETRY_MAX_WAIT_MS}) holds the NEXT request for that
 *   camera, so the rest of the page is not asked, one after another, for the
 *   same "not now".
 *
 * Pure apart from its maps and timers: no React, no network.
 */

import { CLIP_STILL_RETRY_MAX_WAIT_MS, type ClipStillOutcome } from './clip-still.js'

/** One ask of the network, cancellable by the lane. */
export type ClipStillAsk = (signal: AbortSignal) => Promise<ClipStillOutcome>

interface Job {
  readonly url: string
  readonly laneKey: string
  readonly ask: ClipStillAsk
  readonly controller: AbortController
  readonly settled: Promise<ClipStillOutcome | null>
  settle(outcome: ClipStillOutcome | null): void
  waiters: number
  started: boolean
}

interface Lane {
  readonly queue: Job[]
  busy: boolean
  restUntilMs: number
  timer: ReturnType<typeof setTimeout> | null
}

const jobs = new Map<string, Job>()
const lanes = new Map<string, Lane>()

/** The camera a mint URL belongs to: the URL without its query and clip key. */
export function clipStillLaneKey(url: string): string {
  const query = url.indexOf('?')
  const path = query === -1 ? url : url.slice(0, query)
  const slash = path.lastIndexOf('/')
  return slash === -1 ? path : path.slice(0, slash)
}

function laneFor(key: string): Lane {
  const existing = lanes.get(key)
  if (existing !== undefined) return existing
  const created: Lane = { queue: [], busy: false, restUntilMs: 0, timer: null }
  lanes.set(key, created)
  return created
}

function restAfter(outcome: ClipStillOutcome): number {
  if (outcome.kind !== 'deferred' || outcome.retryAfterMs === null) return 0
  return Math.min(outcome.retryAfterMs, CLIP_STILL_RETRY_MAX_WAIT_MS)
}

function pump(key: string): void {
  const lane = lanes.get(key)
  if (lane === undefined || lane.busy || lane.timer !== null) return
  const job = lane.queue[0]
  if (job === undefined) {
    // Kept while it rests, or the next tile would skip the rest.
    if (lane.restUntilMs <= Date.now()) lanes.delete(key)
    return
  }
  const restMs = lane.restUntilMs - Date.now()
  if (restMs > 0) {
    lane.timer = setTimeout(() => {
      lane.timer = null
      pump(key)
    }, restMs)
    return
  }
  lane.queue.shift()
  lane.busy = true
  job.started = true
  void job.ask(job.controller.signal).then(
    (outcome) => {
      finish(lane, job, outcome)
    },
    (err: unknown) => {
      finish(lane, job, {
        kind: 'deferred',
        code: null,
        reason: err instanceof Error ? err.message : String(err),
        retryAfterMs: null,
      })
    },
  )
}

function finish(lane: Lane, job: Job, outcome: ClipStillOutcome): void {
  lane.busy = false
  lane.restUntilMs = Math.max(lane.restUntilMs, Date.now() + restAfter(outcome))
  if (jobs.get(job.url) === job) jobs.delete(job.url)
  job.settle(outcome)
  pump(job.laneKey)
}

function withdraw(job: Job): void {
  job.waiters -= 1
  if (job.waiters > 0) return
  if (jobs.get(job.url) === job) jobs.delete(job.url)
  if (job.started) {
    // In the air: abort it, which also takes it out of the provider's queue.
    job.controller.abort()
    return
  }
  const lane = lanes.get(job.laneKey)
  if (lane !== undefined) {
    const index = lane.queue.indexOf(job)
    if (index !== -1) lane.queue.splice(index, 1)
  }
  job.settle(null)
  pump(job.laneKey)
}

function enqueue(url: string, ask: ClipStillAsk): Job {
  const running = jobs.get(url)
  if (running !== undefined) {
    running.waiters += 1
    return running
  }
  let settle: (outcome: ClipStillOutcome | null) => void = () => undefined
  const settled = new Promise<ClipStillOutcome | null>((resolve) => {
    settle = resolve
  })
  const laneKey = clipStillLaneKey(url)
  const job: Job = {
    url,
    laneKey,
    ask,
    controller: new AbortController(),
    settled,
    settle,
    waiters: 1,
    started: false,
  }
  jobs.set(url, job)
  laneFor(laneKey).queue.push(job)
  pump(laneKey)
  return job
}

/**
 * Ask for this URL's still through its camera's lane.
 *
 * Resolves with the outcome, or `null` once `signal` aborts — the caller went
 * away, and whether the request itself goes on depends on whether anybody
 * else still wants it.
 */
export async function requestClipStill(
  url: string,
  ask: ClipStillAsk,
  signal: AbortSignal,
): Promise<ClipStillOutcome | null> {
  if (signal.aborted) return null
  const job = enqueue(url, ask)
  return await new Promise<ClipStillOutcome | null>((resolve) => {
    const onAbort = (): void => {
      withdraw(job)
      resolve(null)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    void job.settled.then((outcome) => {
      signal.removeEventListener('abort', onAbort)
      resolve(outcome)
    })
  })
}

/** Test seam: drop every queue, rest and pending request. */
export function forgetClipStillLanes(): void {
  for (const lane of lanes.values()) {
    if (lane.timer !== null) clearTimeout(lane.timer)
  }
  for (const job of jobs.values()) job.controller.abort()
  lanes.clear()
  jobs.clear()
}
