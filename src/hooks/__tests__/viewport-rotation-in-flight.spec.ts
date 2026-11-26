/**
 * planning#748 — a rotation in flight must not be decided on.
 *
 * iPhone 1.0.739, session ch62rsf4jrrsti01xl:
 *  - landscape: `winWidth 932` (frame) next to `dimWidth 430 / dimHeight 932`,
 *    and `measuredInWindowWidth` always the PREVIOUS orientation's axis;
 *  - back to portrait: the wrapper went 430x430 (the old landscape HEIGHT under
 *    the new width), then 430x242.
 */
import { describe, expect, it } from 'vitest'

import { resolveViewportSize } from '../viewport-size.js'
import { acceptsMeasurement, stampRootLayout } from '../../screens/camera-detail/container-width.js'

const PORTRAIT = { width: 430, height: 932 }
const LANDSCAPE = { width: 932, height: 430 }

describe('resolveViewportSize across a rotation', () => {
  it('a frame that is half-way (430x430) is not the viewport; the complete window wins', () => {
    const v = resolveViewportSize({
      isWeb: false,
      window: PORTRAIT,
      frame: { width: 430, height: 430 },
      settled: LANDSCAPE,
    })
    expect({ width: v.width, height: v.height }).toEqual(PORTRAIT)
  })

  it('with nothing complete yet, the settled viewport is held', () => {
    const v = resolveViewportSize({
      isWeb: false,
      window: { width: 430, height: 430 },
      frame: { width: 932, height: 932 },
      settled: LANDSCAPE,
    })
    expect(v).toMatchObject({ ...LANDSCAPE, source: 'held' })
  })

  it('a stale window next to a complete frame still follows the frame', () => {
    const v = resolveViewportSize({ isWeb: false, window: PORTRAIT, frame: LANDSCAPE, settled: PORTRAIT })
    expect(v).toMatchObject({ ...LANDSCAPE, source: 'frame' })
  })
})

describe('a layout pass that beats the viewport to a rotation', () => {
  it('is adopted once the viewport catches up, not refused for good', () => {
    // Root laid out landscape (932 wide) while the screen still held portrait.
    const pass = { width: 932, height: 430, windowWidth: 430, windowHeight: 932 }
    const early = stampRootLayout(pass, PORTRAIT)
    expect(acceptsMeasurement(early, PORTRAIT.width)).toBe(false)
    const caughtUp = stampRootLayout(pass, LANDSCAPE)
    expect(acceptsMeasurement(caughtUp, LANDSCAPE.width)).toBe(true)
    expect(caughtUp?.width).toBe(932)
  })

  it('a pass taken in a settled same-shape window keeps its own window stamp', () => {
    const pass = { width: 430, height: 800, windowWidth: 430, windowHeight: 932 }
    expect(stampRootLayout(pass, { width: 500, height: 932 })).toEqual({ width: 430, windowWidth: 430 })
  })
})
