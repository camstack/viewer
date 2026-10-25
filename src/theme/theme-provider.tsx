import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  resolveMode,
  resolveColors,
  THEME_STORAGE_KEY,
  type ThemePreference,
  type SystemScheme,
} from './resolve-theme.js'
import type { ThemeMode, ColorTokens } from './tokens.js'

interface ThemeContextValue {
  preference: ThemePreference
  mode: ThemeMode
  colors: ColorTokens
  setPreference: (p: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({
  initialPreference = 'system',
  children,
}: {
  initialPreference?: ThemePreference
  children: React.ReactNode
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference)
  useEffect(() => {
    void AsyncStorage.getItem(THEME_STORAGE_KEY).then((v) => {
      if (v === 'dark' || v === 'light' || v === 'system') setPreferenceState(v)
    })
  }, [])
  const setPreference = (p: ThemePreference): void => {
    setPreferenceState(p)
    void AsyncStorage.setItem(THEME_STORAGE_KEY, p)
  }
  // RN 0.83's useColorScheme() returns 'light' | 'dark' | 'unspecified';
  // normalize 'unspecified' (and any runtime nullish) to null for SystemScheme.
  const rawScheme = useColorScheme()
  const systemScheme: SystemScheme = rawScheme === 'light' || rawScheme === 'dark' ? rawScheme : null
  const mode = resolveMode(preference, systemScheme)
  const colors = useMemo(() => resolveColors(preference, systemScheme), [preference, systemScheme])
  const value = useMemo(
    () => ({ preference, mode, colors, setPreference }),
    [preference, mode, colors],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
