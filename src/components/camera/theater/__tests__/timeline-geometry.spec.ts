import { describe, it, expect } from 'vitest'
import { pxPerHour, offsetToEpoch, epochToOffset } from '../timeline-geometry.js'
import { ZOOM_LEVELS, TIMELINE_ROW_HEIGHT } from '../mock-data.js'

const TOP = 1_700_000_000_000 // arbitrary epoch ms

describe('pxPerHour', () => {
  it('derives px/hour from row minutes and row height', () => {
    for (let z = 0; z < ZOOM_LEVELS.length; z++) {
      const expected = (60 / ZOOM_LEVELS[z].rowMinutes) * TIMELINE_ROW_HEIGHT
      expect(pxPerHour(z)).toBe(expected)
    }
  })
  it('clamps out-of-range zoom indices', () => {
    expect(pxPerHour(-5)).toBe(pxPerHour(0))
    expect(pxPerHour(999)).toBe(pxPerHour(ZOOM_LEVELS.length - 1))
  })
})

describe('offsetToEpoch / epochToOffset', () => {
  it('offset 0 is the live edge (topMs)', () => {
    expect(offsetToEpoch(0, TOP, 2)).toBe(TOP)
  })
  it('scrolling down goes back in time', () => {
    const oneHourPx = pxPerHour(2)
    expect(offsetToEpoch(oneHourPx, TOP, 2)).toBe(TOP - 3_600_000)
  })
  it('round-trips epoch → offset → epoch', () => {
    const epoch = TOP - 5 * 3_600_000
    const off = epochToOffset(epoch, TOP, 2)
    expect(offsetToEpoch(off, TOP, 2)).toBe(epoch)
  })
  it('clamps offset to >= 0 for future epochs', () => {
    expect(epochToOffset(TOP + 3_600_000, TOP, 2)).toBe(0)
  })
})
