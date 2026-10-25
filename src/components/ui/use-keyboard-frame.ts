/**
 * Where the software keyboard is, as React state — the one subscription every
 * keyboard-aware surface reads (`KeyboardInset.tsx`).
 *
 * Reported as the keyboard's TOP edge in window coordinates, not its height:
 * the consumer measures its own bottom edge and takes the difference
 * (`keyboardOverlap`), which is right whether the window was resized under the
 * keyboard or not. `null` means nothing is covered — hidden, floating, or the
 * web, which has no software-keyboard events and never subscribes.
 */
import { useEffect, useState } from 'react'
import { Dimensions, Keyboard, Platform, type KeyboardEvent } from 'react-native'

import { keyboardEventNames, keyboardTopFromFrame } from './keyboard-inset.js'

/** The keyboard's current frame, plus the animation iOS will run to get there. */
export interface KeyboardFrame {
  /** Top edge, window coordinates. */
  readonly top: number
  /** iOS: the keyboard's own animation, ms (0 on Android, which reports after the fact). */
  readonly duration: number
}

function frameFromEvent(event: KeyboardEvent): KeyboardFrame | null {
  const top = keyboardTopFromFrame(event.endCoordinates, Dimensions.get('window').height)
  return top === null ? null : { top, duration: event.duration ?? 0 }
}

function initialFrame(): KeyboardFrame | null {
  if (keyboardEventNames(Platform.OS) === null || !Keyboard.isVisible()) return null
  const metrics = Keyboard.metrics()
  if (metrics === undefined) return null
  const top = keyboardTopFromFrame(metrics, Dimensions.get('window').height)
  return top === null ? null : { top, duration: 0 }
}

export function useKeyboardFrame(): KeyboardFrame | null {
  // A sheet that opens while the keyboard is ALREADY up (a field on the screen
  // behind it) starts lifted instead of waiting for an event that never comes.
  const [frame, setFrame] = useState<KeyboardFrame | null>(initialFrame)

  useEffect(() => {
    const names = keyboardEventNames(Platform.OS)
    if (names === null) return undefined
    const changed = Keyboard.addListener(names.change, (event) => setFrame(frameFromEvent(event)))
    const hidden = Keyboard.addListener(names.hide, () => setFrame(null))
    return () => {
      changed.remove()
      hidden.remove()
    }
  }, [])

  return frame
}
