/**
 * local-day — local calendar days for the Library's date control
 * (`LibraryDateDef` in `components/ui/LibraryFilterBar.tsx`, the timeline's
 * calendar without the time) and the filters behind it.
 *
 * Every epoch here is a LOCAL midnight (`new Date(y, m, d).getTime()`), the
 * same convention as `calendar-grid.ts` and the hub's day buckets. A page that
 * thinks in "days back from today" (Events, Media) converts with
 * {@link localDayOffset} / {@link dayStartForOffset}; a page that filters by
 * one day (People, Plates) keeps the midnight itself.
 *
 * Pure and RN-free — unit-tested in `__tests__/local-day.spec.ts`.
 */

export interface DayBounds {
  /** Local midnight of the day containing `ms`. */
  readonly startMs: number
  /** Local midnight of the next calendar day (`setDate(+1)`). Exclusive. */
  readonly endMs: number
}

/**
 * The local calendar day containing `ms`: midnight → the next midnight.
 * The span is 23 h, 24 h, or 25 h, whichever that civil day actually lasts.
 */
export function dayBounds(ms: number): DayBounds {
  const start = new Date(ms)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start.getTime())
  end.setDate(end.getDate() + 1)
  return { startMs: start.getTime(), endMs: end.getTime() }
}

/**
 * The same local wall-clock time `deltaDays` calendar days away.
 * `setDate`, never ±24 h — a 23 h or 25 h day would otherwise skip a date
 * or stay on the same one.
 */
export function shiftLocalDay(ms: number, deltaDays: number): number {
  const d = new Date(ms)
  d.setDate(d.getDate() + deltaDays)
  return d.getTime()
}

/** Local midnight of the day containing `ms`. */
export function startOfLocalDay(ms: number): number {
  return dayBounds(ms).startMs
}

/** Local midnight of the day AFTER the one containing `ms` — built from the
 *  calendar, not `+ 24 h`, so a DST day keeps its real length. */
export function startOfNextLocalDay(ms: number): number {
  return dayBounds(ms).endMs
}

/** `[fromMs, toMs]` of the day containing `dayMs`, both ends inclusive. */
export function localDayBounds(dayMs: number): { readonly fromMs: number; readonly toMs: number } {
  const fromMs = startOfLocalDay(dayMs)
  return { fromMs, toMs: startOfNextLocalDay(fromMs) - 1 }
}

/**
 * How many calendar days `dayMs` lies before today (0 = today, 1 = yesterday).
 * Rounded, because a span crossing a DST change is 23 or 25 hours per day;
 * never negative — a future day is today.
 */
export function localDayOffset(dayMs: number, nowMs: number): number {
  const days = Math.round((startOfLocalDay(nowMs) - startOfLocalDay(dayMs)) / 86_400_000)
  return Math.max(0, days)
}

/** The local midnight `dayOffset` calendar days before today. */
export function dayStartForOffset(dayOffset: number, nowMs: number): number {
  const today = new Date(startOfLocalDay(nowMs))
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - Math.max(0, dayOffset), 0, 0, 0, 0).getTime()
}

export interface LibraryDateLabels {
  readonly today: string
  readonly yesterday: string
  /** What the chip reads when no day is picked (a page that allows "every day"). */
  readonly allDates: string
}

/**
 * The chip's words: "Today", "Yesterday", else the short locale date with its
 * weekday ("Mon 20 Oct"); `allDates` when no day is picked.
 */
export function libraryDateLabel(
  dayMs: number | null,
  nowMs: number,
  locale: string,
  labels: LibraryDateLabels,
): string {
  if (dayMs === null) return labels.allDates
  const offset = localDayOffset(dayMs, nowMs)
  if (offset === 0) return labels.today
  if (offset === 1) return labels.yesterday
  const sameYear = new Date(dayMs).getFullYear() === new Date(nowMs).getFullYear()
  return new Date(dayMs).toLocaleDateString(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
