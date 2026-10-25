/**
 * pill-fit — the label pill must HOLD its text, not clip it.
 *
 * The operator's criterion, in his words: two labels that differ have to stay
 * distinguishable at a glance. They differ at their TAIL, which is precisely
 * what a trailing ellipsis eats — the same defect the admin UI's device list
 * carries a guard against.
 *
 * What the pill carries is a TRANSLATED taxonomy label or a tier-2 identity. It
 * no longer carries a sensor's whole device name: that covered the thumbnail,
 * so the tile shows the sensor's type and the detail shows the name
 * (`resolveRowTitle`). The fit outlived that change because the translated
 * types are not short — `Monossido di carbonio` is 21 characters and a 106 px
 * tile holds about 13 per line at full size.
 */
import { describe, expect, it } from 'vitest'
import {
  fitPillText,
  PILL_FONT_MAX_PX,
  PILL_FONT_MIN_PX,
  PILL_MAX_LINES,
  pillHoldsWholeText,
} from '../pill-fit'

/** The medium tile (`cardEdgePx('medium')`) — the operator's own density. */
const TILE_PX = 106
/** The narrowest tile the density control can produce (`small`). */
const NARROW_TILE_PX = 80

/** The longest sensor TYPE the shipped taxonomy translates to (`eventKind.*`). */
const LONG_TYPE = 'Monossido di carbonio'
/** A second one, sharing nothing but its length class. */
const LONG_TYPE_B = 'Sensore movimento'
/** A tier-2 identity — a recognised face. Names are not short either. */
const IDENTITY = 'Maria Vittoria Rovere'

describe('the pill holds the whole label', () => {
  it('holds the longest translated sensor type', () => {
    expect(pillHoldsWholeText(LONG_TYPE, TILE_PX, fitPillText(LONG_TYPE, TILE_PX))).toBe(true)
  })

  it('the shipped rule — ONE line at full size — did NOT hold it', () => {
    // This is the defect, stated as a value: 21 characters in a 106 px tile on
    // one line is `Monossido di c…`.
    expect(
      pillHoldsWholeText(LONG_TYPE, TILE_PX, { fontSizePx: PILL_FONT_MAX_PX, maxLines: 1 }),
    ).toBe(false)
  })

  it('holds a recognised face’s full name too', () => {
    expect(pillHoldsWholeText(IDENTITY, TILE_PX, fitPillText(IDENTITY, TILE_PX))).toBe(true)
  })

  it('still holds them on the NARROWEST tile the density control offers', () => {
    for (const text of [LONG_TYPE, LONG_TYPE_B, IDENTITY]) {
      const fit = fitPillText(text, NARROW_TILE_PX)
      expect(pillHoldsWholeText(text, NARROW_TILE_PX, fit)).toBe(true)
      expect(fit.fontSizePx).toBeGreaterThanOrEqual(PILL_FONT_MIN_PX)
    }
  })
})

describe('the preference order', () => {
  it('changes NOTHING for a short title — one line, full size', () => {
    // `Anna`, `Auto`, `Contatto`, a plate. The majority of the feed, and it must
    // not start rendering smaller or taller to pay for the long case.
    for (const text of ['Anna', 'Auto', 'Contatto']) {
      expect(fitPillText(text, TILE_PX)).toEqual({ fontSizePx: PILL_FONT_MAX_PX, maxLines: 1 })
    }
  })

  it('spends LINES before it spends font size — at BOTH densities', () => {
    // Legibility before density: a label that needs two lines reads better big
    // on two than small on one, and the pill is inside the hero — extra lines
    // cost image, not card height, so the clock underneath cannot be pushed out
    // the way the reel's footer once was.
    for (const tile of [TILE_PX, NARROW_TILE_PX]) {
      for (const text of [LONG_TYPE, LONG_TYPE_B]) {
        const fit = fitPillText(text, tile)
        expect(fit.fontSizePx).toBe(PILL_FONT_MAX_PX)
        expect(fit.maxLines).toBeGreaterThan(1)
      }
    }
  })

  it('steps the font down only when the line cap at full size is not enough', () => {
    const fit = fitPillText('Maria Vittoria Della Rovere', NARROW_TILE_PX)
    expect(fit.maxLines).toBe(PILL_MAX_LINES)
    expect(fit.fontSizePx).toBeLessThan(PILL_FONT_MAX_PX)
  })

  it('never goes below the readable floor, however long the text', () => {
    const fit = fitPillText('x'.repeat(400), NARROW_TILE_PX)
    expect(fit.fontSizePx).toBe(PILL_FONT_MIN_PX)
    expect(fit.maxLines).toBe(PILL_MAX_LINES)
  })

  it('is total on a degenerate tile width', () => {
    // A tile reported as 0 px (a layout that has not measured yet) must still
    // yield a legal fit rather than a division by nothing.
    const fit = fitPillText(LONG_TYPE, 0)
    expect(fit.fontSizePx).toBeGreaterThanOrEqual(PILL_FONT_MIN_PX)
    expect(fit.maxLines).toBeLessThanOrEqual(PILL_MAX_LINES)
  })
})
