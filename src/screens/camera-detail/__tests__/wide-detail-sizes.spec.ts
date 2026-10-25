import { describe, it, expect } from 'vitest'
import {
  computeWideDetailSizes,
  TIMELINE_RAIL_WIDTH,
  TIMELINE_RAIL_WIDTH_NARROW,
} from '../wide-detail-sizes.js'

describe('computeWideDetailSizes', () => {
  it('1440x900: full 380 rail, stream width capped by the 62% viewport height', () => {
    const s = computeWideDetailSizes({ containerWidth: 1440, viewportHeight: 900 })
    expect(s.railWidth).toBe(TIMELINE_RAIL_WIDTH)
    // Height cap: 900*0.62*16/9 = 992 < column 1060 → height-capped.
    expect(s.streamWidth).toBeCloseTo(992, 0)
    expect(s.streamHeight).toBeCloseTo((s.streamWidth * 9) / 16, 5)
  })

  it('a tall window is column-capped instead (stream fills the column width)', () => {
    const s = computeWideDetailSizes({ containerWidth: 1200, viewportHeight: 1600 })
    expect(s.streamWidth).toBe(1200 - TIMELINE_RAIL_WIDTH)
  })

  it('below 1180 the rail narrows to 340 so the stream keeps ≥600px', () => {
    const s = computeWideDetailSizes({ containerWidth: 1000, viewportHeight: 900 })
    expect(s.railWidth).toBe(TIMELINE_RAIL_WIDTH_NARROW)
    expect(s.streamWidth).toBeGreaterThanOrEqual(600)
  })

  it('stream box is always true 16:9', () => {
    for (const containerWidth of [1000, 1180, 1440, 2560]) {
      const s = computeWideDetailSizes({ containerWidth, viewportHeight: 900 })
      expect(s.streamHeight * 16).toBeCloseTo(s.streamWidth * 9, 5)
    }
  })

  it('never returns a negative stream width', () => {
    const s = computeWideDetailSizes({ containerWidth: 100, viewportHeight: 900 })
    expect(s.streamWidth).toBeGreaterThanOrEqual(0)
  })
})
