/**
 * date-locale — the ONE locale every date and time in this app is formatted in.
 *
 * ## What was wrong
 *
 * Every `toLocaleDateString` / `toLocaleTimeString` in the app passed
 * `undefined` as its locale. That is not "no preference": it means **the
 * JavaScript runtime's** locale — the device's, on native; the browser's, on
 * web — and the app's own language setting (Settings → Lingua, `use-language.ts`,
 * which drives i18next) never reaches it.
 *
 * So the date panel rendered its month title and day title in whatever
 * language the phone happened to be in, while the weekday row beside them was
 * the hardcoded array `['L','M','M','G','V','S','D']`. One calendar, two
 * languages, and neither of them necessarily the one the operator chose.
 *
 * ## The rule
 *
 * A date is formatted in the language the app is speaking. i18next already
 * holds that answer, and `useDateLocale()` is the only way to get it — so the
 * sentence and the date inside it can never disagree.
 *
 * `resolveDateLocale` is the pure half, exported for tests and for the
 * non-React call sites.
 */
import { useTranslation } from 'react-i18next'

/**
 * The BCP-47 tag for an i18next language.
 *
 * i18next may hold a bare code (`it`) or a regional one (`it-IT`), and both
 * are valid `Intl` tags, so the value passes through. The guard is against the
 * two ways it can be USELESS: empty, and the `cimode` i18next sets while
 * rendering raw keys in development — either of which would send `Intl` back
 * to the runtime default, which is the bug this module exists to close.
 */
export function resolveDateLocale(language: string | undefined): string {
  if (language === undefined || language.length === 0) return 'en'
  if (language === 'cimode' || language === 'dev') return 'en'
  return language
}

/** The locale to hand every `Intl` / `toLocale*` call in a component. */
export function useDateLocale(): string {
  const { i18n } = useTranslation()
  return resolveDateLocale(i18n.language)
}

/**
 * The seven weekday initials, Monday-first, in a locale.
 *
 * Derived, never written down. The hardcoded `['L','M','M','G','V','S','D']`
 * was correct Italian and wrong everywhere else, and it sat directly beside a
 * month title formatted in a different language entirely.
 *
 * Monday-first because the grid below it is built Monday-first
 * (`calendar-grid.ts`); this function answers for the LETTERS, not the order,
 * and changing the order is a change to that module.
 *
 * 2026-01-05 is a Monday, used only as a known anchor to walk seven days.
 */
const MONDAY_ANCHOR_MS = Date.UTC(2026, 0, 5)
const DAY_MS = 86_400_000

export function weekdayInitials(locale: string): readonly string[] {
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' })
  return Array.from({ length: 7 }, (_, i) =>
    fmt.format(new Date(MONDAY_ANCHOR_MS + i * DAY_MS)),
  )
}
