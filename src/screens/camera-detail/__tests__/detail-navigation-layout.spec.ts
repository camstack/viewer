/**
 * @vitest-environment jsdom
 *
 * THE GATE: a sequence of navigations must not change the layout the camera
 * theater picks, while the screen size holds still.
 *
 * The operator, on v1.0.413 (which already carries the orientation-lock fix):
 * "continuo a vedere la timeline sotto in landscape dopo un paio di
 * navigazioni". "Un paio" is the informative part — one navigation is a
 * transition, two is something being CARRIED. And this screen is never
 * unmounted: the stack runs `freezeOnBlur: false`, so any value latched in it
 * outlives every later navigation and every rotation.
 *
 * Nothing in this repo could ask that question before. `mountScreen` renders
 * into jsdom, which has no layout engine and reports **0** for
 * `documentElement.clientWidth` and for `window.screen.*` — and every viewport
 * rule reads 0 as degenerate and falls back to the portrait stack. So every
 * mount test written so far has been laying out at 0x0 and could not have
 * noticed a layout defect if it tried. `testing/viewport-control.ts` is the
 * missing half; this file is the first claim that needs it.
 *
 * Two invariants, and they fail differently:
 *   • the SHAPE (`detailShapeTestId`) — pure, and it holds;
 *   • the wide GEOMETRY (the rail width) — measured, and it did not.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import { emitFocus } from '../../../testing/focus-control.js'
import {
  setTestViewport,
  IPAD_LANDSCAPE,
  IPAD_PORTRAIT,
} from '../../../testing/viewport-control.js'
import { CameraDetailScreen } from '../../CameraDetailScreen.js'
import { detailShapeTestId } from '../detail-layout.js'
import {
  TIMELINE_RAIL_WIDTH,
  TIMELINE_RAIL_WIDTH_NARROW,
} from '../wide-detail-sizes.js'
import { SIDE_NAV_WIDTH } from '../../../navigation/side-nav-metrics.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

/** The shape the tree actually rendered, read off the timeline root. */
function shapeOf(root: HTMLElement): string {
  for (const shape of ['wide', 'stack', 'fill'] as const) {
    if (root.querySelector(`[data-testid="${detailShapeTestId(shape)}"]`) !== null) return shape
  }
  return 'none'
}

/**
 * The rail width the wide layout committed to, in px. `TheaterTimeline` writes
 * it as a dynamic style, so it reaches jsdom as an inline `width`.
 */
function railWidthOf(root: HTMLElement): number | null {
  for (const candidate of [TIMELINE_RAIL_WIDTH_NARROW, TIMELINE_RAIL_WIDTH]) {
    if (root.querySelector(`[style*="width: ${candidate}px"]`) !== null) return candidate
  }
  return null
}

function openTheater(): HTMLElement {
  return mountScreen(React.createElement(CameraDetailScreen, { deviceId: 1 })).container
}

/** Pop a route that was pushed on top of this one. `freezeOnBlur: false` left
 *  the screen mounted, so this is a re-FOCUS, not a remount. */
function navigateBack(): void {
  act(() => {
    emitFocus()
  })
}

describe('the shape survives a sequence of navigations', () => {
  it('an iPad in landscape stays side-by-side through five round trips', () => {
    setTestPlatform('ios')
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()

    expect(shapeOf(root)).toBe('wide')
    for (let trip = 1; trip <= 5; trip += 1) {
      navigateBack()
      expect(shapeOf(root), `after navigation ${trip}`).toBe('wide')
    }
  })

  it('a rotation taken WHILE the route is covered still lands on the right shape', () => {
    setTestPlatform('ios')
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()

    act(() => setTestViewport(IPAD_PORTRAIT))
    expect(shapeOf(root)).toBe('stack')
    navigateBack()
    act(() => setTestViewport(IPAD_LANDSCAPE))
    navigateBack()
    expect(shapeOf(root)).toBe('wide')
  })
})

describe('the wide GEOMETRY survives the same sequence', () => {
  /**
   * The defect, in one number. The column is the window minus the side nav
   * rail — 1194 − 72 = 1122 on this iPad — which is BELOW `RAIL_NARROW_BELOW`,
   * so the settled rail is 340. The screen used to seed the unmeasured frame
   * with the whole window (1194, one point over the threshold) and therefore
   * open every navigation on a 380pt rail and a picture 36pt wider on each
   * side than the column it sits in.
   */
  it('opens on the SETTLED rail, not on a window-sized guess', () => {
    setTestPlatform('ios')
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()

    expect(IPAD_LANDSCAPE.width - SIDE_NAV_WIDTH).toBeLessThan(1180)
    expect(railWidthOf(root)).toBe(TIMELINE_RAIL_WIDTH_NARROW)
  })

  it('keeps the same rail across a sequence of navigations', () => {
    setTestPlatform('ios')
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()
    const opened = railWidthOf(root)

    for (let trip = 1; trip <= 3; trip += 1) {
      navigateBack()
      expect(railWidthOf(root), `after navigation ${trip}`).toBe(opened)
    }
  })

  /** A camera switch is `router.replace('/camera/<id>')` on a route keyed by
   *  `deviceId`, i.e. a full remount. It must open on the same geometry as the
   *  screen it replaced — that is what "no jump between cameras" means. */
  it('a camera switch remounts onto the same geometry', () => {
    setTestPlatform('ios')
    setTestViewport(IPAD_LANDSCAPE)
    const first = railWidthOf(openTheater())
    cleanup()
    const second = railWidthOf(
      mountScreen(React.createElement(CameraDetailScreen, { deviceId: 7 })).container,
    )
    expect(second).toBe(first)
  })

  it('a rotation round trip comes back to the landscape geometry', () => {
    setTestPlatform('ios')
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()
    const landscapeRail = railWidthOf(root)

    act(() => setTestViewport(IPAD_PORTRAIT))
    navigateBack()
    act(() => setTestViewport(IPAD_LANDSCAPE))
    navigateBack()
    expect(shapeOf(root)).toBe('wide')
    expect(railWidthOf(root)).toBe(landscapeRail)
  })
})
