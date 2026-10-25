/**
 * The location bar is page CHROME — it is as tall as its chips.
 *
 * ## The report this closes (operator, 2026-09-16, with a screenshot)
 *
 * The chips rendered as pills roughly half the screen tall. Two causes, and
 * both had to be fixed:
 *
 * 1. A horizontal `ScrollView` is a flex item like any other. In a column
 *    parent with free space it grows to swallow it, so the bar became hundreds
 *    of points tall before a single chip was measured.
 * 2. A `contentContainerStyle` defaults to `alignItems: 'stretch'`. The chips
 *    carry no height of their own — they are sized by their padding and text —
 *    so each one stretched to whatever height the bar had.
 *
 * Structural, on the source, because the RN stub in this suite does not do
 * layout: nothing here can measure a pill. What it CAN do is stop either half
 * of the fix being tidied away, which is how it shipped.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SOURCE = readFileSync(
  fileURLToPath(new URL('../CameraLocationBar.tsx', import.meta.url)),
  'utf8',
)

describe('CameraLocationBar sizing', () => {
  it('the scroller does not grow into its parent’s free space', () => {
    expect(SOURCE).toContain('flexGrow: 0')
  })

  it('the content container centres, so a chip is as tall as its own text', () => {
    expect(SOURCE).toMatch(/row:\s*\{[^}]*alignItems:\s*'center'/s)
  })
})
