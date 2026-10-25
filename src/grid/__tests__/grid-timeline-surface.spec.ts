/**
 * The two decisions the deleted grid band's gate made that are still the grid
 * page's to make: does this surface get a timeline at all, and what box is left
 * for the wall once it does.
 *
 * `grid-timeline-scope.spec.ts` proves what a rendered page does with them.
 * This proves the rules themselves, which a mount test cannot: a viewport a
 * mount test would need a device for is one line here.
 */
import { describe, it, expect } from 'vitest'

import {
  GRID_WALL_STACK_FRACTION,
  gridWallSlotStyle,
  gridWallStackHeight,
  shouldMountGridTimeline,
} from '../grid-timeline-surface.js'

const NATIVE = { isWeb: false } as const
const WEB = { isWeb: true } as const

describe('shouldMountGridTimeline — a phone never gets one', () => {
  it('excludes a phone in portrait AND in landscape', () => {
    // Both, on purpose: keying off width alone reads a 932×430 phone as a
    // tablet, which is the defect the sidebar rules already paid for once.
    expect(shouldMountGridTimeline({ width: 430, height: 932, ...NATIVE })).toBe(false)
    expect(shouldMountGridTimeline({ width: 932, height: 430, ...NATIVE })).toBe(false)
  })

  it('includes a tablet in both orientations', () => {
    expect(shouldMountGridTimeline({ width: 834, height: 1194, ...NATIVE })).toBe(true)
    expect(shouldMountGridTimeline({ width: 1194, height: 834, ...NATIVE })).toBe(true)
  })

  it('asks the DEVICE screen on native, so a split view keeps its timeline', () => {
    // An iPad in a narrow Split View has a phone-shaped window and is still an
    // iPad. `screenMinSide` is what says so, and it is the same input every
    // other layout rule in the app reads.
    expect(
      shouldMountGridTimeline({ width: 400, height: 1000, screenMinSide: 834, ...NATIVE }),
    ).toBe(true)
  })

  it('on web the WINDOW is the device — a narrow window gets no timeline', () => {
    expect(shouldMountGridTimeline({ width: 400, height: 1000, ...WEB })).toBe(false)
    expect(shouldMountGridTimeline({ width: 1400, height: 900, ...WEB })).toBe(true)
  })
})

describe('gridWallSlotStyle — the wall always has a box', () => {
  it('never returns a style with neither a height nor a flex', () => {
    // The defect this exists to prevent, verbatim from `stream-slot.ts`: a
    // styleless View has no height, so a wall dropped into the slot measures
    // zero on one axis and draws nothing.
    for (const shape of ['wide', 'stack', 'fill'] as const) {
      const style = gridWallSlotStyle(shape, 500)
      const sized = style.flex !== undefined || style.height !== undefined
      expect(sized, shape).toBe(true)
    }
  })

  it('stack takes the measured height; wide and fill take the space', () => {
    expect(gridWallSlotStyle('stack', 500).height).toBe(500)
    expect(gridWallSlotStyle('wide', 500).flex).toBe(1)
    expect(gridWallSlotStyle('fill', 500).flex).toBe(1)
  })

  it('every shape stretches to the full width', () => {
    // `wide`'s slot carries `alignItems: 'center'` — it was written for a
    // fixed-width picture — so a wall that did not claim the width would be
    // centred at its content size.
    for (const shape of ['wide', 'stack', 'fill'] as const) {
      expect(gridWallSlotStyle(shape, 500).width, shape).toBe('100%')
    }
  })
})

describe('gridWallSlotStyle — the timeline toggle OFF', () => {
  it('the wall takes the whole surface in every shape', () => {
    for (const shape of ['wide', 'stack', 'fill'] as const) {
      const style = gridWallSlotStyle(shape, 500, true)
      expect(style.flex, shape).toBe(1)
      expect(style.width, shape).toBe('100%')
    }
  })

  it('`stack` loses its FRACTION — the box the operator would otherwise see half of', () => {
    // The one shape that gets this wrong silently: its box is a fixed fraction
    // of the window, so a wall that kept it would draw at 62% height with the
    // other 38% blank where the chrome used to be.
    expect(gridWallSlotStyle('stack', 500, false).height).toBe(500)
    expect(gridWallSlotStyle('stack', 500, true).height).toBeUndefined()
  })

  it('shown is the default — the argument cannot change what shipped', () => {
    for (const shape of ['wide', 'stack', 'fill'] as const) {
      expect(gridWallSlotStyle(shape, 500, false), shape).toEqual(gridWallSlotStyle(shape, 500))
    }
  })
})

describe('gridWallStackHeight', () => {
  it('is the theater picture fraction of the space, not a fresh guess', () => {
    expect(gridWallStackHeight(1000)).toBe(Math.round(1000 * GRID_WALL_STACK_FRACTION))
  })

  it('a degenerate measurement is zero, never NaN or a negative box', () => {
    expect(gridWallStackHeight(0)).toBe(0)
    expect(gridWallStackHeight(-10)).toBe(0)
    expect(gridWallStackHeight(Number.NaN)).toBe(0)
  })
})
