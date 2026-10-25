import { describe, it, expect } from 'vitest'

import { parseClip, parseClips, playsFromRecording } from '../clip-mapping.js'
import {
  clipSourceDescriptor,
  CLIP_SOURCE_ANALYTICS,
  isPlayable,
  nativeSourceVendor,
  type Clip,
} from '../clip-model.js'

const T0 = 1_700_000_000_000

/** A row shaped exactly like `videoclips.listClips` returns one. */
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'analytics:1:2:evt-1',
    source: 'analytics',
    kind: 'object',
    timeRange: { startMs: T0, endMs: T0 + 12_000 },
    thumbnail: 'https://hub/thumb.jpg',
    ...overrides,
  }
}

describe('parseClip', () => {
  it('maps a well-formed row', () => {
    const clip = parseClip(row(), 101)
    expect(clip).toEqual({
      clipId: 'analytics:1:2:evt-1',
      deviceId: 101,
      startMs: T0,
      endMs: T0 + 12_000,
      sourceId: 'analytics',
      kind: 'object',
      playback: { kind: 'recorded', deviceId: 101 },
      thumbnailUrl: 'https://hub/thumb.jpg',
    })
  })

  it('plays an analytics clip through the RECORDED transport, never a URL', () => {
    expect(parseClip(row(), 101)?.playback).toEqual({ kind: 'recorded', deviceId: 101 })
  })

  it('carries the device the transport must seek on', () => {
    expect(parseClip(row(), 1)?.playback).toEqual({ kind: 'recorded', deviceId: 1 })
  })

  it('omits the thumbnail rather than storing an empty string', () => {
    expect(parseClip(row({ thumbnail: '' }), 101)).not.toHaveProperty('thumbnailUrl')
    expect(parseClip(row({ thumbnail: 42 }), 101)).not.toHaveProperty('thumbnailUrl')
  })

  // `eventIds` is the only id that can recover a clip card whose stamped
  // thumbnail is dead — and the hub stamps one on every clip without vouching
  // for it (62 of 177 clips 404 on device 3836). Dropping the field here is
  // what left the card with a question mark on grey and nothing to retry with.
  it('carries the analytics event ids the hub attached to the visit', () => {
    expect(parseClip(row({ eventIds: ['evt-1', 'evt-2'] }), 101)?.eventIds).toEqual([
      'evt-1',
      'evt-2',
    ])
  })

  it('carries the intra-visit footage holes', () => {
    expect(
      parseClip(row({ holes: [{ startMs: T0 + 1_000, endMs: T0 + 2_000 }] }), 101)?.holes,
    ).toEqual([{ startMs: T0 + 1_000, endMs: T0 + 2_000 }])
  })

  it('omits both rather than inventing empty arrays for a footage-only visit', () => {
    // A field that is always present is a field callers stop checking. A visit
    // the provider attached nothing to must be distinguishable from one whose
    // row this build could not read.
    expect(parseClip(row(), 101)).not.toHaveProperty('eventIds')
    expect(parseClip(row(), 101)).not.toHaveProperty('holes')
    expect(parseClip(row({ eventIds: [] }), 101)).not.toHaveProperty('eventIds')
  })

  it('carries the object-class labels the hub aggregated for the visit', () => {
    const clip = parseClip(row({ labels: ['person', 'cat'] }), 101)
    expect(clip?.labels).toEqual(['person', 'cat'])
  })

  it('omits labels rather than storing junk or an empty array', () => {
    expect(parseClip(row({ labels: [] }), 101)?.labels).toBeUndefined()
    expect(parseClip(row({ labels: [1, '', 'person'] }), 101)?.labels).toEqual(['person'])
    expect(parseClip(row(), 101)?.labels).toBeUndefined()
  })

  it('drops junk inside the arrays instead of trusting the row wholesale', () => {
    expect(parseClip(row({ eventIds: ['ok', 42, '', null] }), 101)?.eventIds).toEqual(['ok'])
    expect(parseClip(row({ eventIds: 'evt-1' }), 101)).not.toHaveProperty('eventIds')
    expect(
      parseClip(row({ holes: [{ startMs: 'x', endMs: 1 }, { startMs: 2, endMs: 3 }] }), 101)?.holes,
    ).toEqual([{ startMs: 2, endMs: 3 }])
  })

  it('falls back to a known kind for an unrecognised one', () => {
    expect(parseClip(row({ kind: 'telepathy' }), 101)?.kind).toBe('motion')
    expect(parseClip(row({ kind: undefined }), 101)?.kind).toBe('motion')
  })

  it('keeps a source id it has never seen — the vocabulary is the hub’s', () => {
    const clip = parseClip(row({ source: 'native:hikvision' }), 101)
    expect(clip?.sourceId).toBe('native:hikvision')
  })

  it('gives a non-recording source a NATIVE ref, resolved at play time', () => {
    // Until 2026-09-20 this asserted `{kind:'url', url:''}` and "not playable",
    // on the stated grounds that no provider served a file yet. One does now
    // (`native:reolink:onboard`), and its row carries NO url: the bytes are
    // behind `videoclips.getClipPlayback`, which mints a per-clip scratch entry
    // on demand. A clip whose file is one call away is playable, and saying
    // otherwise would hide every onboard clip on the fleet.
    const clip = parseClip(row({ source: 'native:hikvision' }), 101)
    expect(clip?.playback).toEqual({ kind: 'native', clipId: 'analytics:1:2:evt-1', deviceId: 101 })
    expect(isPlayable(clip as Clip)).toBe(true)
  })

  it('a row the provider says is NOT playable is not playable', () => {
    // `playable:false` + `unplayableReason` is the provider telling us the file
    // cannot be served (D555). Offering a tap that will fail is worse than a
    // card that says why.
    const clip = parseClip(
      row({ source: 'native:reolink:onboard', playable: false, unplayableReason: 'file is still being written' }),
      101,
    )
    expect(clip?.playable).toBe(false)
    expect(clip?.unplayableReason).toBe('file is still being written')
    expect(isPlayable(clip as Clip)).toBe(false)
  })

  it('absence of `playable` is not a refusal', () => {
    // Measured on the live hub, 2026-09-20: not one of 592's onboard rows
    // carries `playable`. Treating absence as false would empty the surface.
    const clip = parseClip(row({ source: 'native:reolink:onboard' }), 592)
    expect(clip?.playable).toBeUndefined()
    expect(isPlayable(clip as Clip)).toBe(true)
  })
})

describe('parseClip — a native row, exactly as the live hub serves it', () => {
  /** Device 107, `listClips({provider:'provider-reolink'})`, 2026-09-20. */
  const NATIVE_592: Record<string, unknown> = {
    id: 'native:reolink:onboard:0:L21udC9zZGEvTXA0UmVjb3Jk',
    source: 'native:reolink:onboard',
    kind: 'native',
    timeRange: { startMs: 1789933690000, endMs: 1789933720000 },
    labels: ['animal'],
    nativeTypes: ['dog_cat'],
    thumbnailMint: '/addon/provider-reolink/clip-thumb/592/687d6b38',
    catalogAsOf: 1789934179258,
    supportSub: true,
    streams: {
      sub: { id: 'native:reolink:onboard:0:sub', bytes: 728047 },
      main: { id: 'native:reolink:onboard:0:main', bytes: 24762476 },
    },
  }

  it('keeps the mint offer, and it is NOT a thumbnail', () => {
    // `thumbnail` is a picture that exists; `thumbnailMint` is an OFFER that
    // answers 204 on 43 of 60 parallel first-paint tiles (D563). Folding it
    // into `thumbnailUrl` would make a queued still indistinguishable from a
    // dead one, which is exactly the defect D563 was written for.
    const clip = parseClip(NATIVE_592, 592)
    expect(clip?.thumbnailMintUrl).toBe('/addon/provider-reolink/clip-thumb/592/687d6b38')
    expect(clip?.thumbnailUrl).toBeUndefined()
  })

  it('carries the reason a still will never exist, when the provider gives one', () => {
    const clip = parseClip({ ...NATIVE_592, thumbnailUnavailable: 'no keyframe in this file' }, 592)
    expect(clip?.thumbnailUnavailable).toBe('no keyframe in this file')
  })

  it('carries the twins so the surface can ask for the CHEAPEST copy', () => {
    const clip = parseClip(NATIVE_592, 592)
    expect(clip?.streams?.sub?.bytes).toBe(728047)
    expect(clip?.streams?.main?.bytes).toBe(24762476)
  })

  it('carries how old the catalog it came from is', () => {
    expect(parseClip(NATIVE_592, 592)?.catalogAsOf).toBe(1789934179258)
  })

  it('keeps the camera’s own words for what it saw', () => {
    // `nativeTypes` is the camera's vocabulary (`md`, `dog_cat`), kept verbatim
    // and never parsed into ours — the labels are a separate, hub-resolved field.
    expect(parseClip(NATIVE_592, 592)?.nativeTypes).toEqual(['dog_cat'])
    expect(parseClip(NATIVE_592, 592)?.labels).toEqual(['animal'])
  })

  it('survives a row with none of the new fields — an older hub still draws', () => {
    const clip = parseClip(
      { id: 'x', source: 'native:reolink:onboard', kind: 'native', timeRange: { startMs: 1, endMs: 2 } },
      592,
    )
    expect(clip).not.toBeNull()
    expect(clip?.streams).toBeUndefined()
    expect(clip?.thumbnailMintUrl).toBeUndefined()
  })

  it('drops junk inside `streams` rather than storing a twin with no size', () => {
    const clip = parseClip({ ...NATIVE_592, streams: { sub: { id: 'a' }, main: 'nonsense' } }, 592)
    expect(clip?.streams).toBeUndefined()
  })

  it('drops a row the ribbon could not draw', () => {
    expect(parseClip(null, 101)).toBeNull()
    expect(parseClip(row({ id: '' }), 101)).toBeNull()
    expect(parseClip(row({ source: 123 }), 101)).toBeNull()
    expect(parseClip(row({ timeRange: null }), 101)).toBeNull()
    expect(parseClip(row({ timeRange: { startMs: T0 } }), 101)).toBeNull()
    expect(parseClip(row({ timeRange: { startMs: T0, endMs: T0 } }), 101)).toBeNull()
    expect(parseClip(row({ timeRange: { startMs: T0, endMs: T0 - 1 } }), 101)).toBeNull()
    expect(parseClip(row({ timeRange: { startMs: T0, endMs: Number.NaN } }), 101)).toBeNull()
  })
})

describe('parseClips', () => {
  it('drops unusable rows and keeps the rest', () => {
    const clips = parseClips([row(), null, row({ id: 'b', timeRange: { startMs: 1, endMs: 0 } }), row({ id: 'c' })], 101)
    expect(clips.map((c) => c.clipId)).toEqual(['analytics:1:2:evt-1', 'c'])
  })

  it('is empty for a non-array (a cap that is absent returns null)', () => {
    expect(parseClips(null, 101)).toEqual([])
    expect(parseClips({ clips: [] }, 101)).toEqual([])
  })
})

describe('playsFromRecording', () => {
  it('is true only for the hub’s own recording-derived source', () => {
    expect(playsFromRecording(CLIP_SOURCE_ANALYTICS)).toBe(true)
    expect(playsFromRecording('native:hikvision')).toBe(false)
    expect(playsFromRecording('hksv')).toBe(false)
  })
})

describe('clipSourceDescriptor', () => {
  it('knows the sources the viewer ships', () => {
    expect(clipSourceDescriptor('analytics').labelKey).toBe('v2.clips.sourceAnalytics')
    expect(clipSourceDescriptor('hksv').labelKey).toBe('v2.clips.sourceHksv')
  })

  it('resolves a native:<vendor> id to the onboard label without a release', () => {
    expect(clipSourceDescriptor('native:reolink').labelKey).toBe('v2.clips.sourceOnboard')
    expect(nativeSourceVendor('native:reolink')).toBe('reolink')
    expect(nativeSourceVendor('analytics')).toBeNull()
  })

  it('gives two unknown sources different colours', () => {
    const a = clipSourceDescriptor('brand-new-a')
    const b = clipSourceDescriptor('brand-new-b')
    expect(a.labelKey).toBe('v2.clips.sourceUnknown')
    expect(a.color).not.toBe(b.color)
  })

  it('is stable for the same id', () => {
    expect(clipSourceDescriptor('x').color).toBe(clipSourceDescriptor('x').color)
  })
})

describe('a clip that is still being WRITTEN says so, because its end is a guess', () => {
  const row = {
    id: 'native:reolink:onboard:0:growing',
    source: 'native:reolink:onboard',
    kind: 'motion',
    timeRange: { startMs: 1_789_900_000_000, endMs: 1_789_900_029_000 },
    inProgress: true,
  }

  it('carries `inProgress` off the wire', () => {
    const clip = parseClip(row, 592)
    expect(clip?.inProgress).toBe(true)
  })

  it('leaves it ABSENT on a closed row — absence is the common case, not a false', () => {
    const closed = parseClip({ ...row, inProgress: undefined }, 592)
    expect(closed).not.toBeNull()
    expect(closed && 'inProgress' in closed).toBe(false)
  })
})
