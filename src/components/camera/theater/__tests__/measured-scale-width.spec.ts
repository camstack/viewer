/**
 * The bar is sized by what the container HAS, not by what the window has.
 *
 * Reported from a Mac window: the playback bar's controls ran off the edge —
 * LIVE, the restore button and the big transport pushed the rate control out.
 * `playback-bar-fit.ts` already drops jog, step and rate as room runs out, so
 * the ladder was not the problem; it was being handed the whole WINDOW width
 * by the theater's `stack` mount while the bar lived in a much narrower panel.
 */
import { describe, expect, it } from 'vitest'

import {
  SCALE_WIDTH_EPSILON,
  scaleWidthToUse,
  shouldAcceptScaleWidth,
} from '../measured-scale-width.js'

describe('shouldAcceptScaleWidth', () => {
  it('takes the first measurement', () => {
    expect(shouldAcceptScaleWidth(null, 380)).toBe(true)
  })

  it('takes one that moved by a point or more', () => {
    expect(shouldAcceptScaleWidth(380, 380 + SCALE_WIDTH_EPSILON)).toBe(true)
    expect(shouldAcceptScaleWidth(380, 300)).toBe(true)
  })

  it('IGNORES sub-point jitter', () => {
    // Feeding every fractional wobble back sets state inside layout and
    // re-enters it — the loop that starved the JS thread on 3629.
    expect(shouldAcceptScaleWidth(380, 380.4)).toBe(false)
    expect(shouldAcceptScaleWidth(380, 379.7)).toBe(false)
    expect(shouldAcceptScaleWidth(380, 380)).toBe(false)
  })

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses %s — a layout pass that has not happened is not a width',
    (bad) => {
      expect(shouldAcceptScaleWidth(380, bad)).toBe(false)
      expect(shouldAcceptScaleWidth(null, bad)).toBe(false)
    },
  )
})

describe('scaleWidthToUse', () => {
  it('uses the measurement once there is one', () => {
    expect(scaleWidthToUse(380, 1440)).toBe(380)
  })

  it('uses the caller\'s estimate until then', () => {
    // Never the narrowest tier on a first paint: the bar would render its
    // floor and then visibly grow, which reads as a glitch rather than a
    // measurement.
    expect(scaleWidthToUse(null, 1440)).toBe(1440)
  })

  it('treats a stored zero as no measurement', () => {
    expect(scaleWidthToUse(0, 1440)).toBe(1440)
  })
})
