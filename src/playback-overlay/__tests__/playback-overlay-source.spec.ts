import { describe, it, expect } from 'vitest'
import {
  normalizeTracks,
  frameAt,
  boxesAt,
  motionEpisodes,
  resolveCoverage,
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
  it('an unanswered or failed read is unknown', () => {
    expect(resolveCoverage({ answered: false, windowTracks: 0, probeTracks: 0 })).toBe('unknown')
  })
  it('frameAt on unknown coverage hides the overlays', () => {
    expect(frameAt({ tracks: [], coverage: 'unknown' }, 12_000)).toEqual({ availability: 'unknown' })
  })
  it('known + empty is an explicit empty frame, not unknown', () => {
    const f = frameAt({ tracks: [], coverage: 'known' }, 12_000)
    expect(f).toEqual({ availability: 'known', boxes: [], occupancy: [], motion: false, audioDbfs: null })
  })
})

describe('normalizeTracks', () => {
  it('skips malformed rows and positions', () => {
    const out = normalizeTracks([null, { trackId: 1 }, { ...walker, positions: [{ bad: true }, ...walker.positions] }])
    expect(out).toHaveLength(1)
    expect(out[0]?.samples).toHaveLength(3)
  })
})
