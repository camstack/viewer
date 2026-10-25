/**
 * ONE composition builds the day tape's bins, for every surface that draws one.
 *
 * The theater assembled its bins inline — detections, then motion, then audio —
 * and the on-demand overlay, which mounts the SAME `HeatmapBar`, assembled
 * nothing: it passed a module-level empty array. So the overlay's tape drew the
 * recording hairline and nothing else, which is exactly what the operator
 * reported ("only recordings"). A second surface that draws the same strip must
 * not have to re-derive the three lanes, or it will keep drawing fewer of them.
 *
 * The assertions are about what each SOURCE contributes and what each ABSENT
 * source leaves alone — an empty lane must be indistinguishable from the lane
 * not having been asked for, because that is what every caller relies on to
 * gate a lane by passing nothing.
 */
import { describe, it, expect } from 'vitest'
import { composeHeatmapBins } from '../event-highlights.js'
import { HEATMAP_BINS } from '../mock-data.js'
import type { Bucket } from '../activity-bars.js'
import type { DetectionLike } from '../event-highlights.js'

const DAY_START = new Date(2026, 8, 13, 0, 0, 0, 0).getTime()
const HOUR = 3600_000
const BIN_MS = (24 * HOUR) / HEATMAP_BINS

/** Index of the bin holding `hour`. */
const binAt = (hour: number): number => Math.floor((hour * HOUR) / BIN_MS)

const bucket = (hour: number, intensity: number): Bucket => ({
  startMs: DAY_START + hour * HOUR,
  endMs: DAY_START + hour * HOUR + BIN_MS,
  intensity,
})

const detection = (hour: number, className: string): DetectionLike => ({
  id: `d-${hour}-${className}`,
  timestamp: DAY_START + hour * HOUR,
  className,
})

describe('composeHeatmapBins', () => {
  it('always returns a full strip, even with nothing to draw', () => {
    const bins = composeHeatmapBins({ dayStartMs: DAY_START })
    expect(bins).toHaveLength(HEATMAP_BINS)
    expect(bins.every((b) => b.motion === 0 && b.audio === 0 && b.detection === 0)).toBe(true)
  })

  it('paints the motion lane from density buckets alone — no detections needed', () => {
    const bins = composeHeatmapBins({
      dayStartMs: DAY_START,
      motion: [bucket(3, 0.8)],
    })
    expect(bins[binAt(3)].motion).toBeCloseTo(0.8)
    expect(bins[binAt(9)].motion).toBe(0)
  })

  it('paints the audio lane from density buckets alone', () => {
    const bins = composeHeatmapBins({
      dayStartMs: DAY_START,
      audio: [bucket(20, 0.5)],
    })
    expect(bins[binAt(20)].audio).toBeCloseTo(0.5)
  })

  it('carries the detection lane and its dominant class colour', () => {
    const bins = composeHeatmapBins({
      dayStartMs: DAY_START,
      detections: [detection(7, 'person'), detection(7, 'person')],
    })
    expect(bins[binAt(7)].detection).toBeCloseTo(1)
    expect(bins[binAt(7)].detectionColor).toBeDefined()
  })

  it('composes all three lanes into the SAME bin without either overwriting the others', () => {
    const bins = composeHeatmapBins({
      dayStartMs: DAY_START,
      detections: [detection(11, 'person')],
      motion: [bucket(11, 0.6)],
      audio: [bucket(11, 0.4)],
    })
    const b = bins[binAt(11)]
    expect(b.detection).toBeCloseTo(1)
    expect(b.motion).toBeCloseTo(0.6)
    expect(b.audio).toBeCloseTo(0.4)
  })

  it('an omitted source is the same as an empty one — that is how a caller gates a lane', () => {
    const omitted = composeHeatmapBins({ dayStartMs: DAY_START, motion: [bucket(5, 0.9)] })
    const empty = composeHeatmapBins({
      dayStartMs: DAY_START,
      detections: [],
      motion: [bucket(5, 0.9)],
      audio: [],
    })
    expect(omitted).toEqual(empty)
  })
})
