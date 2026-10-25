/**
 * activity-store — the Activity list, held and persisted per server.
 *
 * Thin glue over `activity-model.ts` (the rules) and an injected key-value
 * store (AsyncStorage in the app, an in-memory map in specs). The list is
 * keyed by SERVER: a device that signs into two hubs keeps two lists, and a
 * switch re-binds rather than mixing them.
 *
 * ## Why it survives a restart
 *
 * An export takes minutes on the hub and the operator leaves the app meanwhile.
 * Every mutation writes the whole (capped) list back; `bind()` reads it on the
 * next launch and the reconcile hook then asks the hub how far each export
 * has come, so a job queued before the app was closed shows READY on return.
 *
 * ## The job queue
 *
 * `enqueue` records a job in the list and keeps its function in memory; one
 * pump runs them strictly one after another, oldest first. The function reports
 * progress through its context and resolves with a one-line summary (or throws:
 * the job is failed with the error's message). A job still queued or running
 * when the app was closed is read back as interrupted (`interruptStaleJobs`) —
 * its function died with the process.
 *
 * ## The one ordering hazard
 *
 * `bind()` is asynchronous, and an item can be added (a snapshot cut the moment
 * the screen opened) before the stored list has been read. Hydration therefore
 * MERGES what it read with what was added meanwhile instead of replacing it.
 */
import { create, type UseBoundStore, type StoreApi } from 'zustand'

import {
  activityStorageKey,
  addItem,
  dropRetiredSeen,
  markAllSeen,
  parseActivity,
  reconcileExports,
  removeItem,
  serializeActivity,
  type ActivityItem,
  type ActivityList,
  type JobKind,
} from './activity-model.js'
import {
  dismissFinishedJobs,
  dismissJob,
  finishJob,
  interruptStaleJobs,
  nextQueuedJob,
  progressJob,
  queuedJob,
  startJob,
} from './activity-jobs.js'
import type { ExportRecord } from '../data/use-exports.js'

/** The slice of a key-value store the list needs. */
export interface ActivityKv {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

/** What a running job can tell the list. */
export interface JobContext {
  /** Units completed so far out of `total` (faces, groups). */
  readonly progress: (done: number, total: number) => void
}

/** What a job resolves with: the one-line outcome, already translated. */
export interface JobOutcome {
  readonly summary: string
}

/** The work. Throw to fail the job; the message is what the row shows. */
export type JobRun = (context: JobContext) => Promise<JobOutcome>

export interface JobRequest {
  readonly jobKind: JobKind
  /** Already translated. */
  readonly title: string
  readonly run: JobRun
  /** Called if the job is cancelled while still queued (it will never run). */
  readonly onCancel?: () => void
}

/** The clock and the id source; specs inject theirs. */
export interface ActivityClock {
  readonly now: () => number
  readonly newId: () => string
}

let jobSequence = 0
const systemClock: ActivityClock = {
  now: () => Date.now(),
  newId: () => {
    jobSequence += 1
    return `job:${String(Date.now())}-${String(jobSequence)}-${Math.random().toString(36).slice(2, 8)}`
  },
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message
  return String(error)
}

export interface ActivityState {
  /** The server the list belongs to; `null` until bound. */
  readonly serverId: string | null
  readonly items: ActivityList
  readonly hydrated: boolean
  /** Point the store at a server and load its persisted list. Idempotent. */
  bind: (serverId: string | null) => Promise<void>
  add: (item: ActivityItem) => void
  remove: (id: string) => void
  /** Fold the hub's export records into the list. */
  reconcile: (records: readonly ExportRecord[]) => void
  /** The operator opened (or is looking at) the list. */
  markSeen: () => void
  /** Queue a long action: it runs after the ones queued before it. Returns its id. */
  enqueue: (request: JobRequest) => string
  /** Hide a finished (or still queued, i.e. cancel it) job. */
  dismiss: (id: string) => void
  /** Hide every finished job. */
  dismissFinished: () => void
}

export type ActivityStore = UseBoundStore<StoreApi<ActivityState>>

export function createActivityStore(kv: ActivityKv, clock: ActivityClock = systemClock): ActivityStore {
  // Storage is best-effort: the app works without it, so neither a rejected
  // promise nor a synchronous throw (a disabled `localStorage`) may escape.
  const persist = (serverId: string | null, items: ActivityList): void => {
    if (serverId === null) return
    void (async (): Promise<void> => {
      try {
        await kv.setItem(activityStorageKey(serverId), serializeActivity(items))
      } catch {
        // Unavailable or full: the list lives on in memory until the app closes.
      }
    })()
  }

  const read = async (serverId: string): Promise<string | null> => {
    try {
      return await kv.getItem(activityStorageKey(serverId))
    } catch {
      return null
    }
  }

  // The functions of the jobs still waiting; a closure cannot be persisted.
  const runners = new Map<string, JobRequest>()
  let pumping = false
  // Strictly increasing, so two jobs queued in the same millisecond keep their order.
  let lastQueuedAt = 0

  return create<ActivityState>((set, get) => {
    const commit = (items: ActivityList): void => {
      const { serverId, hydrated } = get()
      set({ items })
      // Before hydration the stored list has not been read; writing now would
      // overwrite it with a fragment. `bind` persists the merge instead.
      if (hydrated) persist(serverId, items)
    }

    const update = (change: (list: ActivityList) => ActivityList): void => {
      const current = get().items
      const next = change(current)
      if (next !== current) commit(next)
    }

    /** Run the queued jobs one at a time until none is left. */
    const pump = async (): Promise<void> => {
      if (pumping) return
      pumping = true
      try {
        for (;;) {
          const next = nextQueuedJob(get().items, (id) => runners.has(id))
          if (next === null) return
          const request = runners.get(next.id)
          runners.delete(next.id)
          if (request === undefined) return
          update((list) => startJob(list, next.id, clock.now()))
          try {
            const outcome = await request.run({
              progress: (done, total) => update((list) => progressJob(list, next.id, { done, total })),
            })
            update((list) => finishJob(list, next.id, { summary: outcome.summary, error: null }, clock.now()))
          } catch (error: unknown) {
            update((list) => finishJob(list, next.id, { summary: null, error: failureMessage(error) }, clock.now()))
          }
        }
      } finally {
        pumping = false
      }
    }

    return {
      serverId: null,
      items: [],
      hydrated: false,
      bind: async (serverId) => {
        if (get().serverId === serverId && get().hydrated) return
        // A job queued under another server cannot be run from this list.
        if (get().serverId !== serverId) runners.clear()
        // Anything added to THIS server's list before it was read survives.
        const pending = get().serverId === serverId ? get().items : []
        set({ serverId, items: pending, hydrated: false })
        if (serverId === null) return
        const raw = await read(serverId)
        // A later bind (a quick server switch) wins; this answer is stale.
        if (get().serverId !== serverId) return
        // Only the STORED list is stale: a job enqueued while it was being read
        // is live and keeps its place in the queue.
        const stored = interruptStaleJobs(parseActivity(raw), clock.now())
        const merged = get().items.reduce<ActivityList>((acc, item) => addItem(acc, item), stored)
        set({ items: merged, hydrated: true })
        persist(serverId, merged)
      },
      add: (item) => commit(addItem(get().items, item)),
      remove: (id) => commit(removeItem(get().items, id)),
      reconcile: (records) => {
        const next = reconcileExports(get().items, records)
        if (next !== get().items) commit(next)
      },
      markSeen: () => {
        const settled = markAllSeen(dropRetiredSeen(get().items))
        const current = get().items
        const unchanged =
          settled.length === current.length && settled.every((item, i) => item === current[i])
        if (!unchanged) commit(settled)
      },
      enqueue: (request) => {
        const id = clock.newId()
        lastQueuedAt = Math.max(clock.now(), lastQueuedAt + 1)
        runners.set(id, request)
        commit(
          addItem(
            get().items,
            queuedJob({ id, jobKind: request.jobKind, title: request.title, now: lastQueuedAt }),
          ),
        )
        void pump()
        return id
      },
      dismiss: (id) => {
        // Only a job still waiting has a function left to forget.
        const waiting = runners.get(id)
        runners.delete(id)
        update((list) => dismissJob(list, id))
        waiting?.onCancel?.()
      },
      dismissFinished: () => update(dismissFinishedJobs),
    }
  })
}
