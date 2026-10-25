import { describe, it, expect } from 'vitest'
import {
  buildSnapshotMediaUrl,
  resolveSnapshotUri,
  snapshotVersionTag,
} from '../snapshot-media-url.js'

describe('buildSnapshotMediaUrl', () => {
  it('builds an absolute .jpg URL against the hub base', () => {
    expect(buildSnapshotMediaUrl('https://hub.local:4443', 101)).toBe(
      'https://hub.local:4443/addon/snapshot/media/101.jpg',
    )
  })

  it('strips trailing slashes from the base', () => {
    expect(buildSnapshotMediaUrl('https://hub.local:4443///', 101)).toBe(
      'https://hub.local:4443/addon/snapshot/media/101.jpg',
    )
  })

  it('keeps a stable param order', () => {
    expect(
      buildSnapshotMediaUrl('https://h', 7, {
        version: '1786203296350',
        streamId: 'high',
        force: true,
        width: 320,
      }),
    ).toBe('https://h/addon/snapshot/media/7.jpg?streamId=high&force=1&w=320&v=1786203296350')
  })

  it('omits an empty streamId and a false force', () => {
    const url = buildSnapshotMediaUrl('https://h', 7, { streamId: '', force: false })
    expect(url).toBe('https://h/addon/snapshot/media/7.jpg')
  })
})

describe('target width', () => {
  it('is omitted when not asked for', () => {
    expect(buildSnapshotMediaUrl('https://h', 7)).not.toContain('w=')
  })

  it('rides the query when asked for', () => {
    expect(buildSnapshotMediaUrl('https://h', 7, { width: 320 })).toContain('w=320')
  })

  it.each([0, -1, Number.NaN, 12.5])('is dropped for the non-width %s', (bad) => {
    expect(buildSnapshotMediaUrl('https://h', 7, { width: bad })).not.toContain('w=')
  })
})

describe('snapshotVersionTag — the URL tracks the FRAME, never the clock', () => {
  it('is the capture identity, so an unchanged frame keeps a byte-identical URL', () => {
    // This is the whole caching contract. `expo-image` is URL-keyed and does not
    // revalidate, and the browser cache keys on the full URL too — so a URL that
    // changed on a timer (the old `?v=floor(now/30000)` bucket) guaranteed a
    // full 200 with a full body every window, on every surface, forever.
    expect(snapshotVersionTag(1786203296350, 0)).toBe('1786203296350')
    expect(snapshotVersionTag(1786203296350, 0)).toBe(snapshotVersionTag(1786203296350, 0))
  })

  it('changes when — and only when — the capture changes', () => {
    expect(snapshotVersionTag(1000, 0)).not.toBe(snapshotVersionTag(2000, 0))
  })

  it('is undefined when the frame identity is unknown, so no v is emitted', () => {
    // A stable URL is the right fallback for an older hub: web revalidates on
    // ETag, which is strictly better than busting the cache on a guess.
    expect(snapshotVersionTag(null, 0)).toBeUndefined()
    expect(buildSnapshotMediaUrl('https://h', 7, {})).not.toContain('v=')
  })

  it('a manual refresh epoch still forces a new URL, even on an unmoved frame', () => {
    const before = snapshotVersionTag(1786203296350, 0)
    const after = snapshotVersionTag(1786203296350, 1)
    expect(after).not.toBe(before)
  })

  it('a manual refresh works even before the frame identity is known', () => {
    expect(snapshotVersionTag(null, 3)).toBe('r3')
  })

  it('carries no wall-clock component at all', () => {
    // A regression guard with teeth: the tag for a given (frame, epoch) must be
    // reproducible, so it cannot have consulted Date.now().
    const first = snapshotVersionTag(1786203296350, 2)
    const later = snapshotVersionTag(1786203296350, 2)
    expect(first).toBe(later)
  })
})

describe('resolveSnapshotUri — a cold cache must not be self-sealing', () => {
  // The hub HAS answered in these cases — see the freeze suite below for the
  // case where it has not.
  const base = {
    serverUrl: 'https://h',
    deviceId: 101,
    refreshEpoch: 0,
    width: 320,
    identityKnown: true,
    fallbackTick: 0,
  }

  it('a device with NO cached frame still gets a URL', () => {
    // The regression this exists to prevent, seen in production within hours of
    // shipping Phase 1: the hub OOM'd, restarted with an empty cache, and the
    // overview answered `lastCapturedAt: null` for 15 of 16 cameras. The client
    // treated "no frame identity" as "nothing to request", so it emitted no
    // image request — and the image request is the ONLY thing that enrols a
    // camera in the keep-warm loop and triggers a capture. Null forever, on
    // every surface, until someone forced a refresh.
    const uri = resolveSnapshotUri({ ...base, lastCapturedAt: null })
    expect(uri).not.toBeNull()
    expect(uri).toContain('/addon/snapshot/media/101.jpg')
    expect(uri).toContain('w=320')
  })

  it('that bootstrap URL carries NO version param — it is the stable form', () => {
    // Stable on purpose: there is no frame identity to encode yet, and inventing
    // one (a clock) is the bug D93 removed.
    expect(resolveSnapshotUri({ ...base, lastCapturedAt: null })).not.toContain('v=')
  })

  it('the bootstrap URL is stable across calls, so it cannot become a poll', () => {
    // A camera that legitimately has no frame — a sleeping battery cam — must
    // not be hammered. Same URL every render means one request per mount, and
    // the platform image layer answers the rest.
    const a = resolveSnapshotUri({ ...base, lastCapturedAt: null })
    const b = resolveSnapshotUri({ ...base, lastCapturedAt: null })
    expect(a).toBe(b)
  })

  it('once a frame exists the URL becomes versioned', () => {
    const uri = resolveSnapshotUri({ ...base, lastCapturedAt: 1786216600622 })
    expect(uri).toContain('v=1786216600622')
  })

  it('the bootstrap URL differs from the versioned one, so the first frame is fetched', () => {
    const cold = resolveSnapshotUri({ ...base, lastCapturedAt: null })
    const warm = resolveSnapshotUri({ ...base, lastCapturedAt: 1786216600622 })
    expect(cold).not.toBe(warm)
  })

  it('is null only when there is genuinely nowhere to ask', () => {
    expect(resolveSnapshotUri({ ...base, serverUrl: null, lastCapturedAt: null })).toBeNull()
    expect(resolveSnapshotUri({ ...base, deviceId: 0, lastCapturedAt: null })).toBeNull()
  })

  it('a manual refresh still busts a cold device', () => {
    const uri = resolveSnapshotUri({ ...base, lastCapturedAt: null, refreshEpoch: 2 })
    expect(uri).toContain('v=r2')
  })
})

describe('resolveSnapshotUri — an UNKNOWN identity must never freeze the tile', () => {
  const base = {
    serverUrl: 'https://h',
    deviceId: 101,
    refreshEpoch: 0,
    width: 320,
    lastCapturedAt: null,
    fallbackTick: 0,
  }

  it('a tile with no overview answer eventually changes its URL on its own', () => {
    // The freeze: the frame identity comes from getSnapshotOverview, which is a
    // tRPC call gated on `state === 'connected'`. The IMAGE is a plain HTTP GET
    // that needs nothing from the socket. So when iOS suspends the socket the
    // version stops advancing, the URL stops changing, and expo-image — which is
    // URL-keyed and never revalidates — paints the same frame forever.
    //
    // This is the SAME failure `use-snapshot.ts` documents from the first time
    // it was gated on the socket, reintroduced one level of indirection away.
    const t0 = resolveSnapshotUri({ ...base, identityKnown: false, fallbackTick: 0 })
    const t1 = resolveSnapshotUri({ ...base, identityKnown: false, fallbackTick: 1 })
    const t2 = resolveSnapshotUri({ ...base, identityKnown: false, fallbackTick: 2 })
    expect(t1).not.toBe(t0)
    expect(t2).not.toBe(t1)
  })

  it('costs nothing on a normal start — the first window is the plain stable URL', () => {
    // The overview answers within ~5 s, well inside the first fallback window,
    // so a healthy launch never pays an extra fetch for this safety net.
    expect(resolveSnapshotUri({ ...base, identityKnown: false, fallbackTick: 0 })).not.toContain(
      'v=',
    )
  })

  it('a KNOWN identity is never overridden by the fallback', () => {
    const uri = resolveSnapshotUri({
      ...base,
      lastCapturedAt: 1786216600622,
      identityKnown: true,
      fallbackTick: 7,
    })
    expect(uri).toContain('v=1786216600622')
    expect(uri).not.toContain('f7')
  })

  it('a connecting poster force-refreshes a KNOWN frozen capture', () => {
    const a = resolveSnapshotUri({
      ...base,
      lastCapturedAt: 1786216600622,
      identityKnown: true,
      forceRefreshTick: 1,
    })
    const b = resolveSnapshotUri({
      ...base,
      lastCapturedAt: 1786216600622,
      identityKnown: true,
      forceRefreshTick: 2,
    })
    expect(a).not.toBe(b)
    expect(a).toContain('force=1')
    expect(a).toContain('f1')
  })

  it('a KNOWN-but-null identity stays stable — a sleeping battery cam is not hammered', () => {
    // `known: null` is the hub telling us there is no frame and it will not make
    // one. That must NOT advance, or 640 gets a request every 30 s forever.
    const a = resolveSnapshotUri({ ...base, identityKnown: true, fallbackTick: 3 })
    const b = resolveSnapshotUri({ ...base, identityKnown: true, fallbackTick: 9 })
    expect(a).toBe(b)
    expect(a).not.toContain('v=')
  })

  it('an unknown identity keeps painting the newest frame this session saw', () => {
    // Live failure (2026-08-18): server slow, overview times out mid-session,
    // the URL degraded to the stable form — and expo-image, URL-keyed and never
    // revalidating, served the bytes cached under that URL from the LAST slow
    // episode: a two-week-old JPEG over a camera that was fine seconds before.
    // While unknown, the only honest paint is the newest identity this process
    // actually saw.
    const uri = resolveSnapshotUri({
      ...base,
      identityKnown: false,
      fallbackTick: 0,
      lastKnownCapturedAt: 1786216600622,
    })
    expect(uri).toContain('v=1786216600622')
  })

  it('fallback ticks are unique per episode — never a byte-identical URL across outages', () => {
    // ?v=f1 minted today and ?v=f1 minted two weeks ago are the same cache key
    // to expo-image, so the second outage repainted the first outage's frames.
    const ep1 = resolveSnapshotUri({
      ...base,
      identityKnown: false,
      fallbackTick: 1,
      fallbackEpochMs: 1786000000000,
    })
    const ep2 = resolveSnapshotUri({
      ...base,
      identityKnown: false,
      fallbackTick: 1,
      fallbackEpochMs: 1787000000000,
    })
    expect(ep1).not.toBe(ep2)
  })

  it('the episode nonce composes with the last-known identity', () => {
    const uri = resolveSnapshotUri({
      ...base,
      identityKnown: false,
      fallbackTick: 2,
      lastKnownCapturedAt: 1786216600622,
      fallbackEpochMs: 1787000000000,
    })
    expect(uri).toContain('1786216600622')
    expect(uri).toContain('f2')
    expect(uri).toContain('1787000000000')
  })

  it('the transition bootstrap -> versioned actually changes the URL', () => {
    const boot = resolveSnapshotUri({ ...base, identityKnown: true, fallbackTick: 0 })
    const versioned = resolveSnapshotUri({
      ...base,
      lastCapturedAt: 1786216600622,
      identityKnown: true,
      fallbackTick: 0,
    })
    expect(versioned).not.toBe(boot)
  })

  it('every subsequent capture changes it again — continuous refresh', () => {
    const a = resolveSnapshotUri({ ...base, lastCapturedAt: 1000, identityKnown: true, fallbackTick: 0 })
    const b = resolveSnapshotUri({ ...base, lastCapturedAt: 2000, identityKnown: true, fallbackTick: 0 })
    const c = resolveSnapshotUri({ ...base, lastCapturedAt: 3000, identityKnown: true, fallbackTick: 0 })
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

describe('resolveSnapshotUri — cold start must not paint last week\'s disk cache', () => {
  const base = {
    serverUrl: 'https://h',
    deviceId: 101,
    refreshEpoch: 0,
    width: 320,
    lastCapturedAt: null,
    fallbackTick: 0,
  }

  it('emits no URI until this session has heard the hub name a frame', () => {
    // The stable URL (no `v=`) is byte-identical across weeks. `expo-image`
    // `memory-disk` serves it from disk on a cold start while the hub is
    // unreachable — a week-old JPEG that looks live. Withholding the URI
    // until the hub answers this process is what makes the tile empty instead.
    expect(
      resolveSnapshotUri({ ...base, identityKnown: false, namedThisSession: false }),
    ).toBeNull()
  })

  it('still resolves after this session already heard the hub, even if identity goes unknown', () => {
    // Mid-session socket drop: blanking would be the resume-from-background
    // defect. The last named frame this process may stay on screen.
    expect(
      resolveSnapshotUri({ ...base, identityKnown: false, namedThisSession: true }),
    ).not.toBeNull()
  })
})

describe('a minted link wins over the identity-versioned form', () => {
  const base = {
    serverUrl: 'https://hub.local:4443',
    deviceId: 101,
    lastCapturedAt: 1_786_203_296_350,
    identityKnown: true,
    fallbackTick: 0,
    refreshEpoch: 0,
    width: 240,
  }

  it('resolves the signed link against the connected hub base', () => {
    // The server mints a ROOT-RELATIVE path on purpose — it must never guess the
    // origin the client reached it on (the `hubUrl: localhost` trap). Joining it
    // is the client's job, and it is the only place that knows the answer.
    const link = '/addon/snapshot/link/101.jpg?w=240&v=1786203296350&exp=1786203420000&sig=abc'
    expect(resolveSnapshotUri({ ...base, link })).toBe(`https://hub.local:4443${link}`)
  })

  it('prefers the link even when the overview identity is present', () => {
    // The identity path is the FALLBACK now. `getSnapshotOverview` is cache-only
    // — it answers with whatever the wrapper happens to hold and never captures
    // — whereas the link carries an identity `getSnapshotLinks` waited for. A
    // client that kept preferring the overview would keep the generation lag.
    const link = '/addon/snapshot/link/101.jpg?w=240&v=1786203296350&exp=1786203420000&sig=abc'
    const withLink = resolveSnapshotUri({ ...base, link })
    const withoutLink = resolveSnapshotUri(base)
    expect(withLink).not.toBe(withoutLink)
    expect(withLink).toContain('/addon/snapshot/link/')
    expect(withoutLink).toContain('/addon/snapshot/media/')
  })

  it('falls back to the versioned media URL when the hub mints no link', () => {
    // An older hub answers NOT_FOUND for `getSnapshotLinks`, and the whole
    // D93/D94/D95 path has to keep working untouched underneath.
    expect(resolveSnapshotUri({ ...base, link: null })).toBe(
      resolveSnapshotUri(base),
    )
  })

  it('still returns null when there is nowhere to ask', () => {
    const link = '/addon/snapshot/link/101.jpg?w=240&exp=1&sig=abc'
    expect(resolveSnapshotUri({ ...base, serverUrl: null, link })).toBeNull()
  })

  it('does not double a slash when the base carries one', () => {
    const link = '/addon/snapshot/link/101.jpg?w=240&exp=1&sig=abc'
    expect(resolveSnapshotUri({ ...base, serverUrl: 'https://hub.local:4443/', link })).toBe(
      `https://hub.local:4443${link}`,
    )
  })
})
