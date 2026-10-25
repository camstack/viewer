/**
 * The pure half of the native snapshot file cache: how a frame's bytes are
 * NAMED on disk, and when a download is worth making.
 *
 * Every rule here exists because `expo-image` is URL-keyed, never revalidates,
 * and owns a disk cache we cannot inspect — so three separate incidents ended
 * with a tile painting pixels of unknown provenance (a two-week-old JPEG among
 * them). The file cache replaces that opaque store with one we name ourselves,
 * and the naming IS the provenance: a file whose name does not state which
 * capture is inside it must never be painted.
 */
import { describe, it, expect } from 'vitest'
import {
  decideSnapshotFetch,
  parseSnapshotCacheFileName,
  parseSnapshotEtag,
  pickCachedSnapshot,
  readEtagHeader,
  planSnapshotCacheSweep,
  sanitizeEtagToken,
  snapshotCacheEntryFor,
  snapshotCacheIfNoneMatch,
  snapshotCacheTmpFileName,
  snapshotCacheWidthKey,
  SNAPSHOT_CACHE_MAX_AGE_MS,
} from '../snapshot-file-cache.js'

describe('parseSnapshotEtag — the capture time is STATED BY THE SERVER', () => {
  // `snapshot-media-handler.ts` builds the tag as
  // `"<deviceId>-<capturedAt>[-s<stream>][-w<width>][-v<variant>]"`. Reading it
  // is what lets a cached file carry an honest age with no sidecar file and no
  // live WebSocket — the age badge works at a cold start with the hub down.
  it('reads the device and the capture time out of the base form', () => {
    expect(parseSnapshotEtag('"101-1786203296350"')).toEqual({
      deviceId: 101,
      capturedAt: 1786203296350,
    })
  })

  it('reads them out of the variant form (width, stream, state overlay)', () => {
    expect(parseSnapshotEtag('"101-1786203296350-w320"')).toEqual({
      deviceId: 101,
      capturedAt: 1786203296350,
    })
    expect(parseSnapshotEtag('"101-1786203296350-shigh-w320-vsleeping"')).toEqual({
      deviceId: 101,
      capturedAt: 1786203296350,
    })
  })

  it('tolerates a weak validator and missing quotes', () => {
    expect(parseSnapshotEtag('W/"101-1000"')).toEqual({ deviceId: 101, capturedAt: 1000 })
    expect(parseSnapshotEtag('101-1000')).toEqual({ deviceId: 101, capturedAt: 1000 })
  })

  it.each(['', '"101"', '"101-"', '"abc-def"', '"101-0"', '"-1-1000"'])(
    'refuses %s rather than inventing an identity',
    (bad) => {
      expect(parseSnapshotEtag(bad)).toBeNull()
    },
  )

  it('refuses absent input', () => {
    expect(parseSnapshotEtag(null)).toBeNull()
    expect(parseSnapshotEtag(undefined)).toBeNull()
  })
})

describe('snapshotCacheWidthKey — one file per (device, WIDTH)', () => {
  // Not per device. Surfaces render the same camera at different widths (a card
  // at ~180, a grid tile, a full-bleed poster at the 960 rung); one path per
  // device would have two surfaces overwrite each other and paint a 180 px
  // thumbnail into a full-bleed poster.
  it('is the requested width when there is one', () => {
    expect(snapshotCacheWidthKey(320)).toBe('w320')
    expect(snapshotCacheWidthKey(960)).toBe('w960')
  })

  it.each([undefined, 0, -1, 12.5, Number.NaN])('is `full` for %s', (bad) => {
    expect(snapshotCacheWidthKey(bad)).toBe('full')
  })
})

describe('the file name IS the metadata', () => {
  // Deliberately no sidecar JSON. Bytes and provenance land in ONE atomic
  // rename, so they cannot desync: a file that exists is a file whose capture
  // time we know.
  it('names the device, the width and the server ETag', () => {
    const entry = snapshotCacheEntryFor(101, 320, '"101-1786203296350-w320"')
    expect(entry).toEqual({
      fileName: '101_w320_101-1786203296350-w320.jpg',
      deviceId: 101,
      widthKey: 'w320',
      etagToken: '101-1786203296350-w320',
      capturedAt: 1786203296350,
    })
  })

  it('round-trips through the parser', () => {
    const entry = snapshotCacheEntryFor(101, 320, '"101-1000-w320"')
    expect(entry).not.toBeNull()
    if (entry === null) return
    expect(parseSnapshotCacheFileName(entry.fileName)).toEqual(entry)
  })

  it('rebuilds the exact If-None-Match the server will compare', () => {
    const entry = snapshotCacheEntryFor(101, 320, '"101-1000-w320"')
    expect(entry).not.toBeNull()
    if (entry === null) return
    expect(snapshotCacheIfNoneMatch(entry)).toBe('"101-1000-w320"')
  })

  it('refuses an ETag that names a DIFFERENT device', () => {
    // A mis-routed response must never be stored under this camera's name.
    expect(snapshotCacheEntryFor(616, 320, '"101-1000-w320"')).toBeNull()
  })

  it('refuses bytes with no stateable identity', () => {
    expect(snapshotCacheEntryFor(101, 320, null)).toBeNull()
    expect(snapshotCacheEntryFor(101, 320, '"junk"')).toBeNull()
  })

  it('keeps the name safe for a file system', () => {
    // The separator is `_` and the token keeps only `[A-Za-z0-9-]`, so nothing
    // in a server tag can break the parse or escape the directory.
    expect(sanitizeEtagToken('W/"101-1000-v../../etc/passwd"')).toBe('101-1000-vetcpasswd')
    expect(sanitizeEtagToken('"101-1000-v a_b"')).toBe('101-1000-vab')
  })

  it.each([
    '101_w320.jpg',
    '101_bogus_101-1000.jpg',
    '101_w320_101-1000-w320.tmp',
    'x_w320_101-1000.jpg',
    '101_w320_.jpg',
    '101_w320_101-1000-w320.jpeg',
  ])('rejects the unparseable name %s', (bad) => {
    expect(parseSnapshotCacheFileName(bad)).toBeNull()
  })

  it('names the temp file WITHOUT an identity, so a half-written frame is unpaintable', () => {
    // downloadAsync writes straight into its target. Downloading onto the final
    // name would leave a truncated JPEG under a name that claims a good capture.
    const tmp = snapshotCacheTmpFileName(101, 'w320')
    expect(tmp).toBe('101_w320.tmp')
    expect(parseSnapshotCacheFileName(tmp)).toBeNull()
  })
})

describe('pickCachedSnapshot', () => {
  const names = [
    '101_w320_101-1000-w320.jpg',
    '101_w320_101-3000-w320.jpg',
    '101_w960_101-9000-w960.jpg',
    '616_w320_616-5000-w320.jpg',
    'garbage.jpg',
  ]

  it('picks the newest capture for the asked (device, width)', () => {
    expect(pickCachedSnapshot(names, 101, 'w320')?.capturedAt).toBe(3000)
  })

  it('never crosses a width or a device', () => {
    expect(pickCachedSnapshot(names, 101, 'w960')?.capturedAt).toBe(9000)
    expect(pickCachedSnapshot(names, 616, 'w320')?.capturedAt).toBe(5000)
    expect(pickCachedSnapshot(names, 102, 'w320')).toBeNull()
    expect(pickCachedSnapshot(names, 101, 'full')).toBeNull()
  })
})

describe('planSnapshotCacheSweep — bounded disk, one frame per surface', () => {
  const now = 10_000_000_000

  it('keeps the newest per (device, width) and removes the superseded', () => {
    const plan = planSnapshotCacheSweep(
      [
        `101_w320_101-${String(now - 1000)}-w320.jpg`,
        `101_w320_101-${String(now - 5000)}-w320.jpg`,
        `101_w960_101-${String(now - 2000)}-w960.jpg`,
      ],
      now,
    )
    expect(plan.keep).toEqual([
      `101_w320_101-${String(now - 1000)}-w320.jpg`,
      `101_w960_101-${String(now - 2000)}-w960.jpg`,
    ])
    expect(plan.remove).toEqual([`101_w320_101-${String(now - 5000)}-w320.jpg`])
  })

  it('removes a temp file left by a killed download', () => {
    const plan = planSnapshotCacheSweep(['101_w320.tmp'], now)
    expect(plan.remove).toEqual(['101_w320.tmp'])
    expect(plan.keep).toEqual([])
  })

  it('removes anything it cannot read — the directory is ours alone', () => {
    const plan = planSnapshotCacheSweep(['README', '101_w320_junk.jpg'], now)
    expect(plan.remove).toEqual(['README', '101_w320_junk.jpg'])
  })

  it('removes a frame too old to be worth any disk at all', () => {
    const ancient = now - SNAPSHOT_CACHE_MAX_AGE_MS - 1
    const plan = planSnapshotCacheSweep([`101_w320_101-${String(ancient)}-w320.jpg`], now)
    expect(plan.keep).toEqual([])
    expect(plan.remove).toEqual([`101_w320_101-${String(ancient)}-w320.jpg`])
  })

  it('keeps a frame that is merely stale — offline honesty needs it', () => {
    // The freshness contract (2026-08-16) is "paint always, the badge
    // communicates staleness". A day-old frame plus "1d" is the whole point of
    // the cache; blanking is what the operator reported as broken.
    const old = now - 24 * 60 * 60 * 1000
    const plan = planSnapshotCacheSweep([`101_w320_101-${String(old)}-w320.jpg`], now)
    expect(plan.keep).toEqual([`101_w320_101-${String(old)}-w320.jpg`])
    expect(plan.remove).toEqual([])
  })
})

describe('decideSnapshotFetch — one download per frame, never two', () => {
  const cached = snapshotCacheEntryFor(101, 320, '"101-1000-w320"')
  const base = {
    enabled: true,
    remoteUrl: 'https://h/addon/snapshot/media/101.jpg?w=320&v=2000',
    cached,
    settledUrl: null,
    inFlight: false,
  }

  it('fetches an identity this session has not asked for yet', () => {
    expect(decideSnapshotFetch(base)).toEqual({
      kind: 'fetch',
      url: base.remoteUrl,
      ifNoneMatch: '"101-1000-w320"',
    })
  })

  it('sends NO validator when there is nothing on disk to validate', () => {
    expect(decideSnapshotFetch({ ...base, cached: null })).toEqual({
      kind: 'fetch',
      url: base.remoteUrl,
      ifNoneMatch: null,
    })
  })

  it('asks once per identity — a re-render is not a new frame', () => {
    // The tile re-renders on every 5 s overview tick. Without this the cache
    // would download the same frame all day, which is the cost the whole
    // identity-versioned URL design exists to avoid.
    expect(decideSnapshotFetch({ ...base, settledUrl: base.remoteUrl })).toEqual({ kind: 'keep' })
  })

  it('asks again as soon as the identity moves', () => {
    const next = { ...base, settledUrl: base.remoteUrl, remoteUrl: `${base.remoteUrl}x` }
    expect(decideSnapshotFetch(next).kind).toBe('fetch')
  })

  it('never runs two downloads for the same surface at once', () => {
    expect(decideSnapshotFetch({ ...base, inFlight: true })).toEqual({ kind: 'keep' })
  })

  it('asks nothing when the surface is disabled or there is nowhere to ask', () => {
    expect(decideSnapshotFetch({ ...base, enabled: false })).toEqual({ kind: 'skip' })
    expect(decideSnapshotFetch({ ...base, remoteUrl: null })).toEqual({ kind: 'skip' })
  })
})

describe('readEtagHeader — provenance must survive the platform header casing', () => {
  it('reads the header whatever case it arrives in', () => {
    expect(readEtagHeader({ etag: '"101-1000"' })).toBe('"101-1000"')
    expect(readEtagHeader({ ETag: '"101-1000"' })).toBe('"101-1000"')
    expect(readEtagHeader({ Etag: '"101-1000"' })).toBe('"101-1000"')
  })

  it('is null when the response states nothing', () => {
    expect(readEtagHeader({})).toBeNull()
    expect(readEtagHeader({ etag: '' })).toBeNull()
    expect(readEtagHeader(undefined)).toBeNull()
  })
})
