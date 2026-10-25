/**
 * @vitest-environment jsdom
 *
 * Per-camera sizes travel only to a page that said it understands them.
 *
 * On web the iframe is served by the hub and the app is whatever the browser
 * cached, so the two halves of this protocol version-skew independently: a
 * viewer that knows about spans will meet a page that does not, and it must
 * keep working. The method probe in `gridCommandScript` already makes an
 * unknown command a silent no-op — that is the right degradation here and the
 * WRONG one for the device set, which is why the two have separate rules:
 *
 *  - `setDevices` absent ⇒ the wall shows the wrong CAMERAS ⇒ reload the document.
 *  - `setSpans`   absent ⇒ the wall distributes its cells evenly ⇒ send nothing.
 *
 * The second line is the claim under test, and both halves of it matter. Sending
 * the command anyway would be harmless; RELOADING for it would blank every peer
 * on the wall to deliver a preference, which is the failure this spec exists to
 * make impossible.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { setTestPlatform } from '../../testing/platform-control.js'
import { emitWebViewMessage, injectedWebViewScripts } from '../../testing/webview-control.js'
import type { GridCellSpan } from '../embed-messages.js'
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
  readonly spans: Readonly<Record<string, GridCellSpan>>
}

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
    devices: [101, 102, 621],
    quality: 'auto',
    layout: 'auto',
    showName: true,
    audioOnIds: [],
    pausedIds: [],
    editable: true,
    spans: props.spans,
  })
}

function setSpans(spans: Readonly<Record<string, GridCellSpan>>): void {
  act(() => {
    pushProps?.({ spans })
  })
}

function reportReady(commands: readonly string[]): void {
  act(() => {
    emitWebViewMessage({ type: 'state', state: 'ready', commands })
  })
}

async function mountWall(): Promise<HTMLElement> {
  setTestPlatform('ios')
  const view = mountScreen(React.createElement(Harness, { initial: { spans: {} } }))
  await waitFor(() => expect(wall(view.container)).not.toBeNull())
  return view.container
}

describe('a page that named the command gets the arrangement', () => {
  it('pushes the spans as a command, naming the camera and its tracks', async () => {
    await mountWall()
    reportReady(['setDevices', 'setSpans'])
    const mark = injectedWebViewScripts().length

    setSpans({ '101': { cw: 2, ch: 1 } })

    const sent = injectedWebViewScripts()
      .slice(mark)
      .filter((s) => s.includes('setSpans'))
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('"101"')
    expect(sent[0]).toContain('"cw":2')
  })

  it('does not re-push an identical map', async () => {
    await mountWall()
    reportReady(['setDevices', 'setSpans'])
    setSpans({ '101': { cw: 2, ch: 1 } })
    const mark = injectedWebViewScripts().length

    setSpans({ '101': { cw: 2, ch: 1 } })

    expect(injectedWebViewScripts().slice(mark).filter((s) => s.includes('setSpans'))).toHaveLength(0)
  })
})

describe('a page that never named it keeps distributing the wall itself', () => {
  it('is sent nothing at all', async () => {
    await mountWall()
    // A page from before spans existed: it reports ready and names only what it
    // has.
    reportReady(['setDevices'])
    const mark = injectedWebViewScripts().length

    setSpans({ '101': { cw: 2, ch: 1 } })

    expect(injectedWebViewScripts().slice(mark).filter((s) => s.includes('setSpans'))).toHaveLength(0)
  })

  it('is NOT reloaded for it — every peer on the wall survives', async () => {
    const container = await mountWall()
    reportReady(['setDevices'])
    const before = wall(container)

    setSpans({ '101': { cw: 2, ch: 1 } })

    // Identity, not presence: a reload also leaves exactly one node here, and
    // it costs a fresh SPA boot and N renegotiated peers.
    expect(wall(container)).toBe(before)
  })

  it('and neither is a page that has not reported at all yet', async () => {
    const container = await mountWall()
    const before = wall(container)

    setSpans({ '101': { cw: 2, ch: 1 } })

    expect(wall(container)).toBe(before)
    expect(injectedWebViewScripts().filter((s) => s.includes('setSpans'))).toHaveLength(0)
  })
})
