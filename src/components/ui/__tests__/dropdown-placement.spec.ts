import { describe, it, expect } from 'vitest'
import { placeAnchoredDropdown } from '../dropdown-placement.js'

/**
 * The occupancy / audio selectors used to open either a full-screen bottom
 * sheet or a Modal whose menu was `justifyContent: 'center'` — so the list
 * floated in the middle of the phone, not on the row that opened it.
 * Placement is a pure function of trigger + menu + window so the attachment
 * can be unit-tested without rendering.
 */

const WINDOW = { width: 390, height: 844 }

describe('placeAnchoredDropdown', () => {
  it('hangs the menu under the trigger, right edges aligned', () => {
    const placed = placeAnchoredDropdown({
      trigger: { x: 220, y: 400, width: 140, height: 32 },
      menuSize: { width: 220, height: 280 },
      windowSize: WINDOW,
    })
    expect(placed.placement).toBe('below')
    expect(placed.top).toBe(400 + 32 + 4)
    // align end: menu.right === trigger.right
    expect(placed.left).toBe(220 + 140 - 220)
  })

  it('is NOT centered on the window when the trigger sits on the right', () => {
    const placed = placeAnchoredDropdown({
      trigger: { x: 250, y: 500, width: 120, height: 28 },
      menuSize: { width: 200, height: 200 },
      windowSize: WINDOW,
    })
    const windowCenter = (WINDOW.width - 200) / 2
    expect(placed.left).not.toBe(windowCenter)
    expect(placed.left).toBeGreaterThan(windowCenter)
  })

  it('flips above the trigger when there is no room below', () => {
    const placed = placeAnchoredDropdown({
      trigger: { x: 40, y: 780, width: 160, height: 32 },
      menuSize: { width: 200, height: 240 },
      windowSize: WINDOW,
    })
    expect(placed.placement).toBe('above')
    expect(placed.top + Math.min(240, placed.maxHeight)).toBeLessThanOrEqual(780 - 4)
  })

  it('honours preferredPlacement=above even when there is room below', () => {
    // The timeline footer range chip: always open upward, like the rate menu.
    const placed = placeAnchoredDropdown({
      trigger: { x: 40, y: 400, width: 64, height: 32 },
      menuSize: { width: 120, height: 220 },
      windowSize: WINDOW,
      preferredPlacement: 'above',
    })
    expect(placed.placement).toBe('above')
    expect(placed.top + Math.min(220, placed.maxHeight)).toBeLessThanOrEqual(400 - 4)
  })

  it('honours preferredPlacement=below even when space above is larger', () => {
    const placed = placeAnchoredDropdown({
      trigger: { x: 40, y: 780, width: 160, height: 32 },
      menuSize: { width: 200, height: 240 },
      windowSize: WINDOW,
      preferredPlacement: 'below',
    })
    expect(placed.placement).toBe('below')
    expect(placed.top).toBe(780 + 32 + 4)
  })

  it('clamps a menu that would overflow the right edge', () => {
    const placed = placeAnchoredDropdown({
      trigger: { x: 300, y: 200, width: 80, height: 28 },
      menuSize: { width: 240, height: 160 },
      windowSize: WINDOW,
    })
    expect(placed.left).toBeGreaterThanOrEqual(16)
    expect(placed.left + 240).toBeLessThanOrEqual(WINDOW.width - 16)
  })

  it('keeps the screen gutter (16 px) on a phone: an end-aligned menu at the right edge', () => {
    // The Library sort chip sits at the row's end, under the gutter.
    const phone = { width: 390, height: 844 }
    const placed = placeAnchoredDropdown({
      trigger: { x: 330, y: 120, width: 44, height: 32 },
      menuSize: { width: 240, height: 260 },
      windowSize: phone,
      align: 'end',
    })
    expect(placed.left + 240).toBe(phone.width - 16)
    expect(placeAnchoredDropdown({
      trigger: { x: 0, y: 120, width: 44, height: 32 },
      menuSize: { width: 240, height: 260 },
      windowSize: phone,
      align: 'start',
    }).left).toBe(16)
  })

  it('caps maxHeight so a long list stays on-screen', () => {
    const placed = placeAnchoredDropdown({
      trigger: { x: 20, y: 600, width: 200, height: 32 },
      menuSize: { width: 200, height: 900 },
      windowSize: WINDOW,
    })
    expect(placed.maxHeight).toBeLessThan(WINDOW.height)
    expect(placed.top + placed.maxHeight).toBeLessThanOrEqual(WINDOW.height - 8)
  })
})
