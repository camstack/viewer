import { describe, it, expect } from 'vitest'
import {
  normalizeTracks,
  frameAt,
  boxesAt,
  motionEpisodes,
  resolveCoverage,
  parseAudioSeries,
  audioAt,
  parseMotionEvents,
  AUDIO_LEVEL_HISTORY_KEY,
  type OverlayTrack,
} from '../playback-overlay-source'

/** A 1000×500 frame; positions carry pixel boxes and a normalised centre. */
function row(id: string, className: string, firstSeen: number, lastSeen: number, pts: readonly [number, number, number][]) {
  return {
    trackId: id,
    className,
    firstSeen,
    lastSeen,
    envelope: { minX: 0.1, minY: 0.2, maxX: 0.6, maxY: 0.6 },
    positions: pts.map(([timestamp, px, py]) => ({
      timestamp,
      x: (px + 50) / 1000,
      y: (py + 50) / 500,
      bbox: { x: px, y: py, w: 100, h: 100 },
      score: 0.8,
    })),
  }
}

const walker = row('a', 'person', 10_000, 14_000, [
  [10_000, 100, 100],
  [12_000, 300, 200],
  [14_000, 500, 100],
])

function tracksOf(...rows: unknown[]): readonly OverlayTrack[] {
  return normalizeTracks(rows)
}

describe('boxesAt — interpolation', () => {
  it('interpolates the box between two positions at the playback time', () => {
    const [box] = boxesAt(tracksOf(walker), 11_000)
    // halfway between (100,100) and (300,200) px on a 1000×500 frame
    expect(box?.x1).toBeCloseTo(0.2, 2)
    expect(box?.y1).toBeCloseTo(0.3, 2)
    expect(box?.x2 - (box?.x1 ?? 0)).toBeCloseTo(0.1, 2)
    expect(box?.label).toBe('person')
  })

  it('is exact on a sample and carries the stored score', () => {
    const [box] = boxesAt(tracksOf(walker), 12_000)
    expect(box?.x1).toBeCloseTo(0.3, 3)
    expect(box?.score).toBeCloseTo(0.8, 3)
  })

  it('draws nothing across a hole in the positions longer than the hold', () => {
    const gappy = row('g', 'car', 10_000, 40_000, [
      [10_000, 100, 100],
      [40_000, 500, 100],
    ])
    expect(boxesAt(tracksOf(gappy), 25_000)).toEqual([])
  })
})

describe('track alive / dead edges', () => {
  it('is dead before firstSeen and after lastSeen, alive on both edges', () => {
    const t = tracksOf(walker)
    expect(boxesAt(t, 9_999)).toEqual([])
    expect(boxesAt(t, 10_000)).toHaveLength(1)
    expect(boxesAt(t, 14_000)).toHaveLength(1)
    expect(boxesAt(t, 14_001)).toEqual([])
  })

  it('occupancy is the tracks alive at t, per class', () => {
    const car = row('c', 'car', 11_000, 13_000, [[11_000, 0, 0], [13_000, 50, 0]])
    const f = frameAt({ tracks: tracksOf(walker, car), coverage: 'known' }, 12_000)
    expect(f.availability).toBe('known')
    if (f.availability !== 'known') return
    expect(f.occupancy).toEqual([
      { className: 'car', count: 1 },
      { className: 'person', count: 1 },
    ])
    const after = frameAt({ tracks: tracksOf(walker, car), coverage: 'known' }, 13_500)
    if (after.availability !== 'known') throw new Error('expected known')
    expect(after.occupancy).toEqual([{ className: 'person', count: 1 }])
  })

  it('motion follows the episode edges of the merged track spans', () => {
    const eps = motionEpisodes(tracksOf(walker, row('b', 'person', 15_000, 16_000, [[15_000, 0, 0]])))
    // 14 000 → 15 000 is a 1 s gap: one episode
    expect(eps).toEqual([{ start: 10_000, end: 16_000 }])
    const far = motionEpisodes(tracksOf(walker, row('b', 'person', 30_000, 31_000, [[30_000, 0, 0]])))
    expect(far).toHaveLength(2)
    const src = { tracks: tracksOf(walker), coverage: 'known' as const }
    const on = frameAt(src, 12_000)
    const off = frameAt(src, 20_000)
    expect(on.availability === 'known' && on.motion).toBe(true)
    expect(off.availability === 'known' && off.motion).toBe(false)
  })

  it('never invents an audio level', () => {
    const f = frameAt({ tracks: tracksOf(walker), coverage: 'known' }, 12_000)
    expect(f.availability === 'known' && f.audioDbfs).toBeNull()
  })
})

describe('pruned range is UNKNOWN, never "no detections"', () => {
  it('an empty window with nothing older answers unknown', () => {
    expect(resolveCoverage({ answered: true, windowTracks: 0, probeTracks: 0 })).toBe('unknown')
  })
  it('an empty window with older history is a genuinely quiet range', () => {
    expect(resolveCoverage({ answered: true, windowTracks: 0, probeTracks: 1 })).toBe('known')
  })
  it('a window with tracks is known', () => {
    expect(resolveCoverage({ answered: true, windowTracks: 3, probeTracks: 0 })).toBe('known')
  })
  it('a truncated read is unknown', () => {
    expect(resolveCoverage({ answered: true, windowTracks: 500, probeTracks: 1, truncated: true })).toBe('unknown')
  })
  it('an unanswered or failed read is unknown', () => {
    expect(resolveCoverage({ answered: false, windowTracks: 0, probeTracks: 0 })).toBe('unknown')
  })
  it('frameAt on unknown coverage hides the overlays', () => {
    expect(frameAt({ tracks: [], coverage: 'unknown' }, 12_000)).toEqual({ availability: 'unknown' })
  })
  it('known + empty is an explicit empty frame, not unknown', () => {
    const f = frameAt({ tracks: [], coverage: 'known' }, 12_000)
    expect(f).toEqual({ availability: 'known', boxes: [], occupancy: [], motion: false, audioDbfs: null, motionRegions: [] })
  })
})

describe('normalizeTracks', () => {
  it('skips malformed rows and positions', () => {
    const out = normalizeTracks([null, { trackId: 1 }, { ...walker, positions: [{ bad: true }, ...walker.positions] }])
    expect(out).toHaveLength(1)
    expect(out[0]?.samples).toHaveLength(3)
  })
})

// ── planning#745: audio level and motion episodes in recorded playback ───────

function audioAnswer(points: readonly { t: number; last: number | null; mean: number | null }[]): unknown {
  return {
    resolution: 'raw',
    truncated: false,
    series: [{ scope: '', before: null, derivedFrom: null, points: points.map((p) => ({ min: -60, max: -20, samples: 1, ...p })) }],
  }
}

describe('stored audio level', () => {
  const answer = audioAnswer([
    { t: 100_000, last: -50, mean: -51 },
    { t: 110_000, last: -30, mean: -31 },
    { t: 120_000, last: null, mean: -40 },
  ])

  it('is read from the history key the hub stores it under', () => {
    expect(AUDIO_LEVEL_HISTORY_KEY).toBe('addon:pipeline-analytics/audio-level')
  })

  it('shows the latest stored level at or before the playback position', () => {
    const series = parseAudioSeries(answer)
    expect(audioAt(series, 100_000)).toBe(-50)
    expect(audioAt(series, 109_999)).toBe(-50)
    expect(audioAt(series, 112_000)).toBe(-30)
  })

  it('falls back to the mean when a point has no last value', () => {
    expect(audioAt(parseAudioSeries(answer), 121_000)).toBe(-40)
  })

  it('a query that did not answer, or answered no point, is unknown — never 0 (D315/D393)', () => {
    expect(parseAudioSeries(null)).toBeNull()
    expect(parseAudioSeries({ series: [] })).toBeNull()
    expect(parseAudioSeries(audioAnswer([]))).toBeNull()
    expect(audioAt(null, 100_000)).toBeNull()
    expect(audioAt(undefined, 100_000)).toBeNull()
  })

  it('a hole wider than the hold is unknown, and so is a time before the first point', () => {
    const series = parseAudioSeries(answer)
    expect(audioAt(series, 99_000)).toBeNull()
    expect(audioAt(series, 400_000)).toBeNull()
  })

  it('frameAt carries the level into the frame, and null when no series was read', () => {
    const withAudio = frameAt({ tracks: [], coverage: 'known', audio: parseAudioSeries(answer) }, 112_000)
    expect(withAudio.availability === 'known' && withAudio.audioDbfs).toBe(-30)
    const without = frameAt({ tracks: [], coverage: 'known', audio: null }, 112_000)
    expect(without.availability === 'known' && without.audioDbfs).toBeNull()
  })
})

describe('stored motion episodes', () => {
  const row = (timestamp: number, durationMs: number | null | undefined, extra: Record<string, unknown> = {}) => ({
    id: 1,
    deviceId: 1,
    kind: 'motion',
    timestamp,
    regionCount: 1,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...extra,
  })

  it('motion is on inside a stored episode and off outside it, with no track involved', () => {
    const motion = parseMotionEvents([row(50_000, 4_000)], 0)
    const inside = frameAt({ tracks: [], coverage: 'known', motion }, 52_000)
    const outside = frameAt({ tracks: [], coverage: 'known', motion }, 70_000)
    expect(inside.availability === 'known' && inside.motion).toBe(true)
    expect(outside.availability === 'known' && outside.motion).toBe(false)
  })

  it('an answered empty list is "no motion" even where a track was alive', () => {
    const track = normalizeTracks([row2()])
    const frame = frameAt({ tracks: track, coverage: 'known', motion: [] }, 12_000)
    expect(frame.availability === 'known' && frame.motion).toBe(false)
  })

  it('an unanswered read (null) falls back to the tracks spans', () => {
    const track = normalizeTracks([row2()])
    const frame = frameAt({ tracks: track, coverage: 'known', motion: null }, 12_000)
    expect(frame.availability === 'known' && frame.motion).toBe(true)
  })

  it('an open episode (durationMs null) runs to now; an absent duration is NOT open', () => {
    const [open] = parseMotionEvents([row(50_000, null)], 90_000) ?? []
    expect(open?.end).toBeGreaterThanOrEqual(90_000)
    const [legacy] = parseMotionEvents([row(50_000, undefined)], 90_000) ?? []
    expect(legacy?.end).toBeLessThan(60_000)
  })

  it('not a list = unknown', () => {
    expect(parseMotionEvents(null, 0)).toBeNull()
    expect(parseMotionEvents({}, 0)).toBeNull()
  })

  it('carries the stored regions, normalised to the frame, while the episode runs', () => {
    const motion = parseMotionEvents(
      [row(50_000, 4_000, { frameWidth: 1000, frameHeight: 500, regions: [{ bbox: { x: 100, y: 50, w: 200, h: 100 }, pixelCount: 900, intensity: 1 }] })],
      0,
    )
    const frame = frameAt({ tracks: [], coverage: 'known', motion }, 51_000)
    expect(frame.availability === 'known' && frame.motionRegions).toEqual([{ x: 0.1, y: 0.1, w: 0.2, h: 0.2, pixelCount: 900 }])
    const after = frameAt({ tracks: [], coverage: 'known', motion }, 80_000)
    expect(after.availability === 'known' && after.motionRegions).toEqual([])
  })
})

function row2() {
  return {
    trackId: 'm',
    className: 'person',
    firstSeen: 10_000,
    lastSeen: 14_000,
    envelope: { minX: 0.1, minY: 0.2, maxX: 0.6, maxY: 0.6 },
    positions: [{ timestamp: 10_000, x: 0.15, y: 0.3, bbox: { x: 100, y: 100, w: 100, h: 100 } }],
  }
}
