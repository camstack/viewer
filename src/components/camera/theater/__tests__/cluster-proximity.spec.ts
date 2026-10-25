import { describe, it, expect } from 'vitest'
import {
  clusterExpansion,
  quantiseExpansion,
  buildExpansionMap,
  expansionMapsEqual,
  EMPTY_EXPANSION,
  EXPANSION_RADIUS_PX,
  DETENT_RADIUS_PX,
  nearestClusterId,
  clusterCenterMs,
  distanceToClusterPx,
} from '../cluster-proximity.js'
import {
  clusterByZoom,
  pickImportantEvent,
  type ObjectEvent,
  type PositionedCluster,
} from '../event-cluster.js'
import { epochToOffset, pxPerHour } from '../timeline-geometry.js'

/**
 * The proximity model behind the expanding cluster cards. All of it is pure —
 * (centre epoch, active epoch, zoom) → factor — precisely so it can be pinned
 * here without a renderer. The animation is NOT under test (there is none: the
 * card styles itself from the factor); the geometry and the ranking are.
 */

const MS_PER_HOUR = 3_600_000

/** Epoch delta (ms) that measures `px` timeline pixels at `zoomIndex`. */
function msForPx(px: number, zoomIndex: number): number {
  return (px / pxPerHour(zoomIndex)) * MS_PER_HOUR
}

const T0 = 1_754_000_000_000

function ev(overrides: Partial<ObjectEvent> & { id: string; timestamp: number }): ObjectEvent {
  return { className: 'person', deviceId: 5, ...overrides }
}

describe('clusterExpansion', () => {
  it('is 1 when the playhead sits exactly on the centre', () => {
    expect(clusterExpansion(T0, T0, 2)).toBe(1)
  })

  it('is 0 at and beyond the radius', () => {
    // Ceil: epochs are integer ms and msForPx is fractional — land AT or just
    // past the radius, never a float hair inside it.
    const atRadius = Math.ceil(msForPx(EXPANSION_RADIUS_PX, 2))
    expect(clusterExpansion(T0, T0 + atRadius, 2)).toBe(0)
    expect(clusterExpansion(T0, T0 + atRadius * 3, 2)).toBe(0)
    expect(clusterExpansion(T0, T0 - atRadius * 3, 2)).toBe(0)
  })

  it('decreases monotonically with distance and is symmetric', () => {
    const near = clusterExpansion(T0, T0 + msForPx(40, 2), 2)
    const mid = clusterExpansion(T0, T0 + msForPx(100, 2), 2)
    const far = clusterExpansion(T0, T0 + msForPx(160, 2), 2)
    expect(near).toBeGreaterThan(mid)
    expect(mid).toBeGreaterThan(far)
    expect(far).toBeGreaterThan(0)
    expect(clusterExpansion(T0, T0 - msForPx(100, 2), 2)).toBeCloseTo(mid, 10)
  })

  it('is smoothstep-shaped, not linear', () => {
    // The midpoint alone cannot tell smoothstep from linear (both give 0.5) —
    // the quarter points can: smoothstep(0.75) = 0.84375 vs linear 0.75.
    expect(clusterExpansion(T0, T0 + msForPx(EXPANSION_RADIUS_PX / 2, 2), 2)).toBeCloseTo(0.5, 6)
    expect(clusterExpansion(T0, T0 + msForPx(EXPANSION_RADIUS_PX / 4, 2), 2)).toBeCloseTo(
      0.84375,
      6,
    )
    expect(clusterExpansion(T0, T0 + msForPx((EXPANSION_RADIUS_PX * 3) / 4, 2), 2)).toBeCloseTo(
      0.15625,
      6,
    )
  })

  it('is zoom-invariant in PIXELS: the same pixel distance gives the same factor', () => {
    // Different epochs deltas, same 68 timeline pixels at each zoom.
    const coarse = clusterExpansion(T0, T0 + msForPx(68, 0), 0)
    const fine = clusterExpansion(T0, T0 + msForPx(68, 3), 3)
    expect(coarse).toBeCloseTo(fine, 10)
    // …which means the same TIME distance expands more when zoomed out.
    const tenMin = 10 * 60_000
    expect(clusterExpansion(T0, T0 + tenMin, 0)).toBeGreaterThan(
      clusterExpansion(T0, T0 + tenMin, 2),
    )
  })

  it('a non-positive radius disables expansion', () => {
    expect(clusterExpansion(T0, T0, 2, 0)).toBe(0)
  })
})

describe('quantiseExpansion', () => {
  it('snaps to the step grid with exact endpoints', () => {
    expect(quantiseExpansion(0)).toBe(0)
    expect(quantiseExpansion(1)).toBe(1)
    expect(quantiseExpansion(-0.3)).toBe(0)
    expect(quantiseExpansion(1.7)).toBe(1)
    expect(quantiseExpansion(0.123)).toBe(0.1)
    expect(quantiseExpansion(0.5)).toBe(0.5)
    // Idempotent: a quantised value re-quantises to itself.
    expect(quantiseExpansion(quantiseExpansion(0.777))).toBe(quantiseExpansion(0.777))
  })
})

describe('the card TOP is its first displayed event and it extends down', () => {
  /**
   * The card is drawn as the rectangle `[anchorMs, anchorMs - heightPx]` in
   * time, and scoring measures that rectangle (`clusterCenterMs`). If scoring
   * ever needs another offset, drawing and scoring have diverged and the fix
   * belongs in `clusterByZoom`.
   */
  const geo = { topMs: T0 + MS_PER_HOUR, zoomIndex: 2, sizePx: 100, gapPx: 10 }

  it('anchorMs is the drawn box top for a lone event', () => {
    const [c] = clusterByZoom([ev({ id: 'a', timestamp: T0, trackId: 'ta' })], geo)
    expect(c.anchorMs).toBe(T0)
    expect(c.topPx).toBeCloseTo(epochToOffset(c.anchorMs, geo.topMs, geo.zoomIndex), 5)
  })

  it('and for a cluster whose events span a real gap', () => {
    const [c] = clusterByZoom(
      [
        ev({ id: 'a', timestamp: T0, trackId: 'ta' }),
        ev({ id: 'b', timestamp: T0 + 40_000, trackId: 'tb' }),
      ],
      geo,
    )
    expect(c.events).toHaveLength(2)
    expect(c.anchorMs).toBe(T0 + 40_000)
    expect(c.topPx).toBeCloseTo(epochToOffset(c.anchorMs, geo.topMs, geo.zoomIndex), 5)
  })

  it('the centre of the rectangle is half a card BELOW the anchor', () => {
    const [c] = clusterByZoom([ev({ id: 'a', timestamp: T0, trackId: 'ta' })], geo)
    expect(clusterCenterMs(c, geo.zoomIndex)).toBeCloseTo(T0 - msForPx(50, geo.zoomIndex), -1)
  })

  it('a cursor on a member in the lower half of its card scores that card, not the next', () => {
    const [c] = clusterByZoom([ev({ id: 'a', timestamp: T0, trackId: 'ta' })], geo)
    const inside = T0 - Math.round(msForPx(80, geo.zoomIndex))
    expect(distanceToClusterPx(c, inside, geo.zoomIndex)).toBe(0)
    expect(distanceToClusterPx(c, T0 + Math.round(msForPx(30, geo.zoomIndex)), geo.zoomIndex)).toBeCloseTo(30, 3)
    expect(nearestClusterId([c], inside, geo.zoomIndex)).toBe('a')
  })
})

describe('importantEvent — semantic priority stays separate from temporal anchoring', () => {
  // NOTE: `centerEvent` is the HIGHLIGHT contract only. The proximity score
  // deliberately does NOT use it (see "the score measures the CARD" below) —
  // an event time is free to sit at the box's lower edge, which is where the
  // peak visibly landed (operator screenshot, 2026-08-02).
  const geometry = { topMs: T0 + MS_PER_HOUR, zoomIndex: 2, sizePx: 100, gapPx: 10 }

  it('picks the highest server-computed importance among the subjects', () => {
    // Concurrent tracks (distinct trackIds, overlapping spans) so dedupe keeps
    // both. The newest event is NOT the important one — that is the point.
    const dull = ev({ id: 'dull', timestamp: T0 + 60_000, trackId: 'ta', importance: 0.2 })
    const vital = ev({ id: 'vital', timestamp: T0, trackId: 'tb', importance: 0.9 })
    const clusters = clusterByZoom([dull, vital], geometry)
    expect(clusters).toHaveLength(1)
    expect(clusters[0].importantEvent.id).toBe('vital')
    expect(clusters[0].importantEvent.timestamp).toBe(T0)
  })

  it('breaks an importance tie toward the later-ending subject', () => {
    const early = ev({
      id: 'early', timestamp: T0, endTimestamp: T0 + 30_000, trackId: 'ta', importance: 0.7,
    })
    const late = ev({
      id: 'late', timestamp: T0 + 5_000, endTimestamp: T0 + 90_000, trackId: 'tb', importance: 0.7,
    })
    expect(pickImportantEvent([early, late], early).id).toBe('late')
    expect(pickImportantEvent([late, early], early).id).toBe('late')
  })

  it('falls back to the class-priority representative when nothing is scored', () => {
    const car = ev({ id: 'car', timestamp: T0 + 60_000, className: 'car', trackId: 'ta' })
    const person = ev({ id: 'person', timestamp: T0, className: 'person', trackId: 'tb' })
    const clusters = clusterByZoom([car, person], geometry)
    expect(clusters).toHaveLength(1)
    // pickRepresentative's default priority puts person over vehicle.
    expect(clusters[0].importantEvent.id).toBe('person')
  })
})

describe('buildExpansionMap', () => {
  const geometry = { topMs: T0 + MS_PER_HOUR, zoomIndex: 2, sizePx: 100, gapPx: 10 }
  const clusters = clusterByZoom(
    [ev({ id: 'a', timestamp: T0, trackId: 'ta', importance: 0.5 })],
    geometry,
  )
  /** The card's visual-midpoint epoch — now simply the cluster's first event,
   *  because the box is centred on it. */
  const mid = T0 - Math.round(msForPx(50, 2))

  it('returns the SHARED empty map for a null epoch (live) and for far playheads', () => {
    expect(buildExpansionMap(clusters, null, 2)).toBe(EMPTY_EXPANSION)
    const far = T0 + msForPx(EXPANSION_RADIUS_PX * 2, 2)
    expect(buildExpansionMap(clusters, far, 2)).toBe(EMPTY_EXPANSION)
    expect(buildExpansionMap([], T0, 2)).toBe(EMPTY_EXPANSION)
  })

  it('holds a quantised entry only for clusters within the radius', () => {
    const map = buildExpansionMap(clusters, mid, 2)
    expect(map.get('a')).toBe(1)
    expect(map.size).toBe(1)
  })

  it('value equality lets the caller pin identity across playhead reports', () => {
    const m1 = buildExpansionMap(clusters, mid, 2)
    const m2 = buildExpansionMap(clusters, mid + 1_000, 2)
    // Two nearby reports, same quantised factor → equal by value.
    expect(m1).not.toBe(m2)
    expect(expansionMapsEqual(m1, m2)).toBe(true)
    expect(expansionMapsEqual(m1, EMPTY_EXPANSION)).toBe(false)
    expect(expansionMapsEqual(EMPTY_EXPANSION, EMPTY_EXPANSION)).toBe(true)
  })
})

describe('the score measures the CARD the operator sees, not an event inside it', () => {
  /**
   * The operator's report, twice: the expansion is "non a ridosso del cluster
   * ma molto più sotto". The cluster is DRAWN as a box `[topPx, topPx +
   * heightPx]` anchored on its newest event (`endMs`), but the score compared
   * the anchor to `centerEvent.timestamp` — an event time that can sit
   * anywhere in the absorption window, worst case at/beyond the box's LOWER
   * edge. The peak then lands up to heightPx/2 + gapPx below the card's
   * visual centre, outside the box entirely. The score must measure the box.
   */
  const z = 2
  const sizePx = 100
  const geometry = { topMs: T0 + 24 * MS_PER_HOUR, zoomIndex: z, sizePx, gapPx: 10 }
  // The card's midpoint is the cluster's FIRST event — no correction term.
  // This used to subtract half a box height, which is exactly the offset the
  // operator saw on screen; keeping the helper (now identity) makes the
  // before/after obvious at the call sites below.
  const midOf = (anchorMs: number): number => anchorMs - Math.round(msForPx(sizePx / 2, z))

  it('a cluster whose card straddles the anchor peaks at exactly 1', () => {
    const clusters = clusterByZoom(
      [ev({ id: 'a', timestamp: T0, trackId: 'ta', importance: 0.5 })],
      geometry,
    )
    expect(buildExpansionMap(clusters, midOf(T0), z).get('a')).toBe(1)
  })

  it('two clusters sharing a first displayed event score equally', () => {
    // P: a single instant. Q: that same first event plus a second, more
    // important track later inside the absorption window — the exact shape
    // that used to drag the score away from the card the operator sees.
    //
    // The premise flipped with the geometry: cards are anchored on the FIRST
    // event now, so "same newest event ⇒ same box" (what this asserted before)
    // is no longer true, and asserting it would pin the bug.
    const p = clusterByZoom(
      [ev({ id: 'p', timestamp: T0, trackId: 'tp', importance: 0.5 })],
      geometry,
    )
    const olderImportant = T0 - Math.round(msForPx(90, z))
    const q = clusterByZoom(
      [
        ev({ id: 'q1', timestamp: T0, endTimestamp: T0 + 60_000, trackId: 'tq1', importance: 0.1 }),
        ev({
          id: 'q2',
          timestamp: olderImportant,
          endTimestamp: olderImportant + 50_000,
          trackId: 'tq2',
          importance: 0.9,
        }),
      ],
      geometry,
    )
    expect(q).toHaveLength(1)
    expect(q[0].anchorMs).toBe(p[0].anchorMs)
    // Same first event, same sizePx ⇒ the SAME drawn box ⇒ the same factor.
    const anchor = midOf(T0) - Math.round(msForPx(60, z))
    expect(buildExpansionMap(q, anchor, z).get(q[0].id)).toBe(
      buildExpansionMap(p, anchor, z).get('p'),
    )
  })

  it('the factor is symmetric around the card midpoint — a skew here reads as "too far down"', () => {
    const clusters = clusterByZoom(
      [ev({ id: 'a', timestamp: T0, trackId: 'ta', importance: 0.5 })],
      geometry,
    )
    const above = buildExpansionMap(clusters, midOf(T0) + Math.round(msForPx(40, z)), z).get('a')
    const below = buildExpansionMap(clusters, midOf(T0) - Math.round(msForPx(40, z)), z).get('a')
    expect(above).toBeDefined()
    expect(above).toBe(below)
  })
})

describe('nearestClusterId — the detent key', () => {
  /** A positioned cluster built in FULL (no cast): the detent only reads `id`
   *  and `anchorMs`, but a partial object hidden behind a cast would stop
   *  telling us when the shape changes underneath. */
  function pc(id: string, anchorMs: number): PositionedCluster {
    const event = ev({ id, timestamp: anchorMs })
    return {
      id,
      events: [event],
      carouselEvents: [event],
      representative: event,
      anchorEvent: event,
      anchorMs,
      importantEvent: event,
      classes: [event.className],
      labels: [],
      startMs: anchorMs,
      endMs: anchorMs,
      topPx: 0,
      heightPx: 0,
    }
  }

  const ZOOM = 2

  it('is null over empty track', () => {
    expect(nearestClusterId([], T0, ZOOM)).toBeNull()
    const far = Math.ceil(msForPx(DETENT_RADIUS_PX * 10, ZOOM))
    expect(nearestClusterId([pc('a', T0 + far)], T0, ZOOM)).toBeNull()
  })

  it('picks a cluster the cursor sits exactly on', () => {
    expect(nearestClusterId([pc('a', T0)], T0, ZOOM)).toBe('a')
  })

  it('is null at and beyond the detent radius', () => {
    const atRadius = Math.ceil(msForPx(DETENT_RADIUS_PX, ZOOM))
    expect(nearestClusterId([pc('a', T0)], T0 + atRadius, ZOOM)).toBeNull()
  })

  it('uses a TIGHTER radius than the expansion cue', () => {
    // The notch must line up with the card under the indicator, not fire while
    // it is still approaching.
    expect(DETENT_RADIUS_PX).toBeLessThan(EXPANSION_RADIUS_PX)
    const betweenPx = (DETENT_RADIUS_PX + EXPANSION_RADIUS_PX) / 2
    const between = Math.ceil(msForPx(betweenPx, ZOOM))
    // Expanding (visible cue) but NOT yet a detent.
    expect(clusterExpansion(T0, T0 + between, ZOOM)).toBeGreaterThan(0)
    expect(nearestClusterId([pc('a', T0)], T0 + between, ZOOM)).toBeNull()
  })

  it('returns the NEAREST when two overlap, so a crossing never flickers', () => {
    const near = Math.round(msForPx(DETENT_RADIUS_PX * 0.2, ZOOM))
    const alsoInRange = Math.round(msForPx(DETENT_RADIUS_PX * 0.8, ZOOM))
    const clusters = [pc('far', T0 + alsoInRange), pc('near', T0 + near)]
    expect(nearestClusterId(clusters, T0, ZOOM)).toBe('near')
    // Order of the input must not decide it.
    expect(nearestClusterId([...clusters].reverse(), T0, ZOOM)).toBe('near')
  })

  it('is zoom-invariant in PIXELS: the same px gap resolves the same way', () => {
    const insidePx = DETENT_RADIUS_PX * 0.5
    for (const zoom of [0, 1, 2, 3]) {
      const delta = Math.round(msForPx(insidePx, zoom))
      expect(nearestClusterId([pc('a', T0)], T0 + delta, zoom)).toBe('a')
    }
  })
})
