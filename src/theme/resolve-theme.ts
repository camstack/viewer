import { THEME, type ThemeMode, type ColorTokens } from './tokens.js'

export type ThemePreference = 'dark' | 'light' | 'system'
export type SystemScheme = 'dark' | 'light' | null

export const THEME_STORAGE_KEY = 'v2.theme'

/** Resolve the effective theme mode. 'system' follows the OS scheme, defaulting
 *  to 'dark' when the OS scheme is unknown (dominevo's primary mode). */
export function resolveMode(pref: ThemePreference, systemScheme: SystemScheme): ThemeMode {
  if (pref === 'system') return systemScheme ?? 'dark'
  return pref
}

/** The dominevo color tokens for the resolved mode. */
export function resolveColors(pref: ThemePreference, systemScheme: SystemScheme): ColorTokens {
  return THEME[resolveMode(pref, systemScheme)]
}
