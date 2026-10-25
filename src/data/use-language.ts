import { useEffect } from 'react'
import * as Localization from 'expo-localization'
import { useLanguageStore, type LanguagePreference } from '../store/language-store.js'

export type { LanguagePreference } from '../store/language-store.js'

const SUPPORTED: readonly string[] = ['it', 'en']

function deviceLanguage(): string {
  const lng = Localization.getLocales()[0]?.languageCode?.slice(0, 2) ?? 'en'
  return SUPPORTED.includes(lng) ? lng : 'en'
}

export function resolveLanguage(pref: LanguagePreference): string {
  return pref === 'system' ? deviceLanguage() : pref
}

/**
 * The language preference (an ACCOUNT setting, `store/language-store.ts`).
 * i18next follows the store on its own (`app/i18n.ts`), so this hook only
 * reads and writes the preference.
 */
export function useLanguage(): {
  preference: LanguagePreference
  setPreference: (p: LanguagePreference) => void
} {
  const preference = useLanguageStore((s) => s.preference)
  const setPreference = useLanguageStore((s) => s.setPreference)
  const hydrate = useLanguageStore((s) => s.hydrate)
  useEffect(() => {
    void hydrate()
  }, [hydrate])
  return { preference, setPreference }
}
