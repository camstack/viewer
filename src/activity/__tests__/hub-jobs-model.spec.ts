import { describe, it, expect } from 'vitest'

import type { ExportRecord } from '../../data/use-exports.js'
import { exportItemFrom, type ActivityList } from '../activity-model.js'
import { orderForDisplay, queuedJob, startJob } from '../activity-jobs.js'
import {
  cancelRefusalKey,
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
