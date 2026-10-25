import { describe, it, expect } from 'vitest'

import type { ExportRecord } from '../../data/use-exports.js'
import {
  ACTIVITY_CAP,
  addItem,
  dropRetiredSeen,
  exportItemFrom,
  markAllSeen,
  overallProgress,
  parseActivity,
  reconcileExports,
  serializeActivity,
  snapshotItemFrom,
  unseenFinishedCount,
  type ActivityList,
} from '../activity-model.js'

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

const exp = (id: string, createdAt: number, over: Partial<ExportRecord> = {}) =>
  exportItemFrom(record({ id, ...over }), 'Front door', createdAt)

describe('the list', () => {
  it('is newest first and replaces an item added twice', () => {
    let list: ActivityList = []
    list = addItem(list, exp('a', 10))
    list = addItem(list, exp('b', 30))
    list = addItem(list, exp('c', 20))
    list = addItem(list, exp('a', 40))
    expect(list.map((i) => i.id)).toEqual(['export:a', 'export:b', 'export:c'])
  })

  it(`is capped at ${ACTIVITY_CAP}: the OLDEST are pruned`, () => {
    let list: ActivityList = []
    for (let i = 0; i < ACTIVITY_CAP + 5; i += 1) list = addItem(list, exp(`e${i}`, i))
    expect(list).toHaveLength(ACTIVITY_CAP)
    expect(list.some((i) => i.id === 'export:e0')).toBe(false)
    expect(list[0]?.id).toBe(`export:e${ACTIVITY_CAP + 4}`)
  })
})

describe('reconcile with the hub', () => {
  it('queued → rendering with a real fraction → ready, and ready clears `seen` once', () => {
    let list = addItem([], exp('e1', 1))
    list = markAllSeen(list)
    list = reconcileExports(list, [record({ state: 'rendering', progressPct: 40 })])
    expect(list[0]).toMatchObject({ state: 'rendering', progressPct: 40, seen: true })
    list = reconcileExports(list, [record({ state: 'ready', fileBytes: 10 })])
    expect(list[0]).toMatchObject({ state: 'ready', progressPct: null, seen: false })
    expect(unseenFinishedCount(list)).toBe(1)
  })

  it('a progress tick inside the same state never re-arms the dot', () => {
    let list = markAllSeen(addItem([], exp('e1', 1, { state: 'rendering', progressPct: 10 })))
    list = reconcileExports(list, [record({ state: 'rendering', progressPct: 60 })])
    expect(list[0]).toMatchObject({ progressPct: 60, seen: true })
  })

  it('an export the hub does not list is LEFT ALONE — absence is not deletion', () => {
    const list = addItem([], exp('e1', 1))
    expect(reconcileExports(list, [record({ id: 'other', state: 'ready' })])).toBe(list)
    // An unreachable cap answers [] — the same.
    expect(reconcileExports(list, [])).toBe(list)
  })

  it('returns the SAME array when nothing changed, so the store stays quiet', () => {
    const list = addItem([], exp('e1', 1, { state: 'rendering', progressPct: 10 }))
    expect(reconcileExports(list, [record({ state: 'rendering', progressPct: 10 })])).toBe(list)
  })

  it('a failed export carries the hub\'s reason', () => {
    const list = reconcileExports(addItem([], exp('e1', 1)), [
      record({ state: 'failed', error: 'no footage' }),
    ])
    expect(list[0]).toMatchObject({ state: 'failed', error: 'no footage' })
  })

  it('an expired/deleted export is shown ONCE, then dropped', () => {
    let list = addItem([], exp('e1', 1))
    list = markAllSeen(reconcileExports(list, [record({ state: 'ready' })]))
    list = reconcileExports(list, [record({ state: 'expired' })])
    // The transition re-arms `seen`: the operator has not seen it expired yet.
    expect(dropRetiredSeen(list)).toHaveLength(1)
    list = markAllSeen(list)
    expect(dropRetiredSeen(list)).toHaveLength(0)
  })

  it('snapshots are never touched by the hub', () => {
    const snap = snapshotItemFrom({
      uid: 'u1', deviceId: 7, cameraName: 'Front door', atMs: 5, fileUri: 'file:///c/a.jpg', mime: 'image/jpeg', now: 9,
    })
    const list = addItem([], snap)
    expect(reconcileExports(list, [record({ state: 'ready' })])).toBe(list)
  })
})

describe('overall progress and the ready dot', () => {
  it('idle when nothing runs', () => {
    expect(overallProgress([])).toEqual({ kind: 'idle' })
    expect(overallProgress(addItem([], exp('e1', 1, { state: 'ready' })))).toEqual({ kind: 'idle' })
  })

  it('indeterminate while no running job has a real fraction — never 0', () => {
    expect(overallProgress(addItem([], exp('e1', 1)))).toEqual({ kind: 'indeterminate', running: 1 })
  })

  it('the mean of the KNOWN fractions, counting every running item', () => {
    let list: ActivityList = []
    list = addItem(list, exp('a', 1, { state: 'rendering', progressPct: 20 }))
    list = addItem(list, exp('b', 2, { state: 'rendering', progressPct: 60 }))
    list = addItem(list, exp('c', 3))
    expect(overallProgress(list)).toEqual({ kind: 'known', running: 3, fraction: 0.4 })
  })

  it('a snapshot is ready on arrival and seen — no dot for news the operator already has', () => {
    const snap = snapshotItemFrom({
      uid: 'u1', deviceId: 7, cameraName: 'x', atMs: 5, fileUri: 'file:///c/a.jpg', mime: 'image/jpeg', now: 9,
    })
    expect(unseenFinishedCount(addItem([], snap))).toBe(0)
  })
})

describe('persistence format', () => {
  it('round-trips a mixed list', () => {
    const snap = snapshotItemFrom({
      uid: 'u1', deviceId: 7, cameraName: 'x', atMs: 5, fileUri: 'file:///c/a.jpg', mime: 'image/jpeg', now: 9,
    })
    const list = addItem(addItem([], exp('e1', 1, { state: 'rendering', progressPct: 33 })), snap)
    expect(parseActivity(serializeActivity(list))).toEqual(list)
  })

  it('unreadable storage is an empty list, never a throw', () => {
    expect(parseActivity(null)).toEqual([])
    expect(parseActivity('{not json')).toEqual([])
    expect(parseActivity('{"a":1}')).toEqual([])
  })

  it('skips a corrupt entry and keeps the rest', () => {
    const good = exp('e1', 1)
    const raw = JSON.stringify([{ id: 5 }, good, { ...good, state: 'sideways', id: 'export:x' }])
    expect(parseActivity(raw).map((i) => i.id)).toEqual(['export:e1'])
  })

  it('drops a web snapshot whose blob URL died with the page', () => {
    const snap = snapshotItemFrom({
      uid: 'u1', deviceId: 7, cameraName: 'x', atMs: 5, fileUri: 'blob:http://x/abc', mime: 'image/jpeg', now: 9,
    })
    expect(parseActivity(serializeActivity([snap]))).toEqual([])
  })
})
