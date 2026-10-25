/**
 * The joystick's pure half. The ring and the d-pad it replaced must AGREE:
 * a stick pushed fully up is the d-pad's "forward" vector, fully down its
 * "turn around", so a robot driven from either surface reads the same
 * command (operator, 2026-09-06: one component, one math).
 */
import { describe, expect, it } from 'vitest'
import { NAVIGATION_VECTORS } from '../../../../data/navigation-controls.js'
import {
  JOYSTICK_DEAD_ZONE,
  joystickThumbPosition,
  joystickVector,
} from '../drive-joystick-math.js'

const RADIUS = 40

describe('joystickVector', () => {
  it('maps screen offsets onto the cap axes: up = forward (tilt +), right = pan +', () => {
    expect(joystickVector({ dx: 0, dy: -RADIUS, radius: RADIUS })).toEqual({ pan: 0, tilt: 1, magnitude: 1 })
    expect(joystickVector({ dx: RADIUS, dy: 0, radius: RADIUS })).toEqual({ pan: 1, tilt: 0, magnitude: 1 })
    expect(joystickVector({ dx: -RADIUS, dy: 0, radius: RADIUS })).toEqual({ pan: -1, tilt: 0, magnitude: 1 })
    expect(joystickVector({ dx: 0, dy: RADIUS, radius: RADIUS })).toEqual({ pan: 0, tilt: -1, magnitude: 1 })
  })

  it('agrees with the d-pad vocabulary at full deflection', () => {
    const full = {
      forward: { dx: 0, dy: -RADIUS },
      turnAround: { dx: 0, dy: RADIUS },
      left: { dx: -RADIUS, dy: 0 },
      right: { dx: RADIUS, dy: 0 },
    } as const
    for (const [direction, offset] of Object.entries(full)) {
      const v = joystickVector({ ...offset, radius: RADIUS })
      const expected = NAVIGATION_VECTORS[direction as keyof typeof NAVIGATION_VECTORS]
      expect({ pan: v.pan, tilt: v.tilt }, direction).toEqual(expected)
    }
  })

  it('a deflection past the ring is clamped onto it — never outside the cap range', () => {
    const v = joystickVector({ dx: 3 * RADIUS, dy: -4 * RADIUS, radius: RADIUS })
    expect(v.magnitude).toBe(1)
    expect(Math.hypot(v.pan, v.tilt)).toBeCloseTo(1, 6)
    expect(v.pan).toBeCloseTo(0.6, 6)
    expect(v.tilt).toBeCloseTo(0.8, 6)
  })

  it('inside the 15% dead zone the stick is centred: zero vector, zero magnitude', () => {
    expect(JOYSTICK_DEAD_ZONE).toBe(0.15)
    const inside = joystickVector({ dx: 0.1 * RADIUS, dy: 0.05 * RADIUS, radius: RADIUS })
    expect(inside).toEqual({ pan: 0, tilt: 0, magnitude: 0 })
    expect(joystickVector({ dx: 0, dy: 0, radius: RADIUS })).toEqual({ pan: 0, tilt: 0, magnitude: 0 })
  })

  it('leaving the dead zone starts from zero, not from a 15% jump', () => {
    const justOut = joystickVector({ dx: 0.16 * RADIUS, dy: 0, radius: RADIUS })
    expect(justOut.magnitude).toBeGreaterThan(0)
    expect(justOut.magnitude).toBeLessThan(0.05)
    const half = joystickVector({ dx: 0, dy: -0.575 * RADIUS, radius: RADIUS })
    expect(half.magnitude).toBeCloseTo(0.5, 6)
    expect(half.tilt).toBeCloseTo(0.5, 6)
  })

  it('a custom dead zone is honoured', () => {
    expect(joystickVector({ dx: 0.3 * RADIUS, dy: 0, radius: RADIUS, deadZone: 0.5 }).magnitude).toBe(0)
  })

  it('a degenerate radius yields the centred vector rather than NaN', () => {
    expect(joystickVector({ dx: 10, dy: 10, radius: 0 })).toEqual({ pan: 0, tilt: 0, magnitude: 0 })
  })
})

describe('joystickThumbPosition', () => {
  it('follows the finger inside the ring and stops on it outside', () => {
    expect(joystickThumbPosition({ dx: 10, dy: -5, radius: RADIUS })).toEqual({ x: 10, y: -5 })
    const clamped = joystickThumbPosition({ dx: 3 * RADIUS, dy: 4 * RADIUS, radius: RADIUS })
    expect(clamped.x).toBeCloseTo(0.6 * RADIUS, 6)
    expect(clamped.y).toBeCloseTo(0.8 * RADIUS, 6)
  })

  it('rests at the centre with no offset', () => {
    expect(joystickThumbPosition({ dx: 0, dy: 0, radius: RADIUS })).toEqual({ x: 0, y: 0 })
  })
})
