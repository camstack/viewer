import { describe, it, expect } from 'vitest'
import {
  dedupeFragmentItems,
  pickRepresentative,
  clusterByZoom,
} from '../event-cluster.js'
import type { ObjectEvent } from '../event-cluster.js'
import { epochToOffset } from '../timeline-geometry.js'

// ─── Fixtures ────────────────────────────────────────────────────────

const BASE_MS = new Date(2026, 5, 17, 12, 0, 0, 0).getTime() // noon anchor

function makeEvent(
  overrides: Partial<ObjectEvent> & { id: string; timestamp: number },
): ObjectEvent {
  return {
    className: 'person',
    deviceId: 5,
    ...overrides,
  }
}

// ─── pickRepresentative ───────────────────────────────────────────────

describe('pickRepresentative', () => {
  it('returns the only event when there is one', () => {
    const e = makeEvent({ id: 'e1', timestamp: BASE_MS })
    expect(pickRepresentative([e])).toBe(e)
  })

  it('prefers an event with a non-empty label over any class', () => {
    const labeled = makeEvent({ id: 'labeled', timestamp: BASE_MS - 1000, className: 'animal', label: 'dog' })
    const person = makeEvent({ id: 'person', timestamp: BASE_MS, className: 'person' })
    expect(pickRepresentative([labeled, person])).toBe(labeled)
  })

  it('honors priority: person > vehicle > animal when no label', () => {
    const animal = makeEvent({ id: 'animal', timestamp: BASE_MS + 3000, className: 'dog' })
    const vehicle = makeEvent({ id: 'vehicle', timestamp: BASE_MS + 2000, className: 'car' })
    const person = makeEvent({ id: 'person', timestamp: BASE_MS + 1000, className: 'person' })
    const result = pickRepresentative([animal, vehicle, person])
    expect(result.id).toBe('person')
  })

  it('vehicle synonym: car/truck/bus/motorcycle match vehicle priority', () => {
    const truck = makeEvent({ id: 'truck', timestamp: BASE_MS + 2000, className: 'truck' })
    const bird = makeEvent({ id: 'bird', timestamp: BASE_MS + 1000, className: 'bird' })
    const result = pickRepresentative([truck, bird])
    expect(result.id).toBe('truck')
  })

  it('animal synonym: dog/cat/bird match animal priority', () => {
    const cat = makeEvent({ id: 'cat', timestamp: BASE_MS + 1000, className: 'cat' })
    // no higher-priority class present
    expect(pickRepresentative([cat]).id).toBe('cat')
  })

  it('falls back to newest when no priority class matches', () => {
    const old = makeEvent({ id: 'old', timestamp: BASE_MS - 5000, className: 'unknown' })
    const newest = makeEvent({ id: 'new', timestamp: BASE_MS, className: 'unknown' })
    expect(pickRepresentative([old, newest]).id).toBe('new')
  })

  it('respects a custom priority list', () => {
    const animal = makeEvent({ id: 'animal', timestamp: BASE_MS, className: 'dog' })
    const person = makeEvent({ id: 'person', timestamp: BASE_MS - 1000, className: 'person' })
    // custom order: animal first
    const result = pickRepresentative([animal, person], ['animal'])
    expect(result.id).toBe('animal')
  })
})

// ─── clusterByZoom ────────────────────────────────────────────────────

describe('clusterByZoom', () => {
  // topMs = BASE_MS so events earlier than BASE_MS have positive offsets.
  const topMs = BASE_MS
  // zoomIndex 2 → pxPerHour = 408 → 1 min ≈ 6.8 px → 5 min ≈ 34 px
  const zoomIndex = 2
  const sizePx = 50
  const gapPx = 10

  it('returns an empty array when given no events', () => {
    expect(clusterByZoom([], { topMs, zoomIndex, sizePx, gapPx })).toEqual([])
  })

  it('wraps a single event in one cluster', () => {
    const e = makeEvent({ id: 'e1', timestamp: BASE_MS - 60_000 })
    const clusters = clusterByZoom([e], { topMs, zoomIndex, sizePx, gapPx })
    expect(clusters).toHaveLength(1)
    expect(clusters[0].events).toEqual([e])
    expect(clusters[0].representative).toBe(e)
  })

  it('merges events that are within sizePx + gapPx vertically', () => {
    // Two events 20 s apart — very close in px at zoom 2
    const e1 = makeEvent({ id: 'e1', timestamp: BASE_MS - 60_000 })
    const e2 = makeEvent({ id: 'e2', timestamp: BASE_MS - 80_000 })
    const clusters = clusterByZoom([e1, e2], { topMs, zoomIndex, sizePx, gapPx })
    expect(clusters).toHaveLength(1)
    expect(clusters[0].events).toHaveLength(2)
  })

  it('clusters across cameras by time — a grid timeline is one list, not N', () => {
    const hall = makeEvent({ id: 's', timestamp: BASE_MS - 60_000, deviceId: 12 })
    const frontDoor = makeEvent({ id: 'i', timestamp: BASE_MS - 80_000, deviceId: 7 })
    const clusters = clusterByZoom([hall, frontDoor], { topMs, zoomIndex, sizePx, gapPx })
    expect(clusters).toHaveLength(1)
    expect(new Set(clusters[0].events.map((e) => e.deviceId))).toEqual(new Set([7, 12]))
  })

  it('splits events that are farther apart than sizePx + gapPx', () => {
    // zoomIndex 2: 1 hour = 408 px → 10 min ≈ 68 px >> sizePx(50)+gapPx(10)
    const e1 = makeEvent({ id: 'e1', timestamp: BASE_MS - 60_000 })        // 1 min ago → ~6.8 px
    const e2 = makeEvent({ id: 'e2', timestamp: BASE_MS - 60 * 60_000 })   // 60 min ago → 408 px
    const clusters = clusterByZoom([e1, e2], { topMs, zoomIndex, sizePx, gapPx })
    expect(clusters).toHaveLength(2)
  })

  it('no two clusters overlap and gap between them is ≥ gapPx', () => {
    // Scatter events across several minutes
    const events: ObjectEvent[] = [
      makeEvent({ id: 'e1', timestamp: BASE_MS - 30_000 }),
      makeEvent({ id: 'e2', timestamp: BASE_MS - 60_000 }),
      makeEvent({ id: 'e3', timestamp: BASE_MS - 10 * 60_000 }),
      makeEvent({ id: 'e4', timestamp: BASE_MS - 11 * 60_000 }),
      makeEvent({ id: 'e5', timestamp: BASE_MS - 30 * 60_000 }),
    ]
    const clusters = clusterByZoom(events, { topMs, zoomIndex, sizePx, gapPx })
    for (let i = 1; i < clusters.length; i++) {
      const prev = clusters[i - 1]
      const curr = clusters[i]
      const gap = curr.topPx - (prev.topPx + prev.heightPx)
      expect(gap).toBeGreaterThanOrEqual(gapPx - 0.01) // float tolerance
    }
  })

  it('finer zoom splits a group that was merged at coarser zoom', () => {
    // Two events 5 min apart
    const e1 = makeEvent({ id: 'e1', timestamp: BASE_MS - 5 * 60_000 })
    const e2 = makeEvent({ id: 'e2', timestamp: BASE_MS - 10 * 60_000 })
    const coarse = clusterByZoom([e1, e2], { topMs, zoomIndex: 0, sizePx, gapPx })
    const fine = clusterByZoom([e1, e2], { topMs, zoomIndex: 3, sizePx, gapPx })
    // At fine zoom events are farther apart in px → more clusters
    expect(fine.length).toBeGreaterThanOrEqual(coarse.length)
  })

  it('sets cluster id to representative.id', () => {
    const e = makeEvent({ id: 'rep', timestamp: BASE_MS - 60_000, className: 'person' })
    const clusters = clusterByZoom([e], { topMs, zoomIndex, sizePx, gapPx })
    expect(clusters[0].id).toBe('rep')
  })

  it('populates distinct classes and labels', () => {
    const e1 = makeEvent({ id: 'e1', timestamp: BASE_MS - 60_000, className: 'person', label: 'alice' })
    const e2 = makeEvent({ id: 'e2', timestamp: BASE_MS - 70_000, className: 'dog', label: 'rex' })
    const clusters = clusterByZoom([e1, e2], { topMs, zoomIndex, sizePx, gapPx })
    const c = clusters[0]
    expect(c.classes).toContain('person')
    expect(c.classes).toContain('dog')
    expect(c.labels).toContain('alice')
    expect(c.labels).toContain('rex')
  })

  /**
   * The card's visual CENTRE must sit on the cluster's FIRST event.
   *
   * Reported three times. Earlier fixes made the expansion SCORE agree with
   * the drawn box while leaving the box hung from the newest event, so the
   * card kept sitting below its own first event. Time runs DOWNWARD here, so
   * top-edge anchoring and newest-event anchoring compound: a real cluster of
   * 09:17 + 09:24 drew 09:26 → 09:00 and centred on 09:14.
   */
  it('starts the card on the FIRST DISPLAYED (newest) event of the cluster', () => {
    const older = makeEvent({ id: 'older', timestamp: BASE_MS - 43 * 60_000 })
    const first = makeEvent({ id: 'first', timestamp: BASE_MS - 36 * 60_000 })
    const [c] = clusterByZoom([first, older], { topMs, zoomIndex, sizePx, gapPx })

    expect(c.events).toHaveLength(2)
    expect(c.carouselEvents[0].id).toBe(first.id)
    expect(c.anchorEvent.id).toBe(first.id)
    expect(c.anchorMs).toBe(first.timestamp)
    expect(c.topPx).toBeCloseTo(epochToOffset(first.timestamp, topMs, zoomIndex), 5)
    expect(c.startMs).toBe(older.timestamp)
  })

  it('starts on the single event when the cluster has only one', () => {
    const e = makeEvent({ id: 'solo', timestamp: BASE_MS - 30 * 60_000 })
    const [c] = clusterByZoom([e], { topMs, zoomIndex, sizePx, gapPx })
    expect(c.topPx).toBeCloseTo(epochToOffset(e.timestamp, topMs, zoomIndex), 5)
  })

  it('every cluster STARTS on its first displayed event, and none overlap', () => {
    // Both invariants together: the previous attempt satisfied one by breaking
    // the other, which is why it could not survive.
    const events = [0, 3, 4, 30, 33, 90, 91, 92].map((m) =>
      makeEvent({ id: `e${m}`, timestamp: BASE_MS - m * 60_000 }),
    )
    const clusters = clusterByZoom(events, { topMs, zoomIndex, sizePx, gapPx })
    for (const c of clusters) {
      expect(c.topPx).toBeCloseTo(epochToOffset(c.anchorMs, topMs, zoomIndex), 5)
    }
    const byTop = [...clusters].sort((a, b) => a.topPx - b.topPx)
    for (let i = 1; i < byTop.length; i++) {
      const gap = byTop[i].topPx - (byTop[i - 1].topPx + byTop[i - 1].heightPx)
      expect(gap).toBeGreaterThanOrEqual(gapPx - 0.01)
    }
  })

  it('coalesces neighbours when fragment dedupe shifts the display anchor', () => {
    const epochAtPx = (px: number): number =>
      topMs - Math.round((px / 408) * 60 * 60_000)
    const newestFragment = makeEvent({
      id: 'newest-fragment',
      timestamp: epochAtPx(0),
      trackId: 'same-track',
      importance: 0.1,
    })
    const displayedFragment = makeEvent({
      id: 'displayed-fragment',
      timestamp: epochAtPx(50),
      trackId: 'same-track',
      importance: 0.9,
    })
    const olderNeighbour = makeEvent({
      id: 'older-neighbour',
      timestamp: epochAtPx(65),
      trackId: 'other-track',
    })

    const clusters = clusterByZoom(
      [newestFragment, displayedFragment, olderNeighbour],
      { topMs, zoomIndex, sizePx, gapPx },
    )

    expect(clusters).toHaveLength(1)
    expect(clusters[0].anchorEvent.id).toBe('displayed-fragment')
    expect(clusters[0].events).toHaveLength(3)
  })

  it('heightPx equals sizePx for every cluster', () => {
    const e = makeEvent({ id: 'e1', timestamp: BASE_MS - 60_000 })
    const clusters = clusterByZoom([e], { topMs, zoomIndex, sizePx, gapPx })
    expect(clusters[0].heightPx).toBe(sizePx)
  })
})


describe('dedupeFragmentItems — one image per subject', () => {
  const T0 = 1_784_300_000_000
  const item = (
    id: string,
    className: string,
    start: number,
    end: number,
    importance?: number,
  ) => ({
    id,
    deviceId: 5,
    timestamp: T0 + start,
    endTimestamp: T0 + end,
    className,
    ...(importance !== undefined ? { importance } : {}),
  })

  it('collapses SEQUENTIAL same-class fragments to the best one', () => {
    // One person split by the tracker into three back-to-back rows.
    const a = item('a', 'person', 0, 10_000, 0.3)
    const b = item('b', 'person', 12_000, 20_000, 0.7) // best
    const c = item('c', 'person', 21_000, 30_000, 0.5)
    const out = dedupeFragmentItems([c, b, a]) // newest→oldest input order
    expect(out).toEqual([b])
  })

  it('keeps CONCURRENT same-class tracks separate (two people together)', () => {
    const p1 = item('p1', 'person', 0, 30_000, 0.6)
    const p2 = item('p2', 'person', 2_000, 28_000, 0.5)
    const out = dedupeFragmentItems([p1, p2])
    expect(out).toHaveLength(2)
  })

  it('never merges across classes (person + dog walking together)', () => {
    const p = item('p', 'person', 0, 20_000)
    const d = item('d', 'dog', 21_000, 40_000)
    expect(dedupeFragmentItems([d, p])).toHaveLength(2)
  })

  it('does not chain across a gap larger than the fragment window', () => {
    const early = item('early', 'person', 0, 10_000)
    const later = item('later', 'person', 70_000, 90_000) // 60s gap → distinct passage
    expect(dedupeFragmentItems([later, early])).toHaveLength(2)
  })

  it('a fragment continuing a JUST-ENDED track attaches there, not to a concurrent one', () => {
    // A ends at 30s; B (concurrent, distinct subject) runs 5s..60s.
    // C starts at 31s: it continues A (sequential) — B must survive separately.
    const a = item('a', 'person', 0, 30_000, 0.4)
    const b = item('b', 'person', 5_000, 60_000, 0.9)
    const c = item('c', 'person', 31_000, 45_000, 0.6)
    const out = dedupeFragmentItems([b, c, a])
    expect(out.map((e) => e.id).sort()).toEqual(['b', 'c'])
  })

  it('tolerates a small hand-off overlap between fragments', () => {
    const a = item('a', 'person', 0, 10_000, 0.8)
    const b = item('b', 'person', 9_000, 20_000, 0.2) // 1s overlap = hand-off
    expect(dedupeFragmentItems([b, a])).toEqual([a])
  })

  it('point items (no endTimestamp) still dedupe sequentially', () => {
    const a = { id: 'a', deviceId: 5, timestamp: T0, className: 'person' }
    const b = { id: 'b', deviceId: 5, timestamp: T0 + 5_000, className: 'person' }
    expect(dedupeFragmentItems([b, a])).toHaveLength(1)
  })
})
