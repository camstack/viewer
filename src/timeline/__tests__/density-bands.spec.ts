import { describe, it, expect } from 'vitest'
import { toBands, type DensityBucket, type ActivityBand } from '../density-bands.js'

const b = (bucketStart: number, motion: number, object: number, audio: number): DensityBucket => ({
  bucketStart,
  motion,
  object,
  audio,
})

describe('toBands', () => {
  it('normalizes motion and audio each to its own max (0..1), ignoring object', () => {
    const out = toBands([b(0, 2, 99, 1), b(10, 4, 0, 4), b(20, 0, 0, 2)])
    expect(out).toEqual<ActivityBand[]>([
      { bucketStart: 0, motion: 0.5, audio: 0.25 },
      { bucketStart: 10, motion: 1, audio: 1 },
      { bucketStart: 20, motion: 0, audio: 0.5 },
    ])
  })

  it('returns [] for no buckets', () => {
    expect(toBands([])).toEqual([])
  })

  it('maps an all-zero kind to all zeros (no divide-by-zero)', () => {
    expect(toBands([b(0, 0, 5, 3), b(10, 0, 5, 3)])).toEqual<ActivityBand[]>([
      { bucketStart: 0, motion: 0, audio: 1 },
      { bucketStart: 10, motion: 0, audio: 1 },
    ])
  })
})
