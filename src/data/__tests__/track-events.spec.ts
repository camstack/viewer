import { describe, it, expect } from 'vitest'
import {
  toTrackSummary,
  parseMediaFiles,
  pickMediaByKind,
  buildTrackGallery,
  cleanFrameId,
  mediaFileId,
  shouldRenderFaceSection,
  toScoredResult,
  scoredToTrackSummary,
  trackLabels,
  trackTitle,
  trackCameraName,
  resolveZoneLabels,
  mediaKindLabel,
  FRAME_KINDS,
  type TrackSummary,
  type MediaFileLite,
} from '../track-events.js'
import en from '../../../locales/en.json'

const enLocale = en.v2

function mf(over: Partial<MediaFileLite> = {}): MediaFileLite {
  return { mediaId: 1, kind: 'crop', base64: 'AAAA', timestamp: 0, ...over }
}

function track(over: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    trackId: 't1',
    deviceId: 5,
    className: 'person',
    firstSeen: 1000,
    lastSeen: 2000,
    state: 'left',
    active: false,
    zonesVisited: ['front'],
    ...over,
  }
}

describe('toTrackSummary', () => {
  it('normalises a well-formed row and defaults bestEventId to trackId', () => {
    const t = toTrackSummary(track(), 'Front Door')
    expect(t).not.toBeNull()
    expect(t!.trackId).toBe('t1')
    expect(t!.cameraName).toBe('Front Door')
    expect(t!.bestEventId).toBe('t1')
    expect(t!.zonesVisited).toEqual(['front'])
  })

  it('prefers an explicit bestEventId', () => {
    const t = toTrackSummary(track({ bestEventId: 'ev:9' }), 'Cam')
    expect(t!.bestEventId).toBe('ev:9')
  })

  it('extracts distinct audio labels from the aggregate array', () => {
    const t = toTrackSummary(
      track({ audioLabels: [{ label: 'dog' }, { label: 'dog' }, { label: 'speech' }] }),
      'Cam',
    )
    expect(t!.audioLabels).toEqual(['dog', 'speech'])
  })

  it('returns null on malformed rows', () => {
    expect(toTrackSummary(null, 'Cam')).toBeNull()
    expect(toTrackSummary({ trackId: '', deviceId: 1, className: 'x', firstSeen: 0, lastSeen: 1 }, 'Cam')).toBeNull()
    expect(toTrackSummary(track({ deviceId: 'nope' }), 'Cam')).toBeNull()
  })

  it('maps a synthetic track\'s producingDeviceName onto the summary', () => {
    const t = toTrackSummary(track({ producingDeviceName: 'Front Door Contact' }), 'Cam')
    expect(t!.producingDeviceName).toBe('Front Door Contact')
  })

  it('leaves producingDeviceName undefined for a normal track / blank value', () => {
    expect(toTrackSummary(track(), 'Cam')!.producingDeviceName).toBeUndefined()
    expect(toTrackSummary(track({ producingDeviceName: '' }), 'Cam')!.producingDeviceName).toBeUndefined()
    expect(toTrackSummary(track({ producingDeviceName: 42 }), 'Cam')!.producingDeviceName).toBeUndefined()
  })
})

describe('trackTitle — producing device (synthetic) > identity (subLabel, verbatim) > tier-1 label (resolved) > class (resolved)', () => {
  const base = (over: Partial<TrackSummary>): TrackSummary => ({
    trackId: 'x', deviceId: 1, cameraName: 'Front Door Cam', className: 'switch',
    firstSeen: 0, lastSeen: 0, state: 'idle', active: false,
    zonesVisited: [], zoneNames: [], audioLabels: [], bestEventId: 'x', ...over,
  })

  // Distinguishes "went through the resolver" from "passed through verbatim":
  // a real resolver would translate `switch` / `van` (taxonomy ids), so a
  // prefixed stub proves whether a given field was routed through it.
  const resolveLabel = (id: string): string => `resolved:${id}`

  it('shows the producing device name for a synthetic track (over identity and label)', () => {
    expect(trackTitle(base({ producingDeviceName: 'Front Door Contact' }), resolveLabel)).toBe(
      'Front Door Contact',
    )
  })

  it('producing name wins even when a tier-2 identity is present', () => {
    expect(
      trackTitle(
        base({ producingDeviceName: 'Front Door Contact', subLabel: 'Mario Rossi' }),
        resolveLabel,
      ),
    ).toBe('Front Door Contact')
  })

  it('tier-2 subLabel (identity/plate) is shown VERBATIM — never through the resolver', () => {
    expect(trackTitle(base({ subLabel: 'Mario Rossi', label: 'van' }), resolveLabel)).toBe(
      'Mario Rossi',
    )
  })

  it('tier-1 label (taxonomy sub-class) goes THROUGH the resolver when no identity exists', () => {
    expect(trackTitle(base({ label: 'van' }), resolveLabel)).toBe('resolved:van')
  })

  it('falls back to the resolved class when neither producing name, identity nor label exists', () => {
    expect(trackTitle(base({}), resolveLabel)).toBe('resolved:switch')
  })
})

describe('media selection', () => {
  const files: MediaFileLite[] = [
    { mediaId: 1, kind: 'crop', base64: 'AAA', timestamp: 1 },
    { mediaId: 2, kind: 'fullFrame', base64: 'BBB', timestamp: 1 },
    { mediaId: 3, kind: 'fullFrameBoxed', base64: 'CCC', timestamp: 1 },
  ]

  it('parses tolerant of malformed rows', () => {
    const parsed = parseMediaFiles([
      files[0],
      null,
      { mediaId: 9 },
      { mediaId: 10, kind: 'crop', base64: '' },
    ])
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.kind).toBe('crop')
  })

  it('picks by kind', () => {
    expect(pickMediaByKind(files, 'fullFrameBoxed')!.base64).toBe('CCC')
    expect(pickMediaByKind(files, 'faceCrop')).toBeUndefined()
  })

  // The `resolveTrackDetailImages` / `mediaDataUri` cases that stood here were
  // deleted with the functions on 2026-08-20 (see track-events.ts). The frame
  // PREFERENCE they asserted — keyFrame → keyFrameSmall → fullFrame → first →
  // last — is still asserted, on the surviving owner, in the `cleanFrameId`
  // block below.
})

describe('toScoredResult (semantic search)', () => {
  it('carries the object event\'s own id, its mediaId (D482) and its trackId, each independently', () => {
    const r = toScoredResult({
      id: 'e1', deviceId: 1, className: 'person', timestamp: 1, score: 0.8, mediaId: 42, trackId: 'tr1',
    })
    expect(r).toEqual({
      id: 'e1', deviceId: 1, className: 'person', timestamp: 1, score: 0.8, mediaId: 42, trackId: 'tr1',
    })
  })

  it('accepts a numeric id (D474) and stringifies it — this module\'s ids are strings', () => {
    expect(toScoredResult({ id: 5, deviceId: 1, className: 'person', timestamp: 1, score: 0.8 })!.id).toBe('5')
  })

  it('mediaId and trackId are both absent when the row carries neither', () => {
    const r = toScoredResult({ id: 'e1', deviceId: 1, className: 'person', timestamp: 1, score: 0.8 })
    expect(r!.mediaId).toBeUndefined()
    expect(r!.trackId).toBeUndefined()
  })

  it('returns null on malformed rows', () => {
    expect(toScoredResult({ id: 'e1' })).toBeNull()
    expect(toScoredResult(null)).toBeNull()
  })
})

describe('scoredToTrackSummary — bestEventId resolves against the TRACK, never a folded string', () => {
  it('prefers trackId when the hit carries one', () => {
    const s = scoredToTrackSummary(
      { id: 'e1', deviceId: 1, className: 'person', timestamp: 1, score: 0.8, trackId: 'tr1' },
      'Cam',
    )
    expect(s.trackId).toBe('tr1')
    expect(s.bestEventId).toBe('tr1')
  })

  it('falls back to the event\'s own id when the hit carries no track', () => {
    const s = scoredToTrackSummary(
      { id: 'e1', deviceId: 1, className: 'person', timestamp: 1, score: 0.8 },
      'Cam',
    )
    expect(s.trackId).toBe('e1')
    expect(s.bestEventId).toBe('e1')
  })
})

describe('trackLabels — class + enrichment chips', () => {
  const base = {
    trackId: 't1', deviceId: 1, cameraName: 'Cam', className: 'person',
    firstSeen: 1, lastSeen: 2, state: 'idle', active: false,
    zonesVisited: [], zoneNames: [], audioLabels: [], bestEventId: 't1',
  }

  it('class only when no enrichment', () => {
    expect(trackLabels({ ...base })).toEqual(['person'])
  })

  it('class + identity/plate label + audio labels, in that order', () => {
    expect(
      trackLabels({ ...base, label: 'Alice', audioLabels: ['speech', 'dog_bark'] }),
    ).toEqual(['person', 'Alice', 'speech', 'dog_bark'])
  })

  it('de-duplicates a label equal to the class or a repeated audio label', () => {
    expect(trackLabels({ ...base, label: 'person', audioLabels: ['person', 'speech'] })).toEqual([
      'person',
      'speech',
    ])
  })
})

describe('buildTrackGallery — all existing media, deduped + ordered', () => {
  it('folds event + track files, dedupes by id (event wins clash)', () => {
    const event = [mf({ mediaId: 1, kind: 'crop' }), mf({ mediaId: 99, kind: 'fullFrame' })]
    const track = [mf({ mediaId: 99, kind: 'keyFrame' }), mf({ mediaId: 2, kind: 'faceCrop' })]
    const g = buildTrackGallery(event, track)
    expect(g.map((f) => f.mediaId)).toEqual([1, 2, 99])
    // the shared id keeps the EVENT-owned kind (fullFrame), not the track's keyFrame
    expect(g.find((f) => f.mediaId === 99)!.kind).toBe('fullFrame')
  })

  it('orders by kind priority (crop → face → frames → cadence), then timestamp', () => {
    const g = buildTrackGallery(
      [
        mf({ mediaId: 1, kind: 'keyFrame', timestamp: 5 }),
        mf({ mediaId: 2, kind: 'fullFrame', timestamp: 5 }),
        mf({ mediaId: 3, kind: 'crop', timestamp: 9 }),
        mf({ mediaId: 4, kind: 'faceCrop', timestamp: 1 }),
      ],
      [],
    )
    expect(g.map((f) => f.kind)).toEqual(['crop', 'faceCrop', 'fullFrame', 'keyFrame'])
  })

  it('never fabricates a kind that does not exist (no placeholders)', () => {
    const g = buildTrackGallery([mf({ mediaId: 1, kind: 'crop' })], [])
    expect(g).toHaveLength(1)
    expect(g.map((f) => f.kind)).toEqual(['crop'])
  })

  it('returns [] when the track stored no media', () => {
    expect(buildTrackGallery([], [])).toEqual([])
  })
})

describe('cleanFrameId — the client-box target frame', () => {
  it('prefers the native keyFrame over the legacy fullFrame/first/last', () => {
    const g = [mf({ mediaId: 1, kind: 'fullFrame' }), mf({ mediaId: 2, kind: 'keyFrame' })]
    expect(cleanFrameId(g)).toBe(mediaFileId(g[1]!))
  })
  it('prefers keyFrameSmall over the legacy fullFrame', () => {
    const g = [mf({ mediaId: 1, kind: 'fullFrame' }), mf({ mediaId: 2, kind: 'keyFrameSmall' })]
    expect(cleanFrameId(g)).toBe(mediaFileId(g[1]!))
  })
  it('falls through keyFrame → keyFrameSmall → fullFrame → firstFrame → lastFrame', () => {
    const last = mf({ mediaId: 1, kind: 'lastFrame' })
    expect(cleanFrameId([last])).toBe(mediaFileId(last))
    const key = mf({ mediaId: 2, kind: 'keyFrame' })
    expect(cleanFrameId([key])).toBe(mediaFileId(key))
    const full = mf({ mediaId: 3, kind: 'fullFrame' })
    expect(cleanFrameId([full])).toBe(mediaFileId(full))
    // keyFrameSmall wins over fullFrame + first when all three present
    const small = mf({ mediaId: 6, kind: 'keyFrameSmall' })
    const g = [mf({ mediaId: 4, kind: 'fullFrame' }), mf({ mediaId: 5, kind: 'firstFrame' }), small]
    expect(cleanFrameId(g)).toBe(mediaFileId(small))
  })
  it('null when the gallery holds no clean frame (crop-only track)', () => {
    expect(cleanFrameId([mf({ mediaId: 1, kind: 'crop' })])).toBeNull()
    expect(cleanFrameId([])).toBeNull()
  })
})

describe('mediaKindLabel — distinct per-kind labels (kills the "2 Crop tiles")', () => {
  // The label set is now localised: `mediaKindLabel(kind, t)` resolves a
  // `v2.mediaKind.*` key. Assert against the EN locale so the test tracks the
  // translation (not a hardcoded English literal). `t` walks the dotted key.
  const t = (key: string): string => {
    const value = key.split('.').reduce<unknown>(
      (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
      { v2: enLocale },
    )
    return typeof value === 'string' ? value : key
  }

  it('gives crop and thumbnail DISTINCT labels', () => {
    expect(mediaKindLabel('crop', t)).toBe(enLocale.mediaKind.crop)
    expect(mediaKindLabel('thumbnail', t)).toBe(enLocale.mediaKind.thumbnail)
    expect(mediaKindLabel('crop', t)).not.toBe(mediaKindLabel('thumbnail', t))
  })

  it('labels both keyFrame and the new keyFrameSmall as the same "Key frame"', () => {
    expect(mediaKindLabel('keyFrame', t)).toBe(enLocale.mediaKind.keyFrame)
    expect(mediaKindLabel('keyFrameSmall', t)).toBe(enLocale.mediaKind.keyFrame)
  })

  it('labels both thumbnail and the new thumbnailSmall as the same "Best shot"', () => {
    expect(mediaKindLabel('thumbnail', t)).toBe(enLocale.mediaKind.thumbnail)
    expect(mediaKindLabel('thumbnailSmall', t)).toBe(enLocale.mediaKind.thumbnail)
  })

  it('labels the cadence / enrichment kinds', () => {
    expect(mediaKindLabel('snapshot', t)).toBe(enLocale.mediaKind.snapshot)
    expect(mediaKindLabel('firstFrame', t)).toBe(enLocale.mediaKind.firstFrame)
    expect(mediaKindLabel('lastFrame', t)).toBe(enLocale.mediaKind.lastFrame)
    expect(mediaKindLabel('faceCrop', t)).toBe(enLocale.mediaKind.faceCrop)
    expect(mediaKindLabel('plateCrop', t)).toBe(enLocale.mediaKind.plateCrop)
    expect(mediaKindLabel('fullFrame', t)).toBe(enLocale.mediaKind.fullFrame)
    expect(mediaKindLabel('fullFrameBoxed', t)).toBe(enLocale.mediaKind.fullFrameBoxed)
  })

  it('falls back to the raw kind for an unknown kind (never calls t)', () => {
    expect(mediaKindLabel('somethingNew', t)).toBe('somethingNew')
  })
})

describe('FRAME_KINDS — the kinds the client bbox overlay may apply to', () => {
  it('includes the clean native frame kinds (keyFrame + keyFrameSmall)', () => {
    expect(FRAME_KINDS.has('keyFrame')).toBe(true)
    expect(FRAME_KINDS.has('keyFrameSmall')).toBe(true)
    expect(FRAME_KINDS.has('fullFrame')).toBe(true)
  })
  it('excludes the subject crops', () => {
    expect(FRAME_KINDS.has('crop')).toBe(false)
    expect(FRAME_KINDS.has('thumbnail')).toBe(false)
    expect(FRAME_KINDS.has('thumbnailSmall')).toBe(false)
  })
  it('excludes the server-boxed cadence frames (first/last/snapshot get no client box)', () => {
    expect(FRAME_KINDS.has('firstFrame')).toBe(false)
    expect(FRAME_KINDS.has('lastFrame')).toBe(false)
    expect(FRAME_KINDS.has('snapshot')).toBe(false)
  })
})

describe('buildTrackGallery — keyFrameSmall ordered next to keyFrame', () => {
  it('orders keyFrame then keyFrameSmall, both before the cadence frames', () => {
    const g = buildTrackGallery(
      [
        mf({ mediaId: 1, kind: 'firstFrame', timestamp: 1 }),
        mf({ mediaId: 2, kind: 'keyFrameSmall', timestamp: 1 }),
        mf({ mediaId: 3, kind: 'keyFrame', timestamp: 1 }),
      ],
      [],
    )
    expect(g.map((f) => f.kind)).toEqual(['keyFrame', 'keyFrameSmall', 'firstFrame'])
  })
})

describe('shouldRenderFaceSection — face UI only when a face exists', () => {
  it('true only when a face is present', () => {
    expect(shouldRenderFaceSection({ base64: 'AAAA' })).toBe(true)
    expect(shouldRenderFaceSection({})).toBe(true)
  })
  it('false when the track has no face (null / undefined)', () => {
    expect(shouldRenderFaceSection(null)).toBe(false)
    expect(shouldRenderFaceSection(undefined)).toBe(false)
  })
})

describe('resolveZoneLabels', () => {
  it('maps zone ids to names and falls back to the id when unknown', () => {
    const names: Readonly<Record<string, string>> = { z1: 'Driveway', z2: 'Porch' }
    expect(resolveZoneLabels(['z1', 'z2'], names)).toEqual(['Driveway', 'Porch'])
    // A zone that no longer exists falls back to its raw id.
    expect(resolveZoneLabels(['z1', 'gone'], names)).toEqual(['Driveway', 'gone'])
  })

  it('is empty for no zones and passes ids through with an empty dictionary', () => {
    expect(resolveZoneLabels([], {})).toEqual([])
    expect(resolveZoneLabels(['a', 'b'], {})).toEqual(['a', 'b'])
  })

  it('never reads a name off Object.prototype', () => {
    // A dictionary is keyed by an id the hub chose. `constructor` and
    // `toString` are ids like any other, and an inherited property would be
    // rendered as a zone NAME.
    expect(resolveZoneLabels(['constructor', 'toString'], {})).toEqual(['constructor', 'toString'])
  })
})

describe('toTrackSummary — hasFace', () => {
  it('carries the boolean through, both ways', () => {
    expect(toTrackSummary(track({ hasFace: true }), 'Cam')!.hasFace).toBe(true)
    expect(toTrackSummary(track({ hasFace: false }), 'Cam')!.hasFace).toBe(false)
  })

  it('leaves a non-boolean / missing value ABSENT rather than coercing it', () => {
    expect(toTrackSummary(track(), 'Cam')!.hasFace).toBeUndefined()
    expect(toTrackSummary(track({ hasFace: 1 }), 'Cam')!.hasFace).toBeUndefined()
  })
})

describe('trackCameraName — the CAMERA name the detail modal shows', () => {
  const cams = [
    { id: 101, name: 'Garden' },
    { id: 102, name: 'Front door' },
  ]

  it('prefers the camera directory name (carries client-side renames)', () => {
    // A summary built from a click / cluster event often carries '' or the
    // server name — the directory is where the operator's rename lives.
    expect(trackCameraName({ deviceId: 102, cameraName: 'stale-server-name' }, cams)).toBe('Front door')
  })

  it('falls back to the summary cameraName when the directory misses the device', () => {
    expect(trackCameraName({ deviceId: 999, cameraName: 'Portico' }, cams)).toBe('Portico')
  })

  it('returns null when nothing names the camera — never an empty string', () => {
    expect(trackCameraName({ deviceId: 999, cameraName: '' }, cams)).toBeNull()
    expect(trackCameraName({ deviceId: 999, cameraName: '' }, [])).toBeNull()
  })
})
