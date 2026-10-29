import { describe, expect, it } from 'vitest'
import {
  epochToContentY,
  offsetToEpoch,
  timelineLayoutOriginPx,
  type TimelineEpochMap,
} from '../timeline-geometry.js'

const TOP_MS = Date.UTC(2026, 9, 29, 21, 50, 0)
const INDICATOR_PX = 300

// Clips mode: a compressed axis, 10 px per minute.
const CLIP_MAP: TimelineEpochMap = {
  epochToOffset: (e) => Math.max(0, ((TOP_MS - e) / 60_000) * 10),
  offsetToEpoch: (y) => Math.round(TOP_MS - (y / 10) * 60_000),
  contentSpanPx: 6000,
}

describe('ticks and cards sit under the playhead epoch', () => {
  for (const contentTopInset of [0, 32]) {
    for (const zoomIndex of [0, 2, 4]) {
      it(`inset ${contentTopInset}, zoom ${zoomIndex}`, () => {
        const origin = timelineLayoutOriginPx({ indicatorOffsetPx: INDICATOR_PX, contentTopInset })
        for (const s of [0, 137, 2000, 9001]) {
          const epoch = offsetToEpoch(s, TOP_MS, zoomIndex)
          const y = epochToContentY(epoch, TOP_MS, zoomIndex, origin, null)
          expect(Math.abs(y - s - INDICATOR_PX)).toBeLessThanOrEqual(1)
        }
      })
    }
    it(`clips axis, inset ${contentTopInset}`, () => {
      const origin = timelineLayoutOriginPx({ indicatorOffsetPx: INDICATOR_PX, contentTopInset })
      const epoch = CLIP_MAP.offsetToEpoch(777)
      expect(Math.abs(epochToContentY(epoch, TOP_MS, 0, origin, CLIP_MAP) - 777 - INDICATOR_PX)).toBeLessThanOrEqual(1)
    })
  }
})
