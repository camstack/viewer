/**
 * The Retrain tab's `listRetrainCorpusPage` REQUEST.
 *
 * 1.0.598 asked for `pageSize: 200`; the hub's `RetrainCorpusFilterSchema`
 * (`packages/types/src/capabilities/pipeline-analytics.cap.ts`) caps it at
 * 100 and answers `too_big` — measured on the live hub 2026-10-13 — so the
 * tab always rendered "could not load". The fake below enforces the same cap.
 */
import { describe, expect, it } from 'vitest'
import {
  fetchRetrainCorpus,
  fetchRetrainCorpusPage,
  nextRetrainCorpusPage,
  RETRAIN_CORPUS_PAGE_SIZE,
} from '../use-retrain-corpus.js'

const HUB_MAX_PAGE_SIZE = 100

interface Req {
  readonly page: number
  readonly pageSize: number
  readonly collectionId?: string
  readonly deviceIds?: readonly number[]
}

function frame(n: number) {
  return {
    frameId: `f${String(n)}`,
    deviceId: 7,
    origin: 'track',
    sourceKind: 'keyFrame',
    sizeBytes: 1,
    width: 640,
    height: 360,
    copiedAt: 1,
    complete: false,
    workState: 'unannotated',
  }
}

function fakeHub(total: number, calls: Req[]): Record<string, unknown> {
  return {
    pipelineAnalytics: {
      listRetrainCorpusPage: {
        query: async (input: Req) => {
          calls.push(input)
          if (input.pageSize > HUB_MAX_PAGE_SIZE) throw new Error('too_big: pageSize')
          const from = (input.page - 1) * input.pageSize
          const n = Math.max(0, Math.min(input.pageSize, total - from))
          return {
            frames: Array.from({ length: n }, (_, i) => frame(from + i)),
            total,
            page: input.page,
            pageSize: input.pageSize,
          }
        },
      },
    },
  }
}

describe('fetchRetrainCorpus', () => {
  it('never asks for a page larger than the hub accepts', () => {
    expect(RETRAIN_CORPUS_PAGE_SIZE).toBeLessThanOrEqual(HUB_MAX_PAGE_SIZE)
  })

  it('walks every page and merges by frameId', async () => {
    const calls: Req[] = []
    const frames = await fetchRetrainCorpus(fakeHub(250, calls), {})
    expect(frames).toHaveLength(250)
    expect(calls.map((c) => c.page)).toEqual([1, 2, 3])
  })

  it('sends one collectionId per call', async () => {
    const calls: Req[] = []
    await fetchRetrainCorpus(fakeHub(3, calls), { collectionIds: ['a', 'b'], deviceIds: [7] })
    expect(calls.map((c) => c.collectionId)).toEqual(['a', 'b'])
    expect(calls[0]?.deviceIds).toEqual([7])
  })
})

describe('fetchRetrainCorpusPage', () => {
  it('asks for one page and does not walk the rest', async () => {
    const calls: Req[] = []
    const page = await fetchRetrainCorpusPage(fakeHub(250, calls), {}, 1)
    expect(calls).toEqual([{ page: 1, pageSize: RETRAIN_CORPUS_PAGE_SIZE }])
    expect(page.frames).toHaveLength(RETRAIN_CORPUS_PAGE_SIZE)
    expect(page.total).toBe(250)
    expect(nextRetrainCorpusPage(page)).toBe(2)
  })

  it('stops when the page covers the total', async () => {
    const calls: Req[] = []
    const page = await fetchRetrainCorpusPage(fakeHub(3, calls), { deviceIds: [7] }, 1)
    expect(calls).toHaveLength(1)
    expect(nextRetrainCorpusPage(page)).toBeUndefined()
  })
})
