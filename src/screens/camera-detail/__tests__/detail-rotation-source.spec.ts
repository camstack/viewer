/**
 * @vitest-environment jsdom
 *
 * THE GATE reads the view tree, not `Dimensions`.
 *
 * The `theater:layout` report from the tablet, 2026-09-10 21:52 (Loki,
 * `[app:info:theater:layout]`, screenMinSide 834):
 *
 *   21:52:05.5  win 834×1194 portrait  → stack   measured 762 @ 1194
 *   21:52:06.4  win 834×1194 portrait  → stack   measured 1122 @ 834   ← root is 1194−72 wide
 *   21:52:10.4  win 1194×834 landscape → wide    measured 1122 @ 834
 *   21:52:10.4  win 1194×834 landscape → wide    measured 762 @ 1194   ← root is 834−72 wide
 *   21:52:11.8  win 834×1194 portrait  → stack   measured 1122 @ 834   ← root is 1194−72 wide
 *   21:52:17    previous runtime exit: backgrounded  (the operator killed the app)
 *
 * The same signature on 2026-09-09 22:06:02 (`measured 1122 @ 834`, then
 * `measured 1194 @ 834` in fullscreen, for 28 s until the window caught up at
 * 22:06:30). A root view 1122 pt wide cannot exist in an 834 pt window: the
 * ROOT is the landscape truth, `useWindowDimensions` is a stale notification,
 * and the gate read the stale one — `isLandscapeViewport({ 834, 1194 })` is
 * false, so a tablet the operator was holding sideways stacked. Both warn
 * lines that night carried `orientationLock: 0` (no lock) and `orientation: 1`
 * (portrait, from the same stale source), which is why the lock hypothesis
 * closed nothing.
 *
 * RN's `RCTDeviceInfo` refreshes `Dimensions.window` on
 * `UIDeviceOrientationDidChangeNotification` and on a KVO of the key window's
 * frame captured at module init; the safe-area frame comes from the provider
 * view's own `layoutSubviews` — a fact about the view tree. The theater reads
 * the latter (`use-viewport-size.ts`); this spec is the operator's rotation
 * with the two sources pulled apart.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import {
  setTestViewport,
  IPAD_LANDSCAPE,
  IPAD_PORTRAIT,
} from '../../../testing/viewport-control.js'
import { CameraDetailScreen } from '../../CameraDetailScreen.js'
import { detailShapeTestId } from '../detail-layout.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

function shapeOf(root: HTMLElement): string {
  for (const shape of ['wide', 'stack', 'fill'] as const) {
    if (root.querySelector(`[data-testid="${detailShapeTestId(shape)}"]`) !== null) return shape
  }
  return 'none'
}

function openTheater(): HTMLElement {
  return mountScreen(React.createElement(CameraDetailScreen, { deviceId: 1 })).container
}

describe('the theater follows the measured frame when Dimensions lags a rotation', () => {
  it('window still portrait, view tree already landscape → wide (21:52:06 and 21:52:11)', () => {
    setTestPlatform('ios')
    setTestViewport(IPAD_PORTRAIT)
    const root = openTheater()
    expect(shapeOf(root)).toBe('stack')

    // The device rotates. The provider view lays out at 1194×834; the
    // `didUpdateDimensions` event never arrives (or arrives seconds later).
    act(() =>
      setTestViewport({
        ...IPAD_PORTRAIT,
        frameWidth: IPAD_LANDSCAPE.width,
        frameHeight: IPAD_LANDSCAPE.height,
      }),
    )
    expect(shapeOf(root)).toBe('wide')
  })

  it('window still landscape, view tree already portrait → stack (21:52:04 and 21:52:10)', () => {
    setTestPlatform('ios')
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()
    expect(shapeOf(root)).toBe('wide')

    act(() =>
      setTestViewport({
        ...IPAD_LANDSCAPE,
        frameWidth: IPAD_PORTRAIT.width,
        frameHeight: IPAD_PORTRAIT.height,
      }),
    )
    expect(shapeOf(root)).toBe('stack')
  })

  it('when Dimensions finally catches up nothing moves', () => {
    setTestPlatform('ios')
    setTestViewport(IPAD_PORTRAIT)
    const root = openTheater()
    act(() =>
      setTestViewport({
        ...IPAD_PORTRAIT,
        frameWidth: IPAD_LANDSCAPE.width,
        frameHeight: IPAD_LANDSCAPE.height,
      }),
    )
    expect(shapeOf(root)).toBe('wide')
    act(() => setTestViewport(IPAD_LANDSCAPE))
    expect(shapeOf(root)).toBe('wide')
  })

  it('on web the window IS the surface — the frame is not consulted', () => {
    // `NativeSafeAreaProvider.web` measures the document once, at mount and on
    // a transition end; it does not follow a resize. The browser window does.
    setTestPlatform('web')
    setTestViewport({ width: 1280, height: 800 })
    const root = openTheater()
    expect(shapeOf(root)).toBe('wide')
    act(() => setTestViewport({ width: 1280, height: 800, frameWidth: 600, frameHeight: 900 }))
    expect(shapeOf(root)).toBe('wide')
  })
})
