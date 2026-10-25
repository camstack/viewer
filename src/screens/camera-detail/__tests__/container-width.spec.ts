/**
 * The camera-detail column width, by value.
 *
 * The operator's report is "la timeline va sotto in landscape dopo un paio di
 * navigazioni". The SHAPE cannot explain it — `resolveDetailLayoutMode` is
 * pure, total, and pinned by `tablet-landscape-layout.spec.ts`; on a landscape
 * window it can only answer `wide` or `fill`. What CAN drift across
 * navigations is the measured width every `wide` size is derived from, because
 * this screen is never unmounted (`freezeOnBlur: false`), so a number latched
 * once outlives every later navigation and rotation.
 *
 * Three rules, each one a defect the previous `useState<number | null>` had.
 */
import { describe, it, expect } from 'vitest'
import {
  isUsableMeasurement,
  resolveContainerWidth,
  type ContainerWidthInput,
} from '../container-width.js'
import { computeWideDetailSizes,
  TIMELINE_RAIL_WIDTH_NARROW,
} from '../wide-detail-sizes.js'
import { SIDE_NAV_WIDTH } from '../../../navigation/side-nav-metrics.js'

/** iPad 11" in landscape, full screen, with the labelled rail on. */
const IPAD_W = 1194
const TABLET_NAV = { visible: true, insetLeft: 0 } as const

function width(input: Partial<ContainerWidthInput> = {}): number {
  return resolveContainerWidth({
    measured: null,
    windowWidth: IPAD_W,
    sideNav: TABLET_NAV,
    ...input,
  })
}

describe('the unmeasured answer already knows about the side nav', () => {
  it('subtracts the labelled rail from the window', () => {
    expect(width()).toBe(IPAD_W - SIDE_NAV_WIDTH)
  })

  it('subtracts the compact rail when that is the one on screen', () => {
    expect(width({ sideNav: { visible: true, insetLeft: 0 } })).toBe(
      IPAD_W - SIDE_NAV_WIDTH,
    )
  })

  it('subtracts the left safe area, which the rail adds to its own width', () => {
    expect(width({ sideNav: { visible: true, insetLeft: 59 } })).toBe(
      IPAD_W - SIDE_NAV_WIDTH - 59,
    )
  })

  it('is the whole window when the rail is not on screen (fill, phone portrait)', () => {
    expect(width({ sideNav: { visible: false, insetLeft: 0 } })).toBe(IPAD_W)
  })

  /**
   * The defect this rule retires, stated in the units the operator sees: the
   * old fallback handed `computeWideDetailSizes` the WINDOW, which on this
   * iPad is one point over `RAIL_NARROW_BELOW` — so the unmeasured frame drew
   * a 380pt rail and a 814pt picture into a column that is 1122pt wide with a
   * 340pt rail. The picture overlapped the rail until a layout pass landed,
   * and every navigation minted a fresh one.
   */
  it('resolves the SETTLED rail and picture on the very first frame', () => {
    const seeded = computeWideDetailSizes({ containerWidth: width(), viewportHeight: 834 })
    const settled = computeWideDetailSizes({
      containerWidth: IPAD_W - SIDE_NAV_WIDTH,
      viewportHeight: 834,
    })
    expect(seeded).toEqual(settled)
    expect(seeded.railWidth).toBe(TIMELINE_RAIL_WIDTH_NARROW)
    expect(seeded.streamWidth).toBeLessThanOrEqual(IPAD_W - SIDE_NAV_WIDTH - seeded.railWidth)
  })
})

describe('a degenerate layout pass is refused, not latched', () => {
  it('rejects zero, negative and non-finite widths', () => {
    expect(isUsableMeasurement(0)).toBe(false)
    expect(isUsableMeasurement(-1)).toBe(false)
    expect(isUsableMeasurement(Number.NaN)).toBe(false)
    expect(isUsableMeasurement(1122)).toBe(true)
  })

  /**
   * `?? winWidth` only ever rescued `null`. A single `onLayout` reporting 0 —
   * what a route detached behind a pushed screen produces — therefore stuck
   * for the life of the screen, and `columnWidth = max(0, 0 - 340) = 0` sized
   * the picture to nothing. `GridViewScreen` has guarded `width > 0` since it
   * was written; this screen never did.
   */
  it('a zero measurement does not become the column width', () => {
    expect(width({ measured: { width: 0, windowWidth: IPAD_W } })).toBe(IPAD_W - SIDE_NAV_WIDTH)
  })
})

describe('a measurement expires with the window it was taken in', () => {
  it('is used while the window width holds', () => {
    expect(width({ measured: { width: 1122, windowWidth: IPAD_W } })).toBe(1122)
  })

  /** A rotation is the case that matters: nothing re-seeded the latch, so the
   *  portrait column width governed the landscape layout until another pass
   *  happened to land — and on a screen that is never unmounted, "happened to"
   *  is the whole bug. */
  it('is refused after a rotation, in favour of the derived width', () => {
    expect(
      resolveContainerWidth({
        measured: { width: 762, windowWidth: 834 },
        windowWidth: IPAD_W,
        sideNav: TABLET_NAV,
      }),
    ).toBe(IPAD_W - SIDE_NAV_WIDTH)
  })

  it('a measurement from a WIDER window does not survive into a narrower one', () => {
    expect(
      resolveContainerWidth({
        measured: { width: 1122, windowWidth: IPAD_W },
        windowWidth: 834,
        sideNav: TABLET_NAV,
      }),
    ).toBe(834 - SIDE_NAV_WIDTH)
  })
})

describe('degenerate windows never produce a negative column', () => {
  it('a window narrower than the rail still resolves to something layoutable', () => {
    expect(width({ windowWidth: 40 })).toBe(40)
    expect(width({ windowWidth: 0 })).toBe(0)
  })
})
