import { describe, it, expect } from 'vitest'
import {
  buildGridEmbedUrl,
  deriveEmbedCacheBust,
  getEmbedCacheBust,
  setEmbedCacheBust,
} from '../embed-url.js'

describe('buildGridEmbedUrl', () => {
  it('builds the grid embed URL on the stream-broker data-plane prefix', () => {
    expect(buildGridEmbedUrl('https://hub.local', 'grid')).toBe(
      'https://hub.local/viewer/camstack/embed/index.html?mode=grid',
    )
  })

  it('builds the player embed URL', () => {
    expect(buildGridEmbedUrl('https://hub.local', 'player')).toBe(
      'https://hub.local/viewer/camstack/embed/index.html?mode=player',
    )
  })

  it('strips a trailing slash on the server URL', () => {
    expect(buildGridEmbedUrl('https://hub.local/', 'grid')).toBe(
      'https://hub.local/viewer/camstack/embed/index.html?mode=grid',
    )
  })

  it('appends devices as a csv when provided', () => {
    expect(buildGridEmbedUrl('https://hub.local', 'grid', { devices: [7, 8, 9] })).toBe(
      'https://hub.local/viewer/camstack/embed/index.html?mode=grid&devices=7,8,9',
    )
  })

  it('omits devices when empty', () => {
    expect(buildGridEmbedUrl('https://hub.local', 'grid', { devices: [] })).toBe(
      'https://hub.local/viewer/camstack/embed/index.html?mode=grid',
    )
  })

  it('never includes a token (token is injected in the body + cookie, not the URL)', () => {
    const url = buildGridEmbedUrl('https://hub.local', 'grid', { devices: [7] })
    expect(url).not.toMatch(/token/i)
  })
})

describe('embed cache identity', () => {
  it('prefers the update id — two OTAs can share a declared version', () => {
    // A publish that forgets to bump `version` produces two different bundles
    // with the same string. The update id is what actually changed.
    expect(deriveEmbedCacheBust({ updateId: 'abcdef0123456789', appVersion: '1.0.259' })).toBe(
      'abcdef012345',
    )
  })

  it('falls back to the declared version, then to dev', () => {
    expect(deriveEmbedCacheBust({ updateId: null, appVersion: '1.0.259' })).toBe('1.0.259')
    expect(deriveEmbedCacheBust({ updateId: null, appVersion: null })).toBe('dev')
    expect(deriveEmbedCacheBust({ updateId: '', appVersion: '' })).toBe('dev')
  })

  // NOTE: there is deliberately no `deriveEmbedCacheBust(x) === deriveEmbedCacheBust(x)`
  // test here. It was written and then removed: put `String(Date.now())` back
  // in the implementation and it still PASSES, because two calls in one tick
  // land in the same millisecond. The stability the fix is about is carried by
  // the two assertions above, which pin the output to the INPUTS — a clock
  // cannot produce 'abcdef012345' or '1.0.259'.

  it('a blank value never overwrites a good identity', () => {
    setEmbedCacheBust('1.0.259')
    setEmbedCacheBust('')
    expect(getEmbedCacheBust()).toBe('1.0.259')
  })
})
