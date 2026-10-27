import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatEventAge, formatEventTime, yesterdayWord } from '../events-time'

const now = new Date(2026, 9, 18, 9, 5).getTime() // Sunday 18 Oct 2026
const at = (d: number, h = 14, m = 32): number => new Date(2026, 9, d, h, m).getTime()
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'events-time.ts')

describe('formatEventTime', () => {
  it('today is HH:MM only', () => {
    expect(formatEventTime(at(18, 7, 4), now)).toBe('07:04')
    expect(formatEventTime(at(18), now, 'it-IT')).toBe('14:32')
  })
  it('yesterday is named, in the locale', () => {
    expect(formatEventTime(at(17), now, 'en-GB')).toBe('Yesterday 14:32')
    expect(formatEventTime(at(17), now, 'it-IT')).toBe('Ieri 14:32')
  })
  it('yesterday never constructs RelativeTimeFormat (Hermes lacks it)', () => {
    // The live crash: `new Intl.RelativeTimeFormat` → "undefined cannot be used
    // as a constructor" on every "ieri" tile after midnight (2026-10-18).
    const src = readFileSync(SRC, 'utf8')
    expect(src).not.toMatch(/new\s+Intl\.RelativeTimeFormat/)
    expect(yesterdayWord('it-IT')).toBe('Ieri')
    expect(yesterdayWord('en-GB')).toBe('Yesterday')
  })
  it('within a week it is the short weekday', () => {
    expect(formatEventTime(at(15), now, 'en-GB')).toMatch(/^Thu\.? 14:32$/)
    expect(formatEventTime(at(15), now, 'it-IT')).toBe('gio 14:32')
    expect(formatEventTime(at(11), now, 'it-IT')).toBe('dom 14:32')
  })
  it('a week or more back is DD/MM', () => {
    expect(formatEventTime(at(10), now, 'en-GB')).toBe('10/10 14:32')
    expect(formatEventTime(at(10), now, 'it-IT')).toBe('10/10 14:32')
    expect(formatEventTime(new Date(2026, 8, 2, 1, 2).getTime(), now)).toBe('02/09 01:02')
  })
})

describe('formatEventAge', () => {
  const ago = (ms: number): number => now - ms
  it('is compact up to seven days, in the language of the page', () => {
    expect(formatEventAge(ago(20_000), now, 'en')).toBe('now')
    expect(formatEventAge(ago(20_000), now, 'it')).toBe('ora')
    expect(formatEventAge(ago(5 * 60_000), now, 'en')).toBe('5m')
    expect(formatEventAge(ago(3 * 3_600_000), now, 'it')).toBe('3h')
    expect(formatEventAge(ago(30 * 3_600_000), now, 'en')).toBe('1d')
    expect(formatEventAge(ago(30 * 3_600_000), now, 'it')).toBe('1g')
    expect(formatEventAge(ago(6 * 86_400_000), now, 'it')).toBe('6g')
  })
  it('is a short localized date past seven days and for the future', () => {
    expect(formatEventAge(ago(8 * 86_400_000), now, 'en')).toMatch(/10 Oct|Oct 10/)
    expect(formatEventAge(ago(8 * 86_400_000), now, 'it')).toBe('10 ott')
    expect(formatEventAge(now + 3_600_000, now, 'it')).toBe('18 ott')
  })
})
