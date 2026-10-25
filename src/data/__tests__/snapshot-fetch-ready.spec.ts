/**
 * A sized camera tile starts its thumbnail download without waiting for
 * `getSnapshotLinks`. The link poll still names the camera; it must not be
 * the thing the first JPEG waits on.
 */
import { describe, expect, it } from 'vitest'
import { snapshotThumbnailFetchReady } from '../snapshot-fetch-ready.js'

const base = {
  enabled: true,
  hasServerUrl: true,
  targetWidth: 320,
  linkRenderable: false,
  linksReady: false,
  linksSupported: true,
  nativeFileCache: true,
}

describe('snapshotThumbnailFetchReady', () => {
  it('starts a native thumbnail before the links poll has answered', () => {
    expect(snapshotThumbnailFetchReady(base)).toBe(true)
  })

  it('still waits on web, where a stable URL would paint a stale disk entry', () => {
    expect(snapshotThumbnailFetchReady({ ...base, nativeFileCache: false })).toBe(false)
  })

  it('does not bootstrap a full-bleed surface that omitted a width', () => {
    expect(snapshotThumbnailFetchReady({ ...base, targetWidth: undefined })).toBe(false)
  })

  it('a disabled surface asks for nothing', () => {
    expect(snapshotThumbnailFetchReady({ ...base, enabled: false })).toBe(false)
  })

  it('an older hub with no links cap fetches once the capability answer has settled', () => {
    expect(
      snapshotThumbnailFetchReady({
        ...base,
        nativeFileCache: false,
        linksReady: true,
        linksSupported: false,
        linkRenderable: false,
      }),
    ).toBe(true)
  })
})
