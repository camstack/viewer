/**
 * @vitest-environment jsdom
 *
 * Every read-out over the picture sits where the operator put it.
 *
 * The stream-stats overlay was reported "always bottom-left" whatever its
 * position said. On iOS the thing on screen was a DIFFERENT overlay — the
 * WebView embed's own pill, which has no position at all. Placement is now the
 * stack's job (`overlay-stack`): these specs pin that every anchor gets a box
 * on its own edges, and that iOS does not hand the job to the embed.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { OVERLAY_ANCHORS, type OverlayAnchor } from '../overlay/overlay-position.js'
import { stackBox } from '../overlay/overlay-stack.js'

const INSET = { top: 8, bottom: 8, left: 8, right: 8 } as const

function edgesOf(anchor: OverlayAnchor): readonly string[] {
  const box = stackBox(anchor, new Set([anchor]), INSET)
  return (['top', 'bottom', 'left', 'right'] as const).filter((edge) => box[edge] !== undefined)
}

describe('every anchor is laid out on its own edges', () => {
  it.each(OVERLAY_ANCHORS)('%s', (anchor) => {
    const edges = edgesOf(anchor)
    if (anchor.startsWith('top')) expect(edges).toContain('top')
    if (anchor.startsWith('bottom')) expect(edges).toContain('bottom')
    if (anchor.startsWith('top') || anchor.startsWith('bottom')) {
      expect(edges).not.toContain(anchor.startsWith('top') ? 'bottom' : 'top')
    }
    if (anchor.endsWith('left')) expect(edges).toContain('left')
    if (anchor.endsWith('right')) expect(edges).toContain('right')
  })

  it('is NOT pinned bottom-left: top-right is top and right only', () => {
    expect(edgesOf('top-right')).toEqual(['top', 'right'])
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
    expect(read('components', 'camera', 'overlay', 'OverlayLayer.tsx')).toContain('<StreamStatsOverlay getStats={getStats}')
    expect(screenSrc).toContain('getStats,')
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
