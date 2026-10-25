import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The WRAPPER owns the picture's box; the player fills it. On every host.
 *
 * The camera screen sizes the cover wrapper (`videoCoverStyle`) per layout
 * shape: 16:9 of the width in `stack`, the wide rail's stream box in `wide`,
 * and the WHOLE WINDOW in `fill` (phone landscape, browser fullscreen). The
 * iOS host (`LiveViewWebView.tsx`) has always been `flex: 1` — no aspect ratio
 * of its own. The web host (`LiveView.web.tsx`) was the one host that shipped
 * `aspectRatio: 16 / 9` of `width: '100%'`: in `fill` on a 932×430 phone that
 * is a 932×524 iframe pinned to the top of a 430-high window, clipped by the
 * wrapper — the bottom ~18 % of the picture was cut off and the detection
 * boxes (drawn against the wrapper) landed ~10 % too high.
 *
 * Operator report 2026-09-06, PWA on an iPhone: "the stream did not take the
 * header into account". This was one of its two causes.
 *
 * Source assertions because vitest runs `node` here, with no renderer.
 */

const SRC = join(process.cwd(), 'src')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

function containerStyle(src: string): string {
  const match = src.match(/^\s*container: \{[^}]*\}/m)
  expect(match, 'a `container` style must exist').not.toBeNull()
  return match?.[0] ?? ''
}

describe('web iframe player — the box is the wrapper, not 16:9 of the width', () => {
  const container = containerStyle(read('live/LiveView.web.tsx'))

  it('fills the wrapper in both dimensions', () => {
    expect(container).toContain("width: '100%'")
    expect(container).toContain("height: '100%'")
  })

  it('has no aspect ratio of its own — the wrapper is the 16:9 authority', () => {
    expect(container).not.toContain('aspectRatio')
  })

  it('has square corners, like the iOS host', () => {
    // A full-window picture with rounded corners shows the background through
    // them; the iOS picture never had any.
    expect(container).not.toContain('borderRadius')
  })
})

describe('iOS WebView player — still lets the wrapper own the box', () => {
  it('keeps `flex: 1` and no aspect ratio', () => {
    const container = containerStyle(read('live/LiveViewWebView.tsx'))
    expect(container).toContain('flex: 1')
    expect(container).not.toContain('aspectRatio')
  })
})
