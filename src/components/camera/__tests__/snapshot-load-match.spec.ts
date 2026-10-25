import { describe, it, expect } from 'vitest'
import { isLoadOfCandidate } from '../snapshot-load-match.js'

const HUB_URL = 'https://camstack.example.top/addon/snapshot/media/103.jpg?w=302&v=1791295307140'

describe('isLoadOfCandidate', () => {
  it('accepts a load whose URL is the candidate URL (native, same-origin web)', () => {
    expect(isLoadOfCandidate(HUB_URL, { uri: HUB_URL })).toBe(true)
  })

  // The hosted PWA reaches the hub cross-origin, so the tile carries a Bearer
  // header. expo-image's web loader cannot put a header on an <img>: it fetches
  // the bytes and paints an OBJECT URL, so the load event reports `blob:…`,
  // never the hub URL. Refusing that load left `everLoaded` false and the
  // skeleton over a painted frame until the 15 s hub timeout lifted it.
  it('accepts the object URL a header-carrying candidate is painted from on web', () => {
    const loaded = 'blob:https://camstack.zentik.app/2b0e4a8e-6c1d-4f5e-9a0b-1c2d3e4f5a6b'
    expect(isLoadOfCandidate(loaded, { uri: HUB_URL, headers: { Authorization: 'Bearer t' } })).toBe(true)
  })

  it('still refuses a late load of a DIFFERENT generation', () => {
    const older = 'https://camstack.example.top/addon/snapshot/media/103.jpg?w=302&v=1791295263726'
    expect(isLoadOfCandidate(older, { uri: HUB_URL })).toBe(false)
    expect(isLoadOfCandidate(older, { uri: HUB_URL, headers: { Authorization: 'Bearer t' } })).toBe(false)
  })

  it('does not take an object URL for a candidate that has no header (it never paints one)', () => {
    expect(isLoadOfCandidate('blob:https://camstack.zentik.app/x', { uri: HUB_URL })).toBe(false)
  })
})
