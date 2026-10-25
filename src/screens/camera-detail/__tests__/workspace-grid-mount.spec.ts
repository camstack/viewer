/**
 * @vitest-environment jsdom
 *
 * The wall in the real tree: when it REPLACES the picture, what the snapshots
 * become, and the one claim that actually matters — that filling the view does
 * not restart the cameras already in it.
 *
 * ## The picture is a cell (2026-09-02)
 *
 * The wall used to be drawn under a picture that stayed its own `<LiveView>`.
 * The operator asked for the other design and accepted its cost — "Non fa
 * niente se riconnette" — so the single→wall step is now a REPLACEMENT: the
 * player is unmounted and every camera, the route camera first, is a cell.
 * That is why the strongest claims below count the WebViews in the whole tree
 * rather than looking inside the wall: two would mean the picture was still
 * playing beside its own cell, which is two peers for one camera.
 *
 * ## Why the no-remount gate is asserted on DOM node IDENTITY
 *
 * Adding a camera is worth doing only if the ones already on the wall keep
 * playing. A remount also leaves exactly one wall on screen, so counting
 * surfaces cannot tell the two apart; `toBe` on the node can. The wall is one
 * `WKWebView` (`GridLiveEmbed`) whose page holds every tile as a keyed sibling
 * of a single parent (`GridWallSurface`), so a preserved host node is a
 * preserved `<video>` and a preserved peer.
 *
 * The page has to say it can take a device set hot before the host will push
 * one — otherwise the host reloads the document on purpose, for a build too old
 * to have the command. So these specs report ready the way a current embed
 * build does, which is also what an iPad on the shipped bundle does.
 *
 * Needs `viewport-control.ts`: jsdom reports 0 for the window and the screen,
 * and every viewport rule reads 0 as degenerate and falls back to the stack.
 * A spec that skipped it would be asserting about a 0x0 window rather than
 * about the surface it names — and since 2026-09-02 `stack` draws a wall too,
 * an unset viewport would even look like a pass.
 *
 * The PHONE's own half — building a view in landscape, refusing to in portrait,
 * and surviving the rotation between them — is `phone-wall-mount.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import {
  setTestViewport,
  IPAD_LANDSCAPE,
  IPHONE_LANDSCAPE,
} from '../../../testing/viewport-control.js'
import {
  bootedWebViewConfigs,
  emitWebViewMessage,
  injectedWebViewScripts,
  resetWebViewStub,
} from '../../../testing/webview-control.js'
import { useWorkspaceStore } from '../../../store/workspace-store.js'
import { EMPTY_WORKSPACE, type WorkspaceState } from '../../../store/workspace.js'
import { CameraDetailScreen } from '../../CameraDetailScreen.js'
import { CAMERA_SHELF_TEST_ID, SHELF_VARIANT_TEST_ID } from '../CameraShelf.js'
import { WORKSPACE_GRID_TEST_ID } from '../WorkspaceGrid.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

/** Five cameras: one in the picture, room for a wall of three and a strip that
 *  still has something left to list. */
const CAMERAS = [
  { id: 1, name: 'Front door', isCamera: true, online: true },
  { id: 5, name: 'Garden', isCamera: true, online: true },
  { id: 9, name: 'Garage', isCamera: true, online: true },
  { id: 12, name: 'Retro', isCamera: true, online: true },
  { id: 20, name: 'Cancello', isCamera: true, online: true },
]

const HUB = { 'deviceManager.listAll': CAMERAS }

beforeEach(() => {
  useWorkspaceStore.setState({ workspace: EMPTY_WORKSPACE })
  resetWebViewStub()
  setTestPlatform('ios')
})

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
  useWorkspaceStore.setState({ workspace: EMPTY_WORKSPACE })
})

/** A view, as the specs describe one. `cells` (the per-camera arrangement) is
 *  filled in from the empty workspace unless a spec is about it. */
async function openTheater(view: Partial<WorkspaceState>): Promise<HTMLElement> {
  useWorkspaceStore.setState({ workspace: { ...EMPTY_WORKSPACE, ...view } })
  const { container } = mountScreen(
    React.createElement(CameraDetailScreen, { deviceId: 1 }),
    { hub: HUB },
  )
  await act(async () => undefined)
  return container
}

function grid(root: HTMLElement): HTMLElement | null {
  return root.querySelector(`[data-testid="${WORKSPACE_GRID_TEST_ID}"]`)
}

/** The wall's own surface — scoped INSIDE the wall. With the wall up it is the
 *  only WebView in the tree; scoping keeps that a CLAIM (see `webViews`) rather
 *  than an assumption baked into the lookup. */
function wallSurface(root: HTMLElement): Element | null {
  return grid(root)?.querySelector('[data-testid="stub-WebView"]') ?? null
}

/** Every embedded surface in the tree — the wall's page, and the single
 *  picture's player. On iOS both are `WKWebView`s, which is exactly why the
 *  count is the thing to assert: one camera drawn twice is two peers. */
function webViews(root: HTMLElement): readonly Element[] {
  return [...root.querySelectorAll('[data-testid="stub-WebView"]')]
}

/** The device list a FRESHLY BOOTED wall was given. The set travels in the
 *  injected config on the first document, not as a `setDevices` command, so a
 *  spec that only watched the command channel could not see the wall the
 *  operator actually got. Filtered on the grid marker: the single picture's
 *  player boots a config of its own on the same channel. */
function bootedWallDevices(): readonly string[] {
  return bootedWebViewConfigs().filter((c) => c.includes('__CAMSTACK_GRID__'))
}

function shelfVariant(root: HTMLElement): 'rows' | 'strip' | null {
  if (root.querySelector(`[data-testid="${SHELF_VARIANT_TEST_ID.strip}"]`) !== null) return 'strip'
  if (root.querySelector(`[data-testid="${SHELF_VARIANT_TEST_ID.rows}"]`) !== null) return 'rows'
  return null
}

/**
 * The reel's variant ONCE THE CAMERA LIST HAS ARRIVED — never a bare read
 * after a fixed number of `act()` flushes.
 *
 * `CameraShelf` lists no CARD while `useCameras()` is still pending — since
 * 2026-09-24 it holds a reserved band instead of vanishing, but the band
 * carries neither variant marker, because there is no variant to report until
 * there is something to scroll. So `shelfVariant` still reads `null` both for
 * "not yet" and for "none", and a spec that read it straight after
 * `openTheater` was asserting on whether ONE microtask flush happened to be
 * enough. (What distinguishes the two is `CAMERA_SHELF_PENDING_TEST_ID`; see
 * `cameraListOnScreen` for the absence half.)
 *
 * It was not. These two specs passed alone and in the full suite for weeks,
 * then went red in the full suite only — under 571 files of load, and only
 * after an unrelated deletion elsewhere in `src/` reshuffled the scheduling.
 * Removing the `await act()` from `openTheater` reproduces it on demand: these
 * two fail with the same `expected null to be 'rows'`, and every other spec in
 * this file survives, because they all reach the reel through
 * {@link firstAddButton}'s `waitFor`. Same discipline, for the same reason.
 */
async function shelfVariantWhenListed(root: HTMLElement): Promise<'rows' | 'strip'> {
  await waitFor(() => {
    expect(shelfVariant(root)).not.toBeNull()
  })
  const variant = shelfVariant(root)
  if (variant === null) throw new Error('reel never listed a camera')
  return variant
}

/**
 * Wait until the camera list has ARRIVED and the tree has consumed it.
 *
 * The phone's claim is an ABSENCE — "there is no reel here" — and an absence
 * asserted while the query is still pending is not a claim at all: until
 * 2026-09-24 the reel rendered nothing while `useCameras()` was unanswered, so
 * both phone specs below were green against a shelf that simply had not
 * decided yet. They could not have failed for the right reason.
 *
 * The signal is the wall's own boot config. `WorkspaceGrid` resolves its tiles
 * from the same `useCameras()` query and boots the page with `devices: []`
 * until the list lands, so a non-empty `devices` means this tree — not some
 * other consumer, not a timer — has the cameras in hand. On a phone it is the
 * only such signal there is, because the reel is exactly what is missing.
 */
async function cameraListOnScreen(): Promise<void> {
  await waitFor(() => {
    expect(bootedWallDevices().some((c) => /"devices":\[\d/.test(c))).toBe(true)
  })
}

/** The reel's whole surface — the listed reel AND the band it reserves while
 *  the list is on the wire. The phone has neither. */
function shelfSurface(root: HTMLElement): Element | null {
  return root.querySelector(`[data-testid="${CAMERA_SHELF_TEST_ID}"]`)
}

function shelfCards(root: HTMLElement): readonly HTMLElement[] {
  const host = root.querySelector(`[data-testid="${CAMERA_SHELF_TEST_ID}"]`)
  if (host === null) return []
  return [...host.querySelectorAll('[aria-label="Go to this camera"]')].filter(
    (n): n is HTMLElement => n instanceof HTMLElement,
  )
}

/**
 * The first "add to view", once the camera list has ARRIVED.
 *
 * `waitFor`, never a count of `act()` flushes: the reel's cards come from a
 * query, and a spec that pressed after a fixed number of flushes would pass or
 * fail on scheduling. A press on `undefined` is the failure this file saw once.
 */
async function firstAddButton(root: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(addButtons(root).length).toBeGreaterThan(0))
  const add = addButtons(root)[0]
  if (add === undefined) throw new Error('no add-to-view control in the reel')
  return add
}

/** The reel's "add to view" controls, in card order. The interaction the whole
 *  feature is reached through — asserted by PRESSING it rather than by writing
 *  the store, so the path from the card to the wall is the thing under test. */
function addButtons(root: HTMLElement): readonly HTMLElement[] {
  const host = root.querySelector(`[data-testid="${CAMERA_SHELF_TEST_ID}"]`)
  if (host === null) return []
  return [...host.querySelectorAll('[aria-label="Add to view"]')].filter(
    (n): n is HTMLElement => n instanceof HTMLElement,
  )
}

/** What a current embed build reports once it has booted. Until this arrives
 *  the host deliberately reloads on a device-set change. */
function reportReady(): void {
  act(() => {
    emitWebViewMessage({
      type: 'state',
      state: 'ready',
      commands: ['setDevices', 'setSpans'],
    })
  })
}

describe('below the picture: today, until there is a view', () => {
  it('no members — the wrapping rows, and no wall', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater(EMPTY_WORKSPACE)
    expect(await shelfVariantWhenListed(root)).toBe('rows')
    expect(grid(root)).toBeNull()
  })

  it('the one member IS the picture: still one camera on screen, still no wall', async () => {
    // `goTo` on the only member. The wall would have no cell to draw, so the
    // gate must stay shut — this is the case that keeps "count the picture"
    // from degenerating into "any member at all".
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [1], primaryId: 1 })
    expect(await shelfVariantWhenListed(root)).toBe('rows')
    expect(grid(root)).toBeNull()
    expect(shelfCards(root)).toHaveLength(4)
  })
})

describe('ONE camera added from the reel starts the wall', () => {
  /**
   * The operator's report, end to end: they press "add to view" on a single
   * card and expect the view to start. It did not — the gate counted `members`,
   * and the reel can only ever list cameras that are NOT on screen, so the one
   * camera they added left the count at one while the timeline (same store,
   * `workspaceTimelineScope`, which DOES count the picture) went to two.
   *
   * Pressed rather than seeded, so the claim covers the whole path: the card's
   * button, `useWorkspaceStore.add`, the gate, and the surface.
   */
  it('pressing add on one card puts the wall up', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater(EMPTY_WORKSPACE)
    expect(grid(root)).toBeNull()

    const add = await firstAddButton(root)
    act(() => {
      fireEvent.click(add)
    })

    // One camera in the store, two on screen — the picture and the cell.
    expect(useWorkspaceStore.getState().workspace.members).toEqual([5])
    expect(grid(root)).not.toBeNull()
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
  })

  it('and the reel becomes the strip, minus the camera now on the wall', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater(EMPTY_WORKSPACE)

    const add = await firstAddButton(root)
    act(() => {
      fireEvent.click(add)
    })

    await waitFor(() => expect(shelfVariant(root)).toBe('strip'))
    // 1 is the primary cell, 5 is the second: 9, 12 and 20 remain.
    expect(shelfCards(root)).toHaveLength(3)
  })

  it('seeded the same way, from the store, it is the same wall', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5], primaryId: 5 })
    await waitFor(() => expect(grid(root)).not.toBeNull())
    expect(shelfVariant(root)).toBe('strip')
  })
})

describe('the wall REPLACES the picture, and it contains the picture', () => {
  /**
   * The operator's decision, end to end.
   *
   * Adding one camera used to leave two surfaces on screen: the route camera in
   * its own `<LiveView>` and a wall of one beneath it. It now leaves ONE, and
   * the route camera is a cell in it. Both halves are asserted, because either
   * alone is satisfiable by a bug: "the wall is up" is true of the old design
   * too, and "there is one WebView" is true of the old design before anything
   * was added.
   */
  it('one camera added: a single surface, and it is the wall', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater(EMPTY_WORKSPACE)

    // Before: the picture is playing, and it is NOT inside a wall.
    await waitFor(() => expect(webViews(root)).toHaveLength(1))
    expect(grid(root)).toBeNull()
    const pictureBefore = webViews(root)[0]

    const add = await firstAddButton(root)
    act(() => {
      fireEvent.click(add)
    })

    // After: still exactly one embedded surface — and it is the wall's.
    await waitFor(() => expect(grid(root)).not.toBeNull())
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
    expect(webViews(root)).toHaveLength(1)
    expect(webViews(root)[0]).toBe(wallSurface(root))
    // …and it is a NEW document. This is the renegotiation the operator
    // accepted; a spec that did not say so would let a later "optimisation"
    // quietly reuse the picture's peer for a wall it cannot draw.
    expect(webViews(root)[0]).not.toBe(pictureBefore)
  })

  it('and that wall booted with BOTH cameras, the route camera first', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater(EMPTY_WORKSPACE)

    const add = await firstAddButton(root)
    act(() => {
      fireEvent.click(add)
    })

    await waitFor(() => expect(bootedWallDevices().length).toBeGreaterThan(0))
    const booted = bootedWallDevices()
    // 1 is the camera the screen is routed to and 5 is the one just added. The
    // ORDER is the claim as much as the membership: the head is the primary,
    // the cell `resolvePrimaryWallSpan` enlarges.
    expect(booted[booted.length - 1]).toContain('"devices":[1,5]')
  })

  it('removing that camera gives the single picture back', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5], primaryId: 5 })
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
    expect(webViews(root)).toHaveLength(1)

    act(() => {
      useWorkspaceStore.getState().remove(5)
    })

    // One camera on screen is the theater again: no wall, and the one surface
    // left is the picture's player rather than a wall of one.
    expect(grid(root)).toBeNull()
    await waitFor(() => expect(webViews(root)).toHaveLength(1))
    expect(wallSurface(root)).toBeNull()
  })

  it('closing the whole view gives it back too, in one step', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9], primaryId: 5 })
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())

    act(() => {
      useWorkspaceStore.getState().clear()
    })

    expect(grid(root)).toBeNull()
    await waitFor(() => expect(webViews(root)).toHaveLength(1))
    expect(wallSurface(root)).toBeNull()
  })
})

describe('two members: the space becomes a wall, the snapshots become one row', () => {
  it('the wall appears', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9], primaryId: 5 })
    expect(grid(root)).not.toBeNull()
    expect(wallSurface(root)).not.toBeNull()
  })

  it('the shelf reduces to a single scrolling row', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9], primaryId: 5 })
    // `waitFor`, not a flush count: the reel renders NOTHING until the camera
    // query has answered (`others.length === 0` returns null), so a synchronous
    // read here passes or fails on scheduling.
    await waitFor(() => expect(shelfVariant(root)).toBe('strip'))
  })

  it('and it lists only what is NOT on screen — no cell is ever also a card', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9], primaryId: 5 })
    // 1, 5 and 9 are all cells now: 12 and 20 remain.
    await waitFor(() => expect(shelfCards(root)).toHaveLength(2))
  })
})

describe('the gate that counts: filling the view does not restart it', () => {
  it('adding a third camera keeps the SAME wall surface', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9], primaryId: 5 })
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
    reportReady()
    const before = wallSurface(root)

    act(() => {
      useWorkspaceStore.getState().add(12)
    })

    // Identity, not presence: a remount also leaves exactly one node here.
    expect(wallSurface(root)).toBe(before)
  })

  it('and moves the new set across as a command, naming the cameras that stay', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9], primaryId: 5 })
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
    reportReady()
    const mark = injectedWebViewScripts().length

    act(() => {
      useWorkspaceStore.getState().add(12)
    })

    const sent = injectedWebViewScripts()
      .slice(mark)
      .filter((s) => s.includes('setDevices'))
    expect(sent).toHaveLength(1)
    // 1 is the route camera and the PRIMARY — it leads the wall's list.
    expect(sent[0]).toContain('[1,5,9,12]')
  })

  it('removing one keeps it too — the wall shrinks, it does not restart', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9, 12], primaryId: 5 })
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
    reportReady()
    const before = wallSurface(root)

    act(() => {
      useWorkspaceStore.getState().remove(12)
    })

    expect(wallSurface(root)).toBe(before)
  })
})

describe('removing members walks the layout back, symmetrically', () => {
  it('three to two: still a wall, still a strip', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9, 12], primaryId: 5 })
    act(() => {
      useWorkspaceStore.getState().remove(12)
    })
    expect(grid(root)).not.toBeNull()
    await waitFor(() => expect(shelfVariant(root)).toBe('strip'))
    expect(shelfCards(root)).toHaveLength(2)
  })

  it('two to one: still a wall — one other camera plus the picture is a view', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9], primaryId: 5 })
    act(() => {
      useWorkspaceStore.getState().remove(9)
    })
    expect(grid(root)).not.toBeNull()
    await waitFor(() => expect(shelfVariant(root)).toBe('strip'))
    // 1 and 5 are the two cells; 9, 12 and 20 remain in the reel.
    expect(shelfCards(root)).toHaveLength(3)
  })

  it('one to none: the wall goes, the rows come back, the camera is listed again', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5], primaryId: 5 })
    act(() => {
      useWorkspaceStore.getState().remove(5)
    })
    expect(grid(root)).toBeNull()
    await waitFor(() => expect(shelfVariant(root)).toBe('rows'))
    expect(shelfCards(root)).toHaveLength(4)
  })

  it('closing the view empties it in one step, back to exactly the start', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9, 12], primaryId: 5 })
    act(() => {
      useWorkspaceStore.getState().clear()
    })
    expect(grid(root)).toBeNull()
    await waitFor(() => expect(shelfVariant(root)).toBe('rows'))
    expect(shelfCards(root)).toHaveLength(4)
  })
})

describe('the Android tablet gets the wall too, through the native tiles', () => {
  it('the same two members, the same wall — but no embedded page', async () => {
    setTestPlatform('android')
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9], primaryId: 5 })
    // The wall is there and the shelf reduced, exactly as on iOS...
    expect(grid(root)).not.toBeNull()
    await waitFor(() => expect(shelfVariant(root)).toBe('strip'))
    // ...and it is the NATIVE wall: `USE_EMBED` excludes Android, so nothing
    // here may quietly mount a WebView the platform is not meant to boot.
    expect(wallSurface(root)).toBeNull()
  })
})

describe('a phone in landscape gets the WALL, and still no reel', () => {
  /**
   * The half of the phone change that is a mount claim. The gate stopped being
   * the reel's on 2026-09-02 (`canHostWorkspaceWall`), and the two answers now
   * differ on this exact surface — so asserting only the wall would be green
   * for a change that also brought the reel along.
   *
   * The interaction that BUILDS the view here is
   * `phone-wall-mount.spec.ts`; this is the seeded state.
   */
  it('the wall is up, and there is no reel under it', async () => {
    setTestViewport(IPHONE_LANDSCAPE)
    const root = await openTheater({ members: [5, 9, 12], primaryId: 5 })
    expect(grid(root)).not.toBeNull()
    // SETTLED, then absent. See `cameraListOnScreen`: the reel now reserves a
    // band while the list is pending, so "nothing there" said before the
    // answer arrives is a race, not a guarantee.
    await cameraListOnScreen()
    expect(shelfVariant(root)).toBeNull()
    expect(shelfSurface(root)).toBeNull()
  })

  it('and it is the ONE surface in the tree — the picture is a cell here too', async () => {
    setTestViewport(IPHONE_LANDSCAPE)
    const root = await openTheater({ members: [5, 9], primaryId: 5 })
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
    expect(webViews(root)).toHaveLength(1)
    expect(webViews(root)[0]).toBe(wallSurface(root))
  })

  it('one camera on screen is still the single picture, phone or not', async () => {
    setTestViewport(IPHONE_LANDSCAPE)
    const root = await openTheater(EMPTY_WORKSPACE)
    expect(grid(root)).toBeNull()
    await waitFor(() => expect(webViews(root)).toHaveLength(1))
    expect(wallSurface(root)).toBeNull()
  })
})

describe('taking ONE camera off the wall', () => {
  /** What a cell's remove control posts. The page draws it; the host is the
   *  only thing that may act on it, because the wall's membership is the
   *  host's set and a page that edited its own would disagree with the next
   *  `setDevices`. */
  function tapRemove(deviceId: number): void {
    act(() => {
      emitWebViewMessage({ type: 'tileRemove', deviceId })
    })
  }

  it('drops that camera and leaves the others in the view', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9, 12], primaryId: 5 })
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
    reportReady()

    tapRemove(9)

    expect(useWorkspaceStore.getState().workspace.members).toEqual([5, 12])
  })

  it('does NOT restart the cameras that stay', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9, 12], primaryId: 5 })
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
    reportReady()
    const before = wallSurface(root)

    tapRemove(9)

    // Identity, not presence: a remount also leaves exactly one wall here, and
    // it costs every remaining camera its `<video>` and its peer.
    expect(wallSurface(root)).toBe(before)
    const sent = injectedWebViewScripts().filter((s) => s.includes('setDevices'))
    expect(sent[sent.length - 1]).toContain('[1,5,12]')
  })

  it('moves the primary off a camera that just left', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9, 12], primaryId: 9 })
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
    reportReady()

    tapRemove(9)

    expect(useWorkspaceStore.getState().workspace.primaryId).toBe(5)
  })

  it('the last cell out walks the layout back to the snapshot rows', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9], primaryId: 5 })
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
    reportReady()

    tapRemove(9)
    // Still a wall: 5 is a cell beside the picture. It is the LAST cell that
    // walks the layout back, and that is now one remove further out.
    expect(grid(root)).not.toBeNull()

    tapRemove(5)

    expect(grid(root)).toBeNull()
    await waitFor(() => expect(shelfVariant(root)).toBe('rows'))
  })
})

describe('resizing a cell', () => {
  it('records the size and pushes it to the page that asked for it', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9, 12], primaryId: 5 })
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
    reportReady()
    const mark = injectedWebViewScripts().length

    act(() => {
      emitWebViewMessage({ type: 'tileResize', deviceId: 9, cw: 2, ch: 1 })
    })

    expect(useWorkspaceStore.getState().workspace.cells).toEqual({ 9: { cw: 2, ch: 1 } })
    const sent = injectedWebViewScripts()
      .slice(mark)
      .filter((s) => s.includes('setSpans'))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('"cw":2')
  })

  it('does not restart the wall to deliver an arrangement', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const root = await openTheater({ members: [5, 9, 12], primaryId: 5 })
    await waitFor(() => expect(wallSurface(root)).not.toBeNull())
    reportReady()
    const before = wallSurface(root)

    act(() => {
      emitWebViewMessage({ type: 'tileResize', deviceId: 9, cw: 2, ch: 1 })
    })

    expect(wallSurface(root)).toBe(before)
  })
})

describe('the phone gets the arrangement too, and never the reel', () => {
  it('a wall with an operator arrangement, and no reel beside it', async () => {
    setTestViewport(IPHONE_LANDSCAPE)
    const root = await openTheater({
      members: [5, 9, 12],
      primaryId: 5,
      cells: { 9: { cw: 2, ch: 2 } },
    })
    expect(grid(root)).not.toBeNull()
    // The reel is the one thing a phone still does not have, in either shape:
    // in `stack` the timeline owns the space under the picture and in `fill`
    // the picture owns the window (`camera-shelf.ts`). Asserted once the list
    // has LANDED — and on the reserved band too, which is the shape the
    // absence could hide behind (`cameraListOnScreen`).
    await cameraListOnScreen()
    expect(shelfVariant(root)).toBeNull()
    expect(shelfSurface(root)).toBeNull()
  })

  it('and the cells the OPERATOR sized ride into the page they were made in', async () => {
    setTestViewport(IPHONE_LANDSCAPE)
    await openTheater({ members: [5, 9, 12], primaryId: 5, cells: { 9: { cw: 2, ch: 2 } } })
    await waitFor(() => expect(bootedWallDevices().length).toBeGreaterThan(0))
    const booted = bootedWallDevices()
    expect(booted[booted.length - 1]).toContain('"cw":2')
  })
})
