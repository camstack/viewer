/**
 * ThemedStatusBar — drives the OS status-bar text/icon color from the resolved
 * app theme so it stays legible on every screen.
 *
 * expo-status-bar's `style` is the FOREGROUND (text/icons): `'light'` = white,
 * `'dark'` = black. The app theme (dark+light, system-aware) owns the background
 * behind the bar, so the foreground must be its inverse — dark theme → light
 * text, light theme → dark text. Without this the bar inherited a fixed color
 * and became unreadable in one of the two themes.
 *
 * This is mounted once at the provider root. Screens that need a different bar
 * while focused (e.g. the camera theater hides it / forces light over the black
 * video) can still render their own `<StatusBar>` — expo-status-bar is
 * component-based and the most-recently-mounted instance wins.
 */
import React from 'react'
import { StatusBar } from 'expo-status-bar'
import { useTheme } from '../theme/theme-provider.js'

export function ThemedStatusBar() {
  const { mode } = useTheme()
  return <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
}
