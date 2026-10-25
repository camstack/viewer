/**
 * @vitest-environment jsdom
 *
 * The footer's CAMERA button: below the tablet threshold, and nowhere else.
 *
 * The operator's call (2026-09-02): *«Rimuoviamo quel pulsante camere, non e'
 * piu' necessario con la nuova griglia in tablet. Lo teniamo solamente per
 * schermi piccoli (smartphone) per saltare su un'altra camera.»* A tablet
 * builds its view on the surface itself — the shelf card's "add to view" beside
 * the picture, the grid definition on the grid page — so a panel that REPLACES
 * the view is a second, contradicting way to do it. On a phone there is no
 * shelf, and the button's verb is exactly "jump to another camera".
 *
 * Asserted on the RENDERED tree on BOTH surfaces and BOTH orientations, never
 * on the source: a source check goes green on a screen that passes the callback
 * and hides the chip some other way. The threshold is the app's one definition
 * (`isTabletViewport`, keyed off the DEVICE screen), which is why a phone in
 * LANDSCAPE — a 932pt-wide window, wider than an iPad in portrait — still gets
 * the button.
 *
 * Needs `viewport-control.ts`: jsdom reports 0 for the window and the screen,
 * and every viewport rule reads 0 as degenerate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../../testing/mount.js'
import { setTestPlatform } from '../../../../testing/platform-control.js'
import {
  setTestViewport,
  IPAD_LANDSCAPE,
  IPAD_PORTRAIT,
  IPHONE_LANDSCAPE,
  IPHONE_PORTRAIT,
  type TestViewport,
} from '../../../../testing/viewport-control.js'
import { resetWebViewStub } from '../../../../testing/webview-control.js'
import { resetRouterStub } from '../../../../testing/native-stubs/expo-router.js'
import { useWorkspaceStore } from '../../../../store/workspace-store.js'
import { EMPTY_WORKSPACE } from '../../../../store/workspace.js'
import { CameraDetailScreen } from '../../../../screens/CameraDetailScreen.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERAS = [
  { id: 1, name: 'Front door', isCamera: true, online: true },
  { id: 5, name: 'Garden', isCamera: true, online: true },
]

/** The harness pins the locale to `en` (`native-stubs/expo-localization.ts`). */
const CAMERA_CHIP = '[aria-label="Switch camera"]'
/** The chip beside it in the same band — the POSITIVE control. Without it every
 *  "the camera chip is absent" assertion is also green for a screen that drew
 *  no footer bar at all. */
const RANGE_CHIP = '[aria-label="Time range"]'

beforeEach(() => {
  useWorkspaceStore.setState({ workspace: EMPTY_WORKSPACE })
  resetWebViewStub()
  resetRouterStub()
  setTestPlatform('ios')
})

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
  useWorkspaceStore.setState({ workspace: EMPTY_WORKSPACE })
})

async function openDetail(viewport: TestViewport): Promise<HTMLElement> {
  setTestViewport(viewport)
  const { container } = mountScreen(
    React.createElement(CameraDetailScreen, { deviceId: 1 }),
    { hub: { 'deviceManager.listAll': CAMERAS } },
  )
  await act(async () => undefined)
  return container
}

describe('camera-detail — the phone keeps it', () => {
  it('a phone in portrait draws the camera chip', async () => {
    const root = await openDetail(IPHONE_PORTRAIT)
    expect(root.querySelector(RANGE_CHIP)).not.toBeNull()
    expect(root.querySelector(CAMERA_CHIP)).not.toBeNull()
  })

  it('a phone in LANDSCAPE keeps it too — the threshold is the DEVICE, not the window', async () => {
    // 932x430: a wider window than an iPad held upright. Keyed off the window
    // this would read as "roomy" and lose the button on the one surface that
    // has no shelf at all.
    const root = await openDetail(IPHONE_LANDSCAPE)
    expect(root.querySelector(CAMERA_CHIP)).not.toBeNull()
  })
})

describe('camera-detail — a tablet does not', () => {
  it('an iPad in landscape draws the band without the camera chip', async () => {
    const root = await openDetail(IPAD_LANDSCAPE)
    expect(root.querySelector(RANGE_CHIP)).not.toBeNull()
    expect(root.querySelector(CAMERA_CHIP)).toBeNull()
  })

  it('an iPad whose WINDOW shrank is still a tablet — no button comes back', async () => {
    // The defect `sidebar-rules.ts` was written against, at a new site. In
    // landscape the window's shortest side IS its height, and the height is the
    // one dimension that shrinks while the device sits still: the Android soft
    // keyboard, browser chrome, a Stage Manager resize. 1194x700 on an 1194x834
    // SCREEN reads as a phone to any window-keyed test — and the button would
    // reappear mid-typing on the surface the operator just cleared it from.
    //
    // Disarming `useTabletViewport()` to the window-keyed `useIsTablet()` is
    // green on every other fixture in this file and red only here.
    const root = await openDetail({
      width: 1194,
      height: 700,
      screenWidth: 1194,
      screenHeight: 834,
    })
    expect(root.querySelector(RANGE_CHIP)).not.toBeNull()
    expect(root.querySelector(CAMERA_CHIP)).toBeNull()
  })

  it('an iPad in PORTRAIT too — the rule is the device, not the layout shape', async () => {
    // `stack`, the same shape a phone in portrait resolves to. A gate written
    // against `layoutMode` could not tell these two apart, and this is the
    // assertion that says so.
    const root = await openDetail(IPAD_PORTRAIT)
    expect(root.querySelector(RANGE_CHIP)).not.toBeNull()
    expect(root.querySelector(CAMERA_CHIP)).toBeNull()
  })
})
