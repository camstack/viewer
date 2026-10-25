import { describe, expect, it } from 'vitest'
import { parseRetrainCorpusPage } from '../retrain-parse.js'

const GOOD_ROW = {
  frameId: 'f1',
  deviceId: 7,
  origin: 'recording' as const,
  sourceKind: 'snapshot',
  sizeBytes: 2048,
  width: 640,
  height: 360,
  copiedAt: 1_700_000_000_000,
  complete: true,
  collectionIds: ['c1'],
  workState: 'complete' as const,
}

describe('parseRetrainCorpusPage', () => {
  it('returns undefined for a non-page', () => {
    expect(parseRetrainCorpusPage(null)).toBeUndefined()
    expect(parseRetrainCorpusPage({})).toBeUndefined()
    expect(parseRetrainCorpusPage([GOOD_ROW])).toBeUndefined()
  })

  it('returns undefined when the paging fields are missing', () => {
    expect(parseRetrainCorpusPage({ frames: [GOOD_ROW] })).toBeUndefined()
  })

  it('returns undefined when any row is malformed', () => {
    expect(
      parseRetrainCorpusPage({
        frames: [GOOD_ROW, { frameId: 'bad' }],
        total: 2,
        page: 1,
        pageSize: 50,
      }),
    ).toBeUndefined()
  })

  it('keeps a well-formed page, an empty answer included', () => {
    expect(
      parseRetrainCorpusPage({ frames: [GOOD_ROW], total: 1, page: 1, pageSize: 50 }),
    ).toEqual({ frames: [GOOD_ROW], total: 1, page: 1, pageSize: 50 })
    expect(parseRetrainCorpusPage({ frames: [], total: 0, page: 1, pageSize: 50 })?.frames).toEqual([])
  })
})
