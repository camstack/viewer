/**
 * @vitest-environment jsdom
 *
 * The camera-detail wall carries the grid page's control bar, and every
 * command on it reaches EVERY camera of the ad-hoc set.
 *
 * ## What is pinned
 *
 * - The bar mounted is `GridControlBar` (the grid page's, not a copy), in the
 *   wall's own footer row — under the cells, not over them.
 * - The saved-grid verbs are absent rather than disabled: there is no grid to
 *   edit or share, no page to go back from, no timeline clock to hide.
 * - Pause all / Play all, Unmute all, quality, layout and active-only each
 *   reach the page on the channel the embed listens to, carrying the WHOLE
 *   set — the picture's camera included.
 * - Nothing writes a saved grid or a camera's preferences: the choices land in
 *   the session workspace and die with the view.
 *
 * Asserted through the wire (the injected grid commands) rather than through
 * props, for the reason `wall-cell-transport.spec.ts` gives: a handler that
 * updated state nothing forwarded would pass a prop assertion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import { setTestViewport, IPAD_LANDSCAPE } from '../../../testing/viewport-control.js'
import {
  emitWebViewMessage,
  injectedWebViewScripts,
  resetWebViewStub,
} from '../../../testing/webview-control.js'
import { useWorkspaceStore } from '../../../store/workspace-store.js'
import { EMPTY_WORKSPACE } from '../../../store/workspace.js'
import { useGridStore } from '../../../store/grid-store.js'
import { useCameraLocalStore } from '../../../store/camera-local-store.js'
import { useGridLocalStore } from '../../../store/grid-local-store.js'
import { CameraDetailScreen } from '../../CameraDetailScreen.js'
import { WORKSPACE_GRID_FOOTER_TEST_ID } from '../WorkspaceGrid.js'
import { NO_WALL_OPTIONS } from '../workspace-wall-options.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

/** All on mains: the battery gate has its own spec, and here it would only
 *  make "every camera" mean something other than every camera. */
const CAMERAS = [
  { id: 1, name: 'Front door', isCamera: true, online: true, features: [] },
  { id: 7, name: 'Kitchen', isCamera: true, online: true, features: [] },
  { id: 9, name: 'Garage', isCamera: true, online: true, features: [] },
]
const HUB = { 'deviceManager.listAll': CAMERAS }
/** The picture (1) plus two members — the whole ad-hoc set. */
const WALL = ['1', '7', '9']

async function openWall(): Promise<HTMLElement> {
  useWorkspaceStore.setState({
    workspace: { ...EMPTY_WORKSPACE, members: [7, 9], primaryId: 7 },
    wallOptions: NO_WALL_OPTIONS,
  })
  const { container } = mountScreen(React.createElement(CameraDetailScreen, { deviceId: 1 }), {
    hub: HUB,
  })
  await act(async () => undefined)
  act(() => {
    emitWebViewMessage({ type: 'state', state: 'ready', commands: ['setDevices', 'setSpans'] })
  })
  await act(async () => undefined)
  return container
}

/** The docked bar's row. Every query is scoped to it: the timeline above has
 *  a quality chip of its own, and finding THAT would prove nothing here. */
function bar(root: HTMLElement): HTMLElement {
  const el = root.querySelector(`[data-testid="${WORKSPACE_GRID_FOOTER_TEST_ID}"]`)
  if (!(el instanceof HTMLElement)) throw new Error('the wall drew no bar row')
  return el
}

/** By label, matched in code: jsdom's selector engine reads the `&` in
 *  "Highlight & overlays" as CSS nesting and finds nothing. */
function button(root: HTMLElement, label: string): Element | null {
  return [...bar(root).querySelectorAll('[aria-label]')].find((el) => el.getAttribute('aria-label') === label) ?? null
}

function press(el: Element | null): void {
  if (el === null) throw new Error('nothing to press')
  act(() => {
    fireEvent.mouseDown(el, { clientX: 40, clientY: 40, button: 0 })
    fireEvent.mouseUp(el, { clientX: 40, clientY: 40, button: 0 })
    fireEvent.click(el, { clientX: 40, clientY: 40 })
  })
}

/** A popover row, by its visible text, inside the bar's row. */
function row(root: HTMLElement, text: string): Element | null {
  return [...bar(root).querySelectorAll('[role="button"]')].find((el) => el.textContent === text) ?? null
}

/** The argument of the newest `kind` command the host injected after `mark`
 *  (`gridCommandScript`: `…api.<kind>(<json>); true;`), parsed. */
function lastCommand(mark: number, kind: string): unknown {
  const call = `.${kind}(`
  const sent = injectedWebViewScripts()
    .slice(mark)
    .filter((s) => s.includes(call))
  const last = sent[sent.length - 1]
  if (last === undefined) return undefined
  const start = last.lastIndexOf(call) + call.length
  return JSON.parse(last.slice(start, last.lastIndexOf('); true;')))
}

function idsIn(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.map(String).sort() : []
}

beforeEach(() => {
  setTestPlatform('ios')
  setTestViewport(IPAD_LANDSCAPE)
  resetWebViewStub()
})

afterEach(() => {
  cleanup()
  useWorkspaceStore.setState({ workspace: EMPTY_WORKSPACE, wallOptions: NO_WALL_OPTIONS })
})

describe('the wall carries the grid bar, without the saved-grid verbs', () => {
  it('draws the wall commands in a row of its own under the cells', async () => {
    const root = await openWall()
    for (const label of ['Pause all', 'Audio', 'Stream quality', 'Layout', 'Highlight & overlays', 'Active only']) {
      expect(button(root, label), label).not.toBeNull()
    }
  })

  it('offers nothing that needs a saved grid or the grid page', async () => {
    const root = await openWall()
    for (const label of ['Edit grid', 'Share grid', 'Back', 'Timeline', 'Hide controls']) {
      expect(button(root, label), label).toBeNull()
    }
  })
})

describe('every command reaches every camera of the set', () => {
  it('Pause all pauses the whole set, the picture included — and Play all releases it', async () => {
    const root = await openWall()
    let mark = injectedWebViewScripts().length
    press(button(root, 'Pause all'))
    expect(idsIn(lastCommand(mark, 'setPaused'))).toEqual(WALL)

    mark = injectedWebViewScripts().length
    press(button(root, 'Play all'))
    expect(idsIn(lastCommand(mark, 'setPaused'))).toEqual([])
  })

  it('Unmute all opens audio on the whole set', async () => {
    const root = await openWall()
    press(button(root, 'Audio'))
    const mark = injectedWebViewScripts().length
    press(row(root, 'Unmute all'))
    expect(idsIn(lastCommand(mark, 'setAudioOn'))).toEqual(WALL)
  })

  it('a quality pick reaches the wall as one tier for all of it', async () => {
    const root = await openWall()
    press(button(root, 'Stream quality'))
    const mark = injectedWebViewScripts().length
    press(row(root, 'Low'))
    expect(lastCommand(mark, 'setQuality')).toBe('low')
  })

  it('a layout pick pins the columns, and active-only reaches the page', async () => {
    const root = await openWall()
    press(button(root, 'Layout'))
    let mark = injectedWebViewScripts().length
    press(row(root, '3'))
    expect(lastCommand(mark, 'setLayout')).toBe(3)

    mark = injectedWebViewScripts().length
    press(button(root, 'Active only'))
    expect(lastCommand(mark, 'setActiveOnly')).toBe(true)
  })
})

describe('the ad-hoc wall writes nothing durable', () => {
  it('a quality pick lands in the session view, never in a grid or a camera preference', async () => {
    useGridStore.setState({ grids: [], hydrated: true })
    const root = await openWall()
    const gridLocalBefore = useGridLocalStore.getState().local
    press(button(root, 'Stream quality'))
    press(row(root, 'Low'))

    expect(useWorkspaceStore.getState().wallOptions.quality).toBe('low')
    expect(useGridStore.getState().grids).toEqual([])
    // Not the primary's remembered tier either (device-local, but durable),
    // nor a saved wall's device-local tier.
    expect(useCameraLocalStore.getState().local.byId[1]?.quality).toBeUndefined()
    expect(useGridLocalStore.getState().local).toBe(gridLocalBefore)
  })

  it('and closing the view drops the choices with it', async () => {
    const root = await openWall()
    press(button(root, 'Stream quality'))
    press(row(root, 'Low'))
    act(() => useWorkspaceStore.getState().clear())
    expect(useWorkspaceStore.getState().wallOptions).toEqual(NO_WALL_OPTIONS)
  })
})
