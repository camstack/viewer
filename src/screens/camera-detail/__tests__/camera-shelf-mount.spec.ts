/**
 * @vitest-environment jsdom
 *
 * The shelf in the real tree: it appears only above the threshold, `goTo`
 * navigates to the right camera, and `add to view` writes the intent and does
 * NOT navigate.
 *
 * The last one is the claim that cannot be made anywhere else. "Add to view"
 * renders nothing today — the wall is a later phase — so the ONLY observable
 * effect is the store write plus the absence of a navigation. A source guard
 * would prove neither.
 *
 * Needs `viewport-control.ts`: jsdom reports 0 for the window and the screen,
 * and every viewport rule reads 0 as degenerate and falls back to the stack —
 * where this feature correctly does not exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import {
  setTestViewport,
  IPAD_LANDSCAPE,
  IPAD_PORTRAIT,
  IPHONE_LANDSCAPE,
} from '../../../testing/viewport-control.js'
import { routerCalls, resetRouterStub } from '../../../testing/native-stubs/expo-router.js'
import { useWorkspaceStore } from '../../../store/workspace-store.js'
import { EMPTY_WORKSPACE } from '../../../store/workspace.js'
import { CameraDetailScreen } from '../../CameraDetailScreen.js'
import {
  CAMERA_SHELF_PENDING_TEST_ID,
  CAMERA_SHELF_TEST_ID,
  REEL_HIGHLIGHT_BUTTON_TEST_ID,
} from '../CameraShelf.js'
import { useOnDemandPlayerStore } from '../../../store/ondemand-player-store.js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { cameraListCacheKey } from '../../../data/camera-list-cache.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

/** Three cameras, so the shelf has something to list for device 1. The shape is
 *  what `deviceManager.listAll` returns for `projection: 'slim'`. */
const CAMERAS = [
  { id: 1, name: 'Front door', isCamera: true, online: true },
  { id: 5, name: 'Garden', isCamera: true, online: true },
  { id: 9, name: 'Garage', isCamera: true, online: false },
]

const HUB = { 'deviceManager.listAll': CAMERAS }

/** What `connection-stub.tsx` reports as the configured hub — the key the
 *  warm camera-list cache is scoped to. */
const STUB_HUB_URL = 'http://hub.test:8080'

beforeEach(() => {
  useWorkspaceStore.setState({ workspace: EMPTY_WORKSPACE })
  setTestPlatform('ios')
})

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
  useWorkspaceStore.setState({ workspace: EMPTY_WORKSPACE })
})

function openTheater(): HTMLElement {
  return mountScreen(React.createElement(CameraDetailScreen, { deviceId: 1 }), { hub: HUB })
    .container
}

function shelf(root: HTMLElement): HTMLElement | null {
  return root.querySelector(`[data-testid="${CAMERA_SHELF_TEST_ID}"]`)
}

/**
 * The reel, once the camera query has ANSWERED.
 *
 * `openTheater` + one `act` flush is not enough: the reel renders `null` until
 * `useCameras` resolves, so every positive assertion below was racing a promise
 * and went red under parallel directory runs while passing in isolation. The
 * absence specs are not affected and deliberately do not use this — the shelf's
 * gate there is the LAYOUT MODE, which is decided synchronously and never
 * becomes true later, so "not yet" and "never" cannot be confused.
 */
async function settledShelf(root: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    const host = shelf(root)
    if (host === null) throw new Error('the reel has not rendered yet')
    if (host.querySelectorAll('[aria-label="Add to view"]').length === 0) {
      throw new Error('the reel rendered, but the camera query has not answered')
    }
    return host
  })
}

/** Every control the shelf drew, by its accessibility label. */
function labelled(root: HTMLElement, label: string): readonly HTMLElement[] {
  const host = shelf(root)
  if (host === null) return []
  return [...host.querySelectorAll(`[aria-label="${label}"]`)].filter(
    (n): n is HTMLElement => n instanceof HTMLElement,
  )
}

describe('the threshold, at the mount', () => {
  it('an iPad in landscape gets the shelf', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()
    await settledShelf(root)
    expect(shelf(root)).not.toBeNull()
  })

  it('the same iPad in portrait does not — the timeline has that space', async () => {
    setTestViewport(IPAD_PORTRAIT)
    const root = openTheater()
    await act(async () => undefined)
    expect(shelf(root)).toBeNull()
  })

  it('a phone in landscape does not, in any state: nothing changes for it', async () => {
    setTestViewport(IPHONE_LANDSCAPE)
    const root = openTheater()
    await act(async () => undefined)
    expect(shelf(root)).toBeNull()
  })
})

/** The reserved band, while the camera list is still on the wire. */
function pendingBand(root: HTMLElement): HTMLElement | null {
  return root.querySelector(`[data-testid="${CAMERA_SHELF_PENDING_TEST_ID}"]`)
}

describe('pending is not empty (D315)', () => {
  /**
   * A COLD start, with nothing painted from the last one.
   *
   * `use-cameras` hydrates the query from a per-hub AsyncStorage copy of the
   * last list it saw, and the stub storage is one map for the whole file — so
   * by the time these specs run, the tests above have already written
   * `hub.test:8080`'s three cameras into it and the query is never pending at
   * all. That warm path is real and is exactly why the operator sees no
   * transition on a warm app; it is simply not the state under test here.
   */
  beforeEach(async () => {
    await AsyncStorage.removeItem(cameraListCacheKey(STUB_HUB_URL))
  })

  /**
   * A deferred `deviceManager.listAll`: the query stays PENDING until the test
   * answers it. Without it "the list has not arrived" lasts one microtask and
   * cannot be asserted on — which is precisely how the shelf shipped for a
   * month claiming "this install has one camera" on every cold start.
   */
  function deferredHub(): {
    readonly hub: Record<string, () => Promise<unknown>>
    readonly answer: (cameras: readonly unknown[]) => void
  } {
    let resolve: (cameras: readonly unknown[]) => void = () => undefined
    const pending = new Promise<readonly unknown[]>((r) => {
      resolve = r
    })
    return {
      hub: { 'deviceManager.listAll': () => pending },
      answer: (cameras) => resolve(cameras),
    }
  }

  it('reserves the band, and says it is LOADING rather than showing nothing', async () => {
    const { hub } = deferredHub()
    setTestViewport(IPAD_LANDSCAPE)
    const { container: root } = mountScreen(
      React.createElement(CameraDetailScreen, { deviceId: 1 }),
      { hub },
    )
    await act(async () => undefined)

    // The space is held from the first frame, so nothing below it moves when
    // the cards land.
    expect(shelf(root)).not.toBeNull()
    expect(pendingBand(root)).not.toBeNull()
    // It does not claim a COUNT: no card is drawn, and neither scroller —
    // the variant markers belong to a reel that has cameras to list.
    expect(labelled(root, 'Go to this camera')).toHaveLength(0)
    // And it is not silent to a screen reader.
    expect(root.querySelector('[aria-label="Loading the other cameras"]')).not.toBeNull()
  })

  it('collapses when the list FAILS, rather than spinning at the operator forever', async () => {
    /**
     * Added 2026-09-24: deleting the `status === 'error'` branch left this
     * whole file green. The band would then have been shown for a query that
     * is never going to answer — a spinner that lies in the opposite
     * direction from the bug it was built to fix.
     *
     * Collapsing is the lesser wrong and it is deliberate: a hub this screen
     * cannot reach announces itself in the connection chrome, so the reel
     * does not need to re-say it. What it must NOT do is imply that an answer
     * is still coming. The residual is honest and recorded: on an error the
     * band reads the same as a single-camera install — the ambiguity this
     * change removes from the PENDING path survives on the error path, and
     * closing it needs an affordance nobody has asked for.
     */
    const hub = {
      'deviceManager.listAll': (): Promise<unknown> =>
        Promise.reject(new Error('the hub refused the camera list')),
    }
    setTestViewport(IPAD_LANDSCAPE)
    const { container: root } = mountScreen(
      React.createElement(CameraDetailScreen, { deviceId: 1 }),
      { hub },
    )
    await waitFor(() => {
      expect(pendingBand(root)).toBeNull()
    })
    expect(shelf(root)).toBeNull()
  })

  it('fills in place when the cameras land — the band does not appear twice', async () => {
    const { hub, answer } = deferredHub()
    setTestViewport(IPAD_LANDSCAPE)
    const { container: root } = mountScreen(
      React.createElement(CameraDetailScreen, { deviceId: 1 }),
      { hub },
    )
    await act(async () => undefined)
    expect(pendingBand(root)).not.toBeNull()

    await act(async () => {
      answer(CAMERAS)
    })

    await waitFor(() => expect(pendingBand(root)).toBeNull())
    expect(labelled(root, 'Go to this camera')).toHaveLength(2)
    expect(shelf(root)).not.toBeNull()
  })

  it('collapses ONCE, and only once the answer really says one camera', async () => {
    // The consequence the operator accepted: a single-camera install loses the
    // band — but at the moment it is saying something TRUE, instead of
    // asserting it from the first frame.
    const { hub, answer } = deferredHub()
    setTestViewport(IPAD_LANDSCAPE)
    const { container: root } = mountScreen(
      React.createElement(CameraDetailScreen, { deviceId: 1 }),
      { hub },
    )
    await act(async () => undefined)
    expect(pendingBand(root)).not.toBeNull()

    await act(async () => {
      answer([{ id: 1, name: 'Front door', isCamera: true, online: true }])
    })

    await waitFor(() => expect(shelf(root)).toBeNull())
    expect(pendingBand(root)).toBeNull()
  })
})

describe('the two buttons on a snapshot', () => {
  it('lists the OTHER cameras, one card each', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()
    await settledShelf(root)
    expect(labelled(root, 'Go to this camera')).toHaveLength(2)
    expect(labelled(root, 'Add to view')).toHaveLength(2)
  })

  /**
   * The swap carries the moment the screen is showing (D483) — and this is the
   * LIVE direction of it, where the target must carry NO `?at=`.
   *
   * That absence is the assertion, not an incidental. An `?at=<now>` here would
   * open camera 5 in recorded playback a fraction of a second behind the live
   * edge: a feeder, a seek, and a picture that never catches up, for a gesture
   * the operator reads as "show me this camera".
   *
   * The PLAYBACK direction is proved by value in
   * `src/recording/__tests__/viewed-instant.spec.ts` (`atParam` /
   * `viewedInstant`, both directions plus epoch 0), and deliberately NOT here:
   * this screen's machine only leaves `live` once the EMBED reports a state,
   * and the embed is a stub under jsdom — a mount test that pretended to assert
   * it would be asserting the stub's behaviour, not the screen's. What this
   * test uniquely proves is the WIRING: that the press reaches
   * `onSwitchCamera`, with `replace` (so back still returns to the list) and
   * with the machine's own instant rather than a literal.
   */
  it('`goTo` swaps to that camera — live, so no instant rides along', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()
    await settledShelf(root)
    resetRouterStub()

    const first = labelled(root, 'Go to this camera')[0]
    expect(first).toBeDefined()
    act(() => {
      fireEvent.click(first)
    })

    expect(routerCalls()).toEqual([{ kind: 'replace', target: '/camera/5' }])
  })

  it('`add to view` writes the intent and does NOT navigate', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()
    await settledShelf(root)
    resetRouterStub()

    const add = labelled(root, 'Add to view')[0]
    expect(add).toBeDefined()
    act(() => {
      fireEvent.click(add)
    })

    expect(useWorkspaceStore.getState().workspace.members).toEqual([5])
    expect(useWorkspaceStore.getState().workspace.primaryId).toBe(5)
    expect(routerCalls()).toEqual([])
  })

  it('a camera already in the view LEAVES the reel — it is a cell now', async () => {
    // It used to stay, greyed out. One added camera now starts the wall
    // (`workspace-grid.ts`), and the wall's cameras are dropped from the reel
    // by the same rule that drops the picture — so the card is not disabled,
    // it is gone, and what remains is exactly the cameras that are not on
    // screen. The wall half of this is `workspace-grid-mount.spec.ts`.
    useWorkspaceStore.setState({ workspace: { ...EMPTY_WORKSPACE, members: [5], primaryId: 5 } })
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()
    await settledShelf(root)

    const adds = labelled(root, 'Add to view')
    expect(adds).toHaveLength(1)
    expect(adds[0]?.getAttribute('aria-disabled')).not.toBe('true')
  })
})

describe('the extracted bar reaches the shelf', () => {
  it('draws the shared bar — and the ONE control the reel does not carry', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()
    await settledShelf(root)
    // The set is pinned by value in `grid/__tests__/camera-action-bar.spec.ts`;
    // this only proves the shelf is rendering THAT bar rather than a copy.
    expect(labelled(root, 'Linked devices').length).toBeGreaterThan(0)
    // `viewOptions` left the reel on 2026-09-12 (D483): it configures overlays
    // drawn on a LIVE picture, and a reel card is a snapshot thumbnail. The
    // wall keeps it. Asserted as an absence here, and not only as a value in
    // the pure spec, because the failure mode is a mount that quietly falls
    // back to the wall's item list.
    expect(labelled(root, 'View options')).toHaveLength(0)
  })

  /**
   * The test that proves the on-demand overlay's mount point (D483).
   *
   * The overlay is a sibling of `<Stack>` in `app/(app)/_layout.tsx`, not a
   * child of this screen, so swapping the camera under it must not touch it —
   * it keeps playing ITS camera at ITS instant. Before the swap went in place
   * the screen remounted on every camera change, and an overlay mounted inside
   * it would have gone with it.
   *
   * What this observes: the reel tap really runs the swap path, and the open
   * request is byte-identical afterwards — a different camera and a different
   * instant from the one being swapped to, so a leak in either direction would
   * show. It does not observe the mounted overlay component itself (that is a
   * layout-route property, still unverified at runtime and flagged in the ADR).
   */
  it('leaves the on-demand overlay alone when the reel swaps the camera', async () => {
    const OVERLAY = { deviceId: 99, atMs: 1_700_000_000_000 }
    useOnDemandPlayerStore.setState({ request: OVERLAY })
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()
    await settledShelf(root)
    resetRouterStub()

    const first = labelled(root, 'Go to this camera')[0]
    expect(first).toBeDefined()
    act(() => {
      fireEvent.click(first)
    })

    // The swap happened...
    expect(routerCalls()).toEqual([{ kind: 'replace', target: '/camera/5' }])
    // ...and the overlay is untouched: still camera 99, still its own instant.
    expect(useOnDemandPlayerStore.getState().request).toEqual(OVERLAY)
    useOnDemandPlayerStore.setState({ request: null })
  })

  it('carries the reel-level highlight editor, and only ONE of it', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()
    await settledShelf(root)
    // ONE control for the whole reel, not one per card: the highlight is
    // grid-scoped ("settings comuni su quella griglia"), so a per-card copy
    // would offer N editors of the same object. It is an absolute overlay
    // rather than a header row because the reel's heading was deliberately
    // removed for its 22pt (2026-09-05) — see `CameraShelf`.
    const buttons = root.querySelectorAll(
      `[data-testid="${REEL_HIGHLIGHT_BUTTON_TEST_ID}"]`,
    )
    expect(buttons).toHaveLength(1)
  })

  it('offers the on-demand player on every card', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = openTheater()
    await settledShelf(root)
    // D483's reel entry point. Present ALONGSIDE the add, never instead of it:
    // the add shows the camera live on the wall, this opens it at the instant
    // the screen is already showing.
    expect(labelled(root, 'Open in the on-demand player').length).toBeGreaterThan(0)
    expect(labelled(root, 'Add to view').length).toBeGreaterThan(0)
  })
})
