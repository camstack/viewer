import { describe, expect, it } from 'vitest'
import { absoluteSnapshotLinkUrl, posterUrlFromLinkRows } from '../grid-tile-poster.js'

describe('absoluteSnapshotLinkUrl', () => {
  it('prefixes a root-relative signed link', () => {
    expect(
      absoluteSnapshotLinkUrl('https://hub.local:4443', '/addon/snapshot/link/101.jpg?sig=x'),
    ).toBe('https://hub.local:4443/addon/snapshot/link/101.jpg?sig=x')
  })

  it('leaves an already-absolute URL alone', () => {
    expect(absoluteSnapshotLinkUrl('https://hub.local:4443', 'https://other/x.jpg')).toBe(
      'https://other/x.jpg',
    )
  })

  it('treats a null link as no poster', () => {
    expect(absoluteSnapshotLinkUrl('https://hub.local:4443', null)).toBeNull()
  })
})

describe('posterUrlFromLinkRows', () => {
  it('takes the first row', () => {
    expect(
      posterUrlFromLinkRows('https://hub.local:4443', [
        { url: '/addon/snapshot/link/101.jpg' },
        { url: '/addon/snapshot/link/616.jpg' },
      ]),
    ).toBe('https://hub.local:4443/addon/snapshot/link/101.jpg')
  })
})
