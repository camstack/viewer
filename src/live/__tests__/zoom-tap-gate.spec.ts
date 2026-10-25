/**
 * A tap that lands on the tail of a pinch is not a tap.
 *
 * ## The symptom
 *
 * The operator: *"a volte quando faccio pinch out ritorna un po' in avanti,
 * forse per un misclick di un dito"*. It is not a spring-back. The double tap
 * climbs a zoom ladder (1x → 2x → 3x → 4x → 1x) and it is composed
 * `Gesture.Simultaneous` with the pinch, so a finger that bounces while the
 * hand leaves the glass registers two taps and advances the ladder one notch —
 * right after a pinch has just set the scale by hand.
 *
 * The gate is time, not pointer count: by the time the taps register, the
 * pinch has already ended and every pointer is up. Nothing else can tell the
 * two apart.
 */
import { describe, expect, it } from 'vitest'

import { TAP_AFTER_PINCH_MS, tapStepAccepted } from '../zoom-tap-gate.js'

describe('tapStepAccepted', () => {
  it('accepts a tap on a screen nobody has pinched', () => {
    expect(tapStepAccepted({ nowMs: 10_000, lastPinchEndMs: 0 })).toBe(true)
  })

  it('refuses a tap in the shadow of a pinch that just ended', () => {
    expect(tapStepAccepted({ nowMs: 10_000, lastPinchEndMs: 9_900 })).toBe(false)
  })

  it('accepts again once the window has passed', () => {
    expect(
      tapStepAccepted({ nowMs: 10_000, lastPinchEndMs: 10_000 - TAP_AFTER_PINCH_MS - 1 }),
    ).toBe(true)
  })

  it('is exactly the window at its edge — no accidental off-by-one either way', () => {
    expect(tapStepAccepted({ nowMs: 10_000, lastPinchEndMs: 10_000 - TAP_AFTER_PINCH_MS })).toBe(
      true,
    )
    expect(
      tapStepAccepted({ nowMs: 10_000, lastPinchEndMs: 10_000 - TAP_AFTER_PINCH_MS + 1 }),
    ).toBe(false)
  })

  it('never refuses on a clock that went backwards', () => {
    // A future timestamp is a clock artefact, not a pinch that has not happened
    // yet. Refusing there would wedge the double tap until wall time caught up.
    expect(tapStepAccepted({ nowMs: 10_000, lastPinchEndMs: 11_000 })).toBe(true)
  })

  it('stays short enough to keep the deliberate gesture: a double tap is ~300 ms of taps', () => {
    // Long enough to cover a bouncing finger, short enough that someone who
    // pinches and then deliberately double-taps is still obeyed. If this grows
    // past half a second it stops being a debounce and starts being a lockout.
    expect(TAP_AFTER_PINCH_MS).toBeGreaterThanOrEqual(200)
    expect(TAP_AFTER_PINCH_MS).toBeLessThanOrEqual(500)
  })
})
