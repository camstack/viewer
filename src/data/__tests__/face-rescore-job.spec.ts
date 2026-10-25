import { describe, expect, it, vi } from 'vitest'
import { followRescoreJob, recomputeArchive } from '../face-rescore-job.js'
import {
  isUnknownActionError,
  makeFaceRescoreClient,
  type FaceRescoreStatus,
} from '../face-rescore.js'

function status(over: Partial<FaceRescoreStatus>): Record<string, unknown> {
  return {
    jobId: 'j1', state: 'running', scanned: 0, total: 10, changed: 0, newlySuggested: 0,
    raised: 0, lowered: 0, cleared: 0, modelMismatch: 0, noVector: 0, batches: 0,
    maxBatchStoreMs: 0, durationMs: 0, galleryFingerprint: 'g', fingerprint: 'f',
    startedAt: '2026-10-17T10:00:00Z', ...over,
  }
}

function setup(sequence: Record<string, unknown>[]) {
  const mutate = vi.fn(async (args: { action: string }) => {
    const next = args.action === 'face.rescoreAll' ? sequence[0] : sequence.shift()
    if (args.action === 'face.rescoreAll') sequence.shift()
    return next
  })
  const client = makeFaceRescoreClient({ addonsCustomMutate: mutate })
  return { mutate, client }
}

describe('followRescoreJob', () => {
  it('starts with rescoreAll, polls rescoreStatus, and stops on completed', async () => {
    const { mutate, client } = setup([
      status({ scanned: 0 }), // rescoreAll
      status({ scanned: 5 }),
      status({ state: 'completed', scanned: 10, changed: 3 }),
      status({ state: 'completed' }), // must never be asked
    ])
    const progress: number[] = []
    const sleep = vi.fn(async () => {})
    const end = await followRescoreJob({
      client, start: true, sleep, onProgress: (s) => progress.push(s.scanned),
    })
    expect(end.state).toBe('completed')
    expect(end.changed).toBe(3)
    expect(progress).toEqual([0, 5])
    expect(mutate.mock.calls.map((c) => c[0].action)).toEqual([
      'face.rescoreAll', 'face.rescoreStatus', 'face.rescoreStatus',
    ])
    expect(mutate.mock.calls[0]![0]).toMatchObject({ addonId: 'pipeline-analytics', input: {} })
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('stops on failed and keeps the error', async () => {
    const { client } = setup([status({}), status({ state: 'failed', error: 'boom' })])
    const end = await followRescoreJob({ client, start: true, sleep: async () => {}, onProgress: () => {} })
    expect(end).toMatchObject({ state: 'failed', error: 'boom' })
  })

  it('resumes a running job without starting another', async () => {
    const { mutate, client } = setup([status({ scanned: 4 }), status({ state: 'completed' })])
    await followRescoreJob({ client, start: false, sleep: async () => {}, onProgress: () => {} })
    expect(mutate.mock.calls.map((c) => c[0].action)).not.toContain('face.rescoreAll')
  })

  it('rejects a malformed status instead of casting it', async () => {
    const client = makeFaceRescoreClient({ addonsCustomMutate: async () => ({ state: 'weird' }) })
    await expect(client.rescoreStatus()).rejects.toThrow()
  })
})

describe('recomputeArchive', () => {
  const base = { sleep: async () => {}, onProgress: () => {}, start: true }

  it('invalidates once, only after completed', async () => {
    const { client } = setup([status({}), status({ state: 'completed' })])
    const invalidate = vi.fn(async () => {})
    const fallback = vi.fn(async () => {})
    const out = await recomputeArchive({ ...base, client, invalidate, fallback })
    expect(out.kind).toBe('job')
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('does not invalidate on failed', async () => {
    const { client } = setup([status({ state: 'failed', error: 'x' })])
    const invalidate = vi.fn(async () => {})
    await recomputeArchive({ ...base, client, invalidate, fallback: async () => {} })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('falls back to the visible-rows loop on an unknown action', async () => {
    const client = makeFaceRescoreClient({
      addonsCustomMutate: async () => { throw new Error('Unknown action: face.rescoreAll') },
    })
    const fallback = vi.fn(async () => {})
    const out = await recomputeArchive({ ...base, client, invalidate: async () => {}, fallback })
    expect(out.kind).toBe('fallback')
    expect(fallback).toHaveBeenCalledTimes(1)
  })

  it('rethrows any other error', async () => {
    const client = makeFaceRescoreClient({
      addonsCustomMutate: async () => { throw new Error('network down') },
    })
    await expect(
      recomputeArchive({ ...base, client, invalidate: async () => {}, fallback: async () => {} }),
    ).rejects.toThrow('network down')
  })
})

describe('isUnknownActionError', () => {
  it('recognises an unknown action, not other failures', () => {
    expect(isUnknownActionError(new Error('Unknown action face.rescoreAll'))).toBe(true)
    expect(
      isUnknownActionError(
        new Error("addon 'pipeline-analytics' has no custom action 'face.rescoreAll' — known actions: debug.analyze"),
      ),
    ).toBe(true)
    expect(isUnknownActionError(new Error('network down'))).toBe(false)
  })
})
