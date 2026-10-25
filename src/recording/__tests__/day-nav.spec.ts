import { describe, it, expect } from 'vitest'
import { shiftLocalDay } from '../../lib/local-day.js'
import { dayAtSameTime, dateLabel } from '../day-nav.js'

describe('dayAtSameTime', () => {
  const now = new Date(2026, 5, 17, 12, 0, 0).getTime()

  it('keeps the time-of-day on the target day', () => {
    const current = new Date(2026, 5, 17, 19, 30, 45, 0).getTime()
    const targetDay = new Date(2026, 5, 15, 0, 0, 0, 0).getTime()
    expect(dayAtSameTime(current, targetDay, now)).toBe(
      new Date(2026, 5, 15, 19, 30, 45, 0).getTime(),
    )
  })

  it('clamps to now when the resulting instant is in the future', () => {
    // current time-of-day 19:30 on TODAY would be future (now is noon) → clamp.
    const current = new Date(2026, 5, 17, 19, 30, 0, 0).getTime()
    const targetDay = new Date(2026, 5, 17, 0, 0, 0, 0).getTime()
    expect(dayAtSameTime(current, targetDay, now)).toBe(now)
  })
})

describe('calendar day navigation', () => {
  it('from 2026-10-25 12:00, back one day is 2026-10-24 and forward is 2026-10-26', () => {
    const noon = new Date(2026, 9, 25, 12, 0, 0, 0).getTime()
    const back = new Date(shiftLocalDay(noon, -1))
    const fwd = new Date(shiftLocalDay(noon, 1))
    expect([back.getFullYear(), back.getMonth(), back.getDate(), back.getHours()]).toEqual([2026, 9, 24, 12])
    expect([fwd.getFullYear(), fwd.getMonth(), fwd.getDate(), fwd.getHours()]).toEqual([2026, 9, 26, 12])
  })

  it('from 2026-03-30 00:30, back one day is 2026-03-29, not the day before that', () => {
    // The spring-forward day is 23 h, so subtracting 24 h from early 30 Mar
    // skips 29 Mar and lands on 28 Mar.
    const morning = new Date(2026, 2, 30, 0, 30, 0, 0).getTime()
    const back = new Date(shiftLocalDay(morning, -1))
    expect([back.getFullYear(), back.getMonth(), back.getDate(), back.getHours(), back.getMinutes()]).toEqual([2026, 2, 29, 0, 30])
  })
})

describe('dateLabel', () => {
  const now = new Date(2026, 5, 17, 12, 0, 0).getTime()
  const t = (k: string): string => (k === 'v2.theater.today' ? 'Oggi' : k === 'v2.theater.yesterday' ? 'Ieri' : k)

  it('returns Today for the current day', () => {
    expect(dateLabel(new Date(2026, 5, 17, 0, 0, 0).getTime(), now, t, 'it-IT')).toBe('Oggi')
  })

  it('returns Yesterday for the previous day', () => {
    expect(dateLabel(new Date(2026, 5, 16, 0, 0, 0).getTime(), now, t, 'it-IT')).toBe('Ieri')
  })

  it('calls 2026-10-25 yesterday when now is 2026-10-26, even though that day lasted 25 h', () => {
    const nowAutumn = new Date(2026, 9, 26, 18, 0, 0, 0).getTime()
    expect(dateLabel(new Date(2026, 9, 25, 0, 0, 0).getTime(), nowAutumn, t, 'it-IT')).toBe('Ieri')
    expect(dateLabel(new Date(2026, 9, 26, 12, 0, 0).getTime(), nowAutumn, t, 'it-IT')).toBe('Oggi')
  })

  it('returns a formatted date for older days in the app locale', () => {
    const label = dateLabel(new Date(2026, 5, 10, 0, 0, 0).getTime(), now, t, 'it-IT')
    expect(label).not.toBe('Oggi')
    expect(label).not.toBe('Ieri')
    expect(label.length).toBeGreaterThan(0)
    // English locale must not stay Italian when the app language is English.
    const en = dateLabel(new Date(2026, 5, 10, 0, 0, 0).getTime(), now, t, 'en-US')
    expect(en.toLowerCase()).toContain('jun')
  })
})
