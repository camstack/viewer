import { describe, expect, it } from 'vitest'
import { parseRetrainStaging, parseRetrainFrameList } from '../retrain-parse.js'

describe('retrain-parse', () => {
  it('parseRetrainStaging accepts a valid staging row', () => {
    const rows = parseRetrainStaging([
      {
        trackId: 't1',
        deviceId: 101,
        className: 'person',
        firstSeen: 1,
        lastSeen: 2,
        frameCount: 0,
        annotationCount: 0,
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows?.[0]?.trackId).toBe('t1')
  })

  it('parseRetrainStaging returns undefined for a malformed row', () => {
    expect(parseRetrainStaging([{ trackId: 'only-id' }])).toBeUndefined()
    expect(parseRetrainStaging(null)).toBeUndefined()
  })

  it('parseRetrainFrameList accepts candidates and copies', () => {
    const list = parseRetrainFrameList({
      candidates: [
        {
          mediaId: 1,
          kind: 'keyFrame',
          timestamp: 100,
          sizeBytes: 50_000,
          copied: false,
        },
      ],
      copies: [],
    })
    expect(list?.candidates).toHaveLength(1)
    expect(list?.copies).toHaveLength(0)
  })
})
