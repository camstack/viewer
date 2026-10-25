import { describe, it, expect } from 'vitest'
import { buildNotifierIconUrl, isSvgMediaType } from '../notifier-icon.js'

describe('buildNotifierIconUrl', () => {
  it('joins the hub base with a root-relative icon path', () => {
    expect(buildNotifierIconUrl('https://hub.local', '/addon/notifiers/icons/telegram')).toBe(
      'https://hub.local/addon/notifiers/icons/telegram',
    )
  })

  it('trims trailing slashes on the base so it never doubles', () => {
    expect(buildNotifierIconUrl('https://hub.local///', '/addon/notifiers/icons/discord')).toBe(
      'https://hub.local/addon/notifiers/icons/discord',
    )
  })

  it('adds a leading slash when the icon path lacks one', () => {
    expect(buildNotifierIconUrl('https://hub.local', 'addon/notifiers/icons/ntfy')).toBe(
      'https://hub.local/addon/notifiers/icons/ntfy',
    )
  })

  it('passes an already-absolute icon URL through unchanged (base ignored)', () => {
    expect(buildNotifierIconUrl('https://hub.local', 'https://cdn.example/icon.png')).toBe(
      'https://cdn.example/icon.png',
    )
    expect(buildNotifierIconUrl(null, 'http://cdn.example/icon.svg')).toBe('http://cdn.example/icon.svg')
  })

  it('returns null when the icon URL is missing (kind has no bundled icon)', () => {
    expect(buildNotifierIconUrl('https://hub.local', undefined)).toBeNull()
    expect(buildNotifierIconUrl('https://hub.local', null)).toBeNull()
    expect(buildNotifierIconUrl('https://hub.local', '')).toBeNull()
  })

  it('returns null when the hub base is unknown and the path is relative', () => {
    expect(buildNotifierIconUrl(null, '/addon/notifiers/icons/telegram')).toBeNull()
    expect(buildNotifierIconUrl(undefined, '/addon/notifiers/icons/telegram')).toBeNull()
  })
})

/**
 * The renderer selector. This is the actual mobile bug: `expo-image` does not
 * decode SVG on iOS/Android, so handing it `image/svg+xml` silently produced a
 * fallback glyph for 7 of the 8 bundled brand icons — on mobile only, since a
 * browser decodes SVG and the web build looked fine.
 */
describe('isSvgMediaType — which renderer draws the icon', () => {
  it('routes image/svg+xml to the SVG renderer', () => {
    expect(isSvgMediaType('image/svg+xml')).toBe(true)
  })

  it('ignores parameters and case', () => {
    expect(isSvgMediaType('image/SVG+XML; charset=utf-8')).toBe(true)
    expect(isSvgMediaType('  image/svg+xml  ')).toBe(true)
  })

  it('routes raster types to expo-image', () => {
    expect(isSvgMediaType('image/png')).toBe(false)
    expect(isSvgMediaType('image/jpeg')).toBe(false)
  })

  it('treats an ABSENT media type as raster', () => {
    // A legacy server that does not stamp the field still renders: expo-image
    // handling a PNG works, whereas handing a PNG to the SVG parser does not.
    expect(isSvgMediaType(undefined)).toBe(false)
    expect(isSvgMediaType(null)).toBe(false)
    expect(isSvgMediaType('')).toBe(false)
  })
})
