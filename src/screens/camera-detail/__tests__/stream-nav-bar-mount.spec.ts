/**
 * @vitest-environment jsdom
 *
 * The navigation bar in the real tree: it is absent by default, present when
 * the operator switches it on, and it never doubles up with the side rail.
 *
 * The default case is the one that matters most. This screen is the operator's
 * daily surface and the setting ships OFF, so a bar that appeared without being
 * asked for would be a regression in the layout of every camera they open — and
 * a pure rule returning `false` cannot prove the screen actually asked it.
 *
 * Needs `viewport-control.ts`: jsdom reports 0 for the window and the screen,
 * and every viewport rule reads 0 as degenerate and falls back to the stack.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import {
  setTestViewport,
  IPAD_LANDSCAPE,
  IPHONE_LANDSCAPE,
  IPHONE_PORTRAIT,
} from '../../../testing/viewport-control.js'
import { BOTTOM_NAV_TEST_ID } from '../../../navigation/BottomNavBar.js'
import { CAMERA_SHELF_TEST_ID } from '../CameraShelf.js'
import { DEFAULTS, useSettingsStore } from '../../../store/settings-store.js'
import { CameraDetailScreen } from '../../CameraDetailScreen.js'
import { useActivityStore } from '../../../activity/activity-instance.js'
import { queuedJob } from '../../../activity/activity-jobs.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERAS = [
  { id: 1, name: 'Front door', isCamera: true, online: true },
  { id: 5, name: 'Garden', isCamera: true, online: true },
]

const HUB = { 'deviceManager.listAll': CAMERAS }

/** Put the store in the state the app would be in after hydration. */
function setNavBarSetting(navBarOnStream: boolean): void {
  useSettingsStore.setState({
    settings: { ...DEFAULTS, stream: { ...DEFAULTS.stream, navBarOnStream } },
    hydrated: true,
  })
}

beforeEach(() => {
  setTestPlatform('ios')
  setNavBarSetting(false)
})

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
  useSettingsStore.setState({ settings: DEFAULTS, hydrated: false })
})

async function openTheater(): Promise<HTMLElement> {
  const { container } = mountScreen(React.createElement(CameraDetailScreen, { deviceId: 1 }), {
    hub: HUB,
    pathname: '/camera/1',
  })
  await act(async () => undefined)
  return container
}

const navBar = (root: HTMLElement): HTMLElement | null =>
  root.querySelector(`[data-testid="${BOTTOM_NAV_TEST_ID}"]`)

describe('the bar appears only when the setting is on', () => {
  it('a phone in portrait does NOT get it by default', async () => {
    setTestViewport(IPHONE_PORTRAIT)
    expect(navBar(await openTheater())).toBeNull()
  })

  it('the same phone DOES with the setting on', async () => {
    setNavBarSetting(true)
    setTestViewport(IPHONE_PORTRAIT)
    expect(navBar(await openTheater())).not.toBeNull()
  })

  it('and it carries every top-level destination, so it is the real navigation', async () => {
    setNavBarSetting(true)
    setTestViewport(IPHONE_PORTRAIT)
    const bar = navBar(await openTheater())
    expect(bar).not.toBeNull()
    for (const label of ['Cameras', 'Grids', 'Library']) {
      expect(bar?.textContent, label).toContain(label)
    }
    // Settings left the bar: it is a route behind the account menu now, and
    // the bar carries that menu's avatar instead, and the Activity centre only
    // while it has something not yet dismissed.
    expect(bar?.textContent).not.toContain('Settings')
    expect(bar?.querySelector('[data-testid="user-menu-button"]')).not.toBeNull()
    expect(bar?.querySelector('[data-testid="activity-button"]')).toBeNull()
    act(() => {
      useActivityStore.setState({ items: [queuedJob({ id: 'job:1', jobKind: 'face-assign', title: 'Assign', now: 1 })] })
    })
    expect(bar?.querySelector('[data-testid="activity-button"]')).not.toBeNull()
    act(() => {
      useActivityStore.setState({ items: [] })
    })
  })
})

describe('it never doubles the navigation, and never fights the picture', () => {
  it('a tablet in landscape keeps the side rail and grows no second bar', async () => {
    setNavBarSetting(true)
    setTestViewport(IPAD_LANDSCAPE)
    expect(navBar(await openTheater())).toBeNull()
  })

  it('a phone in landscape is `fill` — the picture still owns the window', async () => {
    setNavBarSetting(true)
    setTestViewport(IPHONE_LANDSCAPE)
    expect(navBar(await openTheater())).toBeNull()
  })

  it('and the shelf is never on screen next to it, in either direction', async () => {
    // The operator's stated worry, checked at the mount rather than argued:
    // the two surfaces that compete for the space under the picture.
    setNavBarSetting(true)
    for (const viewport of [IPHONE_PORTRAIT, IPAD_LANDSCAPE]) {
      setTestViewport(viewport)
      const root = await openTheater()
      const both =
        navBar(root) !== null &&
        root.querySelector(`[data-testid="${CAMERA_SHELF_TEST_ID}"]`) !== null
      expect(both).toBe(false)
      cleanup()
    }
  })
})
