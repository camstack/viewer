/**
 * day-relative-label — a timestamp that says WHICH DAY when the day is not
 * today.
 *
 * ## What was wrong
 *
 * Every card and every tick on the timeline rendered `HH:MM` and nothing else
 * (`formatHHMM`, copied verbatim into four components). That is exactly right
 * while the body shows one day and the toolbar names it — and wrong the moment
 * it does not. Clips mode widens the window backwards a day at a time, and the
 * cards from three days ago were indistinguishable from this morning's: a list
 * of times with no date anywhere on it.
 *
 * The operator asked for: *"la stessa data se non è oggi va mostrata con
 * l'orario in timeline"*, and chose the shape — *"Mostra 3 iniziali del giorno
 * fino a una settimana prima poi data corta"*.
 *
 * ## The rule
 *
 * - today                → `15:43`
 * - within the last week → `lun 15:43`
 * - older                → `18 set 15:43`
 *
 * "Within the last week" is counted in CALENDAR DAYS, not in 168 hours: a
 * weekday initial is only unambiguous while at most one day carries each name,
 * so the boundary has to be the seventh distinct day, and 6.5 days of elapsed
 * time can straddle eight of them. Seven days back inclusive is the last point
 * where "lun" can only mean one Monday.
 *
 * Pure: it takes the locale rather than reading one, so the same rule serves a
 * component (`useDateLocale()`) and a test (a fixed tag).
 */

/** How many distinct calendar days back still get a bare weekday name. */
export const WEEKDAY_NAME_DAYS = 7

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Whole calendar days between two instants — `0` for the same day, `1` for
 * yesterday.
 *
 * Both ends are floored to local midnight FIRST, so this is unaffected by the
 * time of day and by a DST shift inside the span, which a plain
 * `(a - b) / 86400000` is not: on the two days a year the offset moves, that
 * division is off by an hour and rounds to the wrong day for anything before
 * 01:00.
 */
export function calendarDaysAgo(ms: number, nowMs: number): number {
  return Math.round((startOfDay(nowMs) - startOfDay(ms)) / 86_400_000)
}

/**
 * `HH:MM` in the viewer's locale — the embed card's clock (`hhmm`), nothing
 * else: no day, because the surface that shows it (a tile in a day's list) has
 * already said which day it is.
 */
export function clockLabel(ms: number, locale: string): string {
  return new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
}

export interface DayRelativeLabelOptions {
  readonly locale: string
  /** Defaults to {@link WEEKDAY_NAME_DAYS}. */
  readonly weekdayDays?: number
}

/**
 * `HH:MM`, prefixed with the day when the day is not today.
 *
 * A FUTURE timestamp (a clock skew, a camera an hour ahead) is treated as
 * today: labelling it "tomorrow" would be a claim about the future made from a
 * disagreement about the present.
 */
export function dayRelativeLabel(
  ms: number,
  nowMs: number,
  options: DayRelativeLabelOptions,
): string {
  const time = clockLabel(ms, options.locale)
  const daysAgo = calendarDaysAgo(ms, nowMs)
  if (daysAgo <= 0) return time
  if (daysAgo <= (options.weekdayDays ?? WEEKDAY_NAME_DAYS)) {
    const weekday = new Date(ms).toLocaleDateString(options.locale, { weekday: 'short' })
    return `${weekday} ${time}`
  }
  const date = new Date(ms).toLocaleDateString(options.locale, {
    day: 'numeric',
    month: 'short',
  })
  return `${date} ${time}`
}
