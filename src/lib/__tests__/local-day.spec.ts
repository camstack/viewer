/**
 * local-day — the calendar days behind the Library date control. Every
 * fixture is built in LOCAL time: the helpers reason in local days, so a UTC
 * epoch would land on another day depending on the machine's zone.
 */
import { describe, expect, it } from 'vitest'
import {
  dayBounds,
  dayStartForOffset,
  libraryDateLabel,
  localDayBounds,
  localDayOffset,
  shiftLocalDay,
  startOfLocalDay,
  startOfNextLocalDay,
} from '../local-day.js'

const NOW = new Date(2026, 9, 23, 16, 20, 0, 0).getTime()
const LABELS = { today: 'MARK-Today', yesterday: 'MARK-Yesterday', allDates: 'MARK-All dates' }

describe('local days', () => {
  it('a day starts at local midnight and ends one ms before the next', () => {
    expect(startOfLocalDay(NOW)).toBe(new Date(2026, 9, 23).getTime())
    expect(localDayBounds(NOW)).toEqual({
      fromMs: new Date(2026, 9, 23).getTime(),
      toMs: new Date(2026, 9, 24).getTime() - 1,
    })
  })

  it('the next day is the calendar\'s, not +24 h (a DST day keeps its length)', () => {
    // 25 Oct 2026 is the EU fall-back Sunday in CET zones; in any zone the
    // calendar answer is the next local midnight.
    const sunday = new Date(2026, 9, 25, 10, 0, 0, 0).getTime()
    expect(startOfNextLocalDay(sunday)).toBe(new Date(2026, 9, 26).getTime())
  })

  it('offset ↔ day round-trips across a month boundary and a DST change', () => {
    for (const offset of [0, 1, 2, 7, 23, 30, 45]) {
      const day = dayStartForOffset(offset, NOW)
      expect(localDayOffset(day, NOW), String(offset)).toBe(offset)
      expect(startOfLocalDay(day)).toBe(day)
    }
    expect(dayStartForOffset(23, NOW)).toBe(new Date(2026, 8, 30).getTime())
  })

  it('a future day is today, never a negative offset', () => {
    expect(localDayOffset(NOW + 3 * 86_400_000, NOW)).toBe(0)
    expect(dayStartForOffset(-2, NOW)).toBe(startOfLocalDay(NOW))
  })
})

describe('dayBounds — local midnight to the next, whatever that day lasts', () => {
  it('an ordinary day (2026-06-17) runs 24 h, noon to midnight is 12/24', () => {
    const noon = new Date(2026, 5, 17, 12, 0, 0, 0).getTime()
    const { startMs, endMs } = dayBounds(noon)
    expect(startMs).toBe(new Date(2026, 5, 17).getTime())
    expect(endMs).toBe(new Date(2026, 5, 18).getTime())
    expect(endMs - startMs).toBe(24 * 3_600_000)
    expect((noon - startMs) / (endMs - startMs)).toBeCloseTo(12 / 24, 10)
  })

  it('2026-10-25 ends at the next midnight; a 25 h day puts noon at 13/25, not at half', () => {
    const noon = new Date(2026, 9, 25, 12, 0, 0, 0).getTime()
    const { startMs, endMs } = dayBounds(noon)
    expect(startMs).toBe(new Date(2026, 9, 25).getTime())
    expect(endMs).toBe(new Date(2026, 9, 26).getTime())
    const span = endMs - startMs
    if (span === 25 * 3_600_000) {
      expect(noon - startMs).toBe(13 * 3_600_000)
      expect((noon - startMs) / span).toBeCloseTo(13 / 25, 10)
    }
  })

  it('2026-03-29 ends at the next midnight; a 23 h day puts noon at 11/23, not at half', () => {
    const noon = new Date(2026, 2, 29, 12, 0, 0, 0).getTime()
    const { startMs, endMs } = dayBounds(noon)
    expect(startMs).toBe(new Date(2026, 2, 29).getTime())
    expect(endMs).toBe(new Date(2026, 2, 30).getTime())
    const span = endMs - startMs
    if (span === 23 * 3_600_000) {
      expect(noon - startMs).toBe(11 * 3_600_000)
      expect((noon - startMs) / span).toBeCloseTo(11 / 23, 10)
    }
  })
})

describe('shiftLocalDay — calendar ±1, same wall clock', () => {
  it('2026-10-25 12:00 steps back to 2026-10-24 12:00 and forward to 2026-10-26 12:00', () => {
    const noon = new Date(2026, 9, 25, 12, 0, 0, 0).getTime()
    const back = new Date(shiftLocalDay(noon, -1))
    const fwd = new Date(shiftLocalDay(noon, 1))
    expect([back.getFullYear(), back.getMonth(), back.getDate(), back.getHours(), back.getMinutes()]).toEqual([2026, 9, 24, 12, 0])
    expect([fwd.getFullYear(), fwd.getMonth(), fwd.getDate(), fwd.getHours(), fwd.getMinutes()]).toEqual([2026, 9, 26, 12, 0])
  })

  it('2026-10-25 00:30 steps forward onto 2026-10-26 00:30 (a +24 h step stays on the 25th)', () => {
    const morning = new Date(2026, 9, 25, 0, 30, 0, 0).getTime()
    const fwd = new Date(shiftLocalDay(morning, 1))
    expect([fwd.getFullYear(), fwd.getMonth(), fwd.getDate(), fwd.getHours(), fwd.getMinutes()]).toEqual([2026, 9, 26, 0, 30])
  })

  it('2026-03-29 12:00 steps back to 2026-03-28 12:00 and forward to 2026-03-30 12:00', () => {
    const noon = new Date(2026, 2, 29, 12, 0, 0, 0).getTime()
    const back = new Date(shiftLocalDay(noon, -1))
    const fwd = new Date(shiftLocalDay(noon, 1))
    expect([back.getFullYear(), back.getMonth(), back.getDate(), back.getHours()]).toEqual([2026, 2, 28, 12])
    expect([fwd.getFullYear(), fwd.getMonth(), fwd.getDate(), fwd.getHours()]).toEqual([2026, 2, 30, 12])
  })
})

describe('libraryDateLabel — the chip\'s words', () => {
  it('Today, Yesterday, then the short date with its weekday', () => {
    expect(libraryDateLabel(startOfLocalDay(NOW), NOW, 'en-GB', LABELS)).toBe('MARK-Today')
    expect(libraryDateLabel(dayStartForOffset(1, NOW), NOW, 'en-GB', LABELS)).toBe('MARK-Yesterday')
    const label = libraryDateLabel(dayStartForOffset(3, NOW), NOW, 'en-GB', LABELS)
    expect(label).toContain('20')
    expect(label).toContain('Oct')
    expect(label).not.toContain('2026')
  })

  it('names the year only when it is not this one', () => {
    expect(libraryDateLabel(new Date(2025, 11, 31).getTime(), NOW, 'en-GB', LABELS)).toContain('2025')
  })

  it('no day picked reads "All dates"', () => {
    expect(libraryDateLabel(null, NOW, 'en-GB', LABELS)).toBe('MARK-All dates')
  })
})
