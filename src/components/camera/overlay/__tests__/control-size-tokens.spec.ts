/**
 * planning#751 — the overlay panel draws its controls at the `md` size and
 * reaches a 44 pt hit area through `hitSlop`, not through bigger drawing.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTROL, ICON, controlHitSlop } from '../../../../theme/tokens.js'

const src = (rel: string): string => readFileSync(join(__dirname, '../../../../', rel), 'utf8')

describe('CONTROL / ICON tokens', () => {
  it('md is the drawn size and lg the 44 pt hit area', () => {
    expect(CONTROL).toEqual({ sm: 28, md: 34, lg: 44 })
    expect(ICON.md).toBe(16)
  })

  it('controlHitSlop lifts a drawn size to the lg hit area, and never goes negative', () => {
    const slop = controlHitSlop(CONTROL.md)
    expect(CONTROL.md + slop.top + slop.bottom).toBeGreaterThanOrEqual(CONTROL.lg)
    expect(CONTROL.md + slop.left + slop.right).toBeGreaterThanOrEqual(CONTROL.lg)
    expect(controlHitSlop(60)).toEqual({ top: 0, bottom: 0, left: 0, right: 0 })
  })
})

describe('the overlay panel controls adopt the tokens', () => {
  it.each([
    'components/ui/ColorPickerRow.tsx',
    'components/ui/StepperRow.tsx',
    'components/camera/overlay/OverlayPositionPicker.tsx',
    'components/camera/theater/TimelineOverlayPanel.tsx',
  ])('%s lifts its hit area', (file) => {
    expect(src(file)).toContain('controlHitSlop(CONTROL.md)')
  })

  it('the panel switch row keeps a 44 pt row and the md icon', () => {
    const s = src('components/camera/ActivationRow.tsx')
    expect(s).toContain('minHeight: CONTROL.lg')
    expect(s).toContain('size={ICON.md}')
  })

  it('the colour swatches are no longer the old 28 pt', () => {
    expect(src('components/ui/ColorPickerRow.tsx')).not.toMatch(/width: 28/)
  })
})
