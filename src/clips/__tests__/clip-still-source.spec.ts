/**
 * WHICH address a clip tile asks for its still.
 *
 * ## The live defect this exists for
 *
 * Measured on 592 on 2026-09-21: `listClips` returned **300 rows, 275 of them
 * carrying a SERVED still** on `thumbnail` — a plain JPEG the provider already
 * holds — and the tile asked the MINT route for every single one.
 * `clip-mapping.ts` parsed the served URL into `Clip.thumbnailUrl`, the model
 * documented it, three spec files asserted it, and no component in the app
 * ever read it.
 *
 * The cost is not theoretical. A mint cuts the still out of the file through
 * the provider's queue; a served still is one GET. Asking the queue for 275
 * stills that are already on disk is what put the operator's tiles behind the
 * catalog's own prefetch — *"non vedo thumbnail"* — on the night the prefetch
 * was wired (D577).
 *
 * The ordering rule is therefore: **the still that EXISTS beats the one that
 * has to be made.** A row with neither still falls to the mint, which is what
 * the mint is for; a row with neither falls to nothing at all, and the tile
 * draws its glyph.
 */
import { describe, expect, it } from 'vitest'

import { clipStillSource } from '../clip-still-source.js'

const SERVED = '/addon/provider-reolink/clip-still/592/abc.jpg'
const MINT = '/addon/provider-reolink/clip-thumb/592/abc'

describe('clipStillSource', () => {
  it('prefers the SERVED still — it exists, and costs one GET', () => {
    expect(clipStillSource({ thumbnailUrl: SERVED, thumbnailMintUrl: MINT })).toEqual({
      url: SERVED,
      origin: 'served',
    })
  })

  it('falls back to the MINT when nothing is held yet', () => {
    expect(clipStillSource({ thumbnailMintUrl: MINT })).toEqual({ url: MINT, origin: 'mint' })
  })

  it('is null when the row offers neither, so the tile draws its glyph', () => {
    expect(clipStillSource({})).toBeNull()
  })

  it.each([
    ['an empty served url', { thumbnailUrl: '', thumbnailMintUrl: MINT }, MINT, 'mint'],
    ['a whitespace served url', { thumbnailUrl: '   ', thumbnailMintUrl: MINT }, MINT, 'mint'],
  ])('treats %s as ABSENT and still mints', (_label, clip, url, origin) => {
    // An empty string is a provider that has no still, not an address. Passed
    // to a fetch it resolves to the app's own origin and 404s — a named wait
    // turned into an anonymous broken tile.
    expect(clipStillSource(clip)).toEqual({ url, origin })
  })

  it('is null when the served url is empty and there is no mint either', () => {
    expect(clipStillSource({ thumbnailUrl: '' })).toBeNull()
  })

  it('names the ORIGIN, because the two addresses fail differently', () => {
    // A mint answers 204 while the queue drains and the tile must keep
    // waiting; a served still either is a JPEG or is gone. A caller that
    // cannot tell them apart cannot say which wait is legitimate.
    expect(clipStillSource({ thumbnailUrl: SERVED })?.origin).toBe('served')
    expect(clipStillSource({ thumbnailMintUrl: MINT })?.origin).toBe('mint')
  })
})
