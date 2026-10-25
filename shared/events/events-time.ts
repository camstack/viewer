/**
 * events-time — the clock label of a track tile, shared by the hub embed's
 * gallery and the native gallery so the two cannot disagree on what a tile says.
 *
 * - today                       => `HH:MM`
 * - yesterday                   => `Yesterday HH:MM` / `Ieri HH:MM`
 * - 2..7 calendar days back     => `Thu HH:MM` / `gio HH:MM`
 * - older (or in the future)    => `DD/MM HH:MM`
 *
 * Weekday / clock words come from `Intl` where Hermes has them. "Yesterday" does
 * NOT — Hermes 0.17 has no `Intl.RelativeTimeFormat`, and constructing it threw
 * `undefined cannot be used as a constructor` on every "ieri" tile after midnight
 * (OTA 1.0.630+, 2026-10-18). A small locale table keeps the label without that
 * constructor. `nowMs` is injected so the rule is pure. `locale` also shapes the
 * clock (12h/24h); omit it for the host's default locale and a fixed 24h clock.
 */

/** Calendar days back that still get a friendly name instead of a date. */
export const FRIENDLY_DAY_SPAN = 7

function clock(date: Date, locale: string | undefined): string {
  if (locale !== undefined) {
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  }
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Whole local calendar days between `ms` and `nowMs` (DST-safe). */
function daysBack(ms: number, nowMs: number): number {
  return Math.round((startOfDay(nowMs) - startOfDay(ms)) / 86_400_000)
}

/**
 * The word for "yesterday" without `Intl.RelativeTimeFormat` (absent on Hermes).
 * Exported so a missing-constructor regression is a one-line test, not a device.
 */
export function yesterdayWord(locale: string | undefined): string {
  const tag = (locale ?? 'en').toLowerCase()
  if (tag.startsWith('it')) return 'Ieri'
  if (tag.startsWith('de')) return 'Gestern'
  if (tag.startsWith('fr')) return 'Hier'
  if (tag.startsWith('es')) return 'Ayer'
  return 'Yesterday'
}

export function formatEventTime(lastSeen: number, nowMs: number, locale?: string): string {
  const d = new Date(lastSeen)
  const time = clock(d, locale)
  const back = daysBack(lastSeen, nowMs)
  if (back === 0) return time
  if (back === 1) return `${yesterdayWord(locale)} ${time}`
  if (back > 1 && back <= FRIENDLY_DAY_SPAN) {
    return `${d.toLocaleDateString(locale, { weekday: 'short' })} ${time}`
  }
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  return `${day}/${month} ${time}`
}
