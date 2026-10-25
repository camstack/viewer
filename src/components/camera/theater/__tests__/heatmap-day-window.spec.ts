/**
 * The day window the heatmap strip spans (D483 extraction).
 *
 * It was derived inline in `TheaterTimeline` and would have been derived a
 * third time in the on-demand player's compact timeline. The window is the
 * local calendar day: midnight to the next midnight, 23 h, 24 h, or 25 h.
 */
import { describe, it, expect } from 'vitest'
import {
  dayFractionToEpoch,
  epochToDayFraction,
  localDayWindow,
} from '../heatmap-scrub.js'

describe('the day window containing an instant', () => {
  it('starts at local midnight and runs one day', () => {
    const noon = new Date(2026, 8, 12, 12, 34, 56, 789).getTime()
    const win = localDayWindow(noon)
    const start = new Date(win.fromMs)
    expect([start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()])
      .toEqual([0, 0, 0, 0])
    expect(start.getDate()).toBe(12)
    expect(win.toMs).toBe(new Date(2026, 8, 13).getTime())
  })

  it('contains the instant it was derived from', () => {
    const t = new Date(2026, 0, 31, 23, 59, 59, 999).getTime()
    const win = localDayWindow(t)
    expect(t).toBeGreaterThanOrEqual(win.fromMs)
    expect(t).toBeLessThan(win.toMs)
  })

  it('is idempotent — midnight resolves to its own window', () => {
    const win = localDayWindow(new Date(2026, 8, 12, 9, 0, 0).getTime())
    expect(localDayWindow(win.fromMs)).toEqual(win)
  })

  it('spans the real DST day: 23 h on 2026-03-29, 25 h on 2026-10-25', () => {
    const spring = localDayWindow(new Date(2026, 2, 29, 12).getTime())
    const autumn = localDayWindow(new Date(2026, 9, 25, 12).getTime())
    expect(spring.fromMs).toBe(new Date(2026, 2, 29).getTime())
    expect(spring.toMs).toBe(new Date(2026, 2, 30).getTime())
    expect(autumn.fromMs).toBe(new Date(2026, 9, 25).getTime())
    expect(autumn.toMs).toBe(new Date(2026, 9, 26).getTime())
    const springH = (spring.toMs - spring.fromMs) / 3_600_000
    const autumnH = (autumn.toMs - autumn.fromMs) / 3_600_000
    // Europe/Rome (and any EU zone): 23 h and 25 h. A zone without that
    // transition keeps 24 h; the ends above are still the calendar midnights.
    if (springH !== 24) expect(springH).toBe(23)
    if (autumnH !== 24) expect(autumnH).toBe(25)
  })
})

describe('the round trip the compact timeline shares with the theater', () => {
  const win = localDayWindow(new Date(2026, 8, 12, 15, 0, 0).getTime())

  it('maps an epoch to a fraction and back to itself', () => {
    const t = new Date(2026, 8, 12, 7, 30, 0).getTime()
    const f = epochToDayFraction(t, win.fromMs, win.toMs)
    expect(dayFractionToEpoch(f, win.fromMs, win.toMs)).toBe(t)
  })

  it('pins the ends of the strip to the ends of the day', () => {
    expect(dayFractionToEpoch(0, win.fromMs, win.toMs)).toBe(win.fromMs)
    expect(dayFractionToEpoch(1, win.fromMs, win.toMs)).toBe(win.toMs)
  })
})
