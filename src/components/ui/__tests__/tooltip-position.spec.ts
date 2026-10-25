import { describe, it, expect } from 'vitest'
import { tooltipLeftOffset, TOOLTIP_SHOW_DELAY_MS, TOOLTIP_GAP } from '../tooltip-position.js'

describe('tooltipLeftOffset', () => {
  it('centers a tooltip wider than its anchor (negative overhang)', () => {
    // 34px icon button, 90px label → 28px overhang each side.
    expect(tooltipLeftOffset(34, 90)).toBe(-28)
  })

  it('centers a tooltip narrower than its anchor', () => {
    expect(tooltipLeftOffset(100, 40)).toBe(30)
  })

  it('is zero for equal widths', () => {
    expect(tooltipLeftOffset(50, 50)).toBe(0)
  })

  it('rounds to whole pixels', () => {
    expect(tooltipLeftOffset(35, 90)).toBe(-27) // -27.5 → -27 (Math.round)
    expect(Number.isInteger(tooltipLeftOffset(33, 90))).toBe(true)
  })

  it('exports sane timing/gap constants', () => {
    expect(TOOLTIP_SHOW_DELAY_MS).toBeGreaterThan(0)
    expect(TOOLTIP_GAP).toBeGreaterThanOrEqual(0)
  })
})
