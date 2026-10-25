/**
 * @vitest-environment jsdom
 *
 * "Tappando ovunque sulla griglia deve nascondere qualsiasi pannello
 * attualmente aperto."
 *
 * The control bar's popovers were the gap: the cell card and the share dialog
 * each brought a full-screen backdrop, the popover brought nothing, and its
 * state lived inside `FloatingControlBar` where the page could not reach it. A
 * tap on the wall left the menu standing — and on the embed that tap carried on
 * through to a tile.
 *
 * Three gates, and the third is the one a unit test usually misses:
 *
 *  1. with nothing open the dismiss layer is NOT IN THE TREE, so it cannot eat
 *     a tile press, a long-press or a pinch;
 *  2. opening a bar popover puts it there, and a tap on it closes the popover;
 *  3. that same tap does NOT reach the wall. Asserted on the wall's native
 *     surface NODE (`toBe`) plus the absence of any navigation: "the popover
 *     closed" is green whether or not a camera also opened behind it.
 *
 * Phone viewport on purpose — no timeline here, so the tree is the wall, the
 * layer and the bar, and nothing else can be answering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen, TEST_SERVER_ID } from '../../testing/mount.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { setTestPlatform } from '../../testing/platform-control.js'
import { setTestViewport, IPHONE_PORTRAIT } from '../../testing/viewport-control.js'
import { resetWebViewStub } from '../../testing/webview-control.js'
import { useGridStore, type Grid } from '../../store/grid-store.js'
import { GridViewScreen } from '../GridViewScreen.js'
import { GRID_TAP_DISMISS_TEST_ID } from '../../components/grid/GridTapDismiss.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERAS = [
  { id: 1, name: 'Front door', isCamera: true, online: true },
  { id: 5, name: 'Garden', isCamera: true, online: true },
]

const GRID_ID = 'g1'
/** The harness pins the locale to `en` (`native-stubs/expo-localization.ts`). */
const QUALITY_BUTTON = '[aria-label="Stream quality"]'

function hub(): Readonly<Record<string, unknown>> {
  return { 'deviceManager.listAll': CAMERAS }
}

function seedGrid(): void {
  useGridStore.setState({
    grids: [{ id: GRID_ID, name: 'Piano terra', serverId: TEST_SERVER_ID, cameraIds: [1, 5] } satisfies Grid],
    hydrated: true,
  })
}

async function openGrid(): Promise<HTMLElement> {
  const { container } = mountScreen(React.createElement(GridViewScreen, { gridId: GRID_ID }), {
    hub: hub(),
  })
  // Readiness: the wall is drawn only once the camera list has ANSWERED — a
  // count of `act` flushes would prove nothing about the tree below.
  await waitFor(() =>
    expect(hubCalls().filter((c) => c.path === 'deviceManager.listAll').length).toBeGreaterThan(0),
  )
  await act(async () => undefined)
  return container
}

/** The dismiss layer, or null when the page decided nothing is open. */
function dismissLayer(root: HTMLElement): Element | null {
  return root.querySelector(`[data-testid="${GRID_TAP_DISMISS_TEST_ID}"]`)
}

/** A row that exists ONLY while the quality popover is open. The tier NAME is
 *  drawn nowhere else on this page — the bar button wears a one-letter badge. */
function qualityRow(root: HTMLElement): Element | null {
  return [...root.querySelectorAll('div')].find((el) => el.textContent === 'Medium') ?? null
}

function click(el: Element): void {
  act(() => {
    fireEvent.mouseDown(el, { clientX: 40, clientY: 40, button: 0 })
    fireEvent.mouseUp(el, { clientX: 40, clientY: 40, button: 0 })
    fireEvent.click(el, { clientX: 40, clientY: 40 })
  })
}

/** The wall's native surface — its NODE, so "did not remount" is a real claim. */
function wallSurface(root: HTMLElement): Element {
  const el = root.querySelector('[data-testid="stub-WebView"]')
  if (el === null) throw new Error('the wall reached no native surface')
  return el
}

beforeEach(() => {
  useGridStore.setState({ grids: [], hydrated: true })
  resetWebViewStub()
  setTestPlatform('ios')
  setTestViewport(IPHONE_PORTRAIT)
})

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
  useGridStore.setState({ grids: [], hydrated: true })
})

describe('a tap on the grid dismisses whatever is open', () => {
  it('with nothing open there is NO layer over the wall', async () => {
    seedGrid()
    const root = await openGrid()
    // Positive control: the bar IS drawn, so "no layer" is not "no page".
    expect(root.querySelector(QUALITY_BUTTON)).not.toBeNull()
    expect(dismissLayer(root)).toBeNull()
    // …and the popover row the other cases look for is genuinely absent here,
    // so finding it below is a fact about the popover and not about the page.
    expect(qualityRow(root)).toBeNull()
  })

  it('opening a bar popover puts the layer there', async () => {
    seedGrid()
    const root = await openGrid()
    expect(dismissLayer(root)).toBeNull()

    click(root.querySelector(QUALITY_BUTTON)!)
    expect(qualityRow(root)).not.toBeNull()
    expect(dismissLayer(root)).not.toBeNull()
  })

  it('and a tap on it closes the popover — without disturbing the wall', async () => {
    seedGrid()
    const root = await openGrid()
    const surface = wallSurface(root)

    click(root.querySelector(QUALITY_BUTTON)!)
    expect(qualityRow(root)).not.toBeNull()

    click(dismissLayer(root)!)

    expect(qualityRow(root)).toBeNull()
    // The layer withdraws with the panel it was holding for.
    expect(dismissLayer(root)).toBeNull()
    // The dismissing tap did not ALSO act: same wall node, never re-parented,
    // and the page did not navigate away to a camera.
    expect(wallSurface(root)).toBe(surface)
    expect(root.querySelector(QUALITY_BUTTON)).not.toBeNull()
  })
})
