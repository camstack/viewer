import { describe, expect, it } from 'vitest'
import {
  ORBIT_CX,
  ORBIT_CY,
  ORBIT_RX,
  ORBIT_TILT,
  bladeSegment,
  glint,
  irisRing,
  orbitAngle,
  placeNode,
  pupilRadius,
  shutter,
  squash,
} from '../splash/splash-math.js'

describe('splash math', () => {
  it('puts the big node on the tilted orbit end at theta 0, in front', () => {
    const n = placeNode(0, 5)
    expect(n.cx).toBeCloseTo(ORBIT_CX + ORBIT_RX * Math.cos(ORBIT_TILT), 6)
    expect(n.cy).toBeCloseTo(ORBIT_CY + ORBIT_RX * Math.sin(ORBIT_TILT), 6)
    expect(n.r).toBeCloseTo(5, 6)
    expect(n.layer).toBe('front')
  })

  it('puts the node on the opposite end at theta pi', () => {
    const n = placeNode(Math.PI, 5)
    expect(n.cx).toBeCloseTo(ORBIT_CX - ORBIT_RX * Math.cos(ORBIT_TILT), 6)
    expect(n.cy).toBeCloseTo(ORBIT_CY - ORBIT_RX * Math.sin(ORBIT_TILT), 6)
  })

  it('switches layer by the sign of depth and scales with it', () => {
    expect(placeNode(Math.PI / 2, 5).layer).toBe('front')
    expect(placeNode(Math.PI / 2, 5).r).toBeCloseTo(5.6, 6)
    expect(placeNode(-Math.PI / 2, 5).layer).toBe('back')
    expect(placeNode(-Math.PI / 2, 5).r).toBeCloseTo(4.4, 6)
    expect(placeNode(1.5 * Math.PI, 5).opacity).toBeCloseTo(0.86, 6)
    expect(placeNode(0, 5).opacity).toBe(1)
    expect(placeNode(Math.PI / 2, 5).opacity).toBe(1)
  })

  it('starts and ends the pass at the rest angle', () => {
    expect(orbitAngle(0)).toBe(0)
    expect(orbitAngle(1)).toBeCloseTo(2 * Math.PI, 9)
  })

  it('is exactly unsquashed at rest and settles near 1 at the end', () => {
    expect(squash(0)).toEqual({ sx: 1, sy: 1 })
    expect(squash(1).sx).toBeCloseTo(1, 2)
    expect(squash(1).sy).toBeCloseTo(1, 2)
    expect(squash(0.3).sy).toBeCloseTo(1.05 - 0.0, 1)
  })

  it('keeps the pupil at its resting radius at rest', () => {
    expect(pupilRadius(1)).toBe(2.4)
    expect(pupilRadius(1.05)).toBeLessThanOrEqual(3.4)
  })

  it('has the shutter open at rest and fully closed at u 0.35', () => {
    expect(shutter(0)).toBe(0)
    expect(shutter(0.35)).toBe(1)
    expect(shutter(0.5)).toBe(0)
    expect(shutter(1)).toBe(0)
    expect(irisRing(0)).toEqual({ r: 5.6, strokeWidth: 0 })
    expect(irisRing(1).strokeWidth).toBeCloseTo(5.6, 9)
  })

  it('slides the blade inner end to the centre when closed', () => {
    const s = bladeSegment(0, 1)
    expect(s.x2).toBeCloseTo(32, 9)
    expect(s.y2).toBeCloseTo(42, 9)
  })

  it('has no glint outside its window', () => {
    expect(glint(0)).toBe(0)
    expect(glint(0.41)).toBe(0)
    expect(glint(0.7)).toBe(0)
    expect(glint(1)).toBe(0)
    expect(glint(0.476)).toBeCloseTo(1, 2)
  })
})
