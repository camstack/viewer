/** Day labels for the events gallery's day dividers: Oggi / Ieri / 3-letter weekday. */

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export type EventsDayT = (key: string, fallback?: string) => string

/**
 * `dayOffset` 0 = today, 1 = yesterday, 2..7 = three-letter weekday of that
 * local calendar day, older = locale date. Weekdays are translated via
 * `v2.events.weekdayShort.*`.
 */
export function eventsDayLabel(dayOffset: number, nowMs: number, t: EventsDayT): string {
  if (dayOffset <= 0) return t('v2.events.today', 'Today')
  if (dayOffset === 1) return t('v2.events.yesterday', 'Yesterday')
  const day = new Date(nowMs)
  day.setHours(0, 0, 0, 0)
  day.setDate(day.getDate() - dayOffset)
  if (dayOffset <= 7) {
    const key = WEEKDAY_KEYS[day.getDay()] ?? 'sun'
    return t(`v2.events.weekdayShort.${key}`, key)
  }
  return day.toLocaleDateString()
}
