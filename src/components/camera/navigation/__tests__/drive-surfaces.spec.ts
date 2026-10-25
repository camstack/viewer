/**
 * The robot's two drive surfaces are ONE joystick (operator, 2026-09-06:
 * joystick + four buttons in landscape overlay; the portrait panel gets the
 * same stick in place of its four hold buttons).
 *
 * Source assertions, in the style of `timebar-controls-removed.spec.ts`: a
 * control nobody renders is invisible to a mount test, and the claims here
 * are about which component is wired where.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const read = (...parts: readonly string[]): string => readFileSync(join(ROOT, ...parts), 'utf8')

const NAV = join('src', 'components', 'camera', 'navigation')
const CONTROLS = read('src', 'components', 'camera', 'NavigationControls.tsx')
const JOYSTICK = read(NAV, 'DriveJoystick.tsx')
const OVERLAY = read(NAV, 'DriveOverlay.tsx')

describe('NavigationControls drives with the joystick, not the four hold buttons', () => {
  it('mounts DriveJoystick on the hook`s vector drive and release', () => {
    expect(CONTROLS).toContain("from './navigation/DriveJoystick.js'")
    expect(CONTROLS).toContain('onVector={nav.driveVector}')
    expect(CONTROLS).toContain('onRelease={nav.stopDrive}')
  })

  it('the hold buttons are gone — no onPressIn drive, no direction table', () => {
    expect(CONTROLS).not.toContain('nav.startDrive(')
    expect(CONTROLS).not.toContain('onPressOut={nav.stopDrive}')
    expect(CONTROLS).not.toContain('const DRIVE:')
    expect(CONTROLS).not.toMatch(/\bRotateCcw\b|\bRotateCw\b|\bUndo2\b/)
  })
})

describe('DriveJoystick', () => {
  it('claims the touch on contact so neither the video pinch nor a scroll view can steal it', () => {
    expect(JOYSTICK).toContain('Gesture.Pan()')
    expect(JOYSTICK).toContain('.manualActivation(true)')
    expect(JOYSTICK).toContain('manager.activate()')
  })

  it('renders from the one math and drives through runOnJS', () => {
    expect(JOYSTICK).toContain('joystickVector(')
    expect(JOYSTICK).toContain('joystickThumbPosition(')
    expect(JOYSTICK).toContain('runOnJS(')
    expect(JOYSTICK).toContain('useSharedValue')
  })

  it('haptic on the FIRST nudge of a gesture only, and release always stops', () => {
    expect(JOYSTICK).toContain('runOnJS(hapticTap)()')
    expect(JOYSTICK).toMatch(/nudged\.set\(true\)/)
    expect(JOYSTICK).toContain('.onFinalize(')
  })

  it('is an adjustable control with an i18n label', () => {
    expect(JOYSTICK).toContain('accessibilityRole="adjustable"')
    expect(JOYSTICK).toContain("t('v2.navigation.joystick')")
  })
})

describe('DriveOverlay — the landscape drive chrome', () => {
  it('never hides while the thumb is down, otherwise follows the stream controls', () => {
    expect(OVERLAY).toContain('readonly visible: boolean')
    expect(OVERLAY).toMatch(/if\s*\(\s*!visible\s*&&\s*!engaged\s*\)\s*return\s+null/)
  })

  it('carries the joystick and the four buttons, plus the "…" that opens the existing panel', () => {
    expect(OVERLAY).toContain('<DriveJoystick')
    expect(OVERLAY).toContain("nav.runAction('stop')")
    expect(OVERLAY).toContain('nav.setLightOn(')
    expect(OVERLAY).toContain("runAction('personFollow')")
    expect(OVERLAY).toContain("runAction('goHome')")
    expect(OVERLAY).toContain('readonly onOpenControls: () => void')
    // The stop button is unconditional; the action buttons exist only when the
    // cap's dictionary has the action for THIS device.
    expect(OVERLAY).toContain("actionEntry(nav.actions, 'personFollow')")
    expect(OVERLAY).toContain("actionEntry(nav.actions, 'goHome')")
  })

  it('labels come from listActions where the action maps, else i18n', () => {
    expect(OVERLAY).toContain("t('v2.navigation.followMe')")
    expect(OVERLAY).toContain("t('v2.navigation.returnToDock')")
    expect(OVERLAY).toContain("t('v2.navigation.moreControls')")
    expect(OVERLAY).toContain('entry?.label ??')
  })

  it('against the open drawer: the cluster is laid out off the panel and the "…" is dropped, the joystick stays', () => {
    expect(OVERLAY).toContain('readonly drawer?: DriveDrawerState')
    expect(OVERLAY).toContain('driveOverlayLayout({')
    expect(OVERLAY).toMatch(/const showMore = drawer\?\.open !== true/)
    expect(OVERLAY).toMatch(/\{showMore \? \(\s*<OverlayDiscButton\s*size=\{size\}\s*icon=\{MoreHorizontal\}/)
    expect(OVERLAY).toContain('right: layout.right')
  })

  it('the light reflects status.flash', () => {
    expect(OVERLAY).toContain('nav.status?.flash === true')
  })
})

describe('the strings exist in both locales', () => {
  for (const locale of ['en', 'it']) {
    it(locale, () => {
      const json = JSON.parse(read('locales', `${locale}.json`)) as { v2: { navigation: Record<string, unknown> } }
      for (const key of ['joystick', 'joystickHint', 'followMe', 'returnToDock', 'moreControls']) {
        expect(typeof json.v2.navigation[key], key).toBe('string')
      }
    })
  }
})
