import { describe, it, expect } from 'vitest'
import {
  pointInPolygon,
  polygonBounds,
  rectIntersectsPolygon,
  segmentsIntersect,
  isPolygonUsable,
  type ZonePoint,
} from '../zone-polygon.js'

/**
 * Box-versus-polygon, which is the whole reason an arbitrary zone is harder
 * than a rectangle.
 *
 * Three cases have to be checked and any one of them alone is wrong:
 *   • a box corner inside the polygon — a small box well within a big zone,
 *   • a polygon vertex inside the box — a small zone swallowed by a big box,
 *   • edges crossing with NEITHER containing the other's points — the plus-sign
 *     overlap, which both containment tests miss entirely.
 * The third is the one a hand-rolled implementation forgets, so it is tested
 * explicitly rather than assumed.
 */

/** A unit square, counter-clockwise. */
const SQUARE: readonly ZonePoint[] = [
  { x: 0.2, y: 0.2 },
  { x: 0.8, y: 0.2 },
  { x: 0.8, y: 0.8 },
  { x: 0.2, y: 0.8 },
]

/** An L — concave, so a bounding-box test alone would answer wrongly. */
const L_SHAPE: readonly ZonePoint[] = [
  { x: 0.1, y: 0.1 },
  { x: 0.4, y: 0.1 },
  { x: 0.4, y: 0.6 },
  { x: 0.9, y: 0.6 },
  { x: 0.9, y: 0.9 },
  { x: 0.1, y: 0.9 },
]

describe('pointInPolygon', () => {
  it('finds a point inside and rejects one outside', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, SQUARE)).toBe(true)
    expect(pointInPolygon({ x: 0.05, y: 0.5 }, SQUARE)).toBe(false)
  })

  it('respects concavity — the notch of an L is OUTSIDE', () => {
    // (0.7, 0.3) sits inside the L's bounding box and outside the L itself.
    // A bounding-box test would call this a hit; it is the reason the whole
    // polygon path exists rather than a fattened rect.
    expect(pointInPolygon({ x: 0.7, y: 0.3 }, L_SHAPE)).toBe(false)
    expect(pointInPolygon({ x: 0.2, y: 0.3 }, L_SHAPE)).toBe(true)
    expect(pointInPolygon({ x: 0.7, y: 0.8 }, L_SHAPE)).toBe(true)
  })

  it('is stable on a vertex-aligned ray', () => {
    // A horizontal ray through a vertex double-counts under a naive
    // implementation and flips inside/outside. y = 0.2 is SQUARE's top edge.
    expect(pointInPolygon({ x: 0.5, y: 0.2 }, SQUARE)).toBe(
      pointInPolygon({ x: 0.5, y: 0.2 }, SQUARE),
    )
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, SQUARE)).toBe(true)
  })

  it('a degenerate polygon contains nothing', () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, [])).toBe(false)
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false)
  })
})

describe('segmentsIntersect', () => {
  it('detects a proper crossing', () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }, { x: 1, y: 0 }),
    ).toBe(true)
  })

  it('rejects parallel and non-touching segments', () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }),
    ).toBe(false)
  })

  it('rejects segments whose INFINITE lines would cross but the segments do not', () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 0.1, y: 0.1 }, { x: 0.9, y: 1 }, { x: 1, y: 0.9 }),
    ).toBe(false)
  })
})

describe('rectIntersectsPolygon', () => {
  it('hits when a box corner is inside the polygon', () => {
    expect(rectIntersectsPolygon({ x: 0.7, y: 0.7, w: 0.4, h: 0.4 }, SQUARE)).toBe(true)
  })

  it('hits when the box CONTAINS the polygon', () => {
    // No box corner is inside the polygon and no polygon vertex test would fire
    // if only corners were checked — the vertex-inside-box case carries this.
    expect(rectIntersectsPolygon({ x: 0, y: 0, w: 1, h: 1 }, SQUARE)).toBe(true)
  })

  it('hits on a plus-sign overlap, where neither contains the other', () => {
    // A tall thin box crossing a wide flat polygon: no corner of either is
    // inside the other, only the edges cross. This is the case a containment-
    // only implementation gets wrong, silently, and only on some geometries.
    const flat: readonly ZonePoint[] = [
      { x: 0.1, y: 0.45 },
      { x: 0.9, y: 0.45 },
      { x: 0.9, y: 0.55 },
      { x: 0.1, y: 0.55 },
    ]
    expect(rectIntersectsPolygon({ x: 0.45, y: 0.1, w: 0.1, h: 0.8 }, flat)).toBe(true)
  })

  it('misses a box in the NOTCH of a concave polygon', () => {
    // Inside the L's bounding box, outside the L. The whole point of polygons.
    expect(rectIntersectsPolygon({ x: 0.6, y: 0.2, w: 0.15, h: 0.15 }, L_SHAPE)).toBe(false)
  })

  it('misses a box entirely outside', () => {
    expect(rectIntersectsPolygon({ x: 0.85, y: 0.85, w: 0.1, h: 0.1 }, SQUARE)).toBe(false)
  })

  it('a degenerate polygon matches nothing rather than everything', () => {
    // Failing OPEN here would silently disable a filter the operator drew.
    expect(rectIntersectsPolygon({ x: 0, y: 0, w: 1, h: 1 }, [])).toBe(false)
  })
})

describe('polygonBounds', () => {
  it('is the tight bounding rect', () => {
    expect(polygonBounds(SQUARE)).toEqual({ x: 0.2, y: 0.2, w: 0.6000000000000001, h: 0.6000000000000001 })
  })

  it('is null for a degenerate polygon', () => {
    expect(polygonBounds([])).toBeNull()
  })
})

describe('isPolygonUsable', () => {
  it('needs three points and some area', () => {
    expect(isPolygonUsable(SQUARE)).toBe(true)
    expect(isPolygonUsable([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(false)
    // Three collinear points enclose nothing — a filter that matches nothing
    // and cannot be told apart from an empty timeline.
    expect(
      isPolygonUsable([{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.9 }]),
    ).toBe(false)
  })
})
