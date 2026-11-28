import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isSignedSnapshotLink,
  shouldAttachSnapshotBearer,
  shouldPaintSignedSnapshotLink,
  type SignedSnapshotLinkInput,
} from '../snapshot-image-auth.js'

const TOKEN = 'jwt-token'
const HUB = 'https://192.0.2.10:4443'
const URI = `${HUB}/addon/snapshot/media/101.jpg?w=480&v=1`

describe('shouldAttachSnapshotBearer', () => {
  it('attaches on native — expo-image honours the header there', () => {
    expect(
      shouldAttachSnapshotBearer({
        platform: 'ios',
        uri: URI,
        token: TOKEN,
      }),
    ).toBe(true)
  })

  it('never attaches to a file:// path — those bytes are ours and carry no auth', () => {
    expect(
      shouldAttachSnapshotBearer({
        platform: 'android',
        uri: 'file:///data/snapshots/101-1.jpg',
        token: TOKEN,
      }),
    ).toBe(false)
  })

  it('attaches on a same-origin web viewer — a token login has no session cookie, a bare <img> is a 401', () => {
    expect(shouldAttachSnapshotBearer({ platform: 'web', uri: URI, token: TOKEN })).toBe(true)
  })

  it('attaches on web when the hub is a different origin than the page', () => {
    expect(
      shouldAttachSnapshotBearer({ platform: 'web', uri: `https://other.example.com/x.jpg`, token: TOKEN }),
    ).toBe(true)
  })

  it('attaches nothing without a uri or a token', () => {
    expect(
      shouldAttachSnapshotBearer({ platform: 'ios', uri: null, token: TOKEN }),
    ).toBe(false)
    expect(
      shouldAttachSnapshotBearer({ platform: 'ios', uri: URI, token: null }),
    ).toBe(false)
    expect(
      shouldAttachSnapshotBearer({ platform: 'ios', uri: URI, token: '' }),
    ).toBe(false)
  })

  it('attaches when the uri is not absolute (no origin to compare)', () => {
    expect(
      shouldAttachSnapshotBearer({
        platform: 'web',
        uri: '/addon/snapshot/media/101.jpg',
        token: TOKEN,
      }),
    ).toBe(true)
  })
})

describe('useSnapshot honours the rule, and keeps the header object stable', () => {
  const hook = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'use-snapshot.ts'),
    'utf8',
  )

  it('asks the shared rule instead of re-deciding', () => {
    expect(hook).toContain('shouldAttachSnapshotBearer')
  })

  it('memoises the headers OUTSIDE the source object', () => {
    // The identity is an expo-image cache key on web: its web loader keys its
    // fetch effect on the whole `source`, and the `source` memo depends on
    // `ageMs`, which is `Date.now()`-derived and therefore new on EVERY render.
    // Building the header inside it meant a fresh object every render and a
    // full re-download of the JPEG every render.
    const headerMemo = hook.indexOf('const headers = useMemo<')
    const sourceMemo = hook.indexOf('const source = useMemo<SnapshotSource>')
    expect(headerMemo).toBeGreaterThan(0)
    expect(sourceMemo).toBeGreaterThan(headerMemo)
    // …and the source memo must LIST it, or it would close over a stale one.
    const deps = hook.slice(sourceMemo)
    expect(deps).toMatch(/\}, \[\s*\n\s*uri,\s*\n\s*headers,/)
  })

  it('falls back to the header when a cookie-authed load fails', () => {
    // The cookie has its own lifetime and can expire under a live JWT. One
    // failure is enough to stop trusting it — the alternative is a whole grid
    // reading "Unavailable" over a credential nothing here can inspect.
    expect(hook).toContain('cookieAuthFailed')
    expect(hook).toContain('setCookieAuthFailed(true)')
  })
})

/**
 * The hosted PWA (dominevo.app) talks to a hub on ANOTHER origin, so the
 * media URL needed a Bearer — a CORS preflight per tile (~110–140 ms through
 * the tunnel) and a JS fetch → blob per frame. The hub's signed link plane is
 * public and HMAC-authorised: painted as a plain `<img>`, it needs neither.
 */
const LINK = '/addon/snapshot/link/101.jpg?w=480&v=1&exp=1790000000000&sig=abc'
const HOSTED = 'https://dominevo.app'
const NOW = 1_789_999_900_000

function signed(overrides: Partial<SignedSnapshotLinkInput> = {}): SignedSnapshotLinkInput {
  return {
    platform: 'web',
    serverUrl: HUB,
    pageOrigin: HOSTED,
    linkPath: LINK,
    expiresAt: 1_790_000_000_000,
    nowMs: NOW,
    failedLinkPath: null,
    ...overrides,
  }
}

describe('shouldPaintSignedSnapshotLink', () => {
  it('a cross-origin web page paints the signed link', () => {
    expect(shouldPaintSignedSnapshotLink(signed())).toBe(true)
  })

  it('never on native — links expire while iOS sleeps; the file cache paints from disk', () => {
    expect(shouldPaintSignedSnapshotLink(signed({ platform: 'ios' }))).toBe(false)
    expect(shouldPaintSignedSnapshotLink(signed({ platform: 'android' }))).toBe(false)
  })

  it('never same-origin — the session cookie already makes the media URL a plain <img>', () => {
    expect(shouldPaintSignedSnapshotLink(signed({ pageOrigin: HUB }))).toBe(false)
  })

  it('never an expired link, a failed link, or no link at all', () => {
    expect(shouldPaintSignedSnapshotLink(signed({ expiresAt: NOW }))).toBe(false)
    expect(shouldPaintSignedSnapshotLink(signed({ failedLinkPath: LINK }))).toBe(false)
    expect(shouldPaintSignedSnapshotLink(signed({ linkPath: null }))).toBe(false)
    expect(shouldPaintSignedSnapshotLink(signed({ serverUrl: null }))).toBe(false)
  })

  it('a NEW link after a failed one is painted again', () => {
    expect(shouldPaintSignedSnapshotLink(signed({ failedLinkPath: LINK.replace('sig=abc', 'sig=old') }))).toBe(true)
  })
})

describe('a signed link never carries a Bearer', () => {
  it('recognises the signed plane, and only it', () => {
    expect(isSignedSnapshotLink(`${HUB}${LINK}`)).toBe(true)
    expect(isSignedSnapshotLink(URI)).toBe(false)
    expect(isSignedSnapshotLink(`${HUB}/addon/snapshot/link/101.jpg?w=480`)).toBe(false)
  })

  it('cross-origin web: no header on the link (that header IS the preflight)', () => {
    expect(
      shouldAttachSnapshotBearer({ platform: 'web', uri: `${HUB}${LINK}`, token: TOKEN }),
    ).toBe(false)
  })

  it('useSnapshot paints the link on web and falls back to the media URL when it fails', () => {
    const hook = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'use-snapshot.ts'),
      'utf8',
    )
    expect(hook).toContain('link: paintSignedLink ? link?.url ?? null : null')
    expect(hook).toMatch(/isSignedSnapshotLink\(uri\)\) \{\s*if \(paintSignedLink && link\?\.url\) setFailedLinkPath\(link\.url\)/)
    expect(hook).toContain("!isSignedSnapshotLink(uri)\n      ? { Authorization")
  })
})
