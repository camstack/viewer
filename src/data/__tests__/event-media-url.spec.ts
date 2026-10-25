import { describe, it, expect } from 'vitest'
import {
  EVENT_MEDIA_PATH,
  absoluteMediaPath,
  buildMediaIdUrl,
  buildMediaOwnerUrl,
  withThumbVariant,
} from '../event-media-url.js'

describe('buildMediaIdUrl — one media row, by its own id (D482)', () => {
  it('builds an absolute full-blob URL (no variant)', () => {
    expect(buildMediaIdUrl('https://hub:4443', 42)).toBe(
      `https://hub:4443${EVENT_MEDIA_PATH}/m/42`,
    )
  })

  it('strips a trailing slash from the base', () => {
    expect(buildMediaIdUrl('https://hub:4443/', 42)).toBe(
      `https://hub:4443${EVENT_MEDIA_PATH}/m/42`,
    )
  })

  it('appends the thumb variant with the default size', () => {
    expect(buildMediaIdUrl('https://hub:4443', 42, { variant: 'thumb' })).toBe(
      `https://hub:4443${EVENT_MEDIA_PATH}/m/42?variant=thumb`,
    )
  })

  it('appends the thumb variant with an explicit size', () => {
    expect(buildMediaIdUrl('https://hub:4443', 42, { variant: 'thumb', size: 144 })).toBe(
      `https://hub:4443${EVENT_MEDIA_PATH}/m/42?variant=thumb&size=144`,
    )
  })

  it('appends a forced kind (reel crop) after the variant + size', () => {
    expect(
      buildMediaIdUrl('https://hub:4443', 42, { variant: 'thumb', size: 192, kind: 'crop' }),
    ).toBe(`https://hub:4443${EVENT_MEDIA_PATH}/m/42?variant=thumb&size=192&kind=crop`)
  })

  it('appends the kind even without an explicit size', () => {
    expect(buildMediaIdUrl('https://hub:4443', 42, { variant: 'thumb', kind: 'crop' })).toBe(
      `https://hub:4443${EVENT_MEDIA_PATH}/m/42?variant=thumb&kind=crop`,
    )
  })

  it('omits the kind when it is an empty string', () => {
    expect(buildMediaIdUrl('https://hub:4443', 42, { variant: 'thumb', kind: '' })).toBe(
      `https://hub:4443${EVENT_MEDIA_PATH}/m/42?variant=thumb`,
    )
  })

  it('builds a full-size kind-forced URL (?kind=crop, no variant) — the timeline card', () => {
    expect(buildMediaIdUrl('https://hub:4443', 42, { kind: 'crop' })).toBe(
      `https://hub:4443${EVENT_MEDIA_PATH}/m/42?kind=crop`,
    )
  })
})

describe('buildMediaOwnerUrl — best media OF an owner (D482)', () => {
  it('builds an absolute owner URL', () => {
    expect(buildMediaOwnerUrl('https://hub:4443', 'track', 'trk-1')).toBe(
      `https://hub:4443${EVENT_MEDIA_PATH}/o/track/trk-1`,
    )
  })

  it('percent-encodes the owner id — it is an arbitrary row key, not a UUID', () => {
    // `summary` owners left with D680; any owner kind exercises the encoding.
    expect(buildMediaOwnerUrl('https://hub:4443', 'mosaic', 'mosaic-r1/w2')).toBe(
      `https://hub:4443${EVENT_MEDIA_PATH}/o/mosaic/${encodeURIComponent('mosaic-r1/w2')}`,
    )
  })

  it('carries the thumb variant + kind, same as the id form', () => {
    expect(
      buildMediaOwnerUrl('https://hub:4443', 'object', '9', { variant: 'thumb', size: 192, kind: 'crop' }),
    ).toBe(`https://hub:4443${EVENT_MEDIA_PATH}/o/object/9?variant=thumb&size=192&kind=crop`)
  })

  it('strips a trailing slash from the base', () => {
    expect(buildMediaOwnerUrl('https://hub:4443/', 'track', 't1')).toBe(
      `https://hub:4443${EVENT_MEDIA_PATH}/o/track/t1`,
    )
  })
})

describe('withThumbVariant', () => {
  it('appends with ? when no existing query', () => {
    expect(withThumbVariant('/addon/x/event-media/m/1')).toBe(
      '/addon/x/event-media/m/1?variant=thumb',
    )
  })

  it('appends with & when a query already exists', () => {
    expect(withThumbVariant('/addon/x/event-media/m/1?foo=1', 192)).toBe(
      '/addon/x/event-media/m/1?foo=1&variant=thumb&size=192',
    )
  })
})

describe('absoluteMediaPath', () => {
  it('joins a hub-relative crop path to the connected origin', () => {
    expect(absoluteMediaPath('https://hub:4443', '/addon/pipeline-analytics/event-media/m/1')).toBe(
      'https://hub:4443/addon/pipeline-analytics/event-media/m/1',
    )
  })

  it('passes through an already-absolute URL and a data URI', () => {
    expect(absoluteMediaPath('https://hub', 'https://other/x')).toBe('https://other/x')
    expect(absoluteMediaPath('https://hub', 'data:image/jpeg;base64,QQ==')).toBe(
      'data:image/jpeg;base64,QQ==',
    )
  })

  it('returns null when there is no path, or a relative path with no origin', () => {
    expect(absoluteMediaPath('https://hub', undefined)).toBeNull()
    expect(absoluteMediaPath(null, '/addon/x')).toBeNull()
  })
})
