/**
 * A cluster card's TOP edge sits on its newest event and the card extends DOWN
 * over the window it absorbed, so every member's time is inside its own band.
 *
 * ## The report (2026-10-17, iPhone, 30 m zoom)
 *
 * The first card spanned 19:32 → 19:27 and its strip showed an event at 19:24;
 * the next card spanned 19:27 → 19:22. Tapping the 19:24 member seeked to
 * 19:23:58 and the cursor landed inside the NEXT card — "it took me to the next
 * cluster". The card was hung UPWARD from its newest event (19:27), so every
 * older member the cluster absorbed lay below it, in the neighbour's rectangle.
 *
 * Specs use the REAL panel height at the 30 m zoom (34 pt per minute), not a
 * made-up box.
 */
import { describe, expect, it } from 'vitest'
import { clusterByZoom, type ObjectEvent } from '../event-cluster.js'
import { CLUSTER_PANEL_HEIGHT } from '../cluster-frame-box.js'
import { MEMBER_SEEK_LEAD_MS, memberSeekMs } from '../cluster-members.js'
import { distanceToClusterPx } from '../cluster-proximity.js'
import { epochToOffset } from '../timeline-geometry.js'

const ZOOM = 4 // the 30 m range, 1-minute rows
const SIZE = CLUSTER_PANEL_HEIGHT
const GAP = Math.round(SIZE * 0.1)
const TOP_MS = 1_700_000_000_000
const MIN = 60_000

function track(id: string, minutesAgo: number): ObjectEvent {
  const startMs = TOP_MS - minutesAgo * MIN
  return { id, deviceId: 102, timestamp: startMs, endTimestamp: startMs + 8_000, className: 'person', trackId: id }
}

const layout = { topMs: TOP_MS, zoomIndex: ZOOM, sizePx: SIZE, gapPx: GAP }
const px = (ms: number): number => epochToOffset(ms, TOP_MS, ZOOM)

describe('cluster vertical anchoring: top on the newest event', () => {
  it('puts the card TOP on the newest event, not its bottom', () => {
    const [c] = clusterByZoom([track('t1', 10)], layout)
    expect(c.topPx).toBe(px(c.anchorMs))
    expect(c.heightPx).toBe(SIZE)
  })

  it('events 3 minutes apart are ONE cluster, and both lie inside its card', () => {
    const clusters = clusterByZoom([track('a', 10), track('b', 13)], layout)
    expect(clusters).toHaveLength(1)
    const [c] = clusters
    for (const e of c.events) {
      expect(px(e.timestamp)).toBeGreaterThanOrEqual(c.topPx)
      expect(px(e.timestamp)).toBeLessThanOrEqual(c.topPx + c.heightPx)
    }
  })

  it('events further apart than a card are two clusters, each TOP on its own event', () => {
    const clusters = clusterByZoom([track('a', 10), track('b', 16)], layout)
    expect(clusters).toHaveLength(2)
    expect(clusters[0].topPx).toBe(px(TOP_MS - 10 * MIN))
    expect(clusters[1].topPx).toBe(px(TOP_MS - 16 * MIN))
  })

  it('no card overlaps another and none is ever above its own newest event', () => {
    const events = [10, 12, 14.9, 15.1, 16, 21, 22, 40].map((m, i) => track(`e${i}`, m))
    const clusters = clusterByZoom(events, layout)
    for (let i = 0; i < clusters.length; i++) {
      expect(clusters[i].topPx).toBeGreaterThanOrEqual(px(clusters[i].anchorMs))
      if (i === 0) continue
      const prev = clusters[i - 1]
      expect(prev.topPx + prev.heightPx + GAP).toBeLessThanOrEqual(clusters[i].topPx)
    }
  })

  it('the member cap pushes the OLDER card down, never the newer one up', () => {
    const events = Array.from({ length: 8 }, (_, i) => track(`m${i}`, 10 + i * 0.4))
    const clusters = clusterByZoom(events, layout)
    expect(clusters.length).toBeGreaterThan(1)
    for (let i = 1; i < clusters.length; i++) {
      const prev = clusters[i - 1]
      expect(prev.topPx + prev.heightPx + GAP).toBeLessThanOrEqual(clusters[i].topPx)
      expect(clusters[i].topPx).toBeGreaterThanOrEqual(px(clusters[i].anchorMs))
    }
  })

  it('a card at the live edge is never above the live line', () => {
    const clusters = clusterByZoom([track('now', 0), track('soon', 2)], layout)
    for (const c of clusters) expect(c.topPx).toBeGreaterThanOrEqual(0)
  })

  it('tap-seek of every member lands inside its OWN card, not a neighbour', () => {
    const clusters = clusterByZoom([track('a', 10), track('b', 13), track('c', 17), track('d', 19)], layout)
    expect(clusters.length).toBeGreaterThan(1)
    for (const c of clusters) {
      for (const e of c.carouselEvents) {
        const seekMs = memberSeekMs(e)
        expect(seekMs).toBe(e.timestamp - MEMBER_SEEK_LEAD_MS)
        expect(distanceToClusterPx(c, seekMs, ZOOM)).toBe(0)
        for (const other of clusters) {
          if (other !== c) expect(distanceToClusterPx(other, seekMs, ZOOM)).toBeGreaterThan(0)
        }
      }
    }
  })

  it('leaves anchorMs itself alone — it is the seek target, not the geometry', () => {
    const [c] = clusterByZoom([track('t1', 10)], layout)
    expect(c.anchorMs).toBe(TOP_MS - 10 * MIN)
  })
})
