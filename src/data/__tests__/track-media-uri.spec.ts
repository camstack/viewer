/**
 * Where a media tile's pixels come from.
 *
 * Track media was 5.3-7.7 MB of base64 per track opened, blocking the view, for
 * a strip that shows a few hundred KB. It is now a manifest plus per-tile URLs
 * — each row's OWN `url` (D482), never rebuilt from its `mediaId`. The tests
 * below pin the two rules that keep that from being a regression: bytes
 * already in memory are never re-fetched, and a tile never asks for a
 * full-resolution blob it only renders at 320 px.
 */

import { describe, it, expect } from 'vitest'
import { mediaFileUri, mediaImageSource } from '../track-media-uri.js'
import type { MediaFileLite } from '../track-events.js'

const HUB = 'https://hub.example'

const file = (over: Partial<MediaFileLite> = {}): MediaFileLite => ({
  mediaId: 1,
  url: '/addon/pipeline-analytics/event-media/m/1',
  kind: 'keyFrame',
  timestamp: 1,
  ...over,
})

describe('bytes win when present', () => {
  it('renders a data URI only when the row carries no url', () => {
    expect(mediaFileUri(file({ url: undefined, base64: 'QUJD' }), null)).toBe(
      'data:image/jpeg;base64,QUJD',
    )
  })

  it('prefers the row url even when bytes are in hand — a data URI is a multi-megabyte string rebuilt on every render', () => {
    const uri = mediaFileUri(file({ base64: 'QUJD' }), HUB)
    expect(uri?.startsWith('data:')).toBe(false)
    expect(uri).toBe(`${HUB}/addon/pipeline-analytics/event-media/m/1`)
  })

  it.skip('renders a data URI without touching the server', () => {
    // A file already in memory must never cost a round-trip — this is what
    // keeps the event-owned media path (which does fetch bytes) unchanged.
    const uri = mediaFileUri(file({ url: undefined, base64: 'QUJD' }), HUB)
    expect(uri).toBe('data:image/jpeg;base64,QUJD')
  })

  it('a thumb request goes to the server even when bytes are in hand', () => {
    const uri = mediaFileUri(file({ base64: 'QUJD' }), HUB, { thumbSize: 320 })
    expect(uri).toContain('variant=thumb')
  })

  it('treats an empty base64 as absent rather than rendering nothing', () => {
    const uri = mediaFileUri(file({ base64: '' }), HUB)
    expect(uri).toBe(`${HUB}/addon/pipeline-analytics/event-media/m/1`)
  })
})

describe('URL-backed tiles', () => {
  it('asks for the small square variant for a strip tile', () => {
    // 27 KB against 173 KB for the stored blob, measured.
    const uri = mediaFileUri(file(), HUB, { thumbSize: 320 })
    expect(uri).toContain('variant=thumb')
    expect(uri).toContain('size=320')
  })

  it('asks for the stored blob when no thumb is requested', () => {
    // The large viewer is what the operator zooms into — it must not be a
    // 320px square.
    const uri = mediaFileUri(file(), HUB)
    expect(uri).not.toContain('variant=thumb')
  })

  it('builds against the row\'s own url — never reconstructed from mediaId', () => {
    expect(mediaFileUri(file({ mediaId: 42, url: '/addon/pipeline-analytics/event-media/m/42' }), HUB)).toBe(
      `${HUB}/addon/pipeline-analytics/event-media/m/42`,
    )
  })

  it('an absolute row url is used verbatim (joined by absoluteMediaPath)', () => {
    expect(mediaFileUri(file({ url: 'https://other-hub/m/9' }), HUB)).toBe('https://other-hub/m/9')
  })
})

describe('nothing to render', () => {
  it('is null with neither bytes nor a url', () => {
    expect(mediaFileUri(file({ url: undefined }), null)).toBeNull()
  })

  it('is null for a row with no url and no server (relative url cannot resolve)', () => {
    // A manifest row without a usable address cannot be addressed; the caller
    // renders its placeholder rather than an image that 404s.
    expect(mediaFileUri(file({ url: '' }), null)).toBeNull()
  })

  it('is null for no file at all', () => {
    expect(mediaFileUri(null, HUB)).toBeNull()
    expect(mediaFileUri(undefined, HUB)).toBeNull()
  })
})

/**
 * The media data plane is AUTHENTICATED.
 *
 * A URL-backed tile rendered without the Authorization header shows a
 * broken-image glyph — which is exactly how the whole detail strip went blank
 * the first time the URL rendering shipped. These tests exist because that
 * shipped to a real operator.
 */
describe('image source', () => {
  const AUTH = { Authorization: 'Bearer t' }

  it('attaches auth to a server URL', () => {
    expect(mediaImageSource('https://hub/x', AUTH)).toEqual({ uri: 'https://hub/x', headers: AUTH })
  })

  it('does NOT attach auth to a data URI', () => {
    // A data: URI needs no header, and giving it one is a request that never
    // happens — but it would make the source object unstable across renders.
    expect(mediaImageSource('data:image/jpeg;base64,QQ==', AUTH)).toEqual({
      uri: 'data:image/jpeg;base64,QQ==',
    })
  })

  it('omits headers when there is no token', () => {
    expect(mediaImageSource('https://hub/x', undefined)).toEqual({ uri: 'https://hub/x' })
  })

  it('yields an empty uri for null, so the caller renders its placeholder', () => {
    expect(mediaImageSource(null, AUTH)).toEqual({ uri: '' })
  })
})
