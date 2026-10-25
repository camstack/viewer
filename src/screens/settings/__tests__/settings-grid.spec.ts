/**
 * How many columns the settings page uses.
 *
 * One long column is right on a phone and wasteful on a tablet or a desktop
 * window, where the operator scrolls past nine sections to reach the last one.
 */
import { describe, expect, it } from 'vitest'
import { settingsColumns, SETTINGS_TWO_COL_MIN, SETTINGS_THREE_COL_MIN } from '../settings-grid.js'

describe('settingsColumns', () => {
  it('keeps one column on a phone', () => {
    expect(settingsColumns(390)).toBe(1)
    expect(settingsColumns(SETTINGS_TWO_COL_MIN - 1)).toBe(1)
  })

  it('goes to two at the tablet threshold and three on a desktop window', () => {
    expect(settingsColumns(SETTINGS_TWO_COL_MIN)).toBe(2)
    expect(settingsColumns(SETTINGS_THREE_COL_MIN)).toBe(3)
    expect(settingsColumns(2_560)).toBe(3)
  })

  it('never answers zero or a fraction', () => {
    // The width feeds a percentage. A 0 divides by zero and a fraction lays
    // sections out at a width nothing can render — both would be a blank page
    // rather than a visibly wrong one.
    for (const w of [0, -100, Number.NaN, 1, 100_000]) {
      const n = settingsColumns(w)
      expect(Number.isInteger(n), String(w)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(3)
    }
  })

  it('is monotonic — a wider window never gets FEWER columns', () => {
    let last = 0
    for (let w = 200; w <= 2_000; w += 20) {
      const n = settingsColumns(w)
      expect(n).toBeGreaterThanOrEqual(last)
      last = n
    }
  })
})
