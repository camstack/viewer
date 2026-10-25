import { describe, it, expect } from 'vitest'
import {
  dbfsToUnit,
  tapeCountIntensity,
  densityToMotionBuckets,
  densityToAudioBuckets,
  parseDensityRows,
  audioEventsToBuckets,
  pickBucketMs,
  mergeDensityRows,
} from '../activity-bars.js'

// ─── dbfsToUnit ───────────────────────────────────────────────────────

describe('dbfsToUnit', () => {
  it('maps floor (-60 dBFS) to 0', () => {
    expect(dbfsToUnit(-60)).toBe(0)
  })

  it('maps ceil (0 dBFS) to 1', () => {
    expect(dbfsToUnit(0)).toBe(1)
  })

  it('maps the midpoint to 0.5', () => {
    expect(dbfsToUnit(-30)).toBeCloseTo(0.5, 5)
  })

  it('clamps values below floor to 0', () => {
    expect(dbfsToUnit(-100)).toBe(0)
  })

  it('clamps values above ceil to 1', () => {
    expect(dbfsToUnit(10)).toBe(1)
  })

  it('accepts custom floor/ceil', () => {
    // floor=-40, ceil=-10 → mid=-25 → 0.5
    expect(dbfsToUnit(-25, -40, -10)).toBeCloseTo(0.5, 5)
  })
})

// ─── densityToMotionBuckets ───────────────────────────────────────────

describe('densityToMotionBuckets', () => {
  const bucketMs = 5_000

  it('returns one Bucket per density row', () => {
    const rows = [
      { bucketStart: 1000, motion: 3 },
      { bucketStart: 6000, motion: 6 },
    ]
    const buckets = densityToMotionBuckets(rows, bucketMs)
    expect(buckets).toHaveLength(2)
  })

  it('maps startMs/endMs from bucketStart', () => {
    const rows = [{ bucketStart: 1000, motion: 5 }]
    const [b] = densityToMotionBuckets(rows, bucketMs)
    expect(b.startMs).toBe(1000)
    expect(b.endMs).toBe(1000 + bucketMs)
  })

  it('normalizes motion: max row gets intensity 1', () => {
    const rows = [
      { bucketStart: 1000, motion: 4 },
      { bucketStart: 6000, motion: 8 },
    ]
    const buckets = densityToMotionBuckets(rows, bucketMs)
    expect(buckets[1].intensity).toBeCloseTo(1, 5)
    expect(buckets[0].intensity).toBe(tapeCountIntensity(4, 8))
  })

  it('keeps a quiet night bucket visible against a busy afternoon peak', () => {
    // Hall 22 ago 2026: ~50 motion/hour overnight vs ~2000 at 20:00.
    // Linear max-norm painted night at 2.5% — gone. Log+floor keeps it on the tape.
    const rows = [
      { bucketStart: 0, motion: 50 },
      { bucketStart: 5_000, motion: 2000 },
    ]
    const buckets = densityToMotionBuckets(rows, bucketMs)
    expect(buckets[1].intensity).toBe(1)
    expect(buckets[0].intensity).toBeGreaterThanOrEqual(0.35)
    expect(buckets[0].intensity).toBeLessThan(1)
  })

  it('returns all-zero intensity when every row has motion 0', () => {
    const rows = [
      { bucketStart: 1000, motion: 0 },
      { bucketStart: 6000, motion: 0 },
    ]
    const buckets = densityToMotionBuckets(rows, bucketMs)
    expect(buckets.every((b) => b.intensity === 0)).toBe(true)
  })

  it('returns an empty array for empty input', () => {
    expect(densityToMotionBuckets([], bucketMs)).toEqual([])
  })

  it('clamps intensity to [0, 1]', () => {
    const rows = [{ bucketStart: 1000, motion: 5 }]
    const [b] = densityToMotionBuckets(rows, bucketMs)
    expect(b.intensity).toBeGreaterThanOrEqual(0)
    expect(b.intensity).toBeLessThanOrEqual(1)
  })
})

describe('mergeDensityRows — sum-up across cameras before normalisation', () => {
  it('sums motion in the same bucket from every camera', () => {
    const camA = [{ bucketStart: 1000, motion: 2 }, { bucketStart: 6000, motion: 1 }]
    const camB = [{ bucketStart: 1000, motion: 3 }]
    expect(mergeDensityRows([camA, camB])).toEqual([
      { bucketStart: 1000, motion: 5, audio: 0 },
      { bucketStart: 6000, motion: 1, audio: 0 },
    ])
  })

  it('normalises against the fused max so a quiet camera cannot inflate the heatmap', () => {
    const fused = mergeDensityRows([
      [{ bucketStart: 1000, motion: 1 }],
      [{ bucketStart: 1000, motion: 3 }],
      [{ bucketStart: 6000, motion: 8 }],
    ])
    const buckets = densityToMotionBuckets(fused, 5_000)
    expect(buckets[1]?.intensity).toBe(1)
    expect(buckets[0]?.intensity).toBeGreaterThan(0)
    expect(buckets[0]?.intensity).toBeLessThan(1)
  })

  it('returns empty when every camera is empty', () => {
    expect(mergeDensityRows([[], []])).toEqual([])
  })

  /**
   * The tape's audio hairline reads `DensityRow.audio`. A fuse that summed only
   * motion left every fused bucket at `audio: 0`, so a multi-camera timeline
   * drew a silent day for cameras that were not silent — and the ONE lane that
   * would have shown it is the one the fuse dropped.
   */
  it('sums audio in the same bucket too, not only motion', () => {
    const camA = [{ bucketStart: 1000, motion: 2, audio: 4 }]
    const camB = [{ bucketStart: 1000, motion: 3, audio: 6 }]
    expect(mergeDensityRows([camA, camB])).toEqual([
      { bucketStart: 1000, motion: 5, audio: 10 },
    ])
  })

  it('keeps the MAX audioDbfs per bucket across cameras', () => {
    const fused = mergeDensityRows([
      [{ bucketStart: 1000, motion: 1, audioDbfs: -40 }],
      [{ bucketStart: 1000, motion: 1, audioDbfs: -18 }],
      [{ bucketStart: 1000, motion: 1 }],
    ])
    expect(fused).toEqual([{ bucketStart: 1000, motion: 3, audio: 0, audioDbfs: -18 }])
  })

  it('leaves a bucket level-less when no row has a level (never 0)', () => {
    const [row] = mergeDensityRows([[{ bucketStart: 1000, motion: 1 }], [{ bucketStart: 1000, motion: 2 }]])
    expect(row).toBeDefined()
    expect('audioDbfs' in row!).toBe(false)
  })

  it('a level-only bucket (counts 0) survives the merge and draws', () => {
    const fused = mergeDensityRows([[{ bucketStart: 1000, motion: 0, audio: 0, audioDbfs: -30 }]])
    expect(fused).toEqual([{ bucketStart: 1000, motion: 0, audio: 0, audioDbfs: -30 }])
    const [b] = densityToAudioBuckets(fused, 5_000)
    expect(b?.intensity).toBeGreaterThan(0)
  })

  it('treats a row with no audio field as zero audio rather than dropping it', () => {
    expect(mergeDensityRows([[{ bucketStart: 1000, motion: 1 }]])).toEqual([
      { bucketStart: 1000, motion: 1, audio: 0 },
    ])
  })
})

// ─── audioEventsToBuckets ─────────────────────────────────────────────

describe('audioEventsToBuckets', () => {
  const fromMs = 0
  const bucketMs = 10_000
  const count = 3

  it('creates exactly `count` buckets', () => {
    const buckets = audioEventsToBuckets([], fromMs, bucketMs, count)
    expect(buckets).toHaveLength(count)
  })

  it('empty events → all intensity 0', () => {
    const buckets = audioEventsToBuckets([], fromMs, bucketMs, count)
    expect(buckets.every((b) => b.intensity === 0)).toBe(true)
  })

  it('assigns dbfsToUnit of the max dbfs in each bucket', () => {
    // bucket 0: [0, 10000) → event at 5000 with dbfs=-30 → 0.5
    // bucket 1: [10000, 20000) → no events → 0
    const events = [{ timestamp: 5_000, dbfs: -30 }]
    const buckets = audioEventsToBuckets(events, fromMs, bucketMs, count)
    expect(buckets[0].intensity).toBeCloseTo(0.5, 5)
    expect(buckets[1].intensity).toBe(0)
    expect(buckets[2].intensity).toBe(0)
  })

  it('picks the max dbfs when multiple events fall in the same bucket', () => {
    const events = [
      { timestamp: 1_000, dbfs: -60 },  // → 0
      { timestamp: 2_000, dbfs: -20 },  // → 2/3
      { timestamp: 3_000, dbfs: -30 },  // → 0.5
    ]
    const buckets = audioEventsToBuckets(events, fromMs, bucketMs, count)
    // max dbfs in bucket 0 = -20 → dbfsToUnit(-20) ≈ 0.6667
    expect(buckets[0].intensity).toBeCloseTo(dbfsToUnit(-20), 5)
  })

  it('ignores events outside the [fromMs, fromMs + count*bucketMs) range', () => {
    const events = [
      { timestamp: fromMs - 1, dbfs: 0 },         // before range
      { timestamp: fromMs + count * bucketMs, dbfs: 0 }, // after range
    ]
    const buckets = audioEventsToBuckets(events, fromMs, bucketMs, count)
    expect(buckets.every((b) => b.intensity === 0)).toBe(true)
  })

  it('sets startMs/endMs correctly on each bucket', () => {
    const buckets = audioEventsToBuckets([], fromMs, bucketMs, count)
    for (let i = 0; i < count; i++) {
      expect(buckets[i].startMs).toBe(fromMs + i * bucketMs)
      expect(buckets[i].endMs).toBe(fromMs + (i + 1) * bucketMs)
    }
  })
})

// ─── tapeCountIntensity ───────────────────────────────────────────────

describe('tapeCountIntensity', () => {
  it('returns 0 for empty counts', () => {
    expect(tapeCountIntensity(0, 2000)).toBe(0)
    expect(tapeCountIntensity(10, 0)).toBe(0)
  })

  it('returns 1 at the peak', () => {
    expect(tapeCountIntensity(2000, 2000)).toBe(1)
  })

  it('floors a single overnight event so it still paints', () => {
    expect(tapeCountIntensity(1, 2000)).toBeGreaterThanOrEqual(0.35)
  })
})

describe('parseDensityRows', () => {
  it('keeps motion and audio counts from getEventDensity', () => {
    const rows = parseDensityRows([
      { bucketStart: 10, motion: 4, object: 1, audio: 7 },
      { bucketStart: 20, motion: 0, object: 0, audio: 0 },
    ])
    expect(rows).toEqual([
      { bucketStart: 10, motion: 4, audio: 7 },
      { bucketStart: 20, motion: 0, audio: 0 },
    ])
  })

  it('drops malformed rows', () => {
    expect(parseDensityRows([{ bucketStart: 'nope', motion: 1 }])).toEqual([])
    expect(parseDensityRows(null)).toEqual([])
  })
})

describe('densityToAudioBuckets', () => {
  /**
   * These two cases used to pin the COUNT contract — "the same tape scale as
   * motion, from density.audio", and "a lone overnight click must stay faint".
   * Both were faithful descriptions of the defect: the lane is drawn on the
   * six-rung dBFS meter, and a count has no business there. 50 events lit
   * 5 rungs of 5 whatever their volume, which is what the operator saw during
   * quiet hours.
   *
   * The contract is now the LEVEL the hub aggregates (D431). Loudness orders
   * the lane; the number of events does not enter it. See
   * `audio-lane-shows-a-level.spec.ts` for the full rules.
   */
  it('is ordered by loudness, and a busy quiet hour stays quiet', () => {
    const rows = [
      { bucketStart: 0, motion: 0, audio: 2000, audioDbfs: -52 },
      { bucketStart: 5_000, motion: 0, audio: 2, audioDbfs: -8 },
    ]
    const buckets = densityToAudioBuckets(rows, 5_000)
    expect(buckets[1].intensity).toBeGreaterThan(buckets[0].intensity)
    expect(buckets[0].intensity).toBeLessThan(0.2)
  })

  it('paints a lone LOUD click loudly — one event is not "faint" by arithmetic', () => {
    const [b] = densityToAudioBuckets(
      [{ bucketStart: 0, motion: 0, audio: 1, audioDbfs: -4 }],
      5_000,
    )
    // The old rule capped a single event below 0.5 because the count could not
    // distinguish a door slam from a bird. The level can.
    expect(b.intensity).toBeGreaterThan(0.8)
  })

  it('draws nothing when the hub reported no level for the bucket', () => {
    const [b] = densityToAudioBuckets([{ bucketStart: 0, motion: 0, audio: 1 }], 5_000)
    expect(b.intensity).toBe(0)
  })
})

// ─── pickBucketMs ─────────────────────────────────────────────────────

describe('pickBucketMs', () => {
  it('targets roughly 240 buckets by default', () => {
    const span = 6 * 3_600_000 // 6 hours
    const bms = pickBucketMs(0, span)
    const count = Math.round(span / bms)
    expect(count).toBeGreaterThanOrEqual(200)
    expect(count).toBeLessThanOrEqual(300)
  })

  it('clamps to minimum 5_000 ms', () => {
    // Very short span → would otherwise be < 5000
    expect(pickBucketMs(0, 100)).toBe(5_000)
  })

  it('clamps to maximum 3_600_000 ms', () => {
    // Very long span → would otherwise exceed 1 hour
    expect(pickBucketMs(0, 365 * 24 * 3_600_000)).toBe(3_600_000)
  })

  it('respects a custom target bucket count', () => {
    const span = 3_600_000 // 1 hour
    const bms = pickBucketMs(0, span, 60)
    const count = Math.round(span / bms)
    expect(count).toBeGreaterThanOrEqual(50)
    expect(count).toBeLessThanOrEqual(70)
  })
})
