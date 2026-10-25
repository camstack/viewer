import { describe, expect, it } from 'vitest'
import {
  PULL_THRESHOLD_PX,
  internalPullGestureEnabled,
  pullDistance,
  shouldTriggerRefresh,
} from '../use-pull-to-refresh'

describe('pullDistance', () => {
  it('ignores an upward drag — that is a scroll', () => {
    expect(pullDistance(-40)).toBe(0)
    expect(pullDistance(0)).toBe(0)
  })

  it('damps the finger distance so the list is not stuck to the thumb', () => {
    expect(pullDistance(40)).toBe(20)
    expect(pullDistance(100)).toBe(50)
  })

  it('caps, so a long drag cannot push the grid off screen', () => {
    expect(pullDistance(10_000)).toBe(88)
  })
})

describe('shouldTriggerRefresh', () => {
  it('fires at or past the threshold', () => {
    expect(shouldTriggerRefresh(PULL_THRESHOLD_PX)).toBe(true)
    expect(shouldTriggerRefresh(PULL_THRESHOLD_PX + 10)).toBe(true)
  })

  it('does NOT fire on a short pull — the indicator is not complete yet', () => {
    expect(shouldTriggerRefresh(PULL_THRESHOLD_PX - 1)).toBe(false)
    expect(shouldTriggerRefresh(0)).toBe(false)
  })

  it('the threshold is reachable — a finger can actually get there', () => {
    // 56px after 0.5 damping = 112px of travel, well within a phone screen.
    expect(pullDistance(PULL_THRESHOLD_PX * 2)).toBe(PULL_THRESHOLD_PX)
  })
})

describe('internalPullGestureEnabled', () => {
  it('runs in the gallery when nobody else owns the gesture', () => {
    expect(internalPullGestureEnabled('gallery', false, false)).toBe(true)
  })

  it('never runs in the reel — a vertical pull there is not deliberate', () => {
    expect(internalPullGestureEnabled('reel', false, false)).toBe(false)
  })

  it('never runs over semantic results — they are complete, not a feed', () => {
    expect(internalPullGestureEnabled('gallery', true, false)).toBe(false)
  })

  // Two overlapping pull gestures is worse than either alone.
  it('yields ENTIRELY to a native host that took the gesture', () => {
    expect(internalPullGestureEnabled('gallery', false, true)).toBe(false)
  })
})
