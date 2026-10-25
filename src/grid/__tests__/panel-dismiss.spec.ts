/**
 * The grid page's ONE dismiss decision.
 *
 * Two claims, and both were wrong in the hand before this module existed:
 *  • what a tap on the wall closes is the union of everything open, not
 *    whatever the last panel to ship happened to wire its own backdrop for;
 *  • the body layer exists ONLY while something is open, because a layer that
 *    outlives the panel eats the tile press behind it.
 */
import { describe, expect, it } from 'vitest'
import {
  DISMISS_TAP_MAX_MOVE_PT,
  DISMISS_TAP_MAX_MS,
  NO_GRID_PANELS,
  gridDismissTargets,
  isDismissTap,
  shouldInterceptGridTap,
  type GridPanelsOpen,
} from '../panel-dismiss.js'

const open = (p: Partial<GridPanelsOpen>): GridPanelsOpen => ({ ...NO_GRID_PANELS, ...p })

describe('what a tap on the grid body dismisses', () => {
  it('nothing open ⇒ no targets, and NO layer over the wall', () => {
    expect(gridDismissTargets(NO_GRID_PANELS)).toEqual([])
    expect(shouldInterceptGridTap(NO_GRID_PANELS)).toBe(false)
  })

  it('the control bar popover counts — the one that used to have no backdrop', () => {
    expect(gridDismissTargets(open({ barPanel: 'quality' }))).toEqual(['barPanel'])
    expect(shouldInterceptGridTap(open({ barPanel: 'quality' }))).toBe(true)
  })

  it('every panel counts, and the layer is mounted for each of them alone', () => {
    for (const only of [
      open({ barPanel: 'audio' }),
      open({ cellPanel: true }),
      open({ share: true }),
    ]) {
      expect(gridDismissTargets(only)).toHaveLength(1)
      expect(shouldInterceptGridTap(only)).toBe(true)
    }
  })

  it('two open at once dismiss together, outermost last', () => {
    expect(gridDismissTargets(open({ barPanel: 'layout', share: true }))).toEqual([
      'barPanel',
      'share',
    ])
  })
})

describe('a tap, and the gestures that are not one', () => {
  const at = (x: number, y: number, t: number) => ({ x, y, t })

  it('press and release in the same place is a tap', () => {
    expect(isDismissTap(at(100, 200, 0), at(100, 200, 80))).toBe(true)
  })

  it('a small wobble is still a tap', () => {
    expect(isDismissTap(at(100, 200, 0), at(103, 204, 90))).toBe(true)
  })

  it('a drag past the slop is NOT a tap — a scrub must not close a menu', () => {
    const far = DISMISS_TAP_MAX_MOVE_PT + 5
    expect(isDismissTap(at(100, 200, 0), at(100 + far, 200, 90))).toBe(false)
    expect(isDismissTap(at(100, 200, 0), at(100, 200 + far, 90))).toBe(false)
  })

  it('a long press is NOT a tap — it is its own gesture', () => {
    expect(isDismissTap(at(100, 200, 0), at(100, 200, DISMISS_TAP_MAX_MS + 1))).toBe(false)
  })

  it('an unmeasurable press still dismisses — the panel is open either way', () => {
    expect(isDismissTap(at(NaN, NaN, NaN), at(NaN, NaN, NaN))).toBe(true)
  })
})
