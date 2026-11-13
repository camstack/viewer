/**
 * Whether a double-tap zoom step is the operator's, or the tail of a pinch.
 *
 * ## Why this exists
 *
 * The double tap climbs a zoom ladder anchored on the tap (1x → 2x → 3x → 4x →
 * 1x), and it is composed `Gesture.Simultaneous` with the pinch — deliberately,
 * because a pinch and a pan must run together. The cost is that a finger which
 * bounces as the hand leaves the glass can register two taps immediately after
 * a pinch, and the picture the operator had just set by hand jumps a notch.
 *
 * Reported 2026-09-21: *"a volte quando faccio pinch out ritorna un po' in
 * avanti, forse per un misclick di un dito"*.
 *
 * ## Why a clock and not a pointer count
 *
 * The pinch's own `numberOfPointers < 2` guard already covers the focal jump
 * WHILE fingers are down. This is the other side of the release: by the time
 * the taps register the pinch has ended and every pointer is up, so nothing in
 * the gesture state distinguishes a bounce from an intention. Only time does.
 *
 * Pure and worklet-safe: no imports, no closures over React state, so the gate
 * can be read on the UI thread inside the tap's own worklet.
 */

import type { TouchSequence } from './zoom-touch-sequence.js'

/**
 * How long a pinch keeps the tap ladder shut.
 *
 * Deliberately shorter than it could be. A double tap is itself ~300 ms of
 * taps, so a window much past half a second would start refusing a deliberate
 * gesture — a debounce that becomes a lockout is a worse bug than the one it
 * fixes, and harder to notice.
 */
export const TAP_AFTER_PINCH_MS = 350

export interface TapStepGateInput {
  readonly nowMs: number
  /** When the last pinch released. `0` when none has, this screen. */
  readonly lastPinchEndMs: number
}

/** True when the ladder may move. */
export function tapStepAccepted(input: TapStepGateInput): boolean {
  'worklet'
  const since = input.nowMs - input.lastPinchEndMs
  // A negative gap is a clock artefact, never a pinch in the future. Refusing
  // there would wedge the double tap until wall time caught up.
  if (since < 0) return true
  return since >= TAP_AFTER_PINCH_MS
}

export type DoubleTapRefusal = 'after-pinch' | 'multi-touch' | 'pinch-seen' | 'pan-seen' | 'not-two-taps'

export interface DoubleTapGateInput extends TapStepGateInput {
  readonly sequence: TouchSequence
}

/**
 * Why a double tap must NOT move the zoom, or `null` when it may.
 *
 * A double tap is two quick single-finger taps with nothing else happening.
 * Two fingers down at any point, a pinch or a real pan during the same touch
 * is a different gesture whose tail merely looks like taps; acting on it reset
 * the operator's zoom to 1x. The 350 ms clock stays as the last line.
 */
export function doubleTapRefusal(input: DoubleTapGateInput): DoubleTapRefusal | null {
  'worklet'
  if (input.sequence.pinchSeen) return 'pinch-seen'
  if (input.sequence.maxTouches > 1) return 'multi-touch'
  if (input.sequence.panSeen) return 'pan-seen'
  // The recogniser's "two taps" are two touches-began events; only the record
  // knows whether they were two single-finger touches of ONE sequence.
  if (input.sequence.downs !== 2) return 'not-two-taps'
  if (!tapStepAccepted(input)) return 'after-pinch'
  return null
}
