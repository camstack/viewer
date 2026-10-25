/**
 * The keyboard arithmetic every input surface shares (`keyboard-inset.ts`).
 *
 * The whole mechanism rests on one claim: the lift is the overlap of the
 * keyboard with THIS view, measured in window coordinates — so a window the
 * system resized for the keyboard is not padded a second time, and a window
 * it draws over (iOS, Android edge-to-edge, every Modal) is padded by exactly
 * what is covered.
 */
import { describe, expect, it } from 'vitest'

import {
  REVEAL_MARGIN,
  basePaddingBottom,
  basePaddingTop,
  keyboardEventNames,
  keyboardOverlap,
  keyboardPaddingStyle,
  keyboardTopFromFrame,
  revealDelta,
} from '../keyboard-inset.js'

describe('keyboardEventNames', () => {
  it('listens to the announcing events on iOS and the after-the-fact ones on Android', () => {
    expect(keyboardEventNames('ios')).toEqual({ change: 'keyboardWillChangeFrame', hide: 'keyboardWillHide' })
    expect(keyboardEventNames('android')).toEqual({ change: 'keyboardDidShow', hide: 'keyboardDidHide' })
  })

  it('subscribes to nothing on the web, which has no software-keyboard events', () => {
    expect(keyboardEventNames('web')).toBeNull()
    expect(keyboardEventNames('windows')).toBeNull()
  })
})

describe('keyboardTopFromFrame', () => {
  it('is the keyboard top edge while one is docked', () => {
    expect(keyboardTopFromFrame({ screenY: 508, height: 336 }, 844)).toBe(508)
  })

  it('is null for a zero-height (floating / undocked) keyboard and for one parked off-screen', () => {
    expect(keyboardTopFromFrame({ screenY: 400, height: 0 }, 844)).toBeNull()
    expect(keyboardTopFromFrame({ screenY: 844, height: 336 }, 844)).toBeNull()
  })
})

describe('keyboardOverlap', () => {
  it('a full-window view under a drawn-over keyboard is covered by the keyboard height', () => {
    expect(keyboardOverlap(844, 508)).toBe(336)
  })

  it('a window the system already resized ends at the keyboard: nothing is padded twice', () => {
    expect(keyboardOverlap(508, 508)).toBe(0)
    expect(keyboardOverlap(480, 508)).toBe(0)
  })

  it('a view that ends partway into the keyboard is padded by the part covered', () => {
    expect(keyboardOverlap(600, 508)).toBe(92)
  })

  it('no keyboard, or a view not measured yet, is 0 — never a guess', () => {
    expect(keyboardOverlap(844, null)).toBe(0)
    expect(keyboardOverlap(null, 508)).toBe(0)
  })
})

describe('revealDelta', () => {
  const strip = { visibleTop: 100, visibleBottom: 500 }

  it('leaves a field that already shows alone', () => {
    expect(revealDelta({ ...strip, fieldTop: 200, fieldBottom: 240 })).toBe(0)
  })

  it('scrolls a field under the keyboard up to sit one margin above it', () => {
    expect(revealDelta({ ...strip, fieldTop: 600, fieldBottom: 640 })).toBe(640 - (500 - REVEAL_MARGIN))
  })

  it('scrolls a field above the visible strip back down', () => {
    expect(revealDelta({ ...strip, fieldTop: 40, fieldBottom: 80 })).toBe(40 - (100 + REVEAL_MARGIN))
  })

  it('aligns a field taller than the strip by its top, never pushing the top out', () => {
    expect(revealDelta({ ...strip, fieldTop: 300, fieldBottom: 900 })).toBe(300 - (100 + REVEAL_MARGIN))
  })

  it('does nothing when the keyboard leaves no strip at all', () => {
    expect(revealDelta({ visibleTop: 500, visibleBottom: 510, fieldTop: 600, fieldBottom: 640 })).toBe(0)
  })
})

describe('keyboardPaddingStyle', () => {
  it('adds nothing while the keyboard is down — a closed keyboard leaves every layout as it was', () => {
    expect(keyboardPaddingStyle({ paddingBottom: 12 }, 0, 47)).toBeNull()
  })

  it('adds the overlap to the padding the style already has', () => {
    expect(keyboardPaddingStyle({ paddingBottom: 12 }, 300)).toEqual({ paddingBottom: 312 })
    expect(keyboardPaddingStyle([{ padding: 8 }, { paddingVertical: 10 }], 300)).toEqual({ paddingBottom: 310 })
    expect(keyboardPaddingStyle(undefined, 300)).toEqual({ paddingBottom: 300 })
  })

  it('keeps a lifted card below the status bar when given the safe top', () => {
    expect(keyboardPaddingStyle({ padding: 16 }, 300, 47)).toEqual({ paddingBottom: 316, paddingTop: 63 })
  })

  it('reads the most specific numeric padding and ignores a percentage', () => {
    expect(basePaddingBottom([{ padding: 4, paddingVertical: 6, paddingBottom: 9 }])).toBe(9)
    expect(basePaddingTop({ paddingVertical: 6 })).toBe(6)
    expect(basePaddingBottom({ paddingBottom: '10%' })).toBe(0)
  })
})
