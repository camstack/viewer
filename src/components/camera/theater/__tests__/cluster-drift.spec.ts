/**
 * A card is drawn where its newest displayed event IS, however busy the camera.
 *
 * ## The report (2026-10-29)
 *
 * Event clusters on the timeline sat up to ~10 minutes away from the events
 * they hold. Reproduced against a live camera's last six hours of tracks
 * (device 101, 85 tracks): at the 30 m zoom the 16th card was drawn 32 minutes
 * (1954 s) below its own newest event.
 *
 * Two things made a card slide down, and each compounded card after card:
 *  - the member cap split a busy minute across several cards, and a card cannot
 *    overlap its neighbour, so each split card was pushed down by a whole card;
 *  - a card absorbed only events within `sizePx`, so the next card's raw anchor
 *    was always `gapPx` short of clear — pushed down by the gap, every time.
 */
import { describe, expect, it } from 'vitest'
import { clusterByZoom, type ObjectEvent } from '../event-cluster.js'
import { CLUSTER_PANEL_HEIGHT } from '../cluster-frame-box.js'
import { epochToOffset } from '../timeline-geometry.js'

const ZOOM = 4 // 30 m range, 34 px per minute
const SIZE = CLUSTER_PANEL_HEIGHT
const GAP = Math.round(SIZE * 0.1)
const TOP_MS = 1_700_000_000_000
const SEC = 1000

function track(id: string, agoSec: number): ObjectEvent {
  const t = TOP_MS - agoSec * SEC
  return { id, deviceId: 101, timestamp: t, endTimestamp: t + 8 * SEC, className: 'person', trackId: id }
}

const layout = { topMs: TOP_MS, zoomIndex: ZOOM, sizePx: SIZE, gapPx: GAP }
const px = (ms: number): number => epochToOffset(ms, TOP_MS, ZOOM)
const drift = (c: { topPx: number; anchorMs: number }): number => c.topPx - px(c.anchorMs)

describe('cluster position does not drift from its events', () => {
  it('a camera busy for 3 hours (an event every 30 s): no card is more than a gap below its anchor', () => {
    const events = Array.from({ length: 360 }, (_, i) => track(`t${i}`, i * 30 + 5))
    const clusters = clusterByZoom(events, layout)
    expect(clusters.length).toBeGreaterThan(20)
    for (const c of clusters) expect(drift(c)).toBeLessThanOrEqual(GAP)
  })

  it('a burst far denser than a card (12 events in one minute) stays at its time', () => {
    const burst = Array.from({ length: 12 }, (_, i) => track(`b${i}`, 600 + i * 5))
    const later = Array.from({ length: 12 }, (_, i) => track(`c${i}`, 1500 + i * 5))
    const clusters = clusterByZoom([...burst, ...later], layout)
    for (const c of clusters) expect(drift(c)).toBeLessThanOrEqual(GAP)
  })

  it('cards still never overlap', () => {
    const events = Array.from({ length: 200 }, (_, i) => track(`t${i}`, i * 20 + 5))
    const clusters = clusterByZoom(events, layout)
    for (let i = 1; i < clusters.length; i++) {
      expect(clusters[i].topPx).toBeGreaterThanOrEqual(clusters[i - 1].topPx + clusters[i - 1].heightPx)
    }
  })
})
