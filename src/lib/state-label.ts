/**
 * state-label — the viewer's door to the ONE shared dictionary of state
 * labels (`stateLabel` in `@dominevo/types`, R7, D690): the device-state and
 * scene words the rule editors show. The admin UI reads the same dictionary,
 * so the two editors cannot call one state two things.
 *
 * Its one job is to map the app's i18n language onto the dictionary's locales
 * (Italian, else English). An unknown word is shown as it is stored — the
 * shared function's own fallback.
 */
import { stateLabel } from '@dominevo/types/client'
import type { StateLabelLocale } from '@dominevo/types'

/** The dictionary locale for an i18n language tag (`it`, `it-IT` → `it`). */
export function stateLabelLocale(language: string | undefined): StateLabelLocale {
  return (language ?? '').toLowerCase().startsWith('it') ? 'it' : 'en'
}

/** The human label of a stored state word, or the word itself. Never throws. */
export function stateLabelFor(key: string, language: string | undefined): string {
  return stateLabel(key, stateLabelLocale(language))
}

/**
 * A live string value in the viewer's language when it is a state word the
 * dictionary knows (`open` → `Aperto`); any other text comes back untouched,
 * so free text such as a model name is never reworded.
 */
export function translateStateWord(word: string, language: string | undefined): string {
  const key = word.trim().toLowerCase()
  const en = stateLabel(key, 'en')
  const it = stateLabel(key, 'it')
  if (en === it) return word
  return stateLabelLocale(language) === 'it' ? it : en
}
