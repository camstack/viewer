/**
 * The Activity centre's local job queue: what runs, in which order, what
 * survives a restart and what an interrupted job becomes.
 */
import { describe, it, expect } from 'vitest'

import { activityStorageKey, type JobActivityItem } from '../activity-model.js'
import { createActivityStore, type ActivityClock, type ActivityKv, type JobRun } from '../activity-store.js'

function memoryKv(): ActivityKv & { readonly data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => Promise.resolve(data.get(k) ?? null),
    setItem: (k, v) => {
      data.set(k, v)
      return Promise.resolve()
    },
  }
}

/** A clock that ticks once per read, and ids that count. */
function fakeClock(): ActivityClock {
  let tick = 1_000
  let id = 0
  return {
    now: () => {
      tick += 10
      return tick
    },
    newId: () => {
      id += 1
      return `job:${String(id)}`
    },
  }
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

/** A job whose end the test decides. */
function gate(): { readonly run: JobRun; readonly started: () => boolean; readonly finish: (summary: string) => void; readonly fail: (message: string) => void; readonly progress: (done: number, total: number) => void } {
  let started = false
  let progress: (done: number, total: number) => void = () => undefined
  let resolveRun: (summary: string) => void = () => undefined
  let rejectRun: (error: Error) => void = () => undefined
  const run: JobRun = (context) => {
    started = true
    progress = context.progress
    return new Promise((resolve, reject) => {
      resolveRun = (summary) => resolve({ summary })
      rejectRun = reject
    })
  }
  return {
    run,
    started: () => started,
    finish: (summary) => resolveRun(summary),
    fail: (message) => rejectRun(new Error(message)),
    progress: (done, total) => progress(done, total),
  }
}

function jobs(store: ReturnType<typeof createActivityStore>): readonly JobActivityItem[] {
  return store.getState().items.flatMap((item) => (item.kind === 'job' ? [item] : []))
}

function job(store: ReturnType<typeof createActivityStore>, id: string): JobActivityItem {
  const found = jobs(store).find((j) => j.id === id)
  if (found === undefined) throw new Error(`no job ${id}`)
  return found
}

describe('the queue runs one job at a time, in the order they were enqueued', () => {
  it('starts the first at once and holds the others queued', async () => {
    const store = createActivityStore(memoryKv(), fakeClock())
    const a = gate()
    const b = gate()
    const idA = store.getState().enqueue({ jobKind: 'face-assign', title: 'A', run: a.run })
    const idB = store.getState().enqueue({ jobKind: 'face-delete', title: 'B', run: b.run })

    expect(a.started()).toBe(true)
    expect(b.started()).toBe(false)
    expect(job(store, idA).state).toBe('running')
    expect(job(store, idB).state).toBe('queued')
  })

  it('runs the second only after the first has finished, then the third', async () => {
    const store = createActivityStore(memoryKv(), fakeClock())
    const order: string[] = []
    const a = gate()
    const b = gate()
    const c = gate()
    const wrap = (name: string, inner: JobRun): JobRun => (context) => {
      order.push(name)
      return inner(context)
    }
    store.getState().enqueue({ jobKind: 'face-assign', title: 'A', run: wrap('A', a.run) })
    store.getState().enqueue({ jobKind: 'face-assign', title: 'B', run: wrap('B', b.run) })
    store.getState().enqueue({ jobKind: 'face-assign', title: 'C', run: wrap('C', c.run) })

    expect(order).toEqual(['A'])
    a.finish('a done')
    await flush()
    expect(order).toEqual(['A', 'B'])
    b.finish('b done')
    await flush()
    expect(order).toEqual(['A', 'B', 'C'])
    c.finish('c done')
    await flush()
    expect(jobs(store).map((j) => j.state)).toEqual(['done', 'done', 'done'])
  })

  it('keeps the order of two jobs enqueued in the same millisecond', async () => {
    const frozen: ActivityClock = { now: () => 5_000, newId: (() => { let n = 0; return () => `job:${String(++n)}` })() }
    const store = createActivityStore(memoryKv(), frozen)
    const order: string[] = []
    const make = (name: string): JobRun => () => {
      order.push(name)
      return Promise.resolve({ summary: name })
    }
    store.getState().enqueue({ jobKind: 'face-assign', title: 'first', run: make('first') })
    store.getState().enqueue({ jobKind: 'face-assign', title: 'second', run: make('second') })
    store.getState().enqueue({ jobKind: 'face-assign', title: 'third', run: make('third') })
    await flush()
    expect(order).toEqual(['first', 'second', 'third'])
  })

  it('goes on to the next job when one fails, and records why', async () => {
    const store = createActivityStore(memoryKv(), fakeClock())
    const a = gate()
    const b = gate()
    const idA = store.getState().enqueue({ jobKind: 'face-assign', title: 'A', run: a.run })
    const idB = store.getState().enqueue({ jobKind: 'face-assign', title: 'B', run: b.run })

    a.fail('hub refused')
    await flush()

    expect(job(store, idA)).toMatchObject({ state: 'failed', error: 'hub refused', interrupted: false })
    expect(b.started()).toBe(true)
    expect(job(store, idB).state).toBe('running')
  })
})

describe('progress and outcome', () => {
  it('shows the running job\'s progress and its summary when done', async () => {
    const store = createActivityStore(memoryKv(), fakeClock())
    const a = gate()
    const id = store.getState().enqueue({ jobKind: 'face-rescore', title: 'Recompute', run: a.run })

    a.progress(3, 10)
    expect(job(store, id).progress).toEqual({ done: 3, total: 10 })
    a.progress(7, 10)
    expect(job(store, id).progress).toEqual({ done: 7, total: 10 })

    a.finish('Recomputed 10 faces')
    await flush()
    expect(job(store, id)).toMatchObject({
      state: 'done',
      summary: 'Recomputed 10 faces',
      progress: { done: 10, total: 10 },
    })
    expect(job(store, id).startedAt).not.toBeNull()
    expect(job(store, id).finishedAt).not.toBeNull()
  })

  it('ignores progress from a job that is not running', async () => {
    const store = createActivityStore(memoryKv(), fakeClock())
    const a = gate()
    const b = gate()
    store.getState().enqueue({ jobKind: 'face-assign', title: 'A', run: a.run })
    const idB = store.getState().enqueue({ jobKind: 'face-assign', title: 'B', run: b.run })
    expect(job(store, idB).progress).toBeNull()
  })

  it('re-arms the ready dot when a job finishes', async () => {
    const store = createActivityStore(memoryKv(), fakeClock())
    const a = gate()
    const id = store.getState().enqueue({ jobKind: 'face-assign', title: 'A', run: a.run })
    store.getState().markSeen()
    a.finish('ok')
    await flush()
    expect(job(store, id).seen).toBe(false)
  })
})

describe('the queue survives closing the app', () => {
  it('round-trips a finished job through storage', async () => {
    const kv = memoryKv()
    const before = createActivityStore(kv, fakeClock())
    await before.getState().bind('hub-a')
    const a = gate()
    const id = before.getState().enqueue({ jobKind: 'face-assign', title: 'Assign 3 faces', run: a.run })
    a.finish('Assigned 3 faces')
    await flush()
    expect(kv.data.has(activityStorageKey('hub-a'))).toBe(true)

    const after = createActivityStore(kv, fakeClock())
    await after.getState().bind('hub-a')
    expect(job(after, id)).toMatchObject({
      title: 'Assign 3 faces',
      jobKind: 'face-assign',
      state: 'done',
      summary: 'Assigned 3 faces',
      dismissed: false,
    })
  })

  it('reads a job that was running when the app closed as interrupted, never as running', async () => {
    const kv = memoryKv()
    const before = createActivityStore(kv, fakeClock())
    await before.getState().bind('hub-a')
    const running = gate()
    const idRunning = before.getState().enqueue({ jobKind: 'face-rescore', title: 'Recompute', run: running.run })
    const queued = gate()
    const idQueued = before.getState().enqueue({ jobKind: 'face-delete', title: 'Delete', run: queued.run })
    running.progress(4, 9)
    await flush()
    // The process dies here: neither job ever finishes.

    const after = createActivityStore(kv, fakeClock())
    await after.getState().bind('hub-a')
    expect(job(after, idRunning)).toMatchObject({ state: 'failed', interrupted: true, error: null })
    expect(job(after, idQueued)).toMatchObject({ state: 'failed', interrupted: true })
    // Nothing is silently lost, and nothing starts by itself.
    expect(jobs(after)).toHaveLength(2)
    expect(jobs(after).every((j) => j.finishedAt !== null)).toBe(true)
  })

  it('does not interrupt a job enqueued while the stored list was still being read', async () => {
    const kv = memoryKv()
    const store = createActivityStore(kv, fakeClock())
    const binding = store.getState().bind('hub-a')
    const a = gate()
    const id = store.getState().enqueue({ jobKind: 'face-assign', title: 'A', run: a.run })
    await binding
    expect(job(store, id).state).toBe('running')
    a.finish('ok')
    await flush()
    expect(job(store, id).state).toBe('done')
  })

  it('works without storage: a throwing store never breaks the queue', async () => {
    const broken: ActivityKv = {
      getItem: () => {
        throw new Error('no localStorage')
      },
      setItem: () => Promise.reject(new Error('quota')),
    }
    const store = createActivityStore(broken, fakeClock())
    await store.getState().bind('hub-a')
    const a = gate()
    const id = store.getState().enqueue({ jobKind: 'face-assign', title: 'A', run: a.run })
    a.finish('ok')
    await flush()
    expect(job(store, id).state).toBe('done')
  })
})

describe('dismissing', () => {
  it('hides a finished job but keeps it as history', async () => {
    const kv = memoryKv()
    const store = createActivityStore(kv, fakeClock())
    await store.getState().bind('hub-a')
    const a = gate()
    const id = store.getState().enqueue({ jobKind: 'face-assign', title: 'A', run: a.run })
    a.finish('ok')
    await flush()

    store.getState().dismiss(id)
    await flush()
    expect(job(store, id).dismissed).toBe(true)

    const after = createActivityStore(kv, fakeClock())
    await after.getState().bind('hub-a')
    expect(job(after, id).dismissed).toBe(true)
  })

  it('refuses to dismiss a running job', async () => {
    const store = createActivityStore(memoryKv(), fakeClock())
    const a = gate()
    const id = store.getState().enqueue({ jobKind: 'face-assign', title: 'A', run: a.run })
    store.getState().dismiss(id)
    expect(job(store, id)).toMatchObject({ state: 'running', dismissed: false })
  })

  it('cancels a queued job: it never runs and its owner is told', async () => {
    const store = createActivityStore(memoryKv(), fakeClock())
    const a = gate()
    const b = gate()
    let cancelled = false
    store.getState().enqueue({ jobKind: 'face-assign', title: 'A', run: a.run })
    const idB = store.getState().enqueue({
      jobKind: 'face-assign',
      title: 'B',
      run: b.run,
      onCancel: () => {
        cancelled = true
      },
    })

    store.getState().dismiss(idB)
    expect(cancelled).toBe(true)
    expect(jobs(store).map((j) => j.title)).toEqual(['A'])

    a.finish('ok')
    await flush()
    expect(b.started()).toBe(false)
  })

  it('clears every finished job at once and leaves the live ones', async () => {
    const store = createActivityStore(memoryKv(), fakeClock())
    const a = gate()
    const b = gate()
    const c = gate()
    const idA = store.getState().enqueue({ jobKind: 'face-assign', title: 'A', run: a.run })
    const idB = store.getState().enqueue({ jobKind: 'face-assign', title: 'B', run: b.run })
    const idC = store.getState().enqueue({ jobKind: 'face-assign', title: 'C', run: c.run })
    a.finish('ok')
    await flush()
    b.fail('boom')
    await flush()

    store.getState().dismissFinished()

    expect(job(store, idA).dismissed).toBe(true)
    expect(job(store, idB).dismissed).toBe(true)
    expect(job(store, idC)).toMatchObject({ state: 'running', dismissed: false })
  })
})
