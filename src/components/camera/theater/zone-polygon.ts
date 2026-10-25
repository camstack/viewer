/**
 * zone-polygon — the geometry an ARBITRARY zone needs and a rectangle does not.
 *
 * The timeline's zone filter asks one question: did this track's trajectory
 * pass through the shape the operator drew? For a rectangle that is
 * `rectsIntersect`, four comparisons. For a polygon it is three separate cases,
 * and using fewer than all three is wrong on real geometry rather than in
 * theory:
 *
 *   1. a box CORNER inside the polygon — a subject well inside a large zone;
 *   2. a polygon VERTEX inside the box — a small zone swallowed by a near
 *      camera's large bbox;
 *   3. EDGES crossing with neither containing the other's points — the
 *      plus-sign overlap. Containment tests alone miss this entirely, and it is
 *      the case a hand-rolled version forgets, because it only shows up on some
 *      shapes.
 *
 * A bounding-box pre-check comes first because it is cheap and rejects most
 * pairs, but it can never be the ANSWER: the reason to draw a polygon at all is
 * usually concavity — a driveway that excludes the pavement, an L-shaped garden
 * — and every concave shape has regions inside its bounds and outside itself.
 *
 * Everything here is pure and normalised to 0..1 of the detection frame, the
 * same space `zone-filter.ts` works in. Coordinates never touch pixels.
 */

/** A vertex, normalised 0..1 of the frame. */
export interface ZonePoint {
  readonly x: number
  readonly y: number
}

/** A normalised rect — structurally the filter's `ZoneRect`, restated here so
 *  this module stays free of a cycle with `zone-filter.ts`. */
export interface NormRect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Below this a polygon encloses no usable area (collinear points, a sliver). */
export const MIN_POLYGON_AREA = 0.0004

/** The tight bounding rect, or null when there is nothing to bound. */
export function polygonBounds(points: readonly ZonePoint[]): NormRect | null {
  if (points.length === 0) return null
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

/**
 * Twice the signed area (the shoelace sum). Sign carries winding order, which
 * this module does not care about — callers take the absolute value.
 */
function doubleSignedArea(points: readonly ZonePoint[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (!a || !b) continue
    sum += a.x * b.y - b.x * a.y
  }
  return sum
}

/**
 * A polygon is usable as a filter when it has three vertices AND encloses area.
 *
 * Three collinear points pass a naive length check and enclose nothing — the
 * resulting filter matches no track, which on screen is indistinguishable from
 * a camera with no activity. Rejecting it at authoring time is the only place
 * the operator can be told.
 */
export function isPolygonUsable(points: readonly ZonePoint[]): boolean {
  if (points.length < 3) return false
  return Math.abs(doubleSignedArea(points)) / 2 >= MIN_POLYGON_AREA
}

/**
 * Ray casting: count crossings of a horizontal ray to the right of `p`.
 *
 * The `(a.y > p.y) !== (b.y > p.y)` test is the half-open convention that makes
 * a ray through a VERTEX count once rather than twice — the classic source of
 * points flickering between inside and outside along an edge.
 */
export function pointInPolygon(p: ZonePoint, points: readonly ZonePoint[]): boolean {
  if (points.length < 3) return false
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i]
    const b = points[j]
    if (!a || !b) continue
    if (a.y > p.y !== b.y > p.y) {
      const t = (b.x - a.x) * (p.y - a.y)
      const d = b.y - a.y
      if (d !== 0 && p.x < a.x + t / d) inside = !inside
    }
  }
  return inside
}

/** Cross product of (b−a) × (c−a); sign gives the turn direction. */
function cross(a: ZonePoint, b: ZonePoint, c: ZonePoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/**
 * True when segments `a1a2` and `b1b2` PROPERLY cross.
 *
 * Collinear-overlap is deliberately not treated as a crossing: two edges lying
 * along each other means the box grazes the zone boundary, and the containment
 * cases already answer that pairing correctly.
 */
export function segmentsIntersect(
  a1: ZonePoint,
  a2: ZonePoint,
  b1: ZonePoint,
  b2: ZonePoint,
): boolean {
  const d1 = cross(b1, b2, a1)
  const d2 = cross(b1, b2, a2)
  const d3 = cross(a1, a2, b1)
  const d4 = cross(a1, a2, b2)
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))
}

/** The four corners of a normalised rect, clockwise from the top-left. */
function rectCorners(r: NormRect): readonly ZonePoint[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ]
}

function boundsOverlap(a: NormRect, b: NormRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/**
 * Does this box overlap the polygon at all?
 *
 * A degenerate polygon matches NOTHING, not everything. Failing open here would
 * silently disable a filter the operator drew, and an unfiltered timeline looks
 * exactly like a filter that matched a lot.
 */
export function rectIntersectsPolygon(rect: NormRect, points: readonly ZonePoint[]): boolean {
  if (points.length < 3) return false
  const bounds = polygonBounds(points)
  if (bounds === null || !boundsOverlap(rect, bounds)) return false

  const corners = rectCorners(rect)

  // 1. Box corner inside the polygon.
  for (const c of corners) {
    if (pointInPolygon(c, points)) return true
  }

  // 2. Polygon vertex inside the box. Carries the "box contains polygon" case,
  //    which case 1 cannot see.
  for (const p of points) {
    if (p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h) {
      return true
    }
  }

  // 3. Crossing edges with no containment either way — the plus sign.
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (!a || !b) continue
    for (let k = 0; k < corners.length; k += 1) {
      const c1 = corners[k]
      const c2 = corners[(k + 1) % corners.length]
      if (!c1 || !c2) continue
      if (segmentsIntersect(a, b, c1, c2)) return true
    }
  }

  return false
}
