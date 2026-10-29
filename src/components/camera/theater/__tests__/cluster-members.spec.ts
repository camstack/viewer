import { describe, expect, it } from 'vitest'

import {
  memberSeekMs,
  MEMBER_SEEK_LEAD_MS,
} from '../cluster-members.js'
import { clusterByZoom, type ObjectEvent } from '../event-cluster.js'
import { clusterCardHeight } from '../cluster-frame-box.js'

function ev(id: string, start: number, end?: number): ObjectEvent {
  return {
    id,
    deviceId: 1,
    className: 'person',
    timestamp: start,
    trackId: id,
    ...(end === undefined ? {} : { endTimestamp: end }),
  }
}

describe('memberSeekMs', () => {
  it('lands two seconds before the member starts', () => {
    expect(MEMBER_SEEK_LEAD_MS).toBe(2_000)
    expect(memberSeekMs(ev('x', 100_000))).toBe(98_000)
  })
})

describe('clustering by the card height, uncapped', () => {
  const topMs = 10_000_000
  const dense = (n: number, stepMs: number): ObjectEvent[] =>
    Array.from({ length: n }, (_, i) => ev(`e${i}`, topMs - i * stepMs))

  it('the card is the gallery panel: one height for every width', () => {
    expect(clusterCardHeight(300)).toBe(162)
    expect(clusterCardHeight(0)).toBe(0)
  })

  it('a shorter card spans less time, so the same events fall into more clusters', () => {
    const events = dense(8, 60_000)
    const tall = clusterByZoom(events, { topMs, zoomIndex: 4, sizePx: 300, gapPx: 0 })
    const short = clusterByZoom(events, { topMs, zoomIndex: 4, sizePx: 60, gapPx: 0 })
    expect(short.length).toBeGreaterThan(tall.length)
  })

  it('has no member cap: a busy minute stays ONE card at its own time', () => {
    const clusters = clusterByZoom(dense(8, 1_000), {
      topMs,
      zoomIndex: 0,
      sizePx: 10_000,
      gapPx: 0,
    })
    expect(clusters.map((c) => c.carouselEvents.length)).toEqual([8])
  })
})
