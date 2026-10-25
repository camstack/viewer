import { describe, expect, it } from 'vitest'

import {
  buildLocalEmbedUri,
  buildRemoteEmbedUri,
  embedReadAccessUri,
} from '../embed-source-uri.js'

const ASSET = 'file:///Users/x/Library/Containers/app/Data/Library/Application%20Support/.expo-internal/feb8145a.html'

describe('buildLocalEmbedUri', () => {
  it('keeps the file path intact and puts the mode in the fragment', () => {
    // The defect this holds shut: `?mode=player` appended to a file URL. The
    // WebView loads file sources with `loadFileURL:`, and on the Mac that
    // combination did not render — the URL escaped to the system and Safari
    // opened the raw HTML.
    const uri = buildLocalEmbedUri(ASSET, 'player')
    expect(uri).toBe(`${ASSET}#mode=player`)
    expect(uri).not.toContain('?')
  })

  it('replaces a fragment rather than stacking a second one', () => {
    expect(buildLocalEmbedUri(`${ASSET}#mode=grid`, 'events')).toBe(`${ASSET}#mode=events`)
  })
})

describe('buildRemoteEmbedUri', () => {
  it('addresses the hub copy, query and all — it is not a file URL', () => {
    expect(buildRemoteEmbedUri('https://hub:4443', 'grid')).toBe(
      'https://hub:4443/viewer/camstack/embed/index.html?mode=grid',
    )
  })

  it('does not double the slash on a server url that ends with one', () => {
    expect(buildRemoteEmbedUri('https://hub:4443/', 'player')).toBe(
      'https://hub:4443/viewer/camstack/embed/index.html?mode=player',
    )
  })
})

describe('embedReadAccessUri', () => {
  it('grants the asset FOLDER, not the single file', () => {
    expect(embedReadAccessUri(ASSET)).toBe(
      'file:///Users/x/Library/Containers/app/Data/Library/Application%20Support/.expo-internal',
    )
  })

  it('ignores a fragment and a query when finding the folder', () => {
    expect(embedReadAccessUri(`${ASSET}#mode=player`)).toBe(embedReadAccessUri(ASSET))
  })

  it('answers null rather than an empty grant on a pathless uri', () => {
    expect(embedReadAccessUri('file:///')).toBeNull()
  })
})
