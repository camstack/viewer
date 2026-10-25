/**
 * The tablet-only guarantee, and the shelf's list.
 *
 * The request was explicit: "Solo tablet. Il comportamento su telefono non deve
 * cambiare in nessun modo." The threshold is not a new number — it is
 * `layoutMode === 'wide'`, the shape `sidebar-rules.ts` already answers and the
 * operator already tuned (2026-08-08). This file is the guard that keeps it
 * that way; the mount-level half is `camera-shelf-mount.spec.ts`.
 */
import { describe, it, expect } from 'vitest'
import {
  SHELF_CARD_WIDTH,
  fitShelfRow,
  shelfCameras,
  shouldShowCameraShelf,
} from '../camera-shelf.js'
import { computeWideDetailSizes } from '../wide-detail-sizes.js'
import { resolveDetailLayoutMode } from '../detail-layout.js'

describe('the shelf exists only where the space is reserved', () => {
  it('wide has it — that is the layout `STREAM_MAX_HEIGHT_FRACTION` leaves room in', () => {
    expect(shouldShowCameraShelf('wide')).toBe(true)
  })

  it('stack does not: there the timeline already owns that space', () => {
    expect(shouldShowCameraShelf('stack')).toBe(false)
  })

  it('fill does not: the picture owns the window', () => {
    expect(shouldShowCameraShelf('fill')).toBe(false)
  })
})

describe('a phone never sees the shelf, in any orientation', () => {
  const PHONES = [
    { name: 'iPhone portrait', width: 430, height: 932, screenMinSide: 430 },
    { name: 'iPhone landscape', width: 932, height: 430, screenMinSide: 430 },
    { name: 'iPad mini landscape (short side 744, still the phone path)', width: 1133, height: 744, screenMinSide: 744 },
    { name: 'phone-sized browser window', width: 420, height: 800, screenMinSide: undefined },
  ]

  for (const phone of PHONES) {
    it(`${phone.name}`, () => {
      const mode = resolveDetailLayoutMode({
        width: phone.width,
        height: phone.height,
        screenMinSide: phone.screenMinSide,
        isWeb: phone.screenMinSide === undefined,
        fullscreen: false,
      })
      expect(shouldShowCameraShelf(mode)).toBe(false)
    })
  }
})

describe('a tablet in landscape does', () => {
  it('iPad 11" landscape', () => {
    const mode = resolveDetailLayoutMode({
      width: 1194,
      height: 834,
      screenMinSide: 834,
      isWeb: false,
      fullscreen: false,
    })
    expect(shouldShowCameraShelf(mode)).toBe(true)
  })

  it('but not while it is in explicit fullscreen', () => {
    const mode = resolveDetailLayoutMode({
      width: 1194,
      height: 834,
      screenMinSide: 834,
      isWeb: false,
      fullscreen: true,
    })
    expect(shouldShowCameraShelf(mode)).toBe(false)
  })

  it('and not in portrait — D6(a), the first delivery', () => {
    const mode = resolveDetailLayoutMode({
      width: 834,
      height: 1194,
      screenMinSide: 834,
      isWeb: false,
      fullscreen: false,
    })
    expect(shouldShowCameraShelf(mode)).toBe(false)
  })
})

describe('the shelf lists the OTHER cameras', () => {
  const cameras = [{ id: 1 }, { id: 5 }, { id: 9 }]

  it('excludes the one whose player is on screen', () => {
    expect(shelfCameras(cameras, 5).map((c) => c.id)).toEqual([1, 9])
  })

  it('keeps the list order — the operator owns it (`camera-prefs-store`)', () => {
    expect(shelfCameras([{ id: 9 }, { id: 1 }], 5).map((c) => c.id)).toEqual([9, 1])
  })

  it('is empty on a one-camera install, and the surface then draws nothing', () => {
    expect(shelfCameras([{ id: 1 }], 1)).toEqual([])
  })
})

/**
 * The reel ends where the picture ends.
 *
 * The operator's report: "la reel non finisce dove finisce il player" — a strip
 * of dead space down the right. Two numbers were in play and neither knew about
 * the other: the picture is `computeWideDetailSizes().streamWidth`, and the
 * cards were a fixed 180pt wrapping inside whatever the COLUMN happened to be.
 * The fit below closes the row on the picture's own width, so the assertions
 * are stated as "the row ends within a gap of the picture's right edge".
 */
describe('the wrapping rows fill the picture width exactly', () => {
  const GAP = 4

  /** Right edge of the first row, in the shelf's own coordinates. */
  function rowRightEdge(contentWidth: number): number {
    const fit = fitShelfRow({ contentWidth, gap: GAP, minCardWidth: SHELF_CARD_WIDTH })
    return fit.perRow * fit.cardWidth + (fit.perRow - 1) * GAP
  }

  const TABLETS = [
    // iPad 11" landscape: 1194 window − 72 side nav = 1122 column, 340 rail.
    { name: 'iPad 11" landscape', containerWidth: 1122, viewportHeight: 834 },
    // iPad Pro 12.9" landscape: 1366 − 72 = 1294, 380 rail.
    { name: 'iPad Pro 12.9" landscape', containerWidth: 1294, viewportHeight: 1024 },
    // A wide web window, where the 62% height cap binds and the picture is
    // NARROWER than the column — the case the old stretched reel overhung.
    { name: '1440x900 web window', containerWidth: 1440, viewportHeight: 900 },
  ]

  for (const tablet of TABLETS) {
    it(`${tablet.name}: the last card lands on the picture's right edge`, () => {
      const { streamWidth } = computeWideDetailSizes(tablet)
      const edge = rowRightEdge(streamWidth)
      expect(edge).toBeLessThanOrEqual(streamWidth)
      // Within the rounding the floor leaves — at most one point per card.
      expect(streamWidth - edge).toBeLessThan(GAP + 1)
    })
  }

  it('a card is never drawn narrower than the width the shelf was tuned for', () => {
    for (const contentWidth of [200, 400, 782, 914, 1200]) {
      const fit = fitShelfRow({ contentWidth, gap: GAP, minCardWidth: SHELF_CARD_WIDTH })
      expect(fit.cardWidth).toBeGreaterThanOrEqual(SHELF_CARD_WIDTH)
    }
  })

  it('the row never OVERFLOWS — one point over is a card dropped to the next row', () => {
    for (let contentWidth = 180; contentWidth <= 1600; contentWidth += 7) {
      expect(rowRightEdge(contentWidth)).toBeLessThanOrEqual(contentWidth)
    }
  })

  it('a degenerate width yields the shipped card, not a nonsense one', () => {
    expect(fitShelfRow({ contentWidth: 0, gap: GAP, minCardWidth: SHELF_CARD_WIDTH })).toEqual({
      perRow: 1,
      cardWidth: SHELF_CARD_WIDTH,
    })
  })
})
