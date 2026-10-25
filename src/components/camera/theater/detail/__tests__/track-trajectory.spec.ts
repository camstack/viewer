import { describe, it, expect } from 'vitest'
import {
  parseTrackPositions,
  buildTrackTrajectory,
  pickTrajectoryBase,
  dwellMs,
  trajectorySampleCount,
  trajectorySpanMs,
  pointToScreen,
  normalizedRectToScreen,
  arrowHeadPoints,
  nodeRadius,
  FULL_FRAME_COVERAGE,
  DWELL_COLLAPSE_EPS,
  type TrackPositionSample,
} from '../track-trajectory.js'
import type { MediaGroup } from '../../../../../data/track-media-groups.js'
import type { MediaFileLite } from '../../../../../data/track-events.js'
import type { ScreenRect } from '../cluster-detail.js'

/** Shorthand: a position sample in detection-frame pixels. */
function pos(x: number, y: number, w: number, h: number, timestamp: number): TrackPositionSample {
  return { bbox: { x, y, w, h }, timestamp }
}

/**
 * REAL data, verified against the live hub on 2026-08-02:
 * track 148d4860… (device 101, a car): 3 leading DEGENERATE near-full-frame
 * boxes (637.2×341.4 at the origin — motion placeholder, no localization),
 * then real boxes walking left, then 11 IDENTICAL trailing samples (the car
 * parked). Envelope {0, 0, 0.995625, 0.94833…} → frame recovers 640×360.
 */
const CAR_ENVELOPE = { x: 0, y: 0, w: 0.9956250000000001, h: 0.9483333333333333 }
const CAR_POSITIONS: readonly TrackPositionSample[] = [
  pos(0, 0, 637.2, 341.4, 1785599848458),
  pos(0, 0, 637.2, 341.4, 1785599848469),
  pos(0, 0, 637.2, 341.4, 1785599848776),
  pos(503.8, 0, 109.4, 124.0, 1785599848826),
  pos(497.5, 0, 112.0, 120.2, 1785599848960),
  pos(493.8, 0, 114.4, 115.2, 1785599849267),
  pos(459.2, 0, 153.6, 78.4, 1785599849492),
  pos(449.2, 0, 119.6, 74.6, 1785599849586),
  pos(444.2, 0, 119.6, 64.6, 1785599849646),
  pos(438.0, 0, 122.0, 60.2, 1785599849735),
  pos(429.2, 0, 124.6, 54.0, 1785599849814),
  pos(418.6, 0, 130.8, 54.0, 1785599849897),
  pos(414.8, 0, 133.4, 50.3, 1785599849968),
  pos(400.1, 0, 133.3, 44.0, 1785599850071),
  pos(390.7, 0, 137.1, 39.0, 1785599850160),
  pos(390.7, 0, 137.1, 39.0, 1785599850539),
  pos(390.7, 0, 137.1, 39.0, 1785599850900),
  pos(390.7, 0, 137.1, 39.0, 1785599851317),
  pos(390.7, 0, 137.1, 39.0, 1785599851638),
  pos(390.7, 0, 137.1, 39.0, 1785599852032),
  pos(390.7, 0, 137.1, 39.0, 1785599852426),
  pos(390.7, 0, 137.1, 39.0, 1785599852820),
  pos(390.7, 0, 137.1, 39.0, 1785599853348),
  pos(390.7, 0, 137.1, 39.0, 1785599853546),
  pos(390.7, 0, 137.1, 39.0, 1785599853921),
]

/** REAL data: track 6eaa0a16… — the stationary phantom. 8 samples, every one
 *  the SAME near-full-frame degenerate box (totalDistance: 0). */
const PHANTOM_POSITIONS: readonly TrackPositionSample[] = [
  pos(0, 0, 637.2, 341.4, 1785601438235),
  pos(0, 0, 637.2, 341.4, 1785601438326),
  pos(0, 0, 637.2, 341.4, 1785601439372),
  pos(0, 0, 637.2, 341.4, 1785601439643),
  pos(0, 0, 637.2, 341.4, 1785601440678),
  pos(0, 0, 637.2, 341.4, 1785601440724),
  pos(0, 0, 637.2, 341.4, 1785601441171),
  pos(0, 0, 637.2, 341.4, 1785601441472),
]

describe('parseTrackPositions', () => {
  it('extracts bbox + timestamp from a raw getTrack row', () => {
    const row = {
      positions: [
        { bbox: { x: 1, y: 2, w: 3, h: 4 }, timestamp: 100, x: 2.5, y: 4 },
        { bbox: { x: 5, y: 6, w: 7, h: 8 }, timestamp: 200 },
      ],
    }
    expect(parseTrackPositions(row)).toEqual([
      { bbox: { x: 1, y: 2, w: 3, h: 4 }, timestamp: 100 },
      { bbox: { x: 5, y: 6, w: 7, h: 8 }, timestamp: 200 },
    ])
  })

  it('skips malformed entries, degenerate boxes, and tolerates a missing timestamp', () => {
    const row = {
      positions: [
        null,
        { bbox: { x: 0, y: 0, w: 0, h: 5 }, timestamp: 1 }, // zero width → skipped
        { bbox: { x: 0, y: 0, w: 5, h: 5 } }, // no timestamp → kept, ts 0
        { bbox: { x: 'a', y: 0, w: 5, h: 5 }, timestamp: 1 }, // NaN coords → skipped
      ],
    }
    expect(parseTrackPositions(row)).toEqual([{ bbox: { x: 0, y: 0, w: 5, h: 5 }, timestamp: 0 }])
  })

  it('returns [] for non-rows', () => {
    expect(parseTrackPositions(null)).toEqual([])
    expect(parseTrackPositions({ positions: 'x' })).toEqual([])
    expect(parseTrackPositions(undefined)).toEqual([])
  })
})

describe('buildTrackTrajectory — the real car track', () => {
  const traj = buildTrackTrajectory(CAR_POSITIONS, CAR_ENVELOPE)

  it('recovers the EXACT detection frame from the envelope (640×360)', () => {
    expect(traj).not.toBeNull()
    expect(traj?.frame.w).toBeCloseTo(640, 1)
    expect(traj?.frame.h).toBeCloseTo(360, 1)
  })

  it('classifies the 3 leading near-full-frame boxes as UNLOCALIZED, not path points', () => {
    expect(traj?.unlocalized).not.toBeNull()
    expect(traj?.unlocalized?.samples).toBe(3)
    expect(traj?.unlocalized?.firstTs).toBe(1785599848458)
    expect(traj?.unlocalized?.lastTs).toBe(1785599848776)
  })

  it('collapses the 11 identical trailing samples into ONE dwell node', () => {
    expect(traj).not.toBeNull()
    if (traj === null) return
    const last = traj.nodes[traj.nodes.length - 1]
    expect(last?.samples).toBe(11)
    expect(last ? dwellMs(last) : 0).toBe(1785599853921 - 1785599850160)
    // The dwell node sits at the parked box's center, normalized.
    expect(last?.x).toBeCloseTo((390.7 + 137.1 / 2) / 640, 3)
    expect(last?.y).toBeCloseTo((0 + 39.0 / 2) / 360, 3)
  })

  it('keeps the moving samples as a time-ordered path (direction preserved)', () => {
    expect(traj).not.toBeNull()
    if (traj === null) return
    expect(traj.nodes.length).toBeGreaterThanOrEqual(3)
    // The car moved right→left: x strictly non-increasing across nodes.
    for (let i = 1; i < traj.nodes.length; i += 1) {
      expect(traj.nodes[i]!.x).toBeLessThanOrEqual(traj.nodes[i - 1]!.x + 1e-9)
    }
    // Every node center stays inside the normalized frame.
    for (const n of traj.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.x).toBeLessThanOrEqual(1)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeLessThanOrEqual(1)
    }
  })

  it('accounts for every sample exactly once', () => {
    expect(traj).not.toBeNull()
    if (traj === null) return
    const pathSamples = traj.nodes.reduce((acc, n) => acc + n.samples, 0)
    expect(pathSamples + (traj.unlocalized?.samples ?? 0)).toBe(CAR_POSITIONS.length)
    expect(trajectorySampleCount(traj)).toBe(CAR_POSITIONS.length)
    expect(trajectorySpanMs(traj)).toBe(1785599853921 - 1785599848458)
  })
})

describe('buildTrackTrajectory — the stationary phantom (8 identical full-frame boxes)', () => {
  const traj = buildTrackTrajectory(PHANTOM_POSITIONS, CAR_ENVELOPE)

  it('yields NO path nodes — a frame-covering box carries no position', () => {
    expect(traj).not.toBeNull()
    expect(traj?.nodes).toEqual([])
  })

  it('reports the samples honestly as one unlocalized summary (never a fake center dot)', () => {
    expect(traj?.unlocalized?.samples).toBe(8)
    expect(traj?.unlocalized?.firstTs).toBe(1785601438235)
    expect(traj?.unlocalized?.lastTs).toBe(1785601441472)
    // The unlocalized region is the (normalized) box itself — near the full frame.
    expect(traj?.unlocalized?.bbox.w).toBeGreaterThan(FULL_FRAME_COVERAGE)
    expect(traj?.unlocalized?.bbox.h).toBeGreaterThan(FULL_FRAME_COVERAGE)
  })
})

describe('buildTrackTrajectory — a genuinely stationary SMALL subject', () => {
  it('collapses identical small boxes into one dwell node with the full time span', () => {
    const samples = [
      pos(100, 200, 40, 80, 1000),
      pos(100, 200, 40, 80, 3000),
      pos(100, 200, 40, 80, 9000),
    ]
    // No envelope → frame falls back to the max-extent estimate; the geometry
    // still collapses to one node.
    const traj = buildTrackTrajectory(samples, null)
    expect(traj).not.toBeNull()
    expect(traj?.nodes.length).toBe(1)
    expect(traj?.nodes[0]?.samples).toBe(3)
    expect(traj?.nodes[0] ? dwellMs(traj.nodes[0]) : 0).toBe(8000)
    expect(traj?.unlocalized).toBeNull()
  })

  it('does NOT collapse two clearly distinct positions', () => {
    const samples = [pos(0, 0, 40, 40, 0), pos(300, 200, 40, 40, 1000)]
    const traj = buildTrackTrajectory(samples, null)
    expect(traj?.nodes.length).toBe(2)
  })

  it('collapses sub-epsilon jitter into the same dwell node', () => {
    // Envelope consistent with a 640×360 frame (extent 41×40 px normalised by
    // it) → the recovery pins 640×360, and a 1px wiggle is below the epsilon.
    const samples = [pos(300, 100, 40, 40, 0), pos(301, 100, 40, 40, 500)]
    const traj = buildTrackTrajectory(samples, { x: 300 / 640, y: 100 / 360, w: 41 / 640, h: 40 / 360 })
    expect(DWELL_COLLAPSE_EPS).toBeGreaterThan(1 / 640)
    expect(traj?.nodes.length).toBe(1)
    expect(traj?.nodes[0]?.samples).toBe(2)
  })
})

describe('buildTrackTrajectory — degenerate inputs', () => {
  it('null for no positions', () => {
    expect(buildTrackTrajectory([], CAR_ENVELOPE)).toBeNull()
    expect(buildTrackTrajectory([], null)).toBeNull()
  })
})

describe('pickTrajectoryBase — which stored frame the path is drawn on', () => {
  function file(key: string, kind: string): MediaFileLite {
    return { url: `/addon/pipeline-analytics/event-media/m/${key}`, kind, timestamp: 0 }
  }
  function group(logicalKind: MediaGroup['logicalKind'], key: string): MediaGroup {
    const f = file(key, logicalKind)
    return { id: `L:${logicalKind}:${key}`, logicalKind, display: f, full: f, hasFullVariant: false, timestamp: 0 }
  }
  function displayKey(g: MediaGroup | null): string | undefined {
    return g?.display.url?.split('/').pop()
  }

  it('prefers the clean keyFrame — the full frame of the track BEST detection', () => {
    const groups = [
      group('bestShot', 'a'),
      group('firstFrame', 'b'),
      group('keyFrame', 'c'),
      group('frame', 'd'),
    ]
    expect(displayKey(pickTrajectoryBase(groups))).toBe('c')
  })

  it('falls back through frame → firstFrame → lastFrame → snapshot → frameBoxed', () => {
    expect(
      displayKey(pickTrajectoryBase([group('frameBoxed', 'x'), group('snapshot', 's'), group('lastFrame', 'l')])),
    ).toBe('l')
    expect(displayKey(pickTrajectoryBase([group('frameBoxed', 'x'), group('snapshot', 's')]))).toBe('s')
    expect(displayKey(pickTrajectoryBase([group('frameBoxed', 'x')]))).toBe('x')
  })

  it('NEVER picks a crop — points cannot be drawn on a cropped image', () => {
    const cropsOnly = [group('bestShot', 'a'), group('objectCrop', 'b'), group('face', 'f'), group('plate', 'p')]
    expect(pickTrajectoryBase(cropsOnly)).toBeNull()
    expect(pickTrajectoryBase([])).toBeNull()
  })
})

describe('screen projection helpers', () => {
  const image: ScreenRect = { left: 10, top: 20, width: 320, height: 180 }

  it('pointToScreen maps normalized coords onto the contain-rendered image rect', () => {
    expect(pointToScreen(0, 0, image)).toEqual({ x: 10, y: 20 })
    expect(pointToScreen(1, 1, image)).toEqual({ x: 330, y: 200 })
    expect(pointToScreen(0.5, 0.5, image)).toEqual({ x: 170, y: 110 })
  })

  it('normalizedRectToScreen maps a normalized rect the same way', () => {
    expect(normalizedRectToScreen({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, image)).toEqual({
      left: 90, top: 110, width: 160, height: 45,
    })
  })

  it('arrowHeadPoints yields a 3-point polygon oriented along the segment', () => {
    const pts = arrowHeadPoints({ x: 0, y: 0 }, { x: 10, y: 0 }, 6)
    const coords = pts.split(' ').map((p) => p.split(',').map(Number))
    expect(coords.length).toBe(3)
    // Tip at the segment end.
    expect(coords[0]![0]).toBeCloseTo(10)
    expect(coords[0]![1]).toBeCloseTo(0)
    // Wings behind the tip.
    expect(coords[1]![0]).toBeLessThan(10)
    expect(coords[2]![0]).toBeLessThan(10)
  })

  it('nodeRadius grows with dwell but stays bounded', () => {
    const instant = nodeRadius({ x: 0, y: 0, samples: 1, firstTs: 0, lastTs: 0, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 } })
    const parked = nodeRadius({ x: 0, y: 0, samples: 11, firstTs: 0, lastTs: 3_761, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 } })
    const forever = nodeRadius({ x: 0, y: 0, samples: 500, firstTs: 0, lastTs: 3_600_000, bbox: { x: 0, y: 0, w: 0.1, h: 0.1 } })
    expect(parked).toBeGreaterThan(instant)
    expect(forever).toBeGreaterThan(parked)
    expect(forever).toBeLessThanOrEqual(12)
  })
})
