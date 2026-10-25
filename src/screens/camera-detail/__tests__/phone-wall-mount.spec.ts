/**
 * @vitest-environment jsdom
 *
 * The WALL on a phone, in the real tree: how it is built, where it is refused,
 * and what a rotation costs.
 *
 * Four claims, and each of them is about a decision that has exactly one wrong
 * answer the operator would feel:
 *
 * 1. **Landscape BUILDS.** Confirming a multi-selection in the timeline's
 *    camera selector puts the wall up and navigates NOWHERE. The router is the
 *    assertion as much as the wall is — `buildView` and `openGrid` both leave
 *    two cameras on screen, and only one of them leaves the operator on the
 *    screen they were on.
 * 2. **Portrait ROUTES.** The same confirm, one rotation away, still pushes
 *    `/grid/adhoc` — and writes no view. Not because portrait has no room (it
 *    draws a wall perfectly well, see 3) but because the selector is hosted
 *    INSIDE the timeline body there, so building a view would delete the
 *    surface under the operator's finger. `camera-selection.ts` argues it; this
 *    asserts it.
 * 3. **Portrait HONOURS a view that exists.** Rotating with the wall up keeps
 *    the wall, drawn in the portrait column with the timeline below it. Portrait
 *    cannot build a view; it renders one.
 * 4. **The rotation does not re-create the embed.** This is the load-bearing
 *    one. `GridLiveEmbed` is one `WKWebView` holding N peers, and `fill` and
 *    `stack` are different boxes — if the shape change re-parented or re-keyed
 *    it, every rotation would cost a full WebRTC renegotiation on every camera.
 *    Asserted on DOM node IDENTITY plus the BOOT COUNT: a remount also leaves
 *    exactly one wall on screen, so presence cannot tell the two apart, and a
 *    fresh document announces itself as a new injected config rather than as a
 *    `setDevices` command (`webview-control.ts`).
 *
 * Needs `viewport-control.ts`: jsdom reports 0 for the window and the screen,
 * and every viewport rule reads 0 as degenerate. A rotation spec in particular
 * is meaningless without it — both orientations would resolve to the same
 * fallback shape.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import {
  setTestViewport,
  IPHONE_LANDSCAPE,
  IPHONE_PORTRAIT,
  type TestViewport,
} from '../../../testing/viewport-control.js'
import {
  bootedWebViewConfigs,
  emitWebViewMessage,
  injectedWebViewScripts,
  resetWebViewStub,
} from '../../../testing/webview-control.js'
import { resetRouterStub, routerCalls } from '../../../testing/native-stubs/expo-router.js'
import { useWorkspaceStore } from '../../../store/workspace-store.js'
import { EMPTY_WORKSPACE, type WorkspaceState } from '../../../store/workspace.js'
import { CameraDetailScreen, WALL_STAGE_TEST_ID } from '../../CameraDetailScreen.js'
import { CAMERA_SELECT_CONFIRM_TEST_ID } from '../../../components/camera/CameraSwitcherPanel.js'
import { TIMELINE_CHROME_TEST_ID } from '../../../components/camera/theater/TheaterTimeline.js'
import { detailShapeTestId } from '../detail-layout.js'
import { resolvePortraitColumnSplit } from '../wall-box.js'
import { TEST_INSETS } from '../../../testing/native-stubs/safe-area-context.js'
import { WORKSPACE_GRID_TEST_ID } from '../WorkspaceGrid.js'
import { SHELF_VARIANT_TEST_ID } from '../CameraShelf.js'

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

async function openTheater(
  viewport: TestViewport,
  view: Partial<WorkspaceState> = EMPTY_WORKSPACE,
): Promise<HTMLElement> {
  setTestViewport(viewport)
  useWorkspaceStore.setState({ workspace: { ...EMPTY_WORKSPACE, ...view } })
  const { container } = mountScreen(React.createElement(CameraDetailScreen, { deviceId: 1 }), {
    hub: HUB,
  })
  await act(async () => undefined)
  return container
}

/** Turn the device, the way the operator does. `act` because the resize lands
 *  as a `setState` inside every `useViewportSize()`. */
function rotate(viewport: TestViewport): void {
  act(() => {
    setTestViewport(viewport)
  })
}

function grid(root: HTMLElement): HTMLElement | null {
  return root.querySelector(`[data-testid="${WORKSPACE_GRID_TEST_ID}"]`)
}

function wallSurface(root: HTMLElement): Element | null {
  return grid(root)?.querySelector('[data-testid="stub-WebView"]') ?? null
}

function webViews(root: HTMLElement): readonly Element[] {
  return [...root.querySelectorAll('[data-testid="stub-WebView"]')]
}

/**
 * The height the wall's BOX was drawn at, in px.
 *
 * The box is the wall's parent — the one element `wallBoxStyle` styles — and
 * the height is readable because it is a DYNAMIC value: `react-native-web`
 * hoists static `StyleSheet` entries into class names jsdom cannot interpret,
 * but writes computed numbers inline. That is the whole reason the portrait
 * split can be asserted here at all and not only in `wall-box.spec.ts`.
 */
function wallBoxHeight(root: HTMLElement): number | null {
  const box = grid(root)?.parentElement ?? null
  // Anchored on a declaration boundary: `min-height: 0px` is what `fill`
  // writes, and an unanchored `height:` matches the tail of it — which read as
  // "the landscape wall is 0pt tall" and would have made the negative case
  // below pass for the wrong reason.
  const px = /(?:^|;)\s*height:\s*([0-9.]+)px/.exec(box?.getAttribute('style') ?? '')
  return px === null ? null : Number(px[1])
}

/** Which shape the timeline RESOLVED to — the whole layout decision of the
 *  screen, and otherwise invisible to a test (`detailShapeTestId`). */
function shape(root: HTMLElement): 'fill' | 'wide' | 'stack' | null {
  for (const s of ['fill', 'wide', 'stack'] as const) {
    if (root.querySelector(`[data-testid="${detailShapeTestId(s)}"]`) !== null) return s
  }
  return null
}

/**
 * Every document a wall has BOOTED, newest last. A fresh document is a fresh
 * peer set; a change a live page can take travels as `setDevices` instead.
 *
 * The count is read as a DELTA around the act under test, never as an absolute.
 * Opening a wall legitimately boots twice — the first document is built before
 * the camera query has answered, so it carries no devices, and the page has not
 * yet said it can take a set hot, which is the one case `GridLiveEmbed` still
 * reloads for. That is the cost of opening a view; a rotation must add nothing
 * to it.
 */
function wallBoots(): readonly string[] {
  return bootedWebViewConfigs().filter((c) => c.includes('__CAMSTACK_GRID__'))
}

/** The wall, settled: booted with the cameras it is meant to draw, and having
 *  told the host it can take a device set without reloading. */
async function settledWall(root: HTMLElement, devices: string): Promise<void> {
  await waitFor(() => expect(wallSurface(root)).not.toBeNull())
  await waitFor(() => {
    const booted = wallBoots()
    expect(booted[booted.length - 1] ?? '').toContain(devices)
  })
  reportReady()
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

/** What a current embed build reports once booted. Until it arrives the host
 *  deliberately reloads the document on a device-set change. */
function reportReady(): void {
  act(() => {
    emitWebViewMessage({ type: 'state', state: 'ready', commands: ['setDevices', 'setSpans'] })
  })
}

describe('a phone in LANDSCAPE: confirming a selection BUILDS the view', () => {
  it('the wall goes up with both cameras, and the router is never asked', async () => {
    const root = await openTheater(IPHONE_LANDSCAPE)
    expect(shape(root)).toBe('fill')
    expect(grid(root)).toBeNull()
    await selectCameras(root, ['Garden', 'Garage'])
    resetRouterStub()

    act(() => {
      fireEvent.click(confirm(root))
    })

    // The view was written, not navigated to. Both halves matter: `openGrid`
    // would also have put two cameras on a screen — a different one.
    expect(members()).toEqual([5, 9])
    expect(routerCalls()).toEqual([])
    expect(grid(root)).not.toBeNull()
  })

  it('and that wall booted with BOTH selected cameras, the route camera first', async () => {
    const root = await openTheater(IPHONE_LANDSCAPE)
    await selectCameras(root, ['Garden', 'Garage'])

    act(() => {
      fireEvent.click(confirm(root))
    })

    await waitFor(() => expect(wallBoots().length).toBeGreaterThan(0))
    const booted = wallBoots()
    // 1 is the camera the screen is routed to and leads the wall as the
    // primary; 5 and 9 are the selection, in list order.
    expect(booted[booted.length - 1]).toContain('"devices":[1,5,9]')
  })

  it('one surface in the tree, and it is the wall — the picture is a cell', async () => {
    const root = await openTheater(IPHONE_LANDSCAPE)
    await waitFor(() => expect(webViews(root)).toHaveLength(1))
    await selectCameras(root, ['Garden', 'Garage'])

    act(() => {
      fireEvent.click(confirm(root))
    })

    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
    expect(webViews(root)).toHaveLength(1)
    expect(webViews(root)[0]).toBe(wallSurface(root))
  })

  it('the TIMELINE is still reachable — its only opener lived on the picture', async () => {
    // The failure this catches is total: in `fill` the timeline rides the
    // compact edge drawer and the drawer's only trigger is a disc inside
    // `StreamOverlayControls`, which is inside the picture the wall replaced.
    // Without a disc beside the wall, building a view in landscape would take
    // the timeline, the camera selector and the way back in one commit.
    const root = await openTheater(IPHONE_LANDSCAPE, { members: [5], primaryId: 5 })
    expect(grid(root)).not.toBeNull()
    const toggles = root.querySelectorAll(
      '[aria-label="Timeline hidden. Press to show it over the video"], [aria-label="Timeline over the video. Press to put it beside the stream"], [aria-label="Timeline beside the stream. Press to hide it"]',
    )
    expect(toggles).toHaveLength(1)
  })
})

describe('a phone in PORTRAIT: the same confirm still ROUTES', () => {
  it('pushes /grid/adhoc, writes no view, and puts up no wall', async () => {
    const root = await openTheater(IPHONE_PORTRAIT)
    expect(shape(root)).toBe('stack')
    await selectCameras(root, ['Garden', 'Garage'])

    act(() => {
      fireEvent.click(confirm(root))
    })

    expect(routerCalls()).toEqual([{ kind: 'push', target: '/grid/adhoc?devices=5,9' }])
    expect(members()).toEqual([])
    // The half that is new: portrait CAN draw a wall, so "no view was written"
    // and "no wall went up" are two claims now, and this is the second.
    expect(grid(root)).toBeNull()
  })
})

describe('portrait HONOURS a view that already exists', () => {
  it('a wall built in landscape survives the rotation, with the timeline below it', async () => {
    const root = await openTheater(IPHONE_LANDSCAPE, { members: [5, 9], primaryId: 5 })
    expect(shape(root)).toBe('fill')
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())

    rotate(IPHONE_PORTRAIT)

    // The portrait column, with the wall in the picture's box…
    expect(shape(root)).toBe('stack')
    expect(grid(root)).not.toBeNull()
    // …and the timeline drawn under it rather than hidden behind a drawer.
    expect(
      root.querySelector(`[data-testid="${TIMELINE_CHROME_TEST_ID.shown}"]`),
    ).not.toBeNull()
    // Still no reel: that is the reel's own predicate and it never moved.
    expect(root.querySelector(`[data-testid="${SHELF_VARIANT_TEST_ID.strip}"]`)).toBeNull()
    expect(root.querySelector(`[data-testid="${SHELF_VARIANT_TEST_ID.rows}"]`)).toBeNull()
  })

  it('and rotating BACK keeps it too — the honouring is not one-way', async () => {
    const root = await openTheater(IPHONE_PORTRAIT, { members: [5, 9], primaryId: 5 })
    expect(grid(root)).not.toBeNull()

    rotate(IPHONE_LANDSCAPE)

    expect(shape(root)).toBe('fill')
    expect(grid(root)).not.toBeNull()
  })

  it('removing the last member is still the close, in portrait as on the tablet', async () => {
    // No new close affordance was invented for the phone. The wall's own X and
    // the per-cell remove are the two that exist, and the last cell out walks
    // the layout back to the single picture.
    const root = await openTheater(IPHONE_PORTRAIT, { members: [5], primaryId: 5 })
    expect(grid(root)).not.toBeNull()

    act(() => {
      useWorkspaceStore.getState().remove(5)
    })

    expect(grid(root)).toBeNull()
    await waitFor(() => expect(webViews(root)).toHaveLength(1))
    expect(wallSurface(root)).toBeNull()
  })
})

describe('the rotation does NOT re-create the embed', () => {
  /**
   * The constraint the whole design is held to. `fill` and `stack` are
   * different boxes, and the wall is ONE `WKWebView` holding N peers — a
   * re-parent or a re-key would renegotiate every camera on every turn of the
   * device. It does not, because `TheaterTimeline` holds one stream slot at
   * index 1 of its column in every shape and the shape is expressed as a STYLE
   * on the same element (`wall-box.ts`).
   */
  it('the wall keeps its DOM node across the rotation', async () => {
    const root = await openTheater(IPHONE_LANDSCAPE, { members: [5, 9], primaryId: 5 })
    await settledWall(root, '"devices":[1,5,9]')
    const before = wallSurface(root)

    rotate(IPHONE_PORTRAIT)

    // Identity, not presence: a remount also leaves exactly one wall here, and
    // it costs every camera on it its `<video>` and its peer.
    expect(wallSurface(root)).toBe(before)
  })

  it('and boots no further document — the wall was restyled, not reloaded', async () => {
    const root = await openTheater(IPHONE_LANDSCAPE, { members: [5, 9], primaryId: 5 })
    await settledWall(root, '"devices":[1,5,9]')
    const bootsBefore = wallBoots().length
    const commandsBefore = injectedWebViewScripts().length

    rotate(IPHONE_PORTRAIT)
    rotate(IPHONE_LANDSCAPE)
    rotate(IPHONE_PORTRAIT)

    // A fresh page announces itself by BOOTING with an injected config; a live
    // page that merely learned something takes a COMMAND. Three rotations add
    // no document at all, and no `setDevices` either — the box moved, the
    // cameras did not.
    expect(wallBoots()).toHaveLength(bootsBefore)
    expect(
      injectedWebViewScripts()
        .slice(commandsBefore)
        .filter((s) => s.includes('setDevices')),
    ).toHaveLength(0)
  })

  it('the node survives a rotation that happens while a camera is added', async () => {
    // The two motions this feature can put together. Adding pushes `setDevices`
    // and rotating restyles the box; neither is a remount, and doing both is
    // still not one.
    const root = await openTheater(IPHONE_LANDSCAPE, { members: [5, 9], primaryId: 5 })
    await settledWall(root, '"devices":[1,5,9]')
    const before = wallSurface(root)
    const bootsBefore = wallBoots().length

    rotate(IPHONE_PORTRAIT)
    act(() => {
      useWorkspaceStore.getState().add(12)
    })

    expect(wallSurface(root)).toBe(before)
    expect(wallBoots()).toHaveLength(bootsBefore)
    const sent = injectedWebViewScripts().filter((s) => s.includes('setDevices'))
    expect(sent[sent.length - 1]).toContain('[1,5,9,12]')
  })
})

describe('in PORTRAIT the wall takes half the timeline', () => {
  /**
   * The operator's call: "in portrait intendo". Several live cameras inside a
   * 16:9 letterbox are postage stamps, and the timeline below is one scroller
   * whose usefulness does not halve with its height — so with a wall up the
   * timeline keeps half of what it had and the wall takes the rest.
   *
   * The timeline is not measured here and does not need to be: in `stack` the
   * timeline body is the `flex: 1` sibling AFTER the stream slot
   * (`TheaterTimeline`), so every point the slot takes is a point it loses. The
   * slot's height is the number under test, and it is the one the screen
   * actually drew.
   */
  const COLUMN = { columnHeight: IPHONE_PORTRAIT.height, topInset: TEST_INSETS.top }
  /** The picture's portrait box — 16:9 of the window width, as it ships. */
  const PICTURE = (IPHONE_PORTRAIT.width * 9) / 16
  const single = resolvePortraitColumnSplit({
    ...COLUMN,
    pictureHeight: PICTURE,
    wallShowing: false,
  })
  const withWall = resolvePortraitColumnSplit({
    ...COLUMN,
    pictureHeight: PICTURE,
    wallShowing: true,
  })

  it('the wall is drawn at the split height, not at the picture\'s', async () => {
    const root = await openTheater(IPHONE_PORTRAIT, { members: [5], primaryId: 5 })
    expect(shape(root)).toBe('stack')
    expect(wallBoxHeight(root)).toBe(withWall.streamHeight)
    // And it is BIGGER than the picture it replaced — the point of the change.
    expect(withWall.streamHeight).toBeGreaterThan(PICTURE)
  })

  it('the timeline it left behind is exactly half of the one-camera timeline', async () => {
    const root = await openTheater(IPHONE_PORTRAIT, { members: [5], primaryId: 5 })
    const drawn = wallBoxHeight(root)
    expect(drawn).not.toBeNull()
    // Read back off the DRAWN box rather than off the model: what is left below
    // the slot is the column, less the inset the screen pads by, less this.
    const timelineDrawn = IPHONE_PORTRAIT.height - TEST_INSETS.top - (drawn ?? 0)
    expect(timelineDrawn).toBe(single.timelineHeight / 2)
    // …and the wall gained precisely that.
    expect((drawn ?? 0) - PICTURE).toBe(single.timelineHeight - timelineDrawn)
  })

  it('one camera in portrait is untouched — no box of ours is drawn at all', async () => {
    const root = await openTheater(IPHONE_PORTRAIT)
    expect(grid(root)).toBeNull()
    expect(wallBoxHeight(root)).toBeNull()
  })

  it('and the halving does not follow the wall into LANDSCAPE', async () => {
    // `fill` has no timeline in flow — it rides the edge drawer — so there is
    // nothing to halve and the wall simply takes the window. A height here
    // would mean the portrait split had leaked into a shape that never asked.
    const root = await openTheater(IPHONE_LANDSCAPE, { members: [5], primaryId: 5 })
    expect(shape(root)).toBe('fill')
    expect(grid(root)).not.toBeNull()
    expect(wallBoxHeight(root)).toBeNull()
  })
})

describe('the way OUT of a wall on a phone in landscape', () => {
  /**
   * In `fill` the toolbar — and the only back button — lives inside the edge
   * drawer, and the swipe that served here belongs to the picture's gesture
   * stage, which the wall replaced: the WebView owns its own touches, so the
   * gesture is gone while the wall is up. Leaving it at that made the way out
   * two taps behind a drawer where a moment earlier it was one gesture.
   *
   * Asserted through the ROUTER rather than the disc's presence: a button that
   * renders and navigates nowhere is the failure this repo keeps hitting, and
   * it would pass a query for the label.
   */
  it('one press on the back disc leaves the screen', async () => {
    const root = await openTheater(IPHONE_LANDSCAPE, { members: [5], primaryId: 5 })
    resetRouterStub()

    // Scoped to the WALL's own subtree. The drawer's toolbar carries a back
    // button of its own, so a tree-wide query is green whether this disc
    // exists or not — which is exactly what the first draft of this test did.
    const back = await waitFor(() => {
      const stage = root.querySelector(`[data-testid="${WALL_STAGE_TEST_ID}"]`)
      const el = stage?.querySelector('[aria-label="Back"]')
      if (!(el instanceof HTMLElement)) throw new Error('no back disc on the wall')
      return el
    })
    act(() => {
      fireEvent.click(back)
    })

    expect(routerCalls().length).toBeGreaterThan(0)
  })
})

