/**
 * A time with no date on it is a lie as soon as the body shows more than one
 * day — and clips mode widens the window backwards by itself.
 */
import { describe, expect, it } from 'vitest'
import { calendarDaysAgo, dayRelativeLabel } from '../day-relative-label.js'

const AT = (y: number, m: number, d: number, h = 12, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime()

const NOW = AT(2026, 9, 22, 10, 0)
const IT = { locale: 'it-IT' }

describe('calendarDaysAgo — whole days, not elapsed hours', () => {
  it('is 0 for any time TODAY, however far from now', () => {
    expect(calendarDaysAgo(AT(2026, 9, 22, 0, 1), NOW)).toBe(0)
    expect(calendarDaysAgo(AT(2026, 9, 22, 23, 59), NOW)).toBe(0)
  })

  it('is 1 for yesterday even when only minutes apart', () => {
    // 23:59 yesterday to 00:01 today is two minutes and one day. An elapsed
    // -hours division calls that zero and drops the date from the label.
    expect(calendarDaysAgo(AT(2026, 9, 21, 23, 59), AT(2026, 9, 22, 0, 1))).toBe(1)
  })

  it('counts backwards across a month boundary', () => {
    expect(calendarDaysAgo(AT(2026, 8, 31, 12), AT(2026, 9, 2, 12))).toBe(2)
  })

  it('is negative for the future, never a positive day count', () => {
    expect(calendarDaysAgo(AT(2026, 9, 23), NOW)).toBe(-1)
  })
})

describe('dayRelativeLabel — the operator\'s shape', () => {
  it('shows the time alone for today', () => {
    expect(dayRelativeLabel(AT(2026, 9, 22, 15, 43), NOW, IT)).toBe('15:43')
  })

  it('prefixes the weekday up to a week back', () => {
    // 2026-09-21 is a Monday.
    expect(dayRelativeLabel(AT(2026, 9, 21, 15, 43), NOW, IT)).toBe('lun 15:43')
    // The seventh day back is still inside the window.
    expect(dayRelativeLabel(AT(2026, 9, 15, 15, 43), NOW, IT)).toContain('15:43')
    expect(dayRelativeLabel(AT(2026, 9, 15, 15, 43), NOW, IT).split(' ')[0]).toHaveLength(3)
  })

  it('switches to a short date past a week — a weekday name stops being unique', () => {
    const label = dayRelativeLabel(AT(2026, 9, 14, 15, 43), NOW, IT)
    expect(label).toBe('14 set 15:43')
  })

  it('treats a FUTURE stamp as today rather than claiming tomorrow', () => {
    // A camera an hour ahead of the hub is a disagreement about the present,
    // not a recording from the future.
    expect(dayRelativeLabel(AT(2026, 9, 22, 23, 30), NOW, IT)).toBe('23:30')
    expect(dayRelativeLabel(AT(2026, 9, 23, 1, 0), NOW, IT)).toBe('01:00')
  })

  it('follows the locale it is handed, for the weekday AND the month', () => {
    const en = dayRelativeLabel(AT(2026, 9, 21, 15, 43), NOW, { locale: 'en-GB' })
    expect(en.startsWith('Mon')).toBe(true)
    expect(dayRelativeLabel(AT(2026, 9, 14, 15, 43), NOW, { locale: 'en-GB' })).toContain('Sep')
  })
})
