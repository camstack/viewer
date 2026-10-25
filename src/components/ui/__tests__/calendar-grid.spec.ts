import { describe, it, expect } from 'vitest'
import { monthBounds, monthBoundsForMs, buildMonthGrid, buildHourGrid } from '../calendar-grid.js'

describe('monthBounds', () => {
  it('returns local first-of-month → first-of-next-month', () => {
    const { fromMs, toMs } = monthBounds(2026, 5) // June 2026 (month is 0-based)
    expect(fromMs).toBe(new Date(2026, 5, 1, 0, 0, 0, 0).getTime())
    expect(toMs).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).getTime())
  })
})

describe('monthBoundsForMs', () => {
  it('derives the month of an arbitrary ms', () => {
    const ms = new Date(2026, 5, 17, 9, 30, 0).getTime()
    const { fromMs, toMs } = monthBoundsForMs(ms)
    expect(fromMs).toBe(new Date(2026, 5, 1, 0, 0, 0, 0).getTime())
    expect(toMs).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).getTime())
  })
})

describe('buildMonthGrid', () => {
  const now = new Date(2026, 5, 17, 12, 0, 0).getTime() // 2026-06-17 noon

  it('returns 42 cells starting on a Monday', () => {
    const cells = buildMonthGrid(2026, 5, now)
    expect(cells).toHaveLength(42)
    // June 1 2026 is a Monday → no leading days; first cell IS June 1.
    expect(cells[0].epoch).toBe(new Date(2026, 5, 1, 0, 0, 0, 0).getTime())
    expect(cells[0].inMonth).toBe(true)
  })

  it('flags inMonth correctly (June has 30 days)', () => {
    const cells = buildMonthGrid(2026, 5, now)
    expect(cells.filter((c) => c.inMonth)).toHaveLength(30)
  })

  it('flags future cells relative to today-midnight', () => {
    const cells = buildMonthGrid(2026, 5, now)
    const d18 = cells.find((c) => c.epoch === new Date(2026, 5, 18, 0, 0, 0, 0).getTime())
    const d17 = cells.find((c) => c.epoch === new Date(2026, 5, 17, 0, 0, 0, 0).getTime())
    expect(d18?.isFuture).toBe(true)
    expect(d17?.isFuture).toBe(false) // today is not "future"
  })
})

describe('buildHourGrid', () => {
  // 2026-06-17 14:30 local — the "now" the month-grid suite already uses.
  const now = new Date(2026, 5, 17, 14, 30, 0, 0).getTime()
  const day = new Date(2026, 5, 17, 0, 0, 0, 0).getTime()

  it('yields 24 wall-clock hours of the day', () => {
    const cells = buildHourGrid(day, now)
    expect(cells).toHaveLength(24)
    expect(cells[0].epoch).toBe(day)
    expect(cells[15].epoch).toBe(new Date(2026, 5, 17, 15, 0, 0, 0).getTime())
  })

  it('the hour containing now stays selectable; later hours are future', () => {
    const cells = buildHourGrid(day, now)
    expect(cells[14].isFuture).toBe(false) // 14:00 ≤ 14:30 — footage exists
    expect(cells[15].isFuture).toBe(true)
  })

  it('a past day has no future hours', () => {
    const cells = buildHourGrid(new Date(2026, 5, 10, 0, 0, 0, 0).getTime(), now)
    expect(cells.every((c) => !c.isFuture)).toBe(true)
  })
})
