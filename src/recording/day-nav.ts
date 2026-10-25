import { dayBounds, shiftLocalDay } from '../lib/local-day.js'

/** Day-navigation helpers for the theater date selector. */

/**
 * The instant on `targetDayMidnightEpoch`'s day at the SAME time-of-day as
 * `currentEpoch`. Clamped to `nowMs` when that would land in the future (e.g.
 * picking "today" at a time-of-day not yet reached).
 */
export function dayAtSameTime(currentEpoch: number, targetDayMidnightEpoch: number, nowMs: number): number {
  const cur = new Date(currentEpoch)
  const target = new Date(targetDayMidnightEpoch)
  target.setHours(cur.getHours(), cur.getMinutes(), cur.getSeconds(), cur.getMilliseconds())
  const t = target.getTime()
  return t > nowMs ? nowMs : t
}

/** How much of the date the pill draws: the full label, a short one, or the day number. */
export type DateLabelFormat = 'full' | 'short' | 'day'

/**
 * "Oggi" / "Ieri" / a localized "Mar 17 Giu"-style date for the date pill.
 * `short` drops the weekday ("17 giu"; today and yesterday keep their word),
 * `day` is the day number alone.
 */
export function dateLabel(
  dayFromMs: number,
  nowMs: number,
  t: (key: string) => string,
  /** The app's language (`useDateLocale()`), never the runtime's. */
  locale: string,
  format: DateLabelFormat = 'full',
): string {
  if (format === 'day') return String(new Date(dayFromMs).getDate())
  const dayStart = dayBounds(dayFromMs).startMs
  const todayStart = dayBounds(nowMs).startMs
  if (dayStart === todayStart) return t('v2.theater.today')
  if (dayStart === shiftLocalDay(todayStart, -1)) return t('v2.theater.yesterday')
  return new Date(dayFromMs).toLocaleDateString(locale, {
    ...(format === 'full' ? { weekday: 'short' as const } : {}),
    day: 'numeric',
    month: 'short',
  })
}
