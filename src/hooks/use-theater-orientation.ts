/**
 * The theater's orientation, re-asserted on every focus.
 *
 * `ScreenOrientation.lockAsync` is APP-WIDE: whatever a route asks for outlives
 * that route unless something puts it back. The camera screen used to apply its
 * intent from a `useEffect` keyed on `[fullscreen]` alone, and the tab stack
 * runs with `freezeOnBlur: false` — so a route pushed ON TOP of the theater
 * (the grid) could impose a lock on its way out that the still-mounted theater
 * never re-ran anything to undo. The layout stayed wrong until the route was
 * entered again from scratch: the operator's "la timeline comincia a stare
 * sotto", permanently.
 *
 * `useFocusEffect` is the only hook that fires again when a mounted screen
 * comes back to the front, so the intent is applied there. The cleanup runs on
 * BLUR as well as unmount, which is the other half of the same rule: a lock
 * imposed by a screen must not survive it.
 *
 * Explicit fullscreen EXIT is different from "not fullscreen". Exit only
 * unlocked, and with the phone still held landscape `resolveDetailLayoutMode`
 * stayed on `fill` — the UI looked like fullscreen with no way back to the
 * stacked portrait chrome. On a phone, exit therefore forces `PORTRAIT_UP`
 * through the same `shouldRestorePortraitLock` gate the grid uses (never
 * tablets, never web); afterwards free rotation is restored so a deliberate
 * landscape tilt can still fill the picture without the fullscreen control.
 */
import { useCallback, useRef } from 'react'
import { Platform } from 'react-native'
import { useFocusEffect } from 'expo-router'
import * as ScreenOrientation from 'expo-screen-orientation'

import { shouldRestorePortraitLock } from './sidebar-rules.js'

/**
 * What the theater wants the device to do while it is in front.
 *
 * - `landscape` — manual fullscreen, pinned.
 * - `portrait` — phone-only restore after an explicit fullscreen exit.
 * - `free` — follow the physical device, so rotating fills the screen.
 * - `none` — web, where there is no app-wide lock to hold: `screen.orientation
 *   .lock()` rejects outside fullscreen and the `void` swallows the rejection.
 */
export type TheaterOrientationIntent = 'landscape' | 'portrait' | 'free' | 'none'

export interface TheaterOrientationInput {
  readonly isWeb: boolean
  readonly fullscreen: boolean
  /**
   * True only on the transition out of explicit fullscreen, and only when the
   * phone gate says portrait restore is allowed. Absent / false ⇒ `free`.
   */
  readonly restorePortraitOnExit?: boolean
}

export function theaterOrientationIntent({
  isWeb,
  fullscreen,
  restorePortraitOnExit = false,
}: TheaterOrientationInput): TheaterOrientationIntent {
  if (isWeb) return 'none'
  if (fullscreen) return 'landscape'
  if (restorePortraitOnExit) return 'portrait'
  return 'free'
}

export interface TheaterOrientationOptions {
  /** Shortest side (pt) of the physical screen; `undefined` on web by design. */
  readonly screenMinSide: number | undefined
}

export function useTheaterOrientation(
  fullscreen: boolean,
  options: TheaterOrientationOptions,
): void {
  const isWeb = Platform.OS === 'web'
  const { screenMinSide } = options
  const wasFullscreenRef = useRef(fullscreen)

  useFocusEffect(
    useCallback((): void | (() => void) => {
      const restorePortraitOnExit =
        wasFullscreenRef.current &&
        !fullscreen &&
        shouldRestorePortraitLock({ screenMinSide, isWeb })
      wasFullscreenRef.current = fullscreen

      const intent = theaterOrientationIntent({
        isWeb,
        fullscreen,
        restorePortraitOnExit,
      })
      if (intent === 'none') return
      if (intent === 'landscape') {
        void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE)
      } else if (intent === 'portrait') {
        // Force the chrome back to portrait, then release so a later tilt can
        // still take the natural landscape `fill` path. `lockAsync` resolves
        // once the lock is applied — unlocking immediately after leaves the
        // device in the portrait orientation it just adopted.
        void ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).then(
          () => {
            void ScreenOrientation.unlockAsync()
          },
        )
      } else {
        void ScreenOrientation.unlockAsync()
      }
      return () => {
        void ScreenOrientation.unlockAsync()
      }
    }, [fullscreen, screenMinSide, isWeb]),
  )
}
