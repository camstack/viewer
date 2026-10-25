import { describe, expect, it } from 'vitest'
import { eventsDayLabel } from '../events-day-label.js'

const LABELS: Record<string, string> = {
  'v2.events.today': 'Oggi',
  'v2.events.yesterday': 'Ieri',
  'v2.events.weekdayShort.sun': 'Dom',
  'v2.events.weekdayShort.mon': 'Lun',
  'v2.events.weekdayShort.tue': 'Mar',
  'v2.events.weekdayShort.wed': 'Mer',
  'v2.events.weekdayShort.thu': 'Gio',
  'v2.events.weekdayShort.fri': 'Ven',
  'v2.events.weekdayShort.sat': 'Sab',
}

const t = (key: string, fallback?: string): string => LABELS[key] ?? fallback ?? key

/** Monday 31 Aug 2026 12:00 local. */
const MONDAY_NOON = new Date(2026, 7, 31, 12, 0, 0).getTime()

describe('eventsDayLabel', () => {
  it('labels today as Oggi', () => {
    expect(eventsDayLabel(0, MONDAY_NOON, t)).toBe('Oggi')
  })

  it('labels yesterday as Ieri, not the weekday', () => {
    expect(eventsDayLabel(1, MONDAY_NOON, t)).toBe('Ieri')
  })

  it('uses 3-letter weekdays for the rest of the past week', () => {
    expect(eventsDayLabel(2, MONDAY_NOON, t)).toBe('Sab')
    expect(eventsDayLabel(3, MONDAY_NOON, t)).toBe('Ven')
    expect(eventsDayLabel(4, MONDAY_NOON, t)).toBe('Gio')
    expect(eventsDayLabel(5, MONDAY_NOON, t)).toBe('Mer')
    expect(eventsDayLabel(6, MONDAY_NOON, t)).toBe('Mar')
    expect(eventsDayLabel(7, MONDAY_NOON, t)).toBe('Lun')
  })

  it('falls back to a locale date beyond a week', () => {
    const label = eventsDayLabel(8, MONDAY_NOON, t)
    expect(label).not.toBe('Oggi')
    expect(label).not.toBe('Ieri')
    expect(label).not.toMatch(/^(Dom|Lun|Mar|Mer|Gio|Ven|Sab)$/)
  })
})
