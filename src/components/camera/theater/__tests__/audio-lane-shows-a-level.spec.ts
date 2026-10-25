/**
 * The audio lane shows a LEVEL, and a level is not a count.
 *
 * ## What it showed before
 *
 * `densityToAudioBuckets` read `DensityRow.audio` — the NUMBER of audio events
 * in the bucket — put it through `tapeCountIntensity` against a floor of 80,
 * and the result was painted on `audioPeakColor`, the same six-rung meter the
 * live view uses for dBFS. Measured:
 *
 * | events in the bucket | rungs lit |
 * | --- | --- |
 * | 5   | 2/5 |
 * | 20  | 4/5 |
 * | 50  | 5/5 — maximum |
 *
 * Fifty brief clicks in a quiet hour lit the whole meter, whatever their
 * volume. That is the operator's report, and it is a category error rather
 * than a scaling one.
 *
 * A dBFS path existed here (`audioEventsToBuckets`) with **zero callers**, and
 * it took the bucket's MAXIMUM — the thing the operator independently suspected
 * was wrong. It had sat there looking like the problem was solved.
 *
 * ## What it shows now
 *
 * The hub aggregates the peak dBFS per bucket (device-history) and ships one
 * number (`audioDbfs`, D431). A bucket with no audio event has NO level — the
 * field is absent — and the lane must draw nothing there rather than a zero,
 * because "nothing was heard" and "nothing was measured" are different claims
 * and only one of them belongs on a meter.
 */
import { describe, expect, it } from 'vitest'
import {
  densityToAudioBuckets,
  parseDensityRows,
} from '../activity-bars.js'

const T0 = 1_700_000_000_000
const BUCKET = 60_000

describe('parseDensityRows', () => {
  it('carries the level through when the hub sent one', () => {
    const rows = parseDensityRows([
      { bucketStart: T0, motion: 0, audio: 3, audioDbfs: -18.5 },
    ])
    expect(rows[0]?.audioDbfs).toBeCloseTo(-18.5, 6)
  })

  it('leaves the level UNDEFINED when the hub sent none', () => {
    const rows = parseDensityRows([{ bucketStart: T0, motion: 4, audio: 0 }])
    expect(rows[0]?.audioDbfs).toBeUndefined()
  })

  it('ignores a non-numeric level rather than trusting it', () => {
    const rows = parseDensityRows([
      { bucketStart: T0, motion: 0, audio: 1, audioDbfs: 'loud' },
    ])
    expect(rows[0]?.audioDbfs).toBeUndefined()
  })
})

describe('densityToAudioBuckets', () => {
  it('maps the LEVEL onto the meter, not the count', () => {
    // 50 events at a quiet -55 dBFS. The old count path lit every rung; the
    // level path must land near the bottom of the scale (floor -60).
    const buckets = densityToAudioBuckets(
      [{ bucketStart: T0, motion: 0, audio: 50, audioDbfs: -55 }],
      BUCKET,
    )
    expect(buckets[0]?.intensity).toBeLessThan(0.2)
  })

  it('lights the meter for a LOUD bucket, however few its events', () => {
    const buckets = densityToAudioBuckets(
      [{ bucketStart: T0, motion: 0, audio: 1, audioDbfs: -6 }],
      BUCKET,
    )
    expect(buckets[0]?.intensity).toBeGreaterThan(0.8)
  })

  it('is ordered by loudness, not by how much happened', () => {
    const [quietBusy, loudQuiet] = densityToAudioBuckets(
      [
        { bucketStart: T0, motion: 0, audio: 400, audioDbfs: -50 },
        { bucketStart: T0 + BUCKET, motion: 0, audio: 1, audioDbfs: -10 },
      ],
      BUCKET,
    )
    expect(loudQuiet?.intensity).toBeGreaterThan(quietBusy?.intensity ?? 1)
  })

  it('draws NOTHING for a bucket the hub could not measure', () => {
    // Not zero-with-a-hairline and not a count fallback: no level, no bar.
    const buckets = densityToAudioBuckets(
      [{ bucketStart: T0, motion: 9, audio: 0 }],
      BUCKET,
    )
    expect(buckets[0]?.intensity).toBe(0)
  })

  it('draws nothing for a bucket with events but no level from the hub', () => {
    // An older hub, or a level aggregation that failed: the count is NOT a
    // stand-in for a level. That substitution is the whole defect.
    const buckets = densityToAudioBuckets(
      [{ bucketStart: T0, motion: 0, audio: 120 }],
      BUCKET,
    )
    expect(buckets[0]?.intensity).toBe(0)
  })
})
