import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/**
 * A SERVED still goes to the image cache; a MINT goes to the fetch ladder.
 *
 * Source-level, like the other wiring guards in this folder: the difference is
 * a branch in a component that renders a WebView-less image, and the property
 * worth pinning is that the two addresses are not treated as one.
 *
 * Why it matters twice over (2026-09-21): pulling the served address through
 * `fetch` cost the disk cache — every re-open re-downloaded and re-encoded a
 * still the device already had — AND it crossed React Native's inability to
 * build a Blob from a buffered body, which printed *"Creating blobs from
 * 'ArrayBuffer' and 'ArrayBufferView' are not supported"* across every clip
 * card on the operator's phone.
 */
describe('EventThumb — the two still addresses are fetched differently', () => {
  const src = readFileSync(new URL('../EventThumb.tsx', import.meta.url), 'utf8')

  it('sends the SERVED still to expo-image with the session header and a disk cache', () => {
    expect(src).toContain("stillSource.origin === 'served'")
    const served = src.slice(src.indexOf('servedStillUrl !== null'))
    expect(served).toContain('cachePolicy="memory-disk"')
    // The credential comes from the one resolver — see the sibling case below.
    expect(served).toContain('hubImageSource(servedStillUrl, token)')
  })

  it('keeps the MINT on the fetch ladder — only a fetch can read a 204', () => {
    // `useClipStill` must be handed null for a served address, or the tile
    // downloads what the cache would have given it for free.
    expect(src).toContain("stillSource === null || stillSource.origin === 'served'")
    expect(src).toContain('useClipStill(stillUrl')
  })

  it('counts a served tile too — a cache hit makes no request and must not read as silence', () => {
    expect(src).toContain('onServedStillLoad')
    expect(src).toContain('onServedStillError')
  })
})

/**
 * Every image in this file gets its credential from ONE place.
 *
 * The operator asked why a clip thumbnail was so hard when track images work
 * everywhere, and this is the answer in one assertion: there were two
 * expressions of the session credential in this component and three images
 * using them, so one image could — and did — render with none.
 */
describe('EventThumb — one credential resolver', () => {
  const src = readFileSync(new URL('../EventThumb.tsx', import.meta.url), 'utf8')

  it('builds every image source through `hubImageSource`', () => {
    const sources = src.match(/source=\{[^}]*\}/g) ?? []
    expect(sources.length).toBeGreaterThanOrEqual(3)
    for (const s of sources) expect(s, s).toContain('hubImageSource(')
  })

  it('builds no header object of its own', () => {
    // The moment a second expression of the credential appears, the two can
    // disagree — and the one that loses is a black tile with no message. A
    // prose mention of the header is fine; a second `Bearer` is not.
    // The fetch ladder still takes an authorization STRING (a different
    // shape, for a different API); what may not come back is a second header
    // OBJECT built at a call site.
    expect(src).not.toContain('{ Authorization')
  })
})
