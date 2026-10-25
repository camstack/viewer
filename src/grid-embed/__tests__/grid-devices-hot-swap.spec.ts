/**
 * @vitest-environment jsdom
 *
 * Changing the wall's device set must NOT reload the embed document.
 *
 * The grid protocol had no runtime "set devices", so the host carried
 * `key={devices.join(',')}` on the WebView: every camera added or removed cost
 * a fresh SPA boot, a second auth handshake and N renegotiated WebRTC peers.
 * That is not a performance detail — it is the difference between a camera
 * sliding into the view and the whole wall going black and starting over, and
 * it makes "add this camera to the view" unusable however it is drawn on top.
 *
 * Asserted on the WebView's DOM NODE IDENTITY, not on its presence: a remount
 * also leaves exactly one WebView on screen, and counting them cannot tell the
 * two apart. If the key comes back, `toBe` fails and nothing else does.
 *
 * The second test is the other half, and shipping the first without it would be
 * a regression: the method probe in `gridCommandScript` turns an unknown
 * command into a silent no-op, so a page that does not implement `setDevices`
 * would keep the OLD cameras for ever. The host takes the hot path only once a
 * page has named the command, and reloads the document otherwise.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { setTestPlatform } from '../../testing/platform-control.js'
import {
  emitWebViewMessage,
  injectedWebViewScripts,
} from '../../testing/webview-control.js'
import { GridLiveEmbed } from '../GridLiveEmbed.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => {
  cleanup()
  setTestPlatform('ios')
})

function wall(container: HTMLElement): Element | null {
  return container.querySelector('[data-testid="stub-WebView"]')
}

interface WallProps {
  readonly devices: readonly number[]
  readonly quality: 'auto' | 'high' | 'low'
}

/**
 * The screen's job, reduced to the one prop under test. A stateful wrapper
 * rather than `rerender`, because `rerender` replaces the element `render` was
 * given — provider stack included — and would report every change as a fresh
 * tree no matter what the component does.
 */
let pushProps: ((next: WallProps) => void) | null = null

function Harness({ initial }: { readonly initial: WallProps }): React.ReactElement {
  const [props, setProps] = React.useState<WallProps>(initial)
  React.useEffect(() => {
    pushProps = setProps
    return () => {
      pushProps = null
    }
  }, [])
  return React.createElement(GridLiveEmbed, {
    devices: props.devices,
    quality: props.quality,
    layout: 'auto',
    showName: true,
    audioOnIds: [],
    pausedIds: [],
  })
}

function setWall(next: WallProps): void {
  act(() => {
    pushProps?.(next)
  })
}

/** What a current embed build reports when it finishes booting. */
function reportReady(commands: readonly string[]): void {
  act(() => {
    emitWebViewMessage({ type: 'state', state: 'ready', commands })
  })
}

async function mountWall(devices: readonly number[]): Promise<HTMLElement> {
  setTestPlatform('ios')
  const view = mountScreen(
    React.createElement(Harness, { initial: { devices, quality: 'auto' } }),
  )
  await waitFor(() => expect(wall(view.container)).not.toBeNull())
  return view.container
}

describe('the wall takes a new device set without reloading the page', () => {
  it('keeps the SAME WebView when a camera is added', async () => {
    const container = await mountWall([101, 102])
    reportReady(['setDevices'])
    const before = wall(container)

    setWall({ devices: [101, 102, 621], quality: 'auto' })

    // Identity, not presence: a remount also leaves exactly one node here.
    expect(wall(container)).toBe(before)
  })

  it('pushes the new set as a COMMAND, naming every camera that stays', async () => {
    await mountWall([101, 102])
    reportReady(['setDevices'])
    const mark = injectedWebViewScripts().length

    setWall({ devices: [101, 102, 621], quality: 'auto' })

    const sent = injectedWebViewScripts().slice(mark)
    const setDevices = sent.filter((s) => s.includes('setDevices'))
    expect(setDevices).toHaveLength(1)
    expect(setDevices[0]).toContain('[101,102,621]')
  })

  it('keeps the SAME WebView when a camera is removed', async () => {
    const container = await mountWall([101, 102, 621])
    reportReady(['setDevices'])
    const before = wall(container)

    setWall({ devices: [101, 621], quality: 'auto' })

    expect(wall(container)).toBe(before)
  })

  it('does not re-push the set when only an OPTION changes', async () => {
    await mountWall([101, 102])
    reportReady(['setDevices'])
    const mark = injectedWebViewScripts().length

    setWall({ devices: [101, 102], quality: 'high' })

    const sent = injectedWebViewScripts().slice(mark)
    expect(sent.filter((s) => s.includes('setDevices'))).toHaveLength(0)
    // …and the option itself still travels on its fast path.
    expect(sent.filter((s) => s.includes('setQuality'))).not.toHaveLength(0)
  })
})

describe('a page that cannot take the set hot still gets the right cameras', () => {
  it('reloads the document when the page never named the command', async () => {
    const container = await mountWall([101, 102])
    // An older embed build: it reports ready, but declares nothing.
    reportReady([])
    const before = wall(container)

    setWall({ devices: [101, 102, 621], quality: 'auto' })

    // A silent no-op here would leave the wall showing two cameras for ever.
    expect(wall(container)).not.toBe(before)
  })

  it('reloads when the set changes before the page has reported at all', async () => {
    const container = await mountWall([101, 102])
    const before = wall(container)

    setWall({ devices: [101, 102, 621], quality: 'auto' })

    expect(wall(container)).not.toBe(before)
  })
})
