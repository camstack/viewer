/**
 * useHeld — debounced "stay on for a while" wrapper around a boolean signal.
 *
 * Returns `true` immediately when `active` becomes true, and keeps returning
 * `true` for `holdMs` after `active` drops back to false (resetting the timer if
 * it flips on again). Used to give motion/audio/detection highlights a cooldown
 * so the border doesn't flicker between events.
 */
import { useEffect, useState } from 'react'

export function useHeld(active: boolean, holdMs: number): boolean {
  const [held, setHeld] = useState(active)

  useEffect(() => {
    if (active) {
      setHeld(true)
      return
    }
    const t = setTimeout(() => setHeld(false), Math.max(0, holdMs))
    return () => clearTimeout(t)
  }, [active, holdMs])

  return held
}
