/**
 * The drive overlay's button cluster against the landscape drawer
 * (operator, 2026-09-06: with the drawer open the buttons sat under the
 * panel; they must fit the picture that is still visible, and never show
 * what the drawer already offers).
 */
import { describe, expect, it } from 'vitest'
import { driveOverlayLayout, DRIVE_DISC_MIN_SIZE } from '../drive-overlay-layout.js'
import { SPACING } from '../../../../theme/tokens.js'

const base = {
  windowWidth: 932,
  edgePad: { left: 59, right: 59 },
  discSize: 40,
  joystickSize: 120,
  buttonCount: 5,
}

describe('driveOverlayLayout', () => {
  it('drawer closed: the cluster sits inside the safe area at full size', () => {
    const l = driveOverlayLayout({ ...base, drawer: { open: false, width: 317 } })
    expect(l.right).toBe(59 + SPACING.md)
    expect(l.discSize).toBe(40)
    expect(l.gap).toBe(SPACING.md)
  })

  it('drawer open: the cluster moves off the panel, to the picture still visible', () => {
    const l = driveOverlayLayout({ ...base, buttonCount: 4, drawer: { open: true, width: 317 } })
    expect(l.right).toBe(317 + SPACING.md)
    expect(l.discSize).toBe(40)
  })

  it('a panel wider than the inset is what is covered; never less than the inset', () => {
    const l = driveOverlayLayout({ ...base, drawer: { open: true, width: 20 } })
    expect(l.right).toBe(59 + SPACING.md)
  })

  it('when the visible picture cannot hold joystick + cluster, the discs shrink rather than overlap', () => {
    const l = driveOverlayLayout({ ...base, windowWidth: 650, buttonCount: 4, drawer: { open: true, width: 287 } })
    const stickEnd = 59 + SPACING.md + 120 + SPACING.lg
    const free = 650 - l.right - stickEnd
    expect(l.discSize).toBeLessThan(40)
    expect(l.gap).toBe(SPACING.sm)
    expect(4 * l.discSize + 3 * l.gap).toBeLessThanOrEqual(free)
  })

  it('shrinks no further than the minimum a thumb can hit', () => {
    const l = driveOverlayLayout({ ...base, windowWidth: 420, buttonCount: 5, drawer: { open: true, width: 240 } })
    expect(l.discSize).toBe(DRIVE_DISC_MIN_SIZE)
  })

  it('no buttons: nothing to fit, full size reported', () => {
    const l = driveOverlayLayout({ ...base, buttonCount: 0, drawer: { open: true, width: 317 } })
    expect(l.discSize).toBe(40)
  })
})
