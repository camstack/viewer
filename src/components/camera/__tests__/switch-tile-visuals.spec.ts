/**
 * What a switch tile's COLOURS claim.
 *
 * The privacy mask on a camera with no zone drawn is a live, writable toggle —
 * it is the button that STARTS the feature. It used to be painted with
 * `foregroundSubtle`, two thirds of the way from a normal off tile to a
 * disabled one, and wearing the same alert badge an unavailable tile wears.
 * The operator read that as locked and reported it twice.
 *
 * So the rule is pinned on the ORDERING, not on a hex value: a control that
 * works is never dimmer than a plain off control.
 */
import { describe, expect, it } from 'vitest'
import { tileVisuals } from '../CameraSwitchGroup.js'
import { THEME } from '../../../theme/tokens.js'

const THEMES = [
  ['dark', THEME.dark],
  ['light', THEME.light],
] as const

describe('a warning never swallows the STATE', () => {
  for (const [name, colors] of THEMES) {
    it(`${name}: a warned control that is ON is drawn ON`, () => {
      // THE defect, and the one the other tests in this file did not catch
      // because they only ever asked about the OFF state. The `warned` branch
      // returned outright, above the `enabled` check — so the privacy mask on
      // a camera with no zone drawn, which ALWAYS carries the warning, could
      // never be drawn on. The hub recorded `enabled: true` (measured on 101:
      // true for 32 s) and the tile did not move. The operator pressed it,
      // saw nothing, and reported it three times as "I cannot activate it".
      const on = tileVisuals('toggle', true, colors, true)
      const plainOn = tileVisuals('toggle', true, colors, false)
      expect(on.circle.backgroundColor).toBe(plainOn.circle.backgroundColor)
      expect(on.iconColor).toBe(plainOn.iconColor)
      expect(on.labelColor).toBe(plainOn.labelColor)
      // …and it is still filled, which is what "on" MEANS on this grid.
      expect(on.circle.backgroundColor).toBe(colors.primary)
    })

    it(`${name}: the warning is the RING, and only the ring`, () => {
      const on = tileVisuals('toggle', true, colors, true)
      const off = tileVisuals('toggle', false, colors, true)
      expect(on.circle.borderColor).toBe(colors.warning)
      expect(off.circle.borderColor).toBe(colors.warning)
      // On and off still differ — the warning did not flatten them together.
      expect(on.circle.backgroundColor).not.toBe(off.circle.backgroundColor)
    })
  }
})

describe('a live control with a warning is not drawn as disabled', () => {
  for (const [name, colors] of THEMES) {
    it(`${name}: a warned tile is exactly as legible as a plain off tile`, () => {
      const off = tileVisuals('toggle', false, colors, false)
      const warned = tileVisuals('toggle', false, colors, true)
      expect(warned.iconColor).toBe(off.iconColor)
      expect(warned.labelColor).toBe(off.labelColor)
    })

    it(`${name}: and it never borrows the disabled colour`, () => {
      const warned = tileVisuals('toggle', false, colors, true)
      const unavailable = tileVisuals('unavailable', false, colors, true)
      expect(warned.iconColor).not.toBe(unavailable.iconColor)
      expect(warned.iconColor).not.toBe(colors.foregroundDisabled)
    })

    it(`${name}: the warning ring is the difference, and the ring is solid`, () => {
      const off = tileVisuals('toggle', false, colors, false)
      const warned = tileVisuals('toggle', false, colors, true)
      expect(warned.circle.borderColor).toBe(colors.warning)
      expect(warned.circle.borderColor).not.toBe(off.circle.borderColor)
      // Dashed is what "not offered here" looks like. A live control keeps a
      // solid ring or the shape alone says denied.
      expect(warned.circle.borderStyle).toBe('solid')
      expect(tileVisuals('unavailable', false, colors, true).circle.borderStyle).toBe('dashed')
    })
  }
})
