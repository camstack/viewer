import { describe, it, expect } from 'vitest'

import type { ExportRecord } from '../../data/use-exports.js'
import { exportItemFrom, snapshotItemFrom, type ActivityList } from '../activity-model.js'
import { createActivityStore, type ActivityKv } from '../activity-store.js'
import { orderForDisplay, queuedJob, startJob } from '../activity-jobs.js'
import {
  ackFromList,
  acknowledgeOnOpen,
  clearFinishedAll,
  rebaseAck,
  cancelRefusalKey,
  HUB_LIST_POLL_MS,
  HUB_SUMMARY_ACTIVE_POLL_MS,
  HUB_SUMMARY_IDLE_POLL_MS,
  hubFromList,
  hubListWanted,
  listPollMs,
  NO_ACK,
  summaryPollMs,
  hubJobClear,
  hubUnseenFinished,
  mergeActivity,
  mergedProgress,
  parseHubJob,
  parseHubJobs,
  parseHubSummary,
  runningCount,
  type HubJobItem,
} from '../hub-jobs-model.js'

function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: 'j1',
    kind: 'adoption',
    titleKey: 'jobs.adoption.title',
    titleParams: { n: 2 },
    state: 'running',
    failure: null,
    progress: null,
    cancellable: true,
    createdAt: 1_000,
    subject: {},
    ...over,
  }
}

function hubJob(over: Record<string, unknown> = {}): HubJobItem {
  const parsed = parseHubJob(raw(over))
  if (parsed === null) throw new Error('fixture does not parse')
  return parsed
}

function exportRecord(id: string, state: ExportRecord['state'] = 'rendering'): ExportRecord {
  return {
    id,
    deviceId: 7,
    profile: 'high',
    fromMs: 0,
    toMs: 1_000,
    options: { includeAudio: true, maxLifeMs: 1, deleteAfterDownload: false },
    state,
    progressPct: 40,
    fileBytes: null,
    expiresAt: 0,
    deleteAfterDownload: false,
    downloadedAt: null,
    createdAt: 0,
    createdBy: 'op',
    error: null,
  }
}

const exportRow = (id: string, createdAt: number): ActivityList => [
  exportItemFrom(exportRecord(id), 'Door', createdAt),
]

describe('parseHubJobs — unknown is not empty', () => {
  it('keeps an unanswered query null and an empty answer empty', () => {
    expect(parseHubJobs(null)).toBeNull()
    expect(parseHubJobs(undefined)).toBeNull()
    expect(parseHubJobs('nope')).toBeNull()
    expect(parseHubJobs([])).toEqual([])
  })

  it('drops an unreadable entry instead of guessing one', () => {
    const jobs = parseHubJobs([raw(), { jobId: 'bad' }, raw({ state: 'weird' })])
    expect(jobs?.map((j) => j.jobId)).toEqual(['j1'])
  })

  it('reads the export a job is about from its subject entity', () => {
    const job = hubJob({ subject: { entity: { kind: 'export', id: 'e9' } } })
    expect(job.exportId).toBe('e9')
    expect(hubJob({ subject: { entity: { kind: 'identity', id: 'e9' } } }).exportId).toBeNull()
  })
})

describe('summary', () => {
  it('a null unseenFinished counts nothing and does not throw', () => {
    const summary = parseHubSummary({ running: 2, unseenFinished: null })
    expect(summary).toEqual({ running: 2, unseenFinished: null })
    expect(hubUnseenFinished(summary)).toBe(0)
    expect(runningCount([], null, summary)).toBe(2)
  })

  it('an unanswered summary is unknown: null, counted as nothing', () => {
    expect(parseHubSummary(null)).toBeNull()
    expect(parseHubSummary({ unseenFinished: 1 })).toBeNull()
    expect(hubUnseenFinished(null)).toBe(0)
    expect(runningCount([], null, null)).toBe(0)
  })
})

describe('mergeActivity', () => {
  it('orders running, then queued oldest first, then the rest newest first — hub and device together', () => {
    const local = startJob(
      [
        queuedJob({ id: 'job:a', jobKind: 'face-rescore', title: 'A', now: 500 }),
        queuedJob({ id: 'job:b', jobKind: 'face-rescore', title: 'B', now: 100 }),
      ],
      'job:a',
      600,
    )
    const hub = [
      hubJob({ jobId: 'old-done', state: 'done', createdAt: 50 }),
      hubJob({ jobId: 'new-done', state: 'failed', createdAt: 900 }),
      hubJob({ jobId: 'hub-run', state: 'running', createdAt: 10 }),
      hubJob({ jobId: 'hub-queued', state: 'queued', createdAt: 300 }),
    ]
    const ids = mergeActivity(local, hub).map((e) => e.id)
    expect(ids).toEqual(['job:a', 'hub:hub-run', 'job:b', 'hub:hub-queued', 'hub:new-done', 'hub:old-done'])
  })

  it('leaves the device-only order exactly as before', () => {
    const local: ActivityList = [
      ...exportRow('e1', 300),
      queuedJob({ id: 'job:q', jobKind: 'face-rescore', title: 'Q', now: 200 }),
      ...exportRow('e2', 100),
    ]
    expect(mergeActivity(local, null).map((e) => e.id)).toEqual(orderForDisplay(local).map((e) => e.id))
    expect(mergeActivity(local, []).map((e) => e.id)).toEqual(orderForDisplay(local).map((e) => e.id))
  })

  it('shows an export the hub also reports as a job once — the hub job wins', () => {
    const local = [...exportRow('e1', 300), ...exportRow('e2', 200)]
    const hub = [hubJob({ jobId: 'j-e1', subject: { entity: { kind: 'export', id: 'e1' } }, createdAt: 310 })]
    const merged = mergeActivity(local, hub)
    expect(merged.map((e) => e.id)).toEqual(['hub:j-e1', 'export:e2'])
    // the same export is not collapsed away when the hub did NOT report it
    expect(mergeActivity(local, []).map((e) => e.id)).toEqual(['export:e1', 'export:e2'])
  })

  it('an unanswered hub list keeps every device item and invents no hub row', () => {
    const local = exportRow('e1', 300)
    expect(mergeActivity(local, null)).toEqual(local)
  })
})

describe('counts', () => {
  it('counts a reported export once, in the badge and the ring', () => {
    const local = exportRow('e1', 300)
    const hub = [
      hubJob({ jobId: 'j-e1', progress: { done: 1, total: 4, unit: 'x' }, subject: { entity: { kind: 'export', id: 'e1' } } }),
    ]
    expect(runningCount(local, hub, { running: 1, unseenFinished: 0 })).toBe(1)
    expect(mergedProgress(local, hub, null)).toEqual({ kind: 'known', running: 1, fraction: 0.25 })
  })

  it('adds hub work to device work, and an unknown fraction stays indeterminate', () => {
    const local = exportRow('e1', 300)
    const hub = [hubJob({ jobId: 'other' })]
    expect(runningCount(local, hub, null)).toBe(2)
    const merged = mergedProgress([], hub, null)
    expect(merged).toEqual({ kind: 'indeterminate', running: 1 })
  })

  it('without the list the summary stands in for the hub half', () => {
    expect(runningCount(exportRow('e1', 1), null, { running: 3, unseenFinished: null })).toBe(4)
    expect(mergedProgress([], null, { running: 3, unseenFinished: null })).toEqual({ kind: 'indeterminate', running: 3 })
  })

  it('an idle device and hub is idle', () => {
    expect(mergedProgress([], [], { running: 0, unseenFinished: 2 })).toEqual({ kind: 'idle' })
  })
})

describe('row actions', () => {
  it('cancels a cancellable running job, offers nothing for one that cannot stop, dismisses a finished one', () => {
    expect(hubJobClear(hubJob({ state: 'running', cancellable: true }))).toBe('cancel')
    expect(hubJobClear(hubJob({ state: 'queued', cancellable: true }))).toBe('cancel')
    expect(hubJobClear(hubJob({ state: 'running', cancellable: false }))).toBeNull()
    expect(hubJobClear(hubJob({ state: 'done' }))).toBe('dismiss')
    expect(hubJobClear(hubJob({ state: 'cancelled' }))).toBe('dismiss')
  })

  it('names why a cancel was refused, and falls back to a generic line', () => {
    expect(cancelRefusalKey('producer-unreachable')).toBe('v2.activity.cancelRefused.producerUnreachable')
    expect(cancelRefusalKey(null)).toBe('v2.activity.cancelRefused.unknown')
    expect(cancelRefusalKey('made-up')).toBe('v2.activity.cancelRefused.unknown')
  })
})

describe('the order of the device items is exactly orderForDisplay', () => {
  const snap = (uid: string, createdAt: number): ActivityList[number] =>
    snapshotItemFrom({ uid, deviceId: 1, cameraName: 'Door', atMs: 1, fileUri: 'file:///a.jpg', mime: 'image/jpeg', now: createdAt })

  it('keeps the store order of the rest even when it differs from createdAt (fails if re-sorted)', () => {
    const local: ActivityList = [snap('a', 100), snap('b', 300), snap('c', 200)]
    expect(mergeActivity(local, null).map((e) => e.id)).toEqual(['snapshot:a', 'snapshot:b', 'snapshot:c'])
    expect(mergeActivity(local, []).map((e) => e.id)).toEqual(['snapshot:a', 'snapshot:b', 'snapshot:c'])
    const withHub = mergeActivity(local, [hubJob({ jobId: 'h', state: 'done', createdAt: 250 })])
    expect(withHub.map((e) => e.id).filter((id) => id.startsWith('snapshot:'))).toEqual([
      'snapshot:a',
      'snapshot:b',
      'snapshot:c',
    ])
  })
})

describe('a retired export is not brought back to life by its hub job', () => {
  it('keeps the device row that says expired and leaves the hub job out', () => {
    const local: ActivityList = [exportItemFrom(exportRecord('e1', 'expired'), 'Door', 100)]
    const hub = [hubJob({ jobId: 'j', state: 'done', subject: { entity: { kind: 'export', id: 'e1' } } })]
    const merged = mergeActivity(local, hub)
    expect(merged.map((e) => e.id)).toEqual(['export:e1'])
  })
})

describe('what the operator has seen of the hub finished jobs', () => {
  const finished = (id: string, finishedAt: number): HubJobItem =>
    hubJob({ jobId: id, state: 'done', createdAt: 1, finishedAt })

  it('is the newest finish and the count of the finished jobs shown', () => {
    expect(ackFromList([finished('a', 10), finished('b', 30), hubJob({ jobId: 'r', state: 'running' })])).toEqual({ at: 30, count: 2 })
    expect(ackFromList([])).toEqual(NO_ACK)
  })

  it('puts the dot out after opening and lights it again for a later finish', () => {
    const summary = { running: 0, unseenFinished: 2 }
    expect(hubUnseenFinished(summary)).toBe(2)
    const ack = ackFromList([finished('a', 10), finished('b', 30)])
    expect(hubUnseenFinished(summary, ack)).toBe(0)
    expect(hubUnseenFinished({ running: 0, unseenFinished: 3 }, ack)).toBe(1)
    // a dismissal on the hub lowers the total below what was seen: never negative
    expect(hubUnseenFinished({ running: 0, unseenFinished: 1 }, ack)).toBe(0)
    expect(hubUnseenFinished({ running: 0, unseenFinished: null }, ack)).toBe(0)
  })
})

describe('the store', () => {
  const memoryKv = (): ActivityKv & { readonly data: Map<string, string> } => {
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

  it('remembers the acknowledgement per server across a restart', async () => {
    const kv = memoryKv()
    const first = createActivityStore(kv)
    await first.getState().bind('s1')
    first.getState().ackHub({ at: 30, count: 2 })
    await flush()
    const second = createActivityStore(kv)
    await second.getState().bind('s1')
    expect(second.getState().hubAck).toEqual({ at: 30, count: 2 })
    await second.getState().bind('s2')
    expect(second.getState().hubAck).toEqual(NO_ACK)
  })

  it('drops the device twin of a dismissed hub export job, so its row does not come back', async () => {
    const store = createActivityStore(memoryKv())
    await store.getState().bind('s1')
    store.getState().add(exportItemFrom(exportRecord('e1'), 'Door', 100))
    store.getState().add(exportItemFrom(exportRecord('e2'), 'Gate', 90))
    store.getState().forgetHubJobs([hubJob({ jobId: 'j', state: 'done', subject: { entity: { kind: 'export', id: 'e1' } } })])
    // with the popover closed the hub list is unknown (null): the twin must still be gone
    expect(mergeActivity(store.getState().items, null).map((e) => e.id)).toEqual(['export:e2'])
  })
})

describe('the polling contract', () => {
  const cached = [hubJob()]

  it('does not ask for the list while idle with the popover closed', () => {
    expect(hubListWanted(false, { running: 0, unseenFinished: 3 })).toBe(false)
    expect(hubListWanted(false, null)).toBe(false)
    expect(hubListWanted(true, null)).toBe(true)
    expect(hubListWanted(false, { running: 1, unseenFinished: 0 })).toBe(true)
  })

  it('reads the list as unknown when not wanted, even with a cached value', () => {
    expect(hubFromList(false, cached)).toBeNull()
    expect(hubFromList(true, cached)).toBe(cached)
    expect(hubFromList(true, undefined)).toBeNull()
  })

  it('stops polling a hub with no jobs capability, and polls faster while a job runs', () => {
    expect(summaryPollMs(null)).toBe(false)
    expect(listPollMs(null)).toBe(false)
    expect(summaryPollMs(undefined)).toBe(HUB_SUMMARY_IDLE_POLL_MS)
    expect(summaryPollMs({ running: 0, unseenFinished: 0 })).toBe(HUB_SUMMARY_IDLE_POLL_MS)
    expect(summaryPollMs({ running: 1, unseenFinished: null })).toBe(HUB_SUMMARY_ACTIVE_POLL_MS)
    expect(listPollMs([])).toBe(HUB_LIST_POLL_MS)
  })
})

describe('the acknowledgement follows the jobs, not a count', () => {
  const finished = (id: string, finishedAt: number): HubJobItem =>
    hubJob({ jobId: id, state: 'done', createdAt: 1, finishedAt })

  it('lights the dot for a new finish after every acknowledged job was dismissed elsewhere', () => {
    // opened with two finished: acknowledged
    let ack = ackFromList([finished('a', 10), finished('b', 30)])
    expect(ack).toEqual({ at: 30, count: 2 })
    // both dismissed elsewhere: the hub total falls to 0 and the count follows it down
    ack = rebaseAck({ running: 0, unseenFinished: 0 }, ack)
    expect(ack).toEqual({ at: 30, count: 0 })
    // one new job finishes: the summary alone must show it
    expect(hubUnseenFinished({ running: 0, unseenFinished: 1 }, ack)).toBe(1)
  })

  it('counts exactly from the list: only jobs that finished after what was seen', () => {
    const ack = { at: 30, count: 2 }
    const list = [finished('a', 10), finished('b', 30), finished('c', 40), hubJob({ jobId: 'r', state: 'running' })]
    expect(hubUnseenFinished(null, ack, list)).toBe(1)
    expect(hubUnseenFinished(null, ack, [])).toBe(0)
  })

  it('does not move the acknowledgement when the total is not below it', () => {
    const ack = { at: 30, count: 2 }
    expect(rebaseAck({ running: 0, unseenFinished: 2 }, ack)).toBe(ack)
    expect(rebaseAck({ running: 0, unseenFinished: null }, ack)).toBe(ack)
    expect(rebaseAck(null, ack)).toBe(ack)
  })
})

describe('acknowledging and clearing, as behaviour', () => {
  const finished = (id: string, finishedAt: number): HubJobItem =>
    hubJob({ jobId: id, state: 'done', createdAt: 1, finishedAt })

  it('acknowledges the list only when it is open and the list answered', () => {
    const acks: unknown[] = []
    const ackHub = (ack: unknown): void => void acks.push(ack)
    acknowledgeOnOpen(true, null, ackHub)
    acknowledgeOnOpen(false, [finished('a', 10)], ackHub)
    expect(acks).toEqual([])
    acknowledgeOnOpen(true, [finished('a', 10)], ackHub)
    expect(acks).toEqual([{ at: 10, count: 1 }])
  })

  it('"Clear finished" dismisses each finished hub job once, resets the acknowledgement, and clears the device jobs', async () => {
    const calls: string[] = []
    const hub = [finished('a', 10), finished('b', 20), hubJob({ jobId: 'run', state: 'running' })]
    await clearFinishedAll(hub, {
      dismissLocal: () => calls.push('local'),
      forgetHubJobs: (jobs) => calls.push(`forget:${jobs.map((j) => j.jobId).join(',')}`),
      dismissHub: (id) => {
        calls.push(`dismiss:${id}`)
        return Promise.resolve(true)
      },
      ackHub: (ack) => calls.push(`ack:${String(ack.at)}/${String(ack.count)}`),
    })
    expect(calls).toEqual(['local', 'forget:a,b', 'ack:0/0', 'dismiss:a', 'dismiss:b'])
  })

  it('an unknown list dismisses nothing on the hub', async () => {
    const dismissed: string[] = []
    await clearFinishedAll(null, {
      dismissLocal: () => undefined,
      forgetHubJobs: () => undefined,
      dismissHub: (id) => {
        dismissed.push(id)
        return Promise.resolve(true)
      },
      ackHub: () => undefined,
    })
    expect(dismissed).toEqual([])
  })
})
