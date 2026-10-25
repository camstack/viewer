import { describe, expect, it } from 'vitest'
import {
  canStepCarousel,
  clampCarouselIndex,
  mountedCarouselIndices,
  stepCarouselIndex,
} from '../carousel-paging.js'

/**
 * The shared carousel paging (`carousel-paging.ts`, formerly the cluster
 * card's `cluster-carousel.ts`): arrows step through the cluster's
 * carousel pages one at a time, CLAMPED at both ends (never wrapping — the
 * operator reading "3/7" must trust that "next" always means later, not a
 * silent jump back to the start), and only the media ADJACENT to the current
 * page is mounted for preload (current ±1, never the whole cluster).
 */

describe('clampCarouselIndex', () => {
  it('keeps an in-range index unchanged', () => {
    expect(clampCarouselIndex(2, 5)).toBe(2)
  })

  it('clamps below zero to the first page', () => {
    expect(clampCarouselIndex(-3, 5)).toBe(0)
  })

  it('clamps past the end to the last page', () => {
    expect(clampCarouselIndex(9, 5)).toBe(4)
  })

  it('answers 0 for an empty carousel', () => {
    expect(clampCarouselIndex(3, 0)).toBe(0)
  })

  it('answers 0 for a negative count', () => {
    expect(clampCarouselIndex(1, -2)).toBe(0)
  })
})

describe('stepCarouselIndex — clamp, never wrap', () => {
  it('steps forward one page', () => {
    expect(stepCarouselIndex(1, 1, 5)).toBe(2)
  })

  it('steps backward one page', () => {
    expect(stepCarouselIndex(3, -1, 5)).toBe(2)
  })

  it('stays on the last page when stepping forward at the end', () => {
    expect(stepCarouselIndex(4, 1, 5)).toBe(4)
  })

  it('stays on the first page when stepping backward at the start', () => {
    expect(stepCarouselIndex(0, -1, 5)).toBe(0)
  })

  it('clamps a stale out-of-range index before stepping', () => {
    // The cluster refreshed and shrank under an open carousel: the stored
    // index may exceed the new count. The step must land in range, not at
    // stale+delta.
    expect(stepCarouselIndex(9, 1, 3)).toBe(2)
    expect(stepCarouselIndex(9, -1, 3)).toBe(1)
  })

  it('answers 0 for an empty carousel', () => {
    expect(stepCarouselIndex(0, 1, 0)).toBe(0)
  })
})

describe('canStepCarousel — which arrows render', () => {
  it('both arrows on a middle page', () => {
    expect(canStepCarousel(2, -1, 5)).toBe(true)
    expect(canStepCarousel(2, 1, 5)).toBe(true)
  })

  it('no back arrow on the first page', () => {
    expect(canStepCarousel(0, -1, 5)).toBe(false)
    expect(canStepCarousel(0, 1, 5)).toBe(true)
  })

  it('no forward arrow on the last page', () => {
    expect(canStepCarousel(4, 1, 5)).toBe(false)
    expect(canStepCarousel(4, -1, 5)).toBe(true)
  })

  it('no arrows on a single-page carousel', () => {
    expect(canStepCarousel(0, -1, 1)).toBe(false)
    expect(canStepCarousel(0, 1, 1)).toBe(false)
  })

  it('no arrows on an empty carousel', () => {
    expect(canStepCarousel(0, -1, 0)).toBe(false)
    expect(canStepCarousel(0, 1, 0)).toBe(false)
  })
})

describe('mountedCarouselIndices — adjacent-only preload', () => {
  it('mounts current ±1 on a middle page, current included, in order', () => {
    expect(mountedCarouselIndices(3, 7)).toEqual([2, 3, 4])
  })

  it('never mounts past the start', () => {
    expect(mountedCarouselIndices(0, 7)).toEqual([0, 1])
  })

  it('never mounts past the end', () => {
    expect(mountedCarouselIndices(6, 7)).toEqual([5, 6])
  })

  it('mounts exactly one page on a single-page carousel', () => {
    expect(mountedCarouselIndices(0, 1)).toEqual([0])
  })

  it('mounts nothing on an empty carousel', () => {
    expect(mountedCarouselIndices(0, 0)).toEqual([])
  })

  it('clamps a stale index so the window stays in range', () => {
    expect(mountedCarouselIndices(9, 3)).toEqual([1, 2])
  })

  it('NEVER mounts the whole cluster — the window is at most 3 wide', () => {
    for (let index = 0; index < 12; index += 1) {
      expect(mountedCarouselIndices(index, 12).length).toBeLessThanOrEqual(3)
    }
  })
})
