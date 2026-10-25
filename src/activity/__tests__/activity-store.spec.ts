import { describe, it, expect } from 'vitest'

import type { ExportRecord } from '../../data/use-exports.js'
import { activityStorageKey, exportItemFrom, unseenFinishedCount } from '../activity-model.js'
import { createActivityStore, type ActivityKv } from '../activity-store.js'

/** An in-memory key-value store — the only thing a "restart" keeps. */
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

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function record(over: Partial<ExportRecord> = {}): ExportRecord {
  return {
    id: 'e1',
    deviceId: 7,
    profile: 'high',
    fromMs: 1_000,
    toMs: 81_000,
    options: { includeAudio: true, maxLifeMs: 1, deleteAfterDownload: false },
    state: 'queued',
    progressPct: null,
    fileBytes: null,
    expiresAt: 0,
    deleteAfterDownload: false,
    downloadedAt: null,
    createdAt: 0,
    createdBy: 'op',
    error: null,
    ...over,
  }
}

describe('an export survives closing the app', () => {
  it('queued before the restart, READY after it — through the hub reconcile', async () => {
    const kv = memoryKv()

    // Session 1: the operator saves an export and closes the app.
    const before = createActivityStore(kv)
    await before.getState().bind('hub-a')
    before.getState().add(exportItemFrom(record(), 'Front door', 100))
    await flush()
    expect(kv.data.has(activityStorageKey('hub-a'))).toBe(true)

    // Session 2: a fresh store (a new process) over the same storage.
    const after = createActivityStore(kv)
    expect(after.getState().items).toHaveLength(0)
    await after.getState().bind('hub-a')
    expect(after.getState().items).toHaveLength(1)
    expect(after.getState().items[0]).toMatchObject({ exportId: 'e1', state: 'queued' })

    // The hub finished it meanwhile; the reconcile on start picks that up.
    after.getState().reconcile([record({ state: 'ready', fileBytes: 1234 })])
    expect(after.getState().items[0]).toMatchObject({ state: 'ready' })
    expect(unseenFinishedCount(after.getState().items)).toBe(1)

    // …and the new state is itself persisted.
    await flush()
    const third = createActivityStore(kv)
    await third.getState().bind('hub-a')
    expect(third.getState().items[0]).toMatchObject({ state: 'ready' })
  })

  it('without persistence the item would be gone (the disarm: a store that never writes)', async () => {
    const kv = memoryKv()
    const forgetful: ActivityKv = { getItem: kv.getItem, setItem: () => Promise.resolve() }
    const before = createActivityStore(forgetful)
    await before.getState().bind('hub-a')
    before.getState().add(exportItemFrom(record(), 'Front door', 100))
    await flush()
    const after = createActivityStore(kv)
    await after.getState().bind('hub-a')
    expect(after.getState().items).toHaveLength(0)
  })
})

describe('one list per server', () => {
  it('a switch re-binds: server B never shows server A\'s items', async () => {
    const kv = memoryKv()
    const store = createActivityStore(kv)
    await store.getState().bind('hub-a')
    store.getState().add(exportItemFrom(record(), 'A cam', 100))
    await flush()
    await store.getState().bind('hub-b')
    expect(store.getState().items).toHaveLength(0)
    await store.getState().bind('hub-a')
    expect(store.getState().items).toHaveLength(1)
  })

  it('an item added before the stored list was read is MERGED, not overwritten', async () => {
    const kv = memoryKv()
    const seed = createActivityStore(kv)
    await seed.getState().bind('hub-a')
    seed.getState().add(exportItemFrom(record({ id: 'old' }), 'Front door', 10))
    await flush()

    const store = createActivityStore(kv)
    const binding = store.getState().bind('hub-a')
    // Added while the read is still in flight.
    store.getState().add(exportItemFrom(record({ id: 'new' }), 'Front door', 20))
    await binding
    await flush()
    expect(store.getState().items.map((i) => i.id).sort()).toEqual(['export:new', 'export:old'])
    const reread = createActivityStore(kv)
    await reread.getState().bind('hub-a')
    expect(reread.getState().items).toHaveLength(2)
  })
})

describe('seen / remove', () => {
  it('opening the list clears the dot; a later finish re-arms it', async () => {
    const store = createActivityStore(memoryKv())
    await store.getState().bind('hub-a')
    store.getState().add(exportItemFrom(record(), 'Front door', 100))
    store.getState().reconcile([record({ state: 'ready' })])
    expect(unseenFinishedCount(store.getState().items)).toBe(1)
    store.getState().markSeen()
    expect(unseenFinishedCount(store.getState().items)).toBe(0)
  })

  it('remove takes it out of the list and out of storage', async () => {
    const kv = memoryKv()
    const store = createActivityStore(kv)
    await store.getState().bind('hub-a')
    store.getState().add(exportItemFrom(record(), 'Front door', 100))
    store.getState().remove('export:e1')
    await flush()
    const again = createActivityStore(kv)
    await again.getState().bind('hub-a')
    expect(again.getState().items).toHaveLength(0)
  })

  it('an export the hub retired is shown once and gone at the next open', async () => {
    const store = createActivityStore(memoryKv())
    await store.getState().bind('hub-a')
    store.getState().add(exportItemFrom(record(), 'Front door', 100))
    store.getState().reconcile([record({ state: 'expired' })])
    store.getState().markSeen()
    expect(store.getState().items).toHaveLength(1)
    store.getState().markSeen()
    expect(store.getState().items).toHaveLength(0)
  })
})
