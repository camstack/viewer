/**
 * "Is this surface actually being looked at?"
 *
 * ## Why
 *
 * Tabs stay mounted under a pushed camera detail (`freezeOnBlur: false`, in-app
 * PiP). A snapshot thumb or a live badge that keeps asking while that overlay
 * is up is competing with WebRTC on the same `wsLink` (no batching).
 *
 * Badge polls themselves are a 5 min reconcile plus events — the expensive
 * leftover is snapshot *demand*: naming a camera in `getSnapshotLinks` is a
 * standing capture order every 5 s. This hook is what lets those surfaces
 * say nobody is looking.
 *
 * ## What it combines
 *
 * Navigation focus AND app foreground — either one being false means nothing
 * is visible. Both matter: focus alone keeps polling while the phone is in a
 * pocket, foreground alone keeps polling behind the camera detail.
 *
 * Data does NOT go stale in a harmful way: React Query refetches on the next
 * render once `enabled` flips back, and the live event subscriptions deliver
 * state changes instantly regardless — the polls are self-heal, not the
 * primary signal.
 */

import { useCallback, useEffect, useState } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
// expo-router, NOT @react-navigation/native: as of SDK 56 importing
// react-navigation directly fails the bundle outright.
import { useFocusEffect } from 'expo-router'

import { isAppForeground } from './app-foreground.js'

/**
 * True while the app is on screen.
 *
 * The classification lives in `app-foreground.ts` and is NOT `=== 'active'`:
 * iOS `inactive` is the shade / Control Centre / app-switcher limbo, and the
 * launch window reports `inactive`, `unknown` or `null` before
 * `applicationDidBecomeActive:`. Both were read as "hidden" here, which blanked
 * every camera tile while the shade was down and deferred the first snapshot
 * demand of a cold start until an AppState change event arrived. See that
 * module for the full account.
 */
export function useAppForeground(): boolean {
  const [active, setActive] = useState(() => isAppForeground(AppState.currentState))
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      setActive(isAppForeground(s))
    })
    return () => sub.remove()
  }, [])
  return active
}

/**
 * True only when this screen is focused AND the app is in the foreground —
 * i.e. when a live badge would actually be seen by someone.
 */
export function useScreenActive(): boolean {
  // Starts TRUE so the first render of a freshly focused screen fetches
  // immediately rather than waiting a frame for the focus effect to land.
  const [focused, setFocused] = useState(true)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, []),
  )
  const foreground = useAppForeground()
  return focused && foreground
}
