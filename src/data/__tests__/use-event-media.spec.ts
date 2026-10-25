import { describe, it, expect } from 'vitest'
import { CLEAN_FALLBACK_KINDS, extractBase64, resolveEventMediaUri } from '../use-event-media.js'

interface MediaLite {
  readonly kind: string
  readonly base64: string
}
function m(kind: string, base64: string): MediaLite {
  return { kind, base64 }
}

describe('extractBase64 — reel/list/grid representative chain (cleanOnly)', () => {
  it('prefers the fast-load thumbnailSmall over every other clean kind', () => {
    const raw = [
      m('crop', 'CROP'),
      m('thumbnail', 'THUMB'),
      m('keyFrameSmall', 'KFS'),
      m('thumbnailSmall', 'SMALL'),
    ]
    expect(extractBase64(raw, undefined, true)).toBe('SMALL')
  })

  it('degrades thumbnailSmall → thumbnail → keyFrameSmall → crop in order', () => {
    expect(extractBase64([m('thumbnail', 'T'), m('crop', 'C')], undefined, true)).toBe('T')
    expect(extractBase64([m('keyFrameSmall', 'KFS'), m('crop', 'C')], undefined, true)).toBe('KFS')
    expect(extractBase64([m('crop', 'C')], undefined, true)).toBe('C')
  })

  it('never degrades to a boxed / cadence frame (→ null so the caller shows an icon)', () => {
    expect(extractBase64([m('fullFrameBoxed', 'B'), m('lastFrame', 'L')], undefined, true)).toBeNull()
  })

  it('the chain lists thumbnailSmall first', () => {
    expect(CLEAN_FALLBACK_KINDS[0]).toBe('thumbnailSmall')
  })
})

describe('resolveEventMediaUri — final uri/isData/failed surfacing', () => {
  it('a fetched base64 fallback wins and is flagged isData', () => {
    const r = resolveEventMediaUri({
      fallbackUri: 'data:image/jpeg;base64,AAA',
      thumbUrl: 'https://hub/event-media/x',
      mediaUrl: undefined,
      failed: false,
    })
    expect(r.uri).toBe('data:image/jpeg;base64,AAA')
    expect(r.isData).toBe(true)
    expect(r.failed).toBe(false)
  })

  it('renders the direct thumbUrl (representative image) while not failed — not a stuck skeleton', () => {
    // A track with NO event crop but a native thumbnail: the server default
    // resolver serves the thumbnail at this direct URL → a real representative
    // image, uri is non-null (the reel tile paints, never stalls).
    const r = resolveEventMediaUri({
      fallbackUri: null,
      thumbUrl: 'https://hub/event-media/track-1',
      mediaUrl: undefined,
      failed: false,
    })
    expect(r.uri).toBe('https://hub/event-media/track-1')
    expect(r.isData).toBe(false)
    expect(r.failed).toBe(false)
  })

  it('drops a KNOWN-BROKEN direct thumbUrl once exhausted → uri null so the caller shows an icon', () => {
    // A synthetic (media-less) track: the direct image 404s AND the base64
    // fallback yields nothing → failed. The direct URL must NOT keep the uri
    // non-null, or the tile spins forever. It degrades to null → class icon.
    const r = resolveEventMediaUri({
      fallbackUri: null,
      thumbUrl: 'https://hub/event-media/pa-synth-1',
      mediaUrl: undefined,
      failed: true,
    })
    expect(r.uri).toBeNull()
    expect(r.failed).toBe(true)
  })

  it('still honours an explicit mediaUrl fast-path even when the direct thumb is exhausted', () => {
    // The non-direct full-frame fallback (a real image) still beats an icon.
    const r = resolveEventMediaUri({
      fallbackUri: null,
      thumbUrl: 'https://hub/event-media/x',
      mediaUrl: 'https://hub/media/full',
      failed: true,
    })
    expect(r.uri).toBe('https://hub/media/full')
    expect(r.failed).toBe(false)
  })

  it('uses mediaUrl as the last resort when there is no fallback or thumb', () => {
    const r = resolveEventMediaUri({
      fallbackUri: null,
      thumbUrl: null,
      mediaUrl: 'https://hub/media/full',
      failed: false,
    })
    expect(r.uri).toBe('https://hub/media/full')
  })

  it('all sources absent → uri null and failed surfaces', () => {
    expect(
      resolveEventMediaUri({ fallbackUri: null, thumbUrl: null, mediaUrl: undefined, failed: true }),
    ).toEqual({ uri: null, isData: false, failed: true })
  })
})
