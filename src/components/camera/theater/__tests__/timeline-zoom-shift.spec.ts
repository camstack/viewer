import { describe, expect, it } from 'vitest'
import {
  shouldAnimateZoomShift,
  zoomShiftEase,
  zoomShiftScaleStart,
  ZOOM_SHIFT_MS,
} from '../timeline-zoom-shift.js'

describe('timeline-zoom-shift', () => {
  it('eases out — first third covers most of the distance', () => {
    expect(zoomShiftEase(0)).toBe(0)
    expect(zoomShiftEase(1)).toBe(1)
    expect(zoomShiftEase(1 / 3)).toBeGreaterThan(0.65)
  })

  it('zoom in starts below 1 (grow); zoom out starts above 1 (shrink)', () => {
    expect(zoomShiftScaleStart(100, 200)).toBeCloseTo(0.5)
    expect(zoomShiftScaleStart(200, 100)).toBeCloseTo(2)
  })

  it('clamps extreme ratios', () => {
    expect(zoomShiftScaleStart(1, 100)).toBe(0.25)
    expect(zoomShiftScaleStart(100, 1)).toBe(4)
  })

  it('skips a no-op or tiny change', () => {
    expect(shouldAnimateZoomShift(100, 100)).toBe(false)
    expect(shouldAnimateZoomShift(100, 102)).toBe(false)
    expect(shouldAnimateZoomShift(100, 200)).toBe(true)
  })

  it('exports a duration in the cursor-shift family', () => {
    expect(ZOOM_SHIFT_MS).toBeGreaterThanOrEqual(180)
    expect(ZOOM_SHIFT_MS).toBeLessThanOrEqual(300)
  })
})
