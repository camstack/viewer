/**
 * language-store — the app language the operator picked (Settings → General).
 *
 * An ACCOUNT setting (operator decision 2026-10-21): kept per user, per hub,
 * so this device holds one cached copy per hub under `v2.language@<serverId>`
 * (`server-scope.ts`), synced by `account/account-settings-sync.ts`. The
 * i18next instance follows the store (`app/i18n.ts` subscribes), so a value
 * that arrives from another device changes the language without the Settings
 * screen being open.
 */
import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { log } from '../lib/logger.js'
import { onServerScopeChange, scopedStorageKey, whenServerScoped } from './server-scope.js'

export type LanguagePreference = 'system' | 'it' | 'en'

/** Base key; one copy per hub (`scopedStorageKey`). */
export const LANGUAGE_STORAGE_KEY = 'v2.language'

export const LANGUAGE_DEFAULT: LanguagePreference = 'system'

export function parseLanguagePreference(raw: unknown): LanguagePreference {
  return raw === 'it' || raw === 'en' || raw === 'system' ? raw : LANGUAGE_DEFAULT
}

interface LanguageState {
  readonly preference: LanguagePreference
  readonly hydrated: boolean
  /** The hub `preference` belongs to; `null` before the first load. */
  readonly serverId: string | null
  hydrate: () => Promise<void>
  setPreference: (next: LanguagePreference) => void
}

function persist(serverId: string | null, preference: LanguagePreference): void {
  if (serverId === null) return
  void AsyncStorage.setItem(scopedStorageKey(LANGUAGE_STORAGE_KEY, serverId), preference).catch((e: unknown) => {
    log.error('settings', 'language persist failed', { error: e instanceof Error ? e.message : String(e) })
  })
}

async function readScoped(serverId: string): Promise<LanguagePreference> {
  try {
    return parseLanguagePreference(await AsyncStorage.getItem(scopedStorageKey(LANGUAGE_STORAGE_KEY, serverId)))
  } catch {
    return LANGUAGE_DEFAULT
  }
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
  preference: LANGUAGE_DEFAULT,
  hydrated: false,
  serverId: null,
  hydrate: async () => {
    if (get().hydrated) return
    const serverId = await whenServerScoped()
    const preference = await readScoped(serverId)
    // A pick made while the copy was being read wins over it.
    if (get().hydrated) return
    set({ preference, serverId, hydrated: true })
  },
  setPreference: (next) => {
    set({ preference: next })
    persist(get().serverId, next)
  },
}))

/** The language cached for the hub this device last used — read once at boot,
 *  before any hub is bound, so the first paint is already in that language. */
export async function readBootLanguage(activeServerId: string | null): Promise<LanguagePreference | null> {
  if (activeServerId === null) return null
  const raw = await AsyncStorage.getItem(scopedStorageKey(LANGUAGE_STORAGE_KEY, activeServerId))
  return raw === null ? null : parseLanguagePreference(raw)
}

onServerScopeChange((serverId) => {
  void readScoped(serverId).then((preference) => useLanguageStore.setState({ preference, serverId, hydrated: true }))
})
