/**
 * @vitest-environment jsdom
 *
 * The grid page's clock button: it HIDES the timeline, it does not unmount it.
 *
 * The operator asked for the toggle back ("deve essere attivabile la timeline,
 * riporta indietro l'orologio per la grid"). The reason it was removed is still
 * true and is the whole difficulty: the timeline is the wall's PARENT now (the
 * wall sits in its stream slot), so mounting and unmounting it around the wall
 * re-parents every tile — React remounts them and every WebRTC peer is torn
 * down and re-dialled. So "off" had to become a STATE of an always-mounted
 * host.
 *
 * The gates, in the order they matter:
 *
 *  1. off ⇒ the chrome is not drawn and the wall has the whole surface;
 *  2. **no tile remounts** across off → on → off. Asserted on DOM NODE
 *     IDENTITY (`toBe`), never on presence: a remount leaves exactly the same
 *     number of surfaces on screen, so `not.toBeNull()` is green against the
 *     very regression this exists to catch;
 *  3. off costs NOTHING on the wire — a hidden surface must not issue the four
 *     batched reads;
 *  4. the default is OFF, which is what the page did before the substitution;
 *  5. a phone has no button, because it has no timeline to toggle.
 *
 * Needs `viewport-control.ts`: jsdom reports 0 for the window and the screen,
 * and every viewport rule reads 0 as degenerate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen, TEST_SERVER_ID } from '../../testing/mount.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { setTestPlatform } from '../../testing/platform-control.js'
import {
  setTestViewport,
  IPAD_LANDSCAPE,
  IPAD_PORTRAIT,
  IPHONE_PORTRAIT,
} from '../../testing/viewport-control.js'
import { resetWebViewStub } from '../../testing/webview-control.js'
import { useGridStore, type Grid } from '../../store/grid-store.js'
import { GridViewScreen } from '../GridViewScreen.js'
import { GRID_WALL_SLOT_TEST_ID } from '../../grid/grid-timeline-surface.js'
import { TIMELINE_CHROME_TEST_ID } from '../../components/camera/theater/TheaterTimeline.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERAS = [
  { id: 1, name: 'Front door', isCamera: true, online: true },
  { id: 5, name: 'Garden', isCamera: true, online: true },
]

// The batch is the ARCHIVE's — `recording` is a device collection since
// D625 and carries only the per-camera, provider-pinned methods.
const AVAILABILITY_BATCH = 'recordingArchive.getAvailabilityBatch'
const DENSITY_BATCH = 'pipelineAnalytics.getEventDensityBatch'
const GRID_ID = 'g1'

/** The harness pins the locale to `en` (`native-stubs/expo-localization.ts`). */
const CLOCK_BUTTON = '[aria-label="Timeline"]'

function hub(): Readonly<Record<string, unknown>> {
  const rows = (input: unknown, key: string): readonly unknown[] =>
    ((input as { deviceIds?: readonly number[] }).deviceIds ?? []).map((deviceId) => ({
      deviceId,
      read: 'read',
      [key]: [],
    }))
  return {
    'deviceManager.listAll': CAMERAS,
    [AVAILABILITY_BATCH]: (input: unknown) => rows(input, 'ranges'),
    [DENSITY_BATCH]: (input: unknown) => rows(input, 'buckets'),
    'pipelineAnalytics.listRecentTracks': { tracks: [], nextCursor: null },
  }
}

function callsTo(path: string): readonly unknown[] {
  return hubCalls().filter((c) => c.path === path)
}

function seedGrid(): void {
  useGridStore.setState({
    grids: [{ id: GRID_ID, name: 'Piano terra', serverId: TEST_SERVER_ID, cameraIds: [1, 5] } satisfies Grid],
    hydrated: true,
  })
}

async function openGrid(): Promise<HTMLElement> {
  const { container } = mountScreen(
    React.createElement(GridViewScreen, { gridId: GRID_ID }),
    { hub: hub() },
  )
  await act(async () => undefined)
  return container
}

/** The wall's box — the SAME element in both states, its testID naming which
 *  box it got. */
function wallSlot(root: HTMLElement): HTMLElement {
  const el =
    root.querySelector(`[data-testid="${GRID_WALL_SLOT_TEST_ID.full}"]`) ??
    root.querySelector(`[data-testid="${GRID_WALL_SLOT_TEST_ID.shared}"]`)
  if (!(el instanceof HTMLElement)) throw new Error('the page drew no wall slot')
  return el
}

/** The wall's native surface, looked up INSIDE the slot: an unscoped query
 *  would happily answer with whatever WebView came first in the document. */
function wallSurface(root: HTMLElement): Element {
  const el = wallSlot(root).querySelector('[data-testid="stub-WebView"]')
  if (el === null) throw new Error('the wall reached no native surface')
  return el
}

function chromeIs(root: HTMLElement, state: 'shown' | 'hidden'): boolean {
  return root.querySelector(`[data-testid="${TIMELINE_CHROME_TEST_ID[state]}"]`) !== null
}

function clickClock(root: HTMLElement): void {
  const el = root.querySelector(CLOCK_BUTTON)
  if (el === null) throw new Error('the control bar offered no clock button')
  act(() => {
    fireEvent.click(el)
  })
}

beforeEach(() => {
  useGridStore.setState({ grids: [], hydrated: true })
  resetWebViewStub()
  setTestPlatform('ios')
  setTestViewport(IPAD_LANDSCAPE)
})

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
  useGridStore.setState({ grids: [], hydrated: true })
})

describe('the default is OFF, as the page opened before the substitution', () => {
  it('the chrome is hidden and the wall has the whole surface', async () => {
    seedGrid()
    const root = await openGrid()
    expect(chromeIs(root, 'hidden')).toBe(true)
    expect(chromeIs(root, 'shown')).toBe(false)
    expect(wallSlot(root).getAttribute('data-testid')).toBe(GRID_WALL_SLOT_TEST_ID.full)
  })

  it('and it costs nothing on the wire — a surface nobody sees issues no batched read', async () => {
    seedGrid()
    const root = await openGrid()
    // Readiness: the camera list IS fetched, so waiting on it proves the screen
    // got far enough for a timeline read to have been issued had it wanted one.
    await waitFor(() => expect(callsTo('deviceManager.listAll').length).toBeGreaterThan(0))
    await act(async () => undefined)

    expect(callsTo(AVAILABILITY_BATCH)).toHaveLength(0)
    expect(callsTo(DENSITY_BATCH)).toHaveLength(0)
    // And the button that would change that is on screen.
    expect(root.querySelector(CLOCK_BUTTON)).not.toBeNull()
  })
})

describe('the toggle changes what is DRAWN, and nothing else', () => {
  it('on draws the chrome, gives the wall a shared box, and starts reading', async () => {
    seedGrid()
    const root = await openGrid()
    clickClock(root)

    expect(chromeIs(root, 'shown')).toBe(true)
    expect(wallSlot(root).getAttribute('data-testid')).toBe(GRID_WALL_SLOT_TEST_ID.shared)
    await waitFor(() => expect(callsTo(AVAILABILITY_BATCH).length).toBeGreaterThan(0))
  })

  it('the wall is not remounted by the round trip off → on → off', async () => {
    seedGrid()
    const root = await openGrid()
    // The identity, taken while hidden. React reuses the host node only when
    // the element type, key and POSITION are all stable, so `toBe` is a real
    // claim about the wall never being re-parented.
    const surface = wallSurface(root)

    clickClock(root)
    await act(async () => undefined)
    expect(chromeIs(root, 'shown')).toBe(true)
    expect(wallSurface(root)).toBe(surface)

    clickClock(root)
    await act(async () => undefined)
    expect(chromeIs(root, 'hidden')).toBe(true)
    expect(wallSurface(root)).toBe(surface)
  })

  it('nor by the round trip in the STACKED shape, where the wall box is a fraction', async () => {
    // Portrait is the shape whose slot is sized by its child: off, the wall
    // takes the window; on, it takes `GRID_WALL_STACK_FRACTION` of it. Two
    // different boxes on one element — which is exactly the change that would
    // be a remount if the box came from a different element instead.
    setTestViewport(IPAD_PORTRAIT)
    seedGrid()
    const root = await openGrid()
    const surface = wallSurface(root)

    clickClock(root)
    await act(async () => undefined)
    expect(wallSlot(root).getAttribute('data-testid')).toBe(GRID_WALL_SLOT_TEST_ID.shared)
    expect(wallSurface(root)).toBe(surface)

    clickClock(root)
    await act(async () => undefined)
    expect(wallSlot(root).getAttribute('data-testid')).toBe(GRID_WALL_SLOT_TEST_ID.full)
    expect(wallSurface(root)).toBe(surface)
  })

  it('the chrome keeps its INSTANCE while hidden — it is not re-created on return', async () => {
    seedGrid()
    const root = await openGrid()
    clickClock(root)
    await act(async () => undefined)
    const chrome = root.querySelector(`[data-testid="${TIMELINE_CHROME_TEST_ID.shown}"]`)
    expect(chrome).not.toBeNull()

    clickClock(root)
    await act(async () => undefined)
    // Same node, renamed — mounted the whole time, merely not drawn.
    expect(root.querySelector(`[data-testid="${TIMELINE_CHROME_TEST_ID.hidden}"]`)).toBe(chrome)

    clickClock(root)
    await act(async () => undefined)
    expect(root.querySelector(`[data-testid="${TIMELINE_CHROME_TEST_ID.shown}"]`)).toBe(chrome)
  })
})

describe('the mechanism, in the source', () => {
  /**
   * The half a rendered tree cannot see. `react-native-web` compiles styles
   * into opaque class names, so nothing above can distinguish "not drawn" from
   * "drawn with zero size" — and zero size is not the same thing: a
   * zero-height box still takes touches and still reconciles.
   *
   * Nor can a rendered tree catch the reverse mistake, the one this whole file
   * exists for: a page that goes back to `cond ? <Timeline>{wall}</Timeline> :
   * wall` renders identically in both states and remounts the wall on every
   * tap. The identity assertions above are the gate for that; this is the
   * guard that stops the mechanism being quietly swapped for a fresh one.
   */
  const SRC = process.cwd()
  const read = (...parts: readonly string[]): string =>
    readFileSync(join(SRC, ...parts), 'utf8')

  it('the chrome is hidden with `display: none`, not shrunk to nothing', () => {
    const src = read('src', 'components', 'camera', 'theater', 'TheaterTimeline.tsx')
    expect(src).toContain(`chromeHidden: {\n    display: 'none',\n  },`)
    // Applied at all three placements: the stacked toolbar above the slot, the
    // body, and the wide rail. A placement somebody forgets is a band that
    // survives the toggle.
    expect(src.match(/styles\.chromeHidden/g) ?? []).toHaveLength(3)
  })

  it('the page never swaps the timeline for the bare wall', () => {
    const src = read('src', 'screens', 'GridViewScreen.tsx')
    // `showTimeline` is the VIEWPORT gate and may still choose the tree (a
    // phone genuinely has no timeline). The toggle may not: it must reach the
    // mounted host as a prop.
    expect(src).toContain('chromeHidden={!timelineOn}')
    expect(src).not.toContain('timelineOn ? (')
    expect(src).not.toContain('showTimeline && timelineOn')
  })

  it('the hidden chrome stops reading, and freezes', () => {
    const src = read('src', 'components', 'camera', 'theater', 'TheaterTimeline.tsx')
    expect(src).toContain('useTimelineDeferral(props.loading) && !chromeHidden')
    expect(src).toContain('frozen={panelOpen || chromeHidden}')
  })
})

describe('the phone is unchanged', () => {
  it('no clock button, because there is no timeline here to toggle', async () => {
    setTestViewport(IPHONE_PORTRAIT)
    seedGrid()
    const root = await openGrid()
    await waitFor(() => expect(callsTo('deviceManager.listAll').length).toBeGreaterThan(0))
    await act(async () => undefined)

    // A POSITIVE control: the bar itself IS on screen, so "no clock" is not
    // simply "no control bar".
    expect(root.querySelector('[aria-label="Stream quality"]')).not.toBeNull()
    expect(root.querySelector(CLOCK_BUTTON)).toBeNull()
    for (const state of ['shown', 'hidden'] as const) {
      expect(chromeIs(root, state)).toBe(false)
    }
  })
})
