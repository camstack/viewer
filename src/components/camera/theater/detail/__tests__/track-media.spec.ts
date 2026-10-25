import { describe, it, expect } from 'vitest'
import {
  mergeTrackMedia,
  parseTrackMedia,
  filterDetailMedia,
  type SceneRef,
  type TrackMediaFile,
} from '../track-media.js'

describe('parseTrackMedia', () => {
  it('keeps well-formed rows and drops malformed ones', () => {
    const raw = [
      { key: 'a', kind: 'crop', timestamp: 10 },
      { key: 'b', kind: 'snapshot', timestamp: 20 },
      { key: '', kind: 'crop', timestamp: 30 }, // empty key → drop
      { key: 'c', kind: 'firstFrame' }, // no timestamp → drop
      { kind: 'crop', timestamp: 40 }, // no key → drop
      'not-an-object',
      { key: 'e', kind: 'lastFrame', timestamp: 50 },
    ]
    const parsed = parseTrackMedia(raw)
    expect(parsed.map((m) => m.key)).toEqual(['a', 'b', 'e'])
  })
  it('returns [] for non-array input', () => {
    expect(parseTrackMedia(null)).toEqual([])
    expect(parseTrackMedia({})).toEqual([])
    expect(parseTrackMedia(undefined)).toEqual([])
  })
})

describe('mergeTrackMedia', () => {
  const scenes: SceneRef[] = [
    { key: 's1', timestamp: 3000 },
    { key: 's2', timestamp: 1000 },
  ]
  const media: TrackMediaFile[] = [
    { key: 'm1', kind: 'crop', timestamp: 2000 },
    { key: 'm2', kind: 'snapshot', timestamp: 4000 },
  ]

  it('folds scenes + media into one chronological (ascending) strip', () => {
    const items = mergeTrackMedia(scenes, media)
    expect(items.map((i) => i.timestamp)).toEqual([1000, 2000, 3000, 4000])
    expect(items.map((i) => i.id)).toEqual(['scene:s2', 'media:m1', 'scene:s1', 'media:m2'])
  })

  it('namespaces ids so scenes and media never collide, and tags kinds', () => {
    const items = mergeTrackMedia([{ key: 'x', timestamp: 5 }], [{ key: 'x', kind: 'crop', timestamp: 5 }])
    expect(items).toHaveLength(2)
    const scene = items.find((i) => i.kind === 'scene')
    const med = items.find((i) => i.kind === 'media')
    expect(scene?.id).toBe('scene:x')
    expect(med?.id).toBe('media:x')
    expect(items[0].kind).toBe('scene')
  })

  it('drops duplicate ids within a source', () => {
    const items = mergeTrackMedia(
      [{ key: 'dup', timestamp: 1 }, { key: 'dup', timestamp: 1 }],
      [],
    )
    expect(items).toHaveLength(1)
  })

  it('renders whatever listTrackMedia returns — N items, any kinds', () => {
    const many: TrackMediaFile[] = Array.from({ length: 7 }, (_, i) => ({
      key: `k${i}`,
      kind: ['firstFrame', 'crop', 'snapshot', 'bestFrame', 'lastFrame', 'faceCrop', 'plateCrop'][i]!,
      timestamp: 100 + i,
    }))
    const items = mergeTrackMedia([], many)
    expect(items).toHaveLength(7)
    expect(items.every((i) => i.kind === 'media')).toBe(true)
  })

  it('handles empty inputs', () => {
    expect(mergeTrackMedia([], [])).toEqual([])
  })
})

describe('filterDetailMedia — the simplified detail keeps ONLY the core images', () => {
  const file = (kind: string): TrackMediaFile => ({ key: `k-${kind}`, kind, timestamp: 1 })

  it('keeps crops (incl. the track `thumbnail` subject crop) + clean full frames, drops every debug variant', () => {
    const files = [
      file('crop'),
      file('thumbnail'),
      file('fullFrame'),
      file('keyFrame'),
      file('fullFrameBoxed'),
      file('firstFrame'),
      file('lastFrame'),
      file('snapshot'),
      file('motionDebug'),
    ]
    expect(filterDetailMedia(files).map((f) => f.kind)).toEqual([
      'crop',
      'thumbnail',
      'fullFrame',
      'keyFrame',
    ])
  })

  it('keeps the track `thumbnail` subject crop when it is the ONLY crop (degenerate track)', () => {
    const files = [file('keyFrame'), file('firstFrame'), file('lastFrame'), file('thumbnail')]
    expect(filterDetailMedia(files).map((f) => f.kind)).toEqual(['keyFrame', 'thumbnail'])
  })

  it('keeps multiple files of an allowed kind (all the main crops)', () => {
    const files = [file('crop'), { ...file('crop'), key: 'k-crop-2' }, file('lastFrame')]
    expect(filterDetailMedia(files)).toHaveLength(2)
  })

  it('returns [] for empty input', () => {
    expect(filterDetailMedia([])).toEqual([])
  })
})
