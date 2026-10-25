/** Pure month-grid helpers for the month calendar (`MonthCalendar`: the timeline date panel and the Library date control). All epochs are LOCAL
 *  midnights (new Date(y, m, d).getTime()), matching the viewer's dayWindow math
 *  and the backend's local-midnight day buckets. */

export interface DayCell {
  /** Local-midnight epoch (ms) of this calendar day. */
  readonly epoch: number
  /** True when the day belongs to the displayed month (vs leading/trailing fill). */
  readonly inMonth: boolean
  /** True when the day is strictly after today (un-selectable). */
  readonly isFuture: boolean
}

/** Local [first-of-month, first-of-next-month) bounds. `month` is 0-based. */
export function monthBounds(year: number, month: number): { fromMs: number; toMs: number } {
  return {
    fromMs: new Date(year, month, 1, 0, 0, 0, 0).getTime(),
    toMs: new Date(year, month + 1, 1, 0, 0, 0, 0).getTime(),
  }
}

/** Month bounds for the month that contains `ms`. */
export function monthBoundsForMs(ms: number): { fromMs: number; toMs: number } {
  const d = new Date(ms)
  return monthBounds(d.getFullYear(), d.getMonth())
}

export interface HourCell {
  /** Hour of day, 0..23. */
  readonly hour: number
  /** Epoch (ms) of `day` at this hour, local. */
  readonly epoch: number
  /** True when the WHOLE hour is after `nowMs` (un-selectable — there is
   *  nothing recorded there yet). The hour containing `nowMs` stays selectable:
   *  seeking to its start is seeking into footage that exists. */
  readonly isFuture: boolean
}

/**
 * The 24 hour cells of the day at `dayEpochMs` (a local midnight). Built via
 * the Date constructor rather than `+ h * 3600_000` so a DST day keeps its
 * wall-clock hours — the same reason the month grid never adds day-lengths.
 */
export function buildHourGrid(dayEpochMs: number, nowMs: number): HourCell[] {
  const day = new Date(dayEpochMs)
  const cells: HourCell[] = []
  for (let hour = 0; hour < 24; hour++) {
    const epoch = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0, 0).getTime()
    cells.push({ hour, epoch, isFuture: epoch > nowMs })
  }
  return cells
}

/**
 * A 6×7 (42-cell) grid covering `month`, weeks starting Monday, with leading and
 * trailing days from the adjacent months. `nowMs` flags future cells.
 */
export function buildMonthGrid(year: number, month: number, nowMs: number): DayCell[] {
  const first = new Date(year, month, 1, 0, 0, 0, 0)
  // JS getDay(): 0=Sun..6=Sat → Monday-first index 0..6.
  const lead = (first.getDay() + 6) % 7
  const todayMidnight = new Date(nowMs)
  todayMidnight.setHours(0, 0, 0, 0)
  const cells: DayCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - lead + i, 0, 0, 0, 0)
    cells.push({
      epoch: d.getTime(),
      inMonth: d.getMonth() === month,
      isFuture: d.getTime() > todayMidnight.getTime(),
    })
  }
  return cells
}
