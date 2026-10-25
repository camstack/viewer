/**
 * The joystick's pure half: a finger offset from the ring's centre → the cap's
 * `{ pan, tilt }`, and the thumb's resting point inside the ring.
 *
 * The conventions are the d-pad's (`navigation-controls.ts`), not a second
 * set: up on the screen is `tilt: +1` (forward), right is `pan: +1`, down is
 * `tilt: -1` (the cap's spin / turn-around). One math for both surfaces, so a
 * robot driven from the portrait panel and from the landscape overlay reads
 * the same command (operator, 2026-09-06: joystick + four buttons in
 * landscape overlay).
 *
 * Both functions carry the `'worklet'` directive: the joystick calls them
 * from its pan gesture on the UI thread, and a plain function reached from a
 * worklet throws at runtime, not at build.
 */

export interface JoystickOffset {
  /** Finger offset from the ring's centre, screen axes (y grows downward). */
  readonly dx: number
  readonly dy: number
  /** How far the thumb may travel from the centre, in points. */
  readonly radius: number
  /** Fraction of `radius` inside which the stick reads as centred. */
  readonly deadZone?: number
}

export interface JoystickVector {
  /** Cap `pan` in [-1, 1]: negative = left, positive = right. */
  readonly pan: number
  /** Cap `tilt` in [-1, 1]: positive = forward, negative = turn around. */
  readonly tilt: number
  /** Deflection in [0, 1] after the dead zone — 0 is a centred stick. */
  readonly magnitude: number
}

export interface JoystickThumbPosition {
  readonly x: number
  readonly y: number
}

/**
 * 15 % of the travel reads as centred. A thumb that rests on the ring is never
 * exactly on its centre, and a robot that creeps because a resting thumb sits
 * two points off is the defect this guards.
 */
export const JOYSTICK_DEAD_ZONE = 0.15

const CENTRED: JoystickVector = Object.freeze({ pan: 0, tilt: 0, magnitude: 0 })

export function joystickVector({ dx, dy, radius, deadZone = JOYSTICK_DEAD_ZONE }: JoystickOffset): JoystickVector {
  'worklet'
  if (!(radius > 0)) return CENTRED
  const distance = Math.hypot(dx, dy)
  const dead = deadZone * radius
  if (distance <= dead) return CENTRED
  // Re-scaled from the dead zone's edge, so the first point past it is a
  // whisper and not a 15 % lurch.
  const magnitude = Math.min(1, (distance - dead) / (radius - dead))
  // `+ 0` folds the `-0` a negated axis produces into the one zero the d-pad
  // vocabulary uses, so the two surfaces compare equal.
  const pan = (dx / distance) * magnitude + 0
  const tilt = -(dy / distance) * magnitude + 0
  return { pan, tilt, magnitude }
}

/** Where the thumb is drawn: under the finger inside the ring, on it outside. */
export function joystickThumbPosition({ dx, dy, radius }: Omit<JoystickOffset, 'deadZone'>): JoystickThumbPosition {
  'worklet'
  const distance = Math.hypot(dx, dy)
  if (distance <= radius || distance === 0) return { x: dx, y: dy }
  const k = radius / distance
  return { x: dx * k, y: dy * k }
}
