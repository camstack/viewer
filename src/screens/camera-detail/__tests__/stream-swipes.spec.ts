/**
 * Two downward flings on the same picture, told apart by how many fingers.
 *
 * The operator's rule (2026-09-13): ONE finger leaves the screen, TWO fingers
 * open the on-demand overlay and leave. The one-finger PiP that used to live
 * here is GONE — PiP is now an automatism on app close, not something a finger
 * asks for, and this file is the record that the gesture did not survive.
 */
import { describe, expect, it } from 'vitest'
import {
  BACK_SWIPE_POINTERS,
  OVERLAY_SWIPE_POINTERS,
  shouldGoBackOnSwipe,
  shouldOpenOverlayOnSwipe,
  SWIPE_DISTANCE,
  SWIPE_VELOCITY,
  ZOOM_IDLE_SCALE,
} from '../stream-swipes.js'

const FAR = SWIPE_DISTANCE + 10
const FAST = SWIPE_VELOCITY + 10

describe('the two downward flings', () => {
  it('needs one finger to go back and two for the overlay', () => {
    // The counts must DIFFER, or one gesture swallows the other and the
    // operator gets whichever the composer resolved first.
    expect(BACK_SWIPE_POINTERS).toBe(1)
    expect(OVERLAY_SWIPE_POINTERS).toBe(2)
    expect(BACK_SWIPE_POINTERS).not.toBe(OVERLAY_SWIPE_POINTERS)
  })

  it('fires on a fling that travels far and fast enough', () => {
    const fling = { translationY: FAR, velocityY: FAST, zoomScale: 1 }
    expect(shouldGoBackOnSwipe(fling)).toBe(true)
    expect(shouldOpenOverlayOnSwipe(fling)).toBe(true)
  })

  it('ignores a slow drag', () => {
    // A slow drag down is how an operator scrolls the page under the picture.
    const drag = { translationY: FAR, velocityY: 10, zoomScale: 1 }
    expect(shouldGoBackOnSwipe(drag)).toBe(false)
    expect(shouldOpenOverlayOnSwipe(drag)).toBe(false)
  })

  it('ignores an upward fling', () => {
    const up = { translationY: -FAR, velocityY: -FAST, zoomScale: 1 }
    expect(shouldGoBackOnSwipe(up)).toBe(false)
    expect(shouldOpenOverlayOnSwipe(up)).toBe(false)
  })

  it('stands down while the picture is zoomed', () => {
    // Zoomed, that pan belongs to the frame.
    const zoomed = { translationY: FAR, velocityY: FAST, zoomScale: ZOOM_IDLE_SCALE + 0.1 }
    expect(shouldGoBackOnSwipe(zoomed)).toBe(false)
    expect(shouldOpenOverlayOnSwipe(zoomed)).toBe(false)
  })

  it('uses the SAME travel and velocity for both', () => {
    // One muscle memory, two outcomes. Different thresholds would make the
    // finger count feel like a coincidence rather than the rule.
    const marginal = { translationY: SWIPE_DISTANCE - 1, velocityY: FAST, zoomScale: 1 }
    expect(shouldGoBackOnSwipe(marginal)).toBe(false)
    expect(shouldOpenOverlayOnSwipe(marginal)).toBe(false)
  })
})
