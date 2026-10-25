/**
 * @vitest-environment jsdom
 *
 * The camera button, in the real tree: what confirming a selection DOES.
 *
 * The claim worth a mount is the negative one — that on a tablet the confirm
 * does not navigate. A pure spec can say `resolveCameraSelection` returned
 * `buildView`; only the mounted screen can say the router was never asked, and
 * that is the whole of what the operator reported ("sembra un modal": a
 * `router.push` onto a `containedTransparentModal` group).
 *
 * The phone case is asserted in the same file and the same way, because "the
 * phone did not change" is a guarantee, and a guarantee that lives in a
 * different file from the thing that could break it gets read as covered.
 *
 * Needs `viewport-control.ts`: jsdom reports 0 for the window and the screen,
 * and every viewport rule reads 0 as degenerate and falls back to the stack —
 * where this feature correctly does not exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import {
  setTestViewport,
  IPAD_LANDSCAPE,
  IPHONE_PORTRAIT,
} from '../../../testing/viewport-control.js'
import { resetWebViewStub } from '../../../testing/webview-control.js'
import { resetRouterStub, routerCalls } from '../../../testing/native-stubs/expo-router.js'
import { useWorkspaceStore } from '../../../store/workspace-store.js'
import { EMPTY_WORKSPACE } from '../../../store/workspace.js'
import { CameraDetailScreen } from '../../CameraDetailScreen.js'
import { CAMERA_SELECT_CONFIRM_TEST_ID } from '../../../components/camera/CameraSwitcherPanel.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERAS = [
  { id: 1, name: 'Front door', isCamera: true, online: true },
  { id: 5, name: 'Garden', isCamera: true, online: true },
  { id: 9, name: 'Garage', isCamera: true, online: true },
  { id: 12, name: 'Retro', isCamera: true, online: true },
]

const HUB = { 'deviceManager.listAll': CAMERAS }

/** The harness pins the locale to `en` (`native-stubs/expo-localization.ts`). */
const SWITCH_CAMERA_LABEL = 'Switch camera'

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

async function openScreen(): Promise<HTMLElement> {
  const { container } = mountScreen(React.createElement(CameraDetailScreen, { deviceId: 1 }), {
    hub: HUB,
  })
  await act(async () => undefined)
  return container
}

function click(root: HTMLElement, selector: string): void {
  const el = root.querySelector(selector)
  if (el === null) throw new Error(`nothing matched ${selector}`)
  act(() => {
    fireEvent.click(el)
  })
}

/** Open the camera panel and tick these cameras, by their row checkboxes. */
async function selectCameras(root: HTMLElement, names: readonly string[]): Promise<void> {
  click(root, `[aria-label="${SWITCH_CAMERA_LABEL}"]`)
  await act(async () => undefined)
  for (const name of names) click(root, `[aria-label="Select ${name}"]`)
}

function confirm(root: HTMLElement): HTMLElement {
  const el = root.querySelector(`[data-testid="${CAMERA_SELECT_CONFIRM_TEST_ID}"]`)
  if (!(el instanceof HTMLElement)) throw new Error('the panel offered no confirm')
  return el
}

function members(): readonly number[] {
  return useWorkspaceStore.getState().workspace.members
}

describe('on a tablet the panel is no longer reachable at all', () => {
  /**
   * The operator removed the footer's camera button above the tablet threshold
   * on 2026-09-02 — a tablet builds its view from the shelf card's "add to
   * view", which is beside the picture and REPORTS what is already in the view.
   *
   * The four tests that stood here proved what confirming did on a tablet
   * (`buildView`: write the workspace, navigate nowhere). They are gone rather
   * than rewritten, because there is no longer a way into the panel from a
   * tablet tree and a test that reaches past the missing control would be
   * asserting about a screen the operator cannot produce. `git show 9c43fc7`
   * has them, and `resolveCameraSelection`'s `buildView` branch is now
   * UNREACHABLE — flagged for the operator, not silently deleted.
   *
   * What survives here is the one claim that is still about this file's
   * subject: the way in is closed. The threshold itself, on both surfaces and
   * both orientations, is `theater/__tests__/camera-jump-gate.spec.ts`.
   */
  it('no camera chip, so no selection to confirm', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openScreen()
    expect(root.querySelector(`[aria-label="${SWITCH_CAMERA_LABEL}"]`)).toBeNull()
    expect(root.querySelector(`[data-testid="${CAMERA_SELECT_CONFIRM_TEST_ID}"]`)).toBeNull()
  })
})

describe('on a phone nothing about this changed', () => {
  it('two selected still push the on-the-fly grid route, and write no view', async () => {
    setTestViewport(IPHONE_PORTRAIT)
    const root = await openScreen()
    await selectCameras(root, ['Garden', 'Garage'])

    act(() => {
      fireEvent.click(confirm(root))
    })

    expect(routerCalls()).toEqual([{ kind: 'push', target: '/grid/adhoc?devices=5,9' }])
    expect(members()).toEqual([])
  })

  it('one selected does nothing at all — the confirm is refused below two', async () => {
    setTestViewport(IPHONE_PORTRAIT)
    const root = await openScreen()
    await selectCameras(root, ['Garden'])

    act(() => {
      fireEvent.click(confirm(root))
    })

    expect(routerCalls()).toEqual([])
    expect(members()).toEqual([])
  })
})
