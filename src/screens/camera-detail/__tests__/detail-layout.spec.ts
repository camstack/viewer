/**
 * The camera-detail shape resolver.
 *
 * These specs pin the behaviour RESTORED on 2026-08-08 after operator feedback
 * on OTA 1.0.263: a phone in landscape (and an unfolded foldable) is `fill` —
 * full-bleed picture with the compact right-edge drawer — NOT the side-by-side
 * rail. Side-by-side is a wide web window or a real tablet in landscape, and
 * nothing else. The previous specs asserted the opposite; they are gone rather
 * than skipped, because a test that pins removed behaviour reads as a
 * requirement to put it back.
 *
 * The one piece of that work that was KEPT is the toolbar placement: only the
 * portrait stack hoists the toolbar above the stream.
 */
import { describe, it, expect } from 'vitest'
import { resolveDetailLayoutMode, toolbarPlacementFor, isFillMode } from '../detail-layout.js'

/** iPhone 15 Pro Max, rotated. The surface the operator reported on. */
const PHONE_LANDSCAPE = { width: 932, height: 430 }
const PHONE_PORTRAIT = { width: 430, height: 932 }
/** iPhone SE, rotated. */
const SMALL_PHONE_LANDSCAPE = { width: 667, height: 375 }
/** A Fold's inner panel, unfolded: wide and near-square, NOT landscape. */
const FOLDABLE_OPEN = { width: 906, height: 1088 }
/** The same device folded (cover display). */
const FOLDABLE_CLOSED = { width: 344, height: 882 }
const TABLET_PORTRAIT = { width: 834, height: 1194 }
const TABLET_LANDSCAPE = { width: 1194, height: 834 }

describe('resolveDetailLayoutMode', () => {
  it('phone LANDSCAPE fills the window — the drawer, not the side-by-side rail', () => {
    expect(resolveDetailLayoutMode({ ...PHONE_LANDSCAPE, isWeb: false, fullscreen: false })).toBe(
      'fill',
    )
  })

  it('a small phone in landscape fills too', () => {
    expect(
      resolveDetailLayoutMode({ ...SMALL_PHONE_LANDSCAPE, isWeb: false, fullscreen: false }),
    ).toBe('fill')
  })

  it('an UNFOLDED foldable keeps the portrait stack — it is not landscape', () => {
    expect(resolveDetailLayoutMode({ ...FOLDABLE_OPEN, isWeb: false, fullscreen: false })).toBe(
      'stack',
    )
  })

  it('the same foldable CLOSED keeps the portrait stack', () => {
    expect(resolveDetailLayoutMode({ ...FOLDABLE_CLOSED, isWeb: false, fullscreen: false })).toBe(
      'stack',
    )
  })

  it('portrait phone keeps the stack — the layout the operator is happy with', () => {
    expect(resolveDetailLayoutMode({ ...PHONE_PORTRAIT, isWeb: false, fullscreen: false })).toBe(
      'stack',
    )
  })

  it('tablet portrait is stack; tablet landscape is the ONE native wide surface', () => {
    expect(resolveDetailLayoutMode({ ...TABLET_PORTRAIT, isWeb: false, fullscreen: false })).toBe(
      'stack',
    )
    expect(resolveDetailLayoutMode({ ...TABLET_LANDSCAPE, isWeb: false, fullscreen: false })).toBe(
      'wide',
    )
  })

  it('explicit fullscreen wins over every shape, portrait included', () => {
    for (const size of [PHONE_PORTRAIT, PHONE_LANDSCAPE, TABLET_LANDSCAPE, FOLDABLE_OPEN]) {
      expect(resolveDetailLayoutMode({ ...size, isWeb: false, fullscreen: true })).toBe('fill')
    }
  })

  it('a wide web window is wide in either orientation (unchanged)', () => {
    expect(
      resolveDetailLayoutMode({ width: 1440, height: 900, isWeb: true, fullscreen: false }),
    ).toBe('wide')
    expect(
      resolveDetailLayoutMode({ width: 1000, height: 1400, isWeb: true, fullscreen: false }),
    ).toBe('wide')
  })
})

describe('toolbarPlacementFor', () => {
  it('ONLY the portrait stack hoists the toolbar above the stream', () => {
    expect(toolbarPlacementFor('stack')).toBe('top')
    expect(toolbarPlacementFor('wide')).toBe('inline')
    expect(toolbarPlacementFor('fill')).toBe('inline')
  })

  it('a landscape phone keeps its toolbar inline (it is in the drawer)', () => {
    const mode = resolveDetailLayoutMode({ ...PHONE_LANDSCAPE, isWeb: false, fullscreen: false })
    expect(toolbarPlacementFor(mode)).toBe('inline')
  })

  it('a portrait phone gets the toolbar at the top of the screen', () => {
    const mode = resolveDetailLayoutMode({ ...PHONE_PORTRAIT, isWeb: false, fullscreen: false })
    expect(toolbarPlacementFor(mode)).toBe('top')
  })
})

describe('isFillMode', () => {
  it('is true only for fill', () => {
    expect(isFillMode('fill')).toBe(true)
    expect(isFillMode('wide')).toBe(false)
    expect(isFillMode('stack')).toBe(false)
  })
})
