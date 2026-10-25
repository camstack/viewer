/**
 * identity-picker — the search rule behind the person picker.
 *
 * ## Why a picker at all
 *
 * The review tab offered the gallery as chips: a row of every person under the
 * Analyze group card, another row of every person across the top of the screen
 * for the sample audit. That is fine for four people and unusable for forty —
 * the operator's report, 2026-09-13: *"il selettore li crescerebbe troppo,
 * serve una alternativa"*.
 *
 * The alternative is not a new idiom. This app already picks from a long list
 * in exactly one way — a search field over a scrolling list, the way the Events
 * camera facet does (`components/events/EventsFilterBar.tsx`) — so that is what
 * `components/faces/IdentityPickerSheet.tsx` renders, and this module is the
 * one rule underneath it.
 *
 * Kept framework-free so it runs under the repo's node vitest env
 * (`data/__tests__/identity-picker.spec.ts`).
 */
import type { PersonIdentity } from './use-face-gallery.js'

/**
 * Latin letters folded to their unaccented form.
 *
 * `String.prototype.normalize('NFD')` would be shorter, and it is deliberately
 * NOT used: this code runs on Hermes, where a built-in that node has is not a
 * built-in the phone has (see `testing/hermes-globals.ts` for the crash that
 * taught this repo the difference). An explicit table cannot be wrong about
 * which engine it is on.
 *
 * The coverage is the Latin-1 range names in this gallery actually use. A
 * letter missing here simply does not fold — the search still matches it
 * literally, which is the same behaviour the field had before.
 */
const FOLD: Readonly<Record<string, string>> = {
  à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a', æ: 'ae',
  ç: 'c',
  è: 'e', é: 'e', ê: 'e', ë: 'e',
  ì: 'i', í: 'i', î: 'i', ï: 'i',
  ñ: 'n',
  ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o', ø: 'o',
  ù: 'u', ú: 'u', û: 'u', ü: 'u',
  ý: 'y', ÿ: 'y',
  ß: 'ss',
}

/** Lower-cased and stripped of accents — the form both sides of the match are
 *  compared in, so `niccolo` finds `Niccolò` and `Niccolò` finds it too. */
export function foldForSearch(value: string): string {
  let out = ''
  for (const char of value.toLowerCase()) out += FOLD[char] ?? char
  return out
}

/**
 * The people whose name contains `query`, in the order they were given.
 *
 * A blank query is NOT a filter: the very same array comes back, by reference,
 * so a `useMemo` above this does not hand the list a new identity on every
 * keystroke that leaves the field empty. A query that matches nothing answers
 * an EMPTY list — never the whole gallery, which would read as "your search
 * found everyone".
 */
export function filterIdentities(
  identities: readonly PersonIdentity[],
  query: string,
): readonly PersonIdentity[] {
  const needle = foldForSearch(query.trim())
  if (needle.length === 0) return identities
  return identities.filter((person) => foldForSearch(person.name).includes(needle))
}
