/**
 * Press feedback of a glass control — the numbers, decided in ONE place.
 *
 * iOS glass shrinks a little under the finger and settles back with a spring.
 * `GlassButton` / `GlassPressable` read this table so the capsule segments, the
 * overlay discs and the floating timeline pills cannot drift into three
 * different feels. Pure (no React), so a spec can pin the values.
 */

import { MOTION } from '../../theme/motion.js'

export interface GlassPressTarget {
  readonly scale: number
  readonly opacity: number
}

/** The numbers live in the motion module; this is the name the glass controls know them by. */
export const GLASS_PRESS = MOTION.press

/** The target a control animates toward. A disabled control never leaves rest. */
export function glassPressTarget(pressed: boolean, disabled = false): GlassPressTarget {
  return pressed && !disabled ? GLASS_PRESS.pressed : GLASS_PRESS.rest
}
