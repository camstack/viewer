import { describe, expect, it } from 'vitest'
import { reelPreloadWindow } from '../events-reel-window'

describe('reelPreloadWindow', () => {
  const items = Array.from({ length: 40 }, (_, index) => index)

  it('returns only the visible interval plus one interval ahead', () => {
    expect(
      reelPreloadWindow(items, {
        scrollLeft: 0,
        viewportWidth: 300,
        cardWidth: 92,
        gap: 8,
        rowsPerColumn: 1,
      }),
    ).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('accounts for multi-row columns and follows the current scroll position', () => {
    expect(
      reelPreloadWindow(items, {
        scrollLeft: 300,
        viewportWidth: 200,
        cardWidth: 92,
        gap: 8,
        rowsPerColumn: 2,
      }),
    ).toEqual(items.slice(6, 14))
  })

  it('keeps an unmeasured reel bounded to the first column', () => {
    expect(
      reelPreloadWindow(items, {
        scrollLeft: 0,
        viewportWidth: 0,
        cardWidth: 92,
        gap: 8,
        rowsPerColumn: 2,
      }),
    ).toEqual([0, 1, 2, 3])
  })
})
