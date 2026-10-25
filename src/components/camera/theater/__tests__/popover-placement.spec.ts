import { describe, it, expect } from 'vitest'
import { placePopover, POPOVER_GAP, type WindowRect } from '../popover-placement.js'

/**
 * Where the playback bar's speed / overflow menu opens on web, once it is
 * portalled out of the bar (operator, 2026-10-06: the menu opened UP into the
 * timeline toolbar and painted under it — an empty sliver poking out from
 * beneath the header).
 */

const VIEWPORT = { width: 1000, height: 800 }
const MENU = { width: 90, height: 200 }

/** A 50×35 speed chip whose top edge is at `y`, right edge at 950. */
function chipAt(y: number): WindowRect {
  return { x: 900, y, width: 50, height: 35 }
}

describe('placePopover', () => {
  it('opens UPWARD when the room above holds the menu', () => {
    const p = placePopover(chipAt(500), MENU, VIEWPORT)
    expect(p.direction).toBe('up')
    expect(p.top).toBe(500 - POPOVER_GAP - MENU.height)
  })

  it('flips DOWN when the chip sits near the top (the rail, under the toolbar)', () => {
    // The operator's layout: the bar is the first thing under a ~50pt header.
    const p = placePopover(chipAt(110), MENU, VIEWPORT)
    expect(p.direction).toBe('down')
    expect(p.top).toBe(110 + 35 + POPOVER_GAP)
  })

  it('never places the menu outside the window', () => {
    for (let y = 0; y <= VIEWPORT.height - 35; y += 5) {
      const p = placePopover(chipAt(y), MENU, VIEWPORT)
      expect(p.top, String(y)).toBeGreaterThanOrEqual(POPOVER_GAP)
      expect(p.top + MENU.height, String(y)).toBeLessThanOrEqual(VIEWPORT.height - POPOVER_GAP)
    }
  })

  it('with room on neither side, takes the larger and pins inside the window', () => {
    const short = { width: 400, height: 260 }
    const p = placePopover(chipAt(120), MENU, short)
    expect(p.direction).toBe('up')
    expect(p.top).toBe(POPOVER_GAP)
  })

  it('right-aligns to the chip, clamped at the window edges', () => {
    expect(placePopover(chipAt(500), MENU, VIEWPORT).left).toBe(950 - MENU.width)
    const atLeftEdge = placePopover({ x: 10, y: 500, width: 30, height: 30 }, MENU, VIEWPORT)
    expect(atLeftEdge.left).toBe(POPOVER_GAP)
    const pastRight = placePopover({ x: 990, y: 500, width: 30, height: 30 }, MENU, VIEWPORT)
    expect(pastRight.left).toBe(VIEWPORT.width - POPOVER_GAP - MENU.width)
  })

  it('honours a downward preference symmetrically', () => {
    expect(placePopover(chipAt(100), MENU, VIEWPORT, 'down').direction).toBe('down')
    expect(placePopover(chipAt(700), MENU, VIEWPORT, 'down').direction).toBe('up')
  })
})
