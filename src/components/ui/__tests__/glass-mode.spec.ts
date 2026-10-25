/**
 * @vitest-environment jsdom
 *
 * Which surface a glass element is drawn as, and — the claim that matters — that
 * asking NEVER throws on a binary that does not carry `ExpoGlassEffect`.
 *
 * The OTA hazard: `expo-glass-effect` reaches the app through expo-router, so a
 * bundle can run on a native build that predates it. `isGlassEffectAPIAvailable()`
 * and `GlassView` both `requireNativeModule` and throw there. The mocked library
 * below throws exactly when the mocked native module is absent, so a probe that
 * reaches for the library before the module fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setTestPlatform } from '../../../testing/platform-control.js'
import { withAlpha } from '../../../theme/tokens.js'
import { hasNativeGlass, loadGlassContainer, loadGlassView, resolveGlassMode } from '../glass-mode.js'

let nativeModule: { isGlassEffectAPIAvailable: boolean } | null = null
const libraryCalls = vi.fn()

/** Stands in for `expo-glass-effect`: like the real package, it throws when the
 *  native module is not linked into the binary. */
function glassLibrary() {
  libraryCalls('evaluated')
  if (nativeModule === null) throw new Error('Cannot find native module ExpoGlassEffect')
  return { GlassView: 'NativeGlassView' as never, GlassContainer: 'NativeGlassContainer' as never }
}

vi.mock('expo-modules-core', () => ({
  requireOptionalNativeModule: () => nativeModule,
}))


beforeEach(() => {
  libraryCalls.mockClear()
  nativeModule = null
  setTestPlatform('ios')
})

afterEach(() => {
  setTestPlatform('ios')
})


describe('resolveGlassMode — the decision table', () => {
  it('uses native glass only on iOS with the API present', () => {
    expect(resolveGlassMode({ os: 'ios', reduceTransparency: false, nativeGlass: true })).toBe('glass')
  })

  it('falls back to blur on iOS without the API (older OS or older binary) and on the web', () => {
    expect(resolveGlassMode({ os: 'ios', reduceTransparency: false, nativeGlass: false })).toBe('blur')
    expect(resolveGlassMode({ os: 'web', reduceTransparency: false, nativeGlass: false })).toBe('blur')
  })

  it('is a solid on Android, never a faked blur', () => {
    expect(resolveGlassMode({ os: 'android', reduceTransparency: false, nativeGlass: false })).toBe('solid')
  })

  it('is a solid whenever reduce transparency is on, whatever the platform can do', () => {
    for (const os of ['ios', 'android', 'web']) {
      expect(resolveGlassMode({ os, reduceTransparency: true, nativeGlass: true })).toBe('solid')
    }
  })
})

describe('the native probe never throws', () => {
  it('module absent: no glass, no view, and the library is never evaluated', () => {
    nativeModule = null
    expect(() => hasNativeGlass()).not.toThrow()
    expect(hasNativeGlass()).toBe(false)
    expect(() => loadGlassView(glassLibrary)).not.toThrow()
    expect(loadGlassView(glassLibrary)).toBeNull()
    expect(libraryCalls).not.toHaveBeenCalled()
  })

  it('module present but the OS API unavailable (iOS < 26): blur, library untouched', () => {
    nativeModule = { isGlassEffectAPIAvailable: false }
    expect(hasNativeGlass()).toBe(false)
    expect(loadGlassView(glassLibrary)).toBeNull()
    expect(libraryCalls).not.toHaveBeenCalled()
    expect(
      resolveGlassMode({ os: 'ios', reduceTransparency: false, nativeGlass: hasNativeGlass() }),
    ).toBe('blur')
  })

  it('module present and API available: the library view is loaded', () => {
    nativeModule = { isGlassEffectAPIAvailable: true }
    expect(hasNativeGlass()).toBe(true)
    expect(loadGlassView(glassLibrary)).toBe('NativeGlassView')
  })

  it('other platforms never look for the module', () => {
    nativeModule = { isGlassEffectAPIAvailable: true }
    setTestPlatform('android')
    expect(hasNativeGlass()).toBe(false)
  })
})

describe('the glass container follows the same probe', () => {
  it('is null without the module or on iOS < 26, and never evaluates the library', () => {
    nativeModule = null
    expect(loadGlassContainer(glassLibrary)).toBeNull()
    nativeModule = { isGlassEffectAPIAvailable: false }
    expect(loadGlassContainer(glassLibrary)).toBeNull()
    expect(libraryCalls).not.toHaveBeenCalled()
  })

  it('is the library container when native glass is available', () => {
    nativeModule = { isGlassEffectAPIAvailable: true }
    expect(loadGlassContainer(glassLibrary)).toBe('NativeGlassContainer')
  })
})

describe('withAlpha', () => {
  it('turns a hex palette colour into rgba at the given opacity', () => {
    expect(withAlpha('#ffffff', 0.5)).toBe('rgba(255, 255, 255, 0.5)')
    expect(withAlpha('#f59e42', 0.2)).toBe('rgba(245, 158, 66, 0.2)')
    expect(withAlpha('#fff', 1)).toBe('rgba(255, 255, 255, 1)')
  })

  it('clamps the alpha and leaves a non-hex colour alone', () => {
    expect(withAlpha('#000000', 3)).toBe('rgba(0, 0, 0, 1)')
    expect(withAlpha('rgba(0, 0, 0, 0.3)', 0.5)).toBe('rgba(0, 0, 0, 0.3)')
  })
})
