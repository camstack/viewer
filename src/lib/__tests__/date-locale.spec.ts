/**
 * Every date in this app is formatted in the language the app is SPEAKING.
 *
 * The operator's phone and app are both in Italian, and he reported the
 * calendar was not. Both halves of it were wrong independently: the month and
 * day titles went through `toLocaleDateString(undefined, …)`, which is the
 * RUNTIME's locale and not i18next's, and the weekday row beside them was the
 * literal array `['L','M','M','G','V','S','D']` — correct Italian, wrong
 * everywhere else, and not even derived from the same source as its
 * neighbours.
 */
import { describe, expect, it } from 'vitest'
import { resolveDateLocale, weekdayInitials } from '../date-locale.js'

describe('resolveDateLocale', () => {
  it('passes a real language through, bare or regional', () => {
    expect(resolveDateLocale('it')).toBe('it')
    expect(resolveDateLocale('it-IT')).toBe('it-IT')
    expect(resolveDateLocale('en')).toBe('en')
  })

  it('never returns undefined — that is the bug, not a default', () => {
    // `undefined` reaches Intl as "use the runtime's locale", which is exactly
    // how the app's own language setting stopped mattering.
    expect(resolveDateLocale(undefined)).toBe('en')
    expect(resolveDateLocale('')).toBe('en')
  })

  it("refuses i18next's development modes, which are not languages", () => {
    expect(resolveDateLocale('cimode')).toBe('en')
    expect(resolveDateLocale('dev')).toBe('en')
  })
})

describe('weekdayInitials', () => {
  it('is Monday-first, seven long, matching the grid below it', () => {
    const it = weekdayInitials('it')
    expect(it).toHaveLength(7)
    expect(it[0]).toBe('L')
    expect(it[6]).toBe('D')
  })

  it('actually changes with the locale — the whole point', () => {
    expect(weekdayInitials('en')[0]).toBe('M')
    expect(weekdayInitials('en')[6]).toBe('S')
    expect(weekdayInitials('en')).not.toEqual(weekdayInitials('it'))
  })

  it('reproduces the array it replaces, so Italian is unchanged', () => {
    expect([...weekdayInitials('it')]).toEqual(['L', 'M', 'M', 'G', 'V', 'S', 'D'])
  })
})
