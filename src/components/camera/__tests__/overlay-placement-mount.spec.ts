/**
 * @vitest-environment jsdom
 *
 * Every read-out over the picture sits where the operator put it.
 *
 * The stream-stats overlay was reported "always bottom-left" whatever its
 * position said. The component itself was never wrong (it places itself with
 * `ANCHOR_PLACEMENT`, like the device-information pill and the audio meter);
 * on iOS the thing on screen was a DIFFERENT overlay — the WebView embed's own
 * pill, which has no position at all. These specs pin both halves: the host
 * components honour all eight anchors, and iOS no longer hands the job to the
 * embed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { mountScreen } from '../../../testing/mount.js'
import { StreamStatsOverlay } from '../StreamStatsOverlay.js'
import { LiveViewersBadge } from '../LiveViewersBadge.js'
import {
  ANCHOR_PLACEMENT,
  OVERLAY_ANCHORS,
  type OverlayAnchor,
} from '../overlay/overlay-position.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => cleanup())

const EDGES = ['top', 'bottom', 'left', 'right'] as const

/** The edge offsets ANCHOR_PLACEMENT asks for, as CSS strings. */
function expectedEdges(anchor: OverlayAnchor): Readonly<Record<string, string>> {
  const placement = ANCHOR_PLACEMENT[anchor]
  const out: Record<string, string> = {}
  for (const edge of EDGES) {
    const value: unknown = Reflect.get(placement, edge)
    if (typeof value === 'number') out[edge] = `${String(value)}px`
  }
  return out
}

function edgesOf(el: HTMLElement): Readonly<Record<string, string>> {
  const style = getComputedStyle(el)
  const out: Record<string, string> = {}
  for (const edge of EDGES) {
    const value = style.getPropertyValue(edge)
    if (value !== '' && value !== 'auto') out[edge] = value
  }
  return out
}

const getStats = (): Promise<null> => Promise.resolve(null)

describe('the stream-stats overlay renders at the configured position', () => {
  it.each(OVERLAY_ANCHORS)('panel at %s', (anchor) => {
    mountScreen(React.createElement(StreamStatsOverlay, { getStats, position: anchor }))
    expect(edgesOf(screen.getByTestId('stream-stats-overlay'))).toEqual(expectedEdges(anchor))
  })

  it.each(OVERLAY_ANCHORS)('grid-cell one-liner at %s', (anchor) => {
    mountScreen(React.createElement(StreamStatsOverlay, { getStats, position: anchor, compact: true }))
    expect(edgesOf(screen.getByTestId('stream-stats-overlay'))).toEqual(expectedEdges(anchor))
  })

  it('is NOT pinned bottom-left: top-right is top and right only', () => {
    mountScreen(React.createElement(StreamStatsOverlay, { getStats, position: 'top-right' }))
    const edges = edgesOf(screen.getByTestId('stream-stats-overlay'))
    expect(edges).not.toHaveProperty('bottom')
    expect(edges).not.toHaveProperty('left')
  })
})

describe('the live-viewers badge renders at the configured position', () => {
  it.each(OVERLAY_ANCHORS)('at %s', async (anchor) => {
    mountScreen(
      React.createElement(LiveViewersBadge, { deviceId: 7, position: anchor, enabled: true }),
      { hub: { 'streamBroker.getLiveViewerCounts': [{ deviceId: 7, viewers: 2 }] } },
    )
    const badge = await screen.findByTestId('live-viewers-badge')
    expect(edgesOf(badge)).toEqual(expectedEdges(anchor))
  })
})

describe('iOS no longer hands the stats read-out to the WebView embed', () => {
  const SRC = join(process.cwd(), 'src')
  const read = (...p: string[]): string => readFileSync(join(SRC, ...p), 'utf8')

  it('the detail screen draws the host overlay on EVERY platform and never asks the embed to draw its own', () => {
    const screenSrc = read('screens', 'CameraDetailScreen.tsx')
    // The embed's pill (ui-library's StreamDebugOverlay) is hard-coded
    // bottom-left; turning it on is what made the position setting do nothing.
    expect(screenSrc).not.toMatch(/showStats=\{[^}]*useWebViewPlayer/)
    expect(screenSrc).not.toMatch(/statsPosition !== 'off' && !useWebViewPlayer/)
    expect(screenSrc).toContain('<StreamStatsOverlay getStats={getStats} position={statsPosition} />')
  })

  it('the WebView handle answers getStats from the embed\'s own samples first', () => {
    const webview = read('live', 'LiveViewWebView.tsx')
    const handle = webview.slice(webview.indexOf('getStats(): Promise<StreamStats | null> {'))
    const sampled = handle.indexOf('streamStatsFromSample(')
    const probe = handle.indexOf("type:'stats'")
    expect(sampled).toBeGreaterThan(-1)
    expect(probe).toBeGreaterThan(sampled)
  })
})
