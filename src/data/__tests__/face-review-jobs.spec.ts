import { describe, it, expect } from 'vitest'

import { analyzeAssignJob, applySuggestionsJob, assignJob, rescoreJob, type FaceJobPorts } from '../face-review-jobs.js'
import type { FaceRescoreClient, FaceRescoreStatus } from '../face-rescore.js'

/** Echoes the key and the interpolated values, so a summary can be read back. */
const t = (key: string, options?: Record<string, unknown>): string =>
  options === undefined ? key : `${key} ${JSON.stringify(options)}`

function ports(over: Partial<FaceJobPorts> = {}): FaceJobPorts & { readonly calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    assign: ({ faceIds, identityId, defer }) => {
      calls.push(`assign ${identityId} x${String(faceIds.length)} defer=${String(defer)}`)
      return Promise.resolve({ assigned: faceIds.length, failed: [] })
    },
    createPerson: (name) => Promise.resolve({ id: 'new-id', name }),
    deleteFaces: (faceIds) => Promise.resolve({ deleted: faceIds.length }),
    flush: () => {
      calls.push('flush')
      return Promise.resolve()
    },
    rescoreClient: () => null,
    rescoreTrack: () => Promise.resolve(),
    sleep: () => Promise.resolve(),
    ...over,
  }
}

const context = (log: [number, number][] = []) => ({ progress: (done: number, total: number) => void log.push([done, total]) })

function status(over: Partial<FaceRescoreStatus>): FaceRescoreStatus {
  return {
    jobId: 'j', state: 'running', scanned: 0, total: 10, changed: 0, newlySuggested: 0, raised: 0, lowered: 0,
    cleared: 0, modelMismatch: 0, noVector: 0, batches: 0, maxBatchStoreMs: 0, durationMs: 0, startedAt: null, ...over,
  }
}

describe('assign job', () => {
  it('summarises what landed', async () => {
    const outcome = await assignJob(ports(), t, { faceIds: ['a', 'b'], target: { identityId: 'p', name: 'Anna' } }).run(context())
    expect(outcome.summary).toContain('assignedManySuccess')
  })

  it('creates the person first when given a new name', async () => {
    const p = ports()
    await assignJob(p, t, { faceIds: ['a'], target: { newName: 'Zoe' } }).run(context())
    expect(p.calls).toEqual(['assign new-id x1 defer=false'])
  })

  it('fails when the hub answered and assigned nothing', async () => {
    const p = ports({ assign: () => Promise.resolve({ assigned: 0, failed: ['a'] }) })
    await expect(assignJob(p, t, { faceIds: ['a'], target: { identityId: 'p', name: 'Anna' } }).run(context())).rejects.toThrow('assignFailed')
  })
})

describe('apply-suggestions and similar-groups jobs', () => {
  it('writes one call per person, reports per-face progress, and flushes once at the end', async () => {
    const p = ports()
    const log: [number, number][] = []
    await applySuggestionsJob(p, t, [
      { identityId: 'p1', name: 'A', faceIds: ['1', '2'] },
      { identityId: 'p2', name: 'B', faceIds: ['3'] },
    ]).run(context(log))
    expect(p.calls).toEqual(['assign p1 x2 defer=true', 'assign p2 x1 defer=true', 'flush'])
    expect(log).toEqual([[0, 3], [2, 3], [3, 3]])
  })

  it('keeps going past a refused group and still flushes', async () => {
    let n = 0
    const p = ports({
      assign: ({ faceIds }) => {
        n += 1
        return n === 1 ? Promise.reject(new Error('ambiguous embedding')) : Promise.resolve({ assigned: faceIds.length, failed: [] })
      },
    })
    const outcome = await analyzeAssignJob(p, t, [
      { representativeFaceId: '1', identityId: 'p1', faceIds: ['1', '2'] },
      { representativeFaceId: '3', identityId: 'p2', faceIds: ['3'] },
    ]).run(context())
    expect(p.calls.at(-1)).toBe('flush')
    expect(outcome.summary).toContain('ambiguous embedding')
  })

  it('fails with the hub\'s reason when nothing was assigned', async () => {
    const p = ports({ assign: () => Promise.reject(new Error('ambiguous embedding')) })
    await expect(
      analyzeAssignJob(p, t, [{ representativeFaceId: '1', identityId: 'p1', faceIds: ['1'] }]).run(context()),
    ).rejects.toThrow('ambiguous embedding')
  })
})

describe('recompute job', () => {
  it('follows the hub job to its end, reporting scanned/total, then flushes', async () => {
    const polls = [status({ scanned: 5 }), status({ state: 'completed', scanned: 10, changed: 4 })]
    const client: FaceRescoreClient = {
      rescoreTrack: () => Promise.reject(new Error('unused')),
      rescoreAll: () => Promise.resolve(status({ scanned: 0 })),
      rescoreStatus: () => Promise.resolve(polls.shift() ?? status({ state: 'completed' })),
    }
    const p = ports({ rescoreClient: () => client })
    const log: [number, number][] = []
    const outcome = await rescoreJob(p, t, { start: true, fallbackRows: [] }).run(context(log))
    expect(log).toEqual([[0, 10], [5, 10]])
    expect(outcome.summary).toContain('recomputeSummary')
    expect(p.calls).toContain('flush')
  })

  it('fails with the hub\'s error when the job failed', async () => {
    const client: FaceRescoreClient = {
      rescoreTrack: () => Promise.reject(new Error('unused')),
      rescoreAll: () => Promise.resolve(status({ state: 'failed', error: 'no model' })),
      rescoreStatus: () => Promise.resolve(status({ state: 'failed', error: 'no model' })),
    }
    await expect(rescoreJob(ports({ rescoreClient: () => client }), t, { start: true, fallbackRows: [] }).run(context())).rejects.toThrow('recomputeFailed')
  })

  it('fails when offline', async () => {
    await expect(rescoreJob(ports(), t, { start: true, fallbackRows: [] }).run(context())).rejects.toThrow('offline')
  })
})
