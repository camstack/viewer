import { describe, it, expect } from 'vitest'
import {
  rectsIntersect,
  normalizeRect,
  estimateFrameSize,
  frameSizeFromEnvelope,
  resolveFrameSize,
  parsePositionBoxes,
  parseNormalizedEnvelope,
  trackMatchesZone,
  filterEventsByZone,
  dragToRect,
  isZoneUsable,
  MIN_ZONE_FRACTION,
  type PixelRect,
  type ZoneFilterable,
  type ZoneRect,
  rectShape,
} from '../zone-filter.js'

const FRAME = { w: 1280, h: 720 }

function zone(x: number, y: number, w: number, h: number): ZoneRect {
  return { x, y, w, h }
}

function box(x: number, y: number, w: number, h: number): PixelRect {
  return { x, y, w, h }
}

describe('rectsIntersect', () => {
  it('detects overlapping rects', () => {
    expect(rectsIntersect(zone(0, 0, 0.5, 0.5), zone(0.4, 0.4, 0.2, 0.2))).toBe(true)
  })

  it('detects containment (either direction)', () => {
    expect(rectsIntersect(zone(0, 0, 1, 1), zone(0.4, 0.4, 0.1, 0.1))).toBe(true)
    expect(rectsIntersect(zone(0.4, 0.4, 0.1, 0.1), zone(0, 0, 1, 1))).toBe(true)
  })

  it('rejects disjoint rects', () => {
    expect(rectsIntersect(zone(0, 0, 0.3, 0.3), zone(0.5, 0.5, 0.3, 0.3))).toBe(false)
  })

  it('mere edge contact does not count as an intersection', () => {
    expect(rectsIntersect(zone(0, 0, 0.5, 0.5), zone(0.5, 0, 0.5, 0.5))).toBe(false)
  })
})

describe('normalizeRect', () => {
  it('maps pixel coords onto 0..1 of the frame', () => {
    expect(normalizeRect(box(640, 360, 128, 72), FRAME)).toEqual({
      x: 0.5,
      y: 0.5,
      w: 0.1,
      h: 0.1,
    })
  })

  it('returns null for a degenerate frame', () => {
    expect(normalizeRect(box(0, 0, 10, 10), { w: 0, h: 720 })).toBeNull()
    expect(normalizeRect(box(0, 0, 10, 10), { w: 1280, h: 0 })).toBeNull()
  })
})

describe('estimateFrameSize', () => {
  it('takes the max extent across every track', () => {
    expect(
      estimateFrameSize([
        [box(0, 0, 100, 50)],
        [box(1000, 600, 280, 120), box(50, 50, 10, 10)],
      ]),
    ).toEqual({ w: 1280, h: 720 })
  })

  it('returns null when no track carries geometry', () => {
    expect(estimateFrameSize([])).toBeNull()
    expect(estimateFrameSize([[], []])).toBeNull()
  })
})

describe('frameSizeFromEnvelope / resolveFrameSize', () => {
  /**
   * The live shape, reproduced: device 101's real detection frame is 640×360,
   * and one track that crossed part of it carries both its pixel positions and
   * the server's normalised envelope of the SAME extent. Dividing one by the
   * other must return the frame exactly — this is the arithmetic 1000 live rows
   * agreed on, and the reason the filter no longer has to guess.
   */
  const walker: ZoneFilterable = {
    positionBoxes: [box(64, 36, 32, 18), box(512, 288, 32, 18)],
    // (64 → 544) / 640 = 0.1 → 0.85 ; (36 → 306) / 360 = 0.1 → 0.85
    normalizedEnvelope: { x: 0.1, y: 0.1, w: 0.75, h: 0.75 },
  }

  it('recovers the exact frame from one track carrying both spaces', () => {
    const frame = frameSizeFromEnvelope(walker.positionBoxes, walker.normalizedEnvelope)
    expect(frame?.w).toBeCloseTo(640, 6)
    expect(frame?.h).toBeCloseTo(360, 6)
  })

  it('refuses to divide by an envelope too small to be a scale', () => {
    // A track that barely moved: the server's rounding would be amplified into
    // tens of pixels of frame size.
    expect(
      frameSizeFromEnvelope([box(100, 100, 4, 4)], { x: 0.5, y: 0.5, w: 0.001, h: 0.001 }),
    ).toBeNull()
  })

  it('needs both spaces — neither alone is a scale', () => {
    expect(frameSizeFromEnvelope(walker.positionBoxes, undefined)).toBeNull()
    expect(frameSizeFromEnvelope(undefined, walker.normalizedEnvelope)).toBeNull()
    expect(frameSizeFromEnvelope([], walker.normalizedEnvelope)).toBeNull()
  })

  it('resolveFrameSize prefers the exact recovery over the max-extent estimate', () => {
    // THE REGRESSION, in one assertion. These tracks never reach the bottom of
    // the picture, so the estimate under-sizes the frame to 544×306 and every
    // track lands at ~1.18× its true normalised Y. Measured on the live hub the
    // same way: device 101's single-day window estimated 630×175 against a real
    // 640×360 — a 2.06× vertical error, which is why a zone drawn low matched
    // nothing at all.
    expect(estimateFrameSize([walker.positionBoxes ?? []])).toEqual({ w: 544, h: 306 })
    const resolved = resolveFrameSize([walker])
    expect(resolved?.w).toBeCloseTo(640, 6)
    expect(resolved?.h).toBeCloseTo(360, 6)
  })

  it('takes the MEDIAN so one anomalous row cannot re-scale the filter', () => {
    const rogue: ZoneFilterable = {
      positionBoxes: [box(0, 0, 100, 100), box(1000, 1000, 100, 100)],
      normalizedEnvelope: { x: 0, y: 0, w: 0.5, h: 0.5 }, // implies 2200×2200
    }
    const frame = resolveFrameSize([walker, walker, rogue])
    expect(frame?.w).toBeCloseTo(640, 6)
    expect(frame?.h).toBeCloseTo(360, 6)
  })

  it('falls back to the estimate only when NO item carries an envelope', () => {
    const legacy: ZoneFilterable = { positionBoxes: [box(0, 0, 1280, 720)] }
    expect(resolveFrameSize([legacy])).toEqual({ w: 1280, h: 720 })
    expect(resolveFrameSize([])).toBeNull()
  })
})

describe('parseNormalizedEnvelope', () => {
  it('converts the server min/max envelope into a normalised rect', () => {
    const rect = parseNormalizedEnvelope({
      envelope: { minX: 0.25, minY: 0.5, maxX: 0.75, maxY: 0.9 },
    })
    expect(rect?.x).toBe(0.25)
    expect(rect?.y).toBe(0.5)
    expect(rect?.w).toBeCloseTo(0.5, 10)
    expect(rect?.h).toBeCloseTo(0.4, 10)
  })

  it('accepts a degenerate (point) envelope — the caller decides it is too small', () => {
    expect(
      parseNormalizedEnvelope({ envelope: { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 } }),
    ).toEqual({ x: 0.5, y: 0.5, w: 0, h: 0 })
  })

  it('returns null for a row with no / malformed / inverted envelope', () => {
    expect(parseNormalizedEnvelope({})).toBeNull()
    expect(parseNormalizedEnvelope(null)).toBeNull()
    expect(parseNormalizedEnvelope({ envelope: { minX: 0, minY: 0, maxX: 'x', maxY: 1 } })).toBeNull()
    expect(parseNormalizedEnvelope({ envelope: { minX: 0, minY: 0, maxX: Number.NaN, maxY: 1 } })).toBeNull()
    expect(parseNormalizedEnvelope({ envelope: { minX: 0.9, minY: 0, maxX: 0.1, maxY: 1 } })).toBeNull()
  })
})

describe('parsePositionBoxes', () => {
  it('extracts the pixel bboxes of a raw listTracks row', () => {
    const row = {
      trackId: 't1',
      positions: [
        { x: 5, y: 5, timestamp: 1, bbox: { x: 10, y: 20, w: 30, h: 40 } },
        { x: 6, y: 6, timestamp: 2, bbox: { x: 12, y: 22, w: 32, h: 42 } },
      ],
    }
    expect(parsePositionBoxes(row)).toEqual([
      { x: 10, y: 20, w: 30, h: 40 },
      { x: 12, y: 22, w: 32, h: 42 },
    ])
  })

  it('skips malformed entries and degenerate boxes', () => {
    const row = {
      positions: [
        null,
        { bbox: { x: 1, y: 2, w: 'bad', h: 4 } },
        { bbox: { x: 1, y: 2, w: 0, h: 4 } }, // zero-width → dropped
        { bbox: { x: 1, y: 2, w: 3, h: 4 } },
      ],
    }
    expect(parsePositionBoxes(row)).toEqual([{ x: 1, y: 2, w: 3, h: 4 }])
  })

  it('yields [] for a row without positions / a non-row', () => {
    expect(parsePositionBoxes({})).toEqual([])
    expect(parsePositionBoxes(null)).toEqual([])
    expect(parsePositionBoxes('nope')).toEqual([])
  })
})

describe('trackMatchesZone', () => {
  const z = zone(0.5, 0.5, 0.5, 0.5) // bottom-right quadrant

  it('passes when ANY position box intersects the zone', () => {
    const boxes = [box(0, 0, 100, 100), box(700, 400, 100, 100)]
    expect(trackMatchesZone({ positionBoxes: boxes }, FRAME, rectShape(z))).toBe(true)
  })

  it('rejects when every box is outside the zone', () => {
    expect(trackMatchesZone({ positionBoxes: [box(0, 0, 100, 100)] }, FRAME, rectShape(z))).toBe(false)
  })

  it('positions BEAT the envelope: a path around the zone is rejected', () => {
    // Trajectory bounds cover the whole frame, but no position is ever inside
    // the bottom-right quadrant. The envelope alone would match.
    const wholeFrame: ZoneRect = { x: 0, y: 0, w: 1, h: 1 }
    const lShaped: ZoneFilterable = {
      positionBoxes: [box(0, 0, 40, 40), box(1200, 0, 40, 40), box(0, 660, 40, 40)],
      normalizedEnvelope: wholeFrame,
    }
    expect(trackMatchesZone(lShaped, FRAME, rectShape(z))).toBe(false)
    expect(rectsIntersect(wholeFrame, z)).toBe(true)
  })

  it('falls back to the envelope when there is no frame to normalise against', () => {
    const item: ZoneFilterable = {
      positionBoxes: [box(0, 0, 100, 100)],
      normalizedEnvelope: { x: 0.6, y: 0.6, w: 0.2, h: 0.2 },
    }
    expect(trackMatchesZone(item, null, rectShape(z))).toBe(true)
    expect(
      trackMatchesZone({ normalizedEnvelope: { x: 0, y: 0, w: 0.1, h: 0.1 } }, null, rectShape(z)),
    ).toBe(false)
  })

  it('a track with no geometry ALWAYS passes (never silently hidden)', () => {
    expect(trackMatchesZone({}, FRAME, rectShape(z))).toBe(true)
    expect(trackMatchesZone({ positionBoxes: [] }, FRAME, rectShape(z))).toBe(true)
    expect(trackMatchesZone({}, null, rectShape(z))).toBe(true)
  })
})

describe('filterEventsByZone', () => {
  interface Item extends ZoneFilterable {
    readonly id: string
  }
  const topLeft: Item = { id: 'tl', positionBoxes: [box(0, 0, 100, 100)] }
  const bottomRight: Item = { id: 'br', positionBoxes: [box(1180, 620, 100, 100)] }
  const noGeometry: Item = { id: 'none' }
  const all = [topLeft, bottomRight, noGeometry]

  it('returns the same array when no zone is active', () => {
    expect(filterEventsByZone(all, null)).toBe(all)
  })

  it('keeps intersecting tracks + geometry-less tracks, drops the rest', () => {
    const out = filterEventsByZone(all, rectShape(zone(0.5, 0.5, 0.5, 0.5)))
    expect(out.map((e) => e.id)).toEqual(['br', 'none'])
  })

  it('passes everything when NO item carries geometry (cannot judge)', () => {
    const blind: readonly Item[] = [{ id: 'a' }, { id: 'b' }]
    expect(filterEventsByZone(blind, rectShape(zone(0, 0, 0.1, 0.1))).map((e) => e.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('the envelope rescues the filter on a camera the estimate under-sizes', () => {
    // The 101 shape: nothing ever appears below y≈175 of a 640×360 frame, so
    // the max-extent estimate halves the frame height. `low` really sits at
    // y≈0.44 of the picture; under the estimate it would read as y≈0.90 and a
    // zone drawn across the middle band would drop it.
    const envelopeOf = (yPx: number, hPx: number): ZoneRect => ({
      x: 100 / 640,
      y: yPx / 360,
      w: 60 / 640,
      h: hPx / 360,
    })
    const low: Item = {
      id: 'low',
      positionBoxes: [box(100, 140, 60, 35)],
      normalizedEnvelope: envelopeOf(140, 35),
    }
    const high: Item = {
      id: 'high',
      positionBoxes: [box(100, 10, 60, 35)],
      normalizedEnvelope: envelopeOf(10, 35),
    }
    const mid = zone(0, 0.35, 1, 0.2) // a band across the middle of the picture
    expect(filterEventsByZone([low, high], rectShape(mid)).map((e) => e.id)).toEqual(['low'])
  })
})

describe('dragToRect / isZoneUsable', () => {
  it('normalises a drag in any direction, clamped to the box', () => {
    // Down-right drag on a 200×100 box.
    expect(dragToRect(20, 10, 120, 60, 200, 100)).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
    // Same rect drawn up-left.
    expect(dragToRect(120, 60, 20, 10, 200, 100)).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 })
  })

  it('clamps points outside the box to its edges', () => {
    expect(dragToRect(-50, -50, 400, 300, 200, 100)).toEqual({ x: 0, y: 0, w: 1, h: 1 })
  })

  it('returns null while the box is unmeasured', () => {
    expect(dragToRect(0, 0, 10, 10, 0, 0)).toBeNull()
  })

  it('isZoneUsable rejects rects thinner than the minimum fraction', () => {
    expect(isZoneUsable(zone(0.1, 0.1, MIN_ZONE_FRACTION, MIN_ZONE_FRACTION))).toBe(true)
    expect(isZoneUsable(zone(0.1, 0.1, MIN_ZONE_FRACTION / 2, 0.5))).toBe(false)
    expect(isZoneUsable(zone(0.1, 0.1, 0.5, 0))).toBe(false)
  })
})
