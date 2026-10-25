import { describe, it, expect } from 'vitest'
import {
  groupTrackMedia,
  groupForKey,
  logicalMediaKindLabel,
  readJpegSize,
  base64PrefixToBytes,
  formatResolution,
  mergePlateFallback,
  type MediaGroup,
} from '../track-media-groups.js'
import { mediaFileId, type MediaFileLite } from '../track-events.js'
import en from '../../../locales/en.json'

const enLocale = en.v2

function mf(over: Partial<MediaFileLite> = {}): MediaFileLite {
  return { mediaId: 1, kind: 'crop', base64: 'AAAA', timestamp: 0, ...over }
}

/** Build a minimal valid JPEG (SOI + APP0 + SOF0 + SOS) with a known size. */
function makeJpeg(width: number, height: number): string {
  const bytes: number[] = [
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // APP0 (len 16)
    0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0 marker + len(17) + precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // 3 components
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, // SOS
  ]
  return Buffer.from(Uint8Array.from(bytes)).toString('base64')
}

describe('groupTrackMedia — one tile per logical kind', () => {
  it('collapses thumbnail + thumbnailSmall into ONE best-shot group', () => {
    const groups = groupTrackMedia([
      mf({ mediaId: 1, kind: 'thumbnail', timestamp: 5 }),
      mf({ mediaId: 2, kind: 'thumbnailSmall', timestamp: 5 }),
    ])
    expect(groups).toHaveLength(1)
    const g = groups[0]
    expect(g.logicalKind).toBe('bestShot')
    expect(g.display.mediaId).toBe(2) // small variant shown
    expect(g.full.mediaId).toBe(1) // native variant on demand
    expect(g.hasFullVariant).toBe(true)
  })

  it('collapses keyFrame + keyFrameSmall into ONE key-frame group', () => {
    const groups = groupTrackMedia([
      mf({ mediaId: 10, kind: 'keyFrame' }),
      mf({ mediaId: 11, kind: 'keyFrameSmall' }),
    ])
    const kf = groups.find((g) => g.logicalKind === 'keyFrame')
    expect(kf).toBeDefined()
    expect(kf?.display.mediaId).toBe(11)
    expect(kf?.full.mediaId).toBe(10)
    expect(kf?.hasFullVariant).toBe(true)
  })

  it('a single native variant (no small sibling) shows itself, no full affordance', () => {
    const groups = groupTrackMedia([mf({ mediaId: 1, kind: 'thumbnail' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].display.mediaId).toBe(1)
    expect(groups[0].full.mediaId).toBe(1)
    expect(groups[0].hasFullVariant).toBe(false)
  })

  it('keeps distinct snapshots as separate tiles', () => {
    const groups = groupTrackMedia([
      mf({ mediaId: 1, kind: 'snapshot', timestamp: 1 }),
      mf({ mediaId: 2, kind: 'snapshot', timestamp: 2 }),
    ])
    expect(groups.filter((g) => g.logicalKind === 'snapshot')).toHaveLength(2)
  })

  it('separates the clean frame and the boxed frame', () => {
    const groups = groupTrackMedia([
      mf({ mediaId: 1, kind: 'fullFrame' }),
      mf({ mediaId: 2, kind: 'fullFrameBoxed' }),
    ])
    expect(groups.map((g) => g.logicalKind).sort()).toEqual(['frame', 'frameBoxed'])
  })

  it('pins best shot first + key frame second regardless of their timestamps', () => {
    // best shot / key frame carry LATER timestamps than the rest, yet stay pinned.
    const groups = groupTrackMedia([
      mf({ mediaId: 1, kind: 'snapshot', timestamp: 9 }),
      mf({ mediaId: 2, kind: 'keyFrame', timestamp: 200 }),
      mf({ mediaId: 3, kind: 'thumbnail', timestamp: 100 }),
    ])
    expect(groups.map((g) => g.logicalKind)).toEqual(['bestShot', 'keyFrame', 'snapshot'])
  })

  it('orders [best shot, key frame, then the rest CHRONOLOGICALLY by timestamp]', () => {
    // Deliberately shuffled input; best/key carry mid-range timestamps.
    const groups = groupTrackMedia([
      mf({ mediaId: 1, kind: 'lastFrame', timestamp: 100 }),
      mf({ mediaId: 2, kind: 'snapshot', timestamp: 60 }),
      mf({ mediaId: 3, kind: 'keyFrame', timestamp: 50 }),
      mf({ mediaId: 4, kind: 'keyFrameSmall', timestamp: 50 }),
      mf({ mediaId: 5, kind: 'snapshot', timestamp: 40 }),
      mf({ mediaId: 6, kind: 'firstFrame', timestamp: 10 }),
      mf({ mediaId: 7, kind: 'thumbnail', timestamp: 55 }),
      mf({ mediaId: 8, kind: 'thumbnailSmall', timestamp: 55 }),
    ])
    expect(groups.map((g) => g.logicalKind)).toEqual([
      'bestShot', 'keyFrame', 'firstFrame', 'snapshot', 'snapshot', 'lastFrame',
    ])
    // The "rest" bucket is strictly ascending by media timestamp.
    const rest = groups.slice(2)
    expect(rest.map((g) => g.timestamp)).toEqual([10, 40, 60, 100])
  })

  it('pins [best shot, key frame, face, plate] to the front, then chronological rest', () => {
    // face/plate carry LATE timestamps yet stay pinned ahead of the chronological rest.
    const groups = groupTrackMedia([
      mf({ mediaId: 1, kind: 'lastFrame', timestamp: 100 }),
      mf({ mediaId: 2, kind: 'plateCrop', timestamp: 90 }),
      mf({ mediaId: 3, kind: 'faceCrop', timestamp: 80 }),
      mf({ mediaId: 4, kind: 'snapshot', timestamp: 40 }),
      mf({ mediaId: 5, kind: 'keyFrame', timestamp: 50 }),
      mf({ mediaId: 6, kind: 'firstFrame', timestamp: 10 }),
      mf({ mediaId: 7, kind: 'thumbnail', timestamp: 55 }),
    ])
    expect(groups.map((g) => g.logicalKind)).toEqual([
      'bestShot', 'keyFrame', 'face', 'plate', 'firstFrame', 'snapshot', 'lastFrame',
    ])
  })

  it('omits the face/plate tiles entirely when the pipeline stored none', () => {
    const groups = groupTrackMedia([
      mf({ mediaId: 1, kind: 'thumbnail', timestamp: 1 }),
      mf({ mediaId: 2, kind: 'keyFrame', timestamp: 2 }),
      mf({ mediaId: 3, kind: 'snapshot', timestamp: 3 }),
    ])
    expect(groups.map((g) => g.logicalKind)).toEqual(['bestShot', 'keyFrame', 'snapshot'])
  })

  it('breaks equal-timestamp ties by id (stable, deterministic)', () => {
    const groups = groupTrackMedia([
      mf({ mediaId: 99, kind: 'snapshot', timestamp: 5 }),
      mf({ mediaId: 2, kind: 'snapshot', timestamp: 5 }),
    ])
    expect(groups.map((g) => g.display.mediaId)).toEqual([2, 99])
  })

  it('is empty for no files', () => {
    expect(groupTrackMedia([])).toEqual([])
  })

  it('unknown kinds fall through to per-file "other" groups', () => {
    const groups = groupTrackMedia([mf({ mediaId: 1, kind: 'debugDump' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].logicalKind).toBe('other')
  })
})

describe('groupForKey', () => {
  const groups: MediaGroup[] = groupTrackMedia([
    mf({ mediaId: 1, kind: 'thumbnail' }),
    mf({ mediaId: 2, kind: 'thumbnailSmall' }),
  ])
  it('matches either the display or the full variant id', () => {
    expect(groupForKey(groups, mediaFileId({ mediaId: 2, kind: 'thumbnailSmall', timestamp: 0 }))?.logicalKind).toBe('bestShot')
    expect(groupForKey(groups, mediaFileId({ mediaId: 1, kind: 'thumbnail', timestamp: 0 }))?.logicalKind).toBe('bestShot')
  })
  it('returns null for an unknown id or null', () => {
    expect(groupForKey(groups, 'id:404')).toBeNull()
    expect(groupForKey(groups, null)).toBeNull()
  })
})

describe('logicalMediaKindLabel', () => {
  const t = (k: string): string => (k.split('.').reduce<unknown>((o, part) => (o as Record<string, unknown>)?.[part], en) as string) ?? k
  it('labels best shot and key frame from the existing mediaKind i18n', () => {
    const [best] = groupTrackMedia([mf({ mediaId: 1, kind: 'thumbnail' })])
    const [kf] = groupTrackMedia([mf({ mediaId: 2, kind: 'keyFrame' })])
    expect(logicalMediaKindLabel(best, t)).toBe(enLocale.mediaKind.thumbnail)
    expect(logicalMediaKindLabel(kf, t)).toBe(enLocale.mediaKind.keyFrame)
  })
  it('falls back to the raw kind for an "other" group', () => {
    const [other] = groupTrackMedia([mf({ mediaId: 1, kind: 'debugDump' })])
    expect(logicalMediaKindLabel(other, t)).toBe('debugDump')
  })
})

describe('readJpegSize', () => {
  it('parses the SOF0 dimensions of a real JPEG header', () => {
    expect(readJpegSize(makeJpeg(1920, 1080))).toEqual({ width: 1920, height: 1080 })
    expect(readJpegSize(makeJpeg(480, 480))).toEqual({ width: 480, height: 480 })
    expect(readJpegSize(makeJpeg(3840, 2160))).toEqual({ width: 3840, height: 2160 })
  })
  it('returns null for a non-JPEG / garbage / empty input', () => {
    expect(readJpegSize('AAAA')).toBeNull()
    expect(readJpegSize('')).toBeNull()
    expect(readJpegSize(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'))).toBeNull() // PNG
  })
})

describe('base64PrefixToBytes', () => {
  it('decodes a bounded prefix', () => {
    const b64 = Buffer.from(Uint8Array.from([1, 2, 3, 4, 5, 6])).toString('base64')
    expect(Array.from(base64PrefixToBytes(b64, 3))).toEqual([1, 2, 3])
    expect(Array.from(base64PrefixToBytes(b64, 100))).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('formatResolution', () => {
  it('formats a size and passes null through', () => {
    expect(formatResolution({ width: 960, height: 540 })).toBe('960×540')
    expect(formatResolution(null)).toBeNull()
  })
})

describe('mergePlateFallback', () => {
  const plate = {
    plateId: 'plate-1',
    base64: 'PLATEB64',
    timestamp: 500,
    cropUrl: '/addon/pipeline-analytics/event-media/m/77',
    mediaId: 77,
  }

  it('appends a synthetic plateCrop tile carrying the fallback\'s url', () => {
    const out = mergePlateFallback([mf({ mediaId: 1, kind: 'thumbnail' })], plate)
    const pc = out.find((f) => f.kind === 'plateCrop')
    expect(pc).toBeDefined()
    expect(pc?.url).toBe('/addon/pipeline-analytics/event-media/m/77')
    expect(pc?.mediaId).toBe(77)
    expect(pc?.base64).toBeUndefined()
    // and it groups into a pinned plate tile
    const groups = groupTrackMedia(out)
    expect(groups.map((g) => g.logicalKind)).toEqual(['bestShot', 'plate'])
  })

  it('is a no-op when a real plateCrop already exists (event media wins)', () => {
    const gallery = [mf({ mediaId: 9, kind: 'plateCrop', base64: 'REAL' })]
    const out = mergePlateFallback(gallery, plate)
    expect(out.filter((f) => f.kind === 'plateCrop').map((f) => f.mediaId)).toEqual([9])
  })

  it('is a no-op for a null plate or an empty crop', () => {
    const gallery = [mf({ mediaId: 1, kind: 'thumbnail' })]
    expect(mergePlateFallback(gallery, null)).toEqual(gallery)
    expect(mergePlateFallback(gallery, { plateId: 'p', timestamp: 1 })).toEqual(gallery)
  })

  it('appends a base64-only plateCrop when the gallery has no cropUrl either', () => {
    const out = mergePlateFallback([mf({ mediaId: 1, kind: 'thumbnail' })], {
      plateId: 'plate-1',
      timestamp: 500,
      base64: 'LEGACYB64',
    })
    const pc = out.find((f) => f.kind === 'plateCrop')
    expect(pc?.base64).toBe('LEGACYB64')
    expect(pc?.url).toBeUndefined()
    expect(pc?.mediaId).toBeUndefined()
  })

  it('returns a new array (does not mutate the input)', () => {
    const gallery = [mf({ mediaId: 1, kind: 'thumbnail' })]
    const out = mergePlateFallback(gallery, plate)
    expect(out).not.toBe(gallery)
    expect(gallery).toHaveLength(1)
  })
})
