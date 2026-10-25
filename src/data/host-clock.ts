/** Pure helpers for the device-information overlay's clock. */

/** HH:MM in the device's locale and time zone (`Intl` — no manual padding). */
export function formatClock(date: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date)
}

/** Milliseconds until the next whole minute (never 0, so a timer always waits). */
export function msToNextMinute(now: number): number {
  return 60_000 - (now % 60_000)
}
