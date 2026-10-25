/**
 * @vitest-environment jsdom
 *
 * The wall's per-cell transport: mute and pause must DO something.
 *
 * ## The defect this pins
 *
 * The embed's tile draws the pause disc and the listen disc unconditionally —
 * `GridTilePlayer` gates them on `controlsOn` (overlay visibility) and nothing
 * else — and `EmbedGridPage` posts `pauseToggle`/`audioToggle` to the host on
 * every press. The host answers with `onPauseToggle?.(…)` / `onAudioToggle?.(…)`.
 *
 * The workspace wall passed `NO_IDS` for both sets and NEITHER handler, so both
 * discs were drawn, pressable, and inert: the optional call landed on
 * `undefined`. `audioActive` fed from an always-empty set left every speaker
 * icon stuck in the "off" state. Two dead controls per cell — the exact failure
 * the screen's own docblock says it keeps hitting, and the one `editable` is
 * carefully gated to avoid.
 *
 * The grid page has always had both. Nothing anywhere argued the wall should
 * not; the one docblock near the stub explains only why the constant is hoisted
 * (prop identity), not why the capability is empty.
 *
 * ## What is asserted, and why through the wire
 *
 * A press cannot be simulated: the disc lives inside the WebView. So the test
 * plays the PAGE — it emits the message the page emits — and asserts the host
 * answered on the channel the embed actually listens to (`setPaused` /
 * `setAudioOn` commands). Asserting a prop would pass on a handler that updated
 * state nothing forwarded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import { setTestViewport, IPAD_LANDSCAPE } from '../../../testing/viewport-control.js'
import {
  bootedWebViewConfigs,
  emitWebViewMessage,
  injectedWebViewScripts,
  resetWebViewStub,
} from '../../../testing/webview-control.js'
import { useWorkspaceStore } from '../../../store/workspace-store.js'
import { EMPTY_WORKSPACE } from '../../../store/workspace.js'
import { CameraDetailScreen } from '../../CameraDetailScreen.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

/** Camera 5 runs on a battery; 1 and 9 are on mains. The gate's only per-camera
 *  input is that flag, so this is the whole fixture it needs. */
const CAMERAS = [
  { id: 1, name: 'Front door', isCamera: true, online: true, features: [] },
  { id: 5, name: 'Garden', isCamera: true, online: true, features: ['battery-operated'] },
  { id: 9, name: 'Garage', isCamera: true, online: true, features: [] },
]

const HUB = { 'deviceManager.listAll': CAMERAS }

/** The picture (1) plus one member: the smallest wall there is. Defaults to the
 *  MAINS camera, so the ordinary-pause specs are not quietly testing the gate. */
async function openWall(member = 9): Promise<void> {
  useWorkspaceStore.setState({ workspace: { ...EMPTY_WORKSPACE, members: [member] } })
  mountScreen(React.createElement(CameraDetailScreen, { deviceId: 1 }), { hub: HUB })
  await act(async () => undefined)
  act(() => {
    emitWebViewMessage({ type: 'state', state: 'ready', commands: ['setDevices', 'setSpans'] })
  })
}

/** The page pressed a disc. This is verbatim what `EmbedGridPage` posts. */
function pressFromPage(type: 'pauseToggle' | 'audioToggle', deviceId: number): void {
  act(() => {
    emitWebViewMessage({ type, deviceId })
  })
}

function commandsSince(mark: number, kind: string): readonly string[] {
  return injectedWebViewScripts()
    .slice(mark)
    .filter((s) => s.includes(kind))
}

beforeEach(() => {
  setTestPlatform('ios')
  setTestViewport(IPAD_LANDSCAPE)
  resetWebViewStub()
  useWorkspaceStore.setState({ workspace: EMPTY_WORKSPACE })
})

afterEach(() => {
  cleanup()
  useWorkspaceStore.setState({ workspace: EMPTY_WORKSPACE })
})

describe('the wall answers its own per-cell transport', () => {
  it('pausing a cell reaches the page as setPaused', async () => {
    await openWall()
    const mark = injectedWebViewScripts().length

    pressFromPage('pauseToggle', 9)

    const sent = commandsSince(mark, 'setPaused')
    expect(sent.length).toBeGreaterThan(0)
    expect(sent[sent.length - 1]).toContain('9')
  })

  it('and pressing again releases it — the same button, both ways', async () => {
    await openWall()
    pressFromPage('pauseToggle', 9)
    const mark = injectedWebViewScripts().length

    pressFromPage('pauseToggle', 9)

    const sent = commandsSince(mark, 'setPaused')
    expect(sent.length).toBeGreaterThan(0)
    expect(sent[sent.length - 1]).not.toContain('9')
  })

  it('listening to a cell reaches the page as setAudioOn', async () => {
    await openWall()
    const mark = injectedWebViewScripts().length

    pressFromPage('audioToggle', 5)

    const sent = commandsSince(mark, 'setAudioOn')
    expect(sent.length).toBeGreaterThan(0)
    expect(sent[sent.length - 1]).toContain('5')
  })

  it('the PICTURE is a cell too — its own transport answers', async () => {
    await openWall()
    const mark = injectedWebViewScripts().length

    pressFromPage('pauseToggle', 1)

    const sent = commandsSince(mark, 'setPaused')
    expect(sent.length).toBeGreaterThan(0)
    expect(sent[sent.length - 1]).toContain('1')
  })

  it('a battery camera added to a view arrives HELD, not woken', async () => {
    await openWall(5)

    // Before any press. The grid page's rule — "opening a grid must never wake
    // a battery camera" — says nothing about how the wall was opened, and a
    // camera added to a VIEW used to wake immediately.
    const held = injectedWebViewScripts().filter((s) => s.includes('setPaused'))
    const boot = bootedWebViewConfigs().filter((c) => c.includes('__CAMSTACK_GRID__'))
    expect(`${boot[boot.length - 1] ?? ''}${held.join('')}`).toContain('5')
  })

  it('and one press on a held battery cell means START, not un-pause', async () => {
    await openWall(5)
    const mark = injectedWebViewScripts().length

    pressFromPage('pauseToggle', 5)

    // The gate turns that press into a START: the camera leaves the held set.
    // A naive `pausedIds.has(id)` toggle would have ADDED it, so the one press
    // an operator makes to wake a sleeping camera would have paused it harder.
    const sent = commandsSince(mark, 'setPaused')
    expect(sent.length).toBeGreaterThan(0)
    expect(sent[sent.length - 1]).not.toContain('5')
  })
})
