import { describe, expect, it } from 'vitest'

import {
  LIVE_FRAME_LAG_MS,
  cursorInstant,
  frameTileCap,
  planFrameTiles,
  settleInstant,
} from '../cursor-frames.js'

describe('cursor frames', () => {
  it('the tile cap grows with the box and never drops below one tile', () => {
    expect(frameTileCap(390)).toBeLessThan(frameTileCap(820))
    expect(frameTileCap(820)).toBeLessThan(frameTileCap(1440))
    expect(frameTileCap(0)).toBeGreaterThan(0)
  })

  it('the cap cuts the scope in order and reports what it left out', () => {
    const plan = planFrameTiles([1, 2, 3, 4, 5], 3)
    expect(plan.shown).toEqual([1, 2, 3])
    expect(plan.hidden).toBe(2)
    expect(planFrameTiles([1, 2], 9)).toEqual({ shown: [1, 2], hidden: 0 })
  })

  it('the instant is the machine epoch, or "now" minus the live lag at the live edge', () => {
    expect(cursorInstant(1_000, 50_000)).toBe(1_000)
    expect(cursorInstant(null, 50_000)).toBe(50_000 - LIVE_FRAME_LAG_MS)
  })

  it('a drag in flight never changes the loaded instant; a released cursor does', () => {
    expect(settleInstant({ settled: 10, pending: 99, scrubbing: true })).toBe(10)
    expect(settleInstant({ settled: 10, pending: 99, scrubbing: false })).toBe(99)
  })
})
