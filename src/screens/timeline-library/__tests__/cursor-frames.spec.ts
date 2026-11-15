import { describe, expect, it } from 'vitest'

import {
  LIVE_FRAME_LAG_MS,
  cursorInstant,
  fillFrameGrid,
  scrubsLive,
  settleInstant,
} from '../cursor-frames.js'

describe('cursor frames', () => {
  it('the cells stretch over the whole box, gaps included', () => {
    const grid = fillFrameGrid(4, 808, 408, 8, 2)
    expect(grid).toEqual({ cols: 2, rows: 2, cellW: 400, cellH: 200 })
    expect(grid.cols * grid.cellW + 8 * (grid.cols - 1)).toBe(808)
    expect(grid.rows * grid.cellH + 8 * (grid.rows - 1)).toBe(408)
    expect(fillFrameGrid(3, 600, 200, 0, 5).cols).toBe(3)
    expect(fillFrameGrid(0, 600, 200, 8, 2)).toEqual({ cols: 0, rows: 0, cellW: 0, cellH: 0 })
  })

  it('only a scope of up to four cameras scrubs live', () => {
    expect(scrubsLive(1)).toBe(true)
    expect(scrubsLive(4)).toBe(true)
    expect(scrubsLive(5)).toBe(false)
    expect(scrubsLive(0)).toBe(false)
  })

  it('the instant is the machine epoch, or "now" minus the live lag at the live edge', () => {
    expect(cursorInstant(1_000, 50_000)).toBe(1_000)
    expect(cursorInstant(null, 50_000)).toBe(50_000 - LIVE_FRAME_LAG_MS)
  })

  it('a drag in flight never changes the loaded instant; a released cursor does', () => {
    expect(settleInstant({ settled: 10, pending: 99, scrubbing: true })).toBe(10)
    expect(settleInstant({ settled: 10, pending: 99, scrubbing: false })).toBe(99)
    expect(settleInstant({ settled: 10, pending: 99, scrubbing: true, live: true })).toBe(99)
  })
})
