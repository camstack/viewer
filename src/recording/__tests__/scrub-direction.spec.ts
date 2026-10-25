import { describe, it, expect } from 'vitest'
import {
  resolveScrubDirection,
  SCRUB_DIRECTION_DEADZONE_MS,
} from '../scrub-direction.js'

describe('resolveScrubDirection', () => {
  it('has no direction before there is a previous target to measure against', () => {
    expect(resolveScrubDirection(null, 1_000, null)).toBeNull()
  })

  it('keeps whatever direction was already held when there is no reference', () => {
    expect(resolveScrubDirection(null, 1_000, 'forward')).toBe('forward')
  })

  it('reads a later target as forward and an earlier one as backward', () => {
    const step = SCRUB_DIRECTION_DEADZONE_MS + 1
    expect(resolveScrubDirection(10_000, 10_000 + step, null)).toBe('forward')
    expect(resolveScrubDirection(10_000, 10_000 - step, null)).toBe('backward')
  })

  it('flips when the drag reverses', () => {
    const step = SCRUB_DIRECTION_DEADZONE_MS + 1
    expect(resolveScrubDirection(10_000, 10_000 - step, 'forward')).toBe('backward')
    expect(resolveScrubDirection(10_000, 10_000 + step, 'backward')).toBe('forward')
  })

  it('ignores jitter inside the dead zone and HOLDS the current direction', () => {
    // A finger resting on the timeline emits scroll frames a few ms apart. A
    // direction recomputed from those flickers the icon between ⏩ and ⏪ at
    // frame rate, which is worse than showing nothing.
    expect(resolveScrubDirection(10_000, 10_000 + 1, 'forward')).toBe('forward')
    expect(resolveScrubDirection(10_000, 10_000 - 1, 'forward')).toBe('forward')
    expect(resolveScrubDirection(10_000, 10_000, 'backward')).toBe('backward')
    expect(resolveScrubDirection(10_000, 10_000 + 1, null)).toBeNull()
  })

  it('treats exactly the dead zone as still jitter', () => {
    expect(resolveScrubDirection(0, SCRUB_DIRECTION_DEADZONE_MS, null)).toBeNull()
    expect(resolveScrubDirection(0, SCRUB_DIRECTION_DEADZONE_MS + 1, null)).toBe('forward')
  })
})
