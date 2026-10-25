import { describe, it, expect } from 'vitest'
import {
  isLandscapeViewport,
  isTabletViewport,
  shouldRestorePortraitLock,
  shouldShowSidebar,
  shouldUseWideDetail,
} from '../sidebar-rules.js'

describe('shouldShowSidebar', () => {
  it('shows sidebar on a real tablet (shortest side >= 768)', () => {
    expect(shouldShowSidebar({ width: 1024, height: 768, isWeb: false })).toBe(true)
  })
  it('shows sidebar on phone-landscape (width > height, shortest side < 768)', () => {
    expect(shouldShowSidebar({ width: 932, height: 430, isWeb: false })).toBe(true)
  })
  it('hides sidebar on phone-portrait (native)', () => {
    expect(shouldShowSidebar({ width: 390, height: 844, isWeb: false })).toBe(false)
  })
  it('shows sidebar on wide web even when short (e.g. 1280x720 browser)', () => {
    expect(shouldShowSidebar({ width: 1280, height: 720, isWeb: true })).toBe(true)
  })
  it('keeps bottom nav on a narrow web window (phone-sized browser)', () => {
    expect(shouldShowSidebar({ width: 420, height: 800, isWeb: true })).toBe(false)
  })
})

describe('shouldUseWideDetail', () => {
  it('wide web window (>= 1000) gets the wide detail layout', () => {
    expect(shouldUseWideDetail({ width: 1440, height: 900, isWeb: true })).toBe(true)
    expect(shouldUseWideDetail({ width: 1000, height: 700, isWeb: true })).toBe(true)
  })
  it('narrow web window keeps the mobile stack', () => {
    // Short landscape browser below the 1000 gate (min side < 768 → not tablet-like).
    expect(shouldUseWideDetail({ width: 999, height: 700, isWeb: true })).toBe(false)
    expect(shouldUseWideDetail({ width: 420, height: 800, isWeb: true })).toBe(false)
  })
  it('a web window with tablet-like dimensions qualifies via tablet-landscape', () => {
    // Both sides >= 768 and landscape — effectively an iPad-landscape-sized window.
    expect(shouldUseWideDetail({ width: 999, height: 900, isWeb: true })).toBe(true)
  })
  it('tablet LANDSCAPE gets the wide layout (native, e.g. iPad 1194x834)', () => {
    expect(shouldUseWideDetail({ width: 1194, height: 834, isWeb: false })).toBe(true)
    expect(shouldUseWideDetail({ width: 1024, height: 768, isWeb: false })).toBe(true)
  })
  it('tablet PORTRAIT keeps the mobile stack (timeline below the stream)', () => {
    expect(shouldUseWideDetail({ width: 834, height: 1194, isWeb: false })).toBe(false)
  })
  it('phone landscape stays on the fill/mobile path (shortest side < 768)', () => {
    expect(shouldUseWideDetail({ width: 932, height: 430, isWeb: false })).toBe(false)
  })

  it('a tablet in landscape stays wide when the KEYBOARD shrinks the window', () => {
    // The reported oscillation: same device, same orientation, 66pt of headroom
    // over the 768 floor, one soft keyboard.
    expect(
      shouldUseWideDetail({ width: 1194, height: 380, screenMinSide: 834, isWeb: false }),
    ).toBe(true)
  })
})

describe('isTabletViewport', () => {
  it('asks the DEVICE screen, not the window, when the device is known', () => {
    // Window height shrunk to 380 by the keyboard; the device is still a tablet.
    expect(isTabletViewport({ width: 1194, height: 380, screenMinSide: 834, isWeb: false })).toBe(
      true,
    )
    // A phone stays a phone however wide its landscape window is.
    expect(isTabletViewport({ width: 932, height: 430, screenMinSide: 430, isWeb: false })).toBe(
      false,
    )
  })

  it('falls back to the window when no device screen is known', () => {
    expect(isTabletViewport({ width: 1194, height: 834, isWeb: false })).toBe(true)
    expect(isTabletViewport({ width: 932, height: 430, isWeb: false })).toBe(false)
  })

  it('IGNORES the device screen on web — the browser window is the device', () => {
    // A 420pt browser window on a 27" monitor is not a tablet.
    expect(isTabletViewport({ width: 420, height: 800, screenMinSide: 1440, isWeb: true })).toBe(
      false,
    )
  })
})

describe('isLandscapeViewport', () => {
  it('is true when the window is wider than tall', () => {
    expect(isLandscapeViewport({ width: 1194, height: 834 })).toBe(true)
    expect(isLandscapeViewport({ width: 834, height: 1194 })).toBe(false)
  })

  it('treats a square mid-rotation frame as landscape — it must not flip a rail out', () => {
    expect(isLandscapeViewport({ width: 1000, height: 1000 })).toBe(true)
  })

  it('refuses a degenerate measurement rather than guessing', () => {
    expect(isLandscapeViewport({ width: 1194, height: 0 })).toBe(false)
    expect(isLandscapeViewport({ width: Number.NaN, height: 834 })).toBe(false)
  })
})

describe('shouldRestorePortraitLock', () => {
  it('a PHONE goes back to portrait when an immersive screen closes', () => {
    expect(shouldRestorePortraitLock({ screenMinSide: 430, isWeb: false })).toBe(true)
  })

  it('a TABLET never gets force-rotated to portrait', () => {
    // The leak behind "a volte la timeline va sotto": leaving a grid locked the
    // whole app portrait, so a landscape tablet reported portrait dimensions and
    // the theater resolved to `stack`.
    expect(shouldRestorePortraitLock({ screenMinSide: 820, isWeb: false })).toBe(false)
    expect(shouldRestorePortraitLock({ screenMinSide: 768, isWeb: false })).toBe(false)
  })

  it('the WEB viewer restores nothing — there is no lock to put back', () => {
    // `useScreenMinSide()` is `undefined` on web BY DESIGN (the browser window is
    // the device), and the guard used to read that as "phone" and lock the whole
    // app to PORTRAIT_UP. On the hub-served viewer that is a `screen.orientation
    // .lock()` the browser rejects outside fullscreen — and honours INSIDE it,
    // which is a landscape iPad rotated out of the layout it was using.
    expect(shouldRestorePortraitLock({ screenMinSide: undefined, isWeb: true })).toBe(false)
    // Not "web means undefined": a measured web window is still web.
    expect(shouldRestorePortraitLock({ screenMinSide: 430, isWeb: true })).toBe(false)
  })

  it('an unmeasured NATIVE screen keeps the phone behaviour', () => {
    expect(shouldRestorePortraitLock({ screenMinSide: undefined, isWeb: false })).toBe(true)
    expect(shouldRestorePortraitLock({ screenMinSide: 0, isWeb: false })).toBe(true)
  })
})
