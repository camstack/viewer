import { describe, it, expect } from 'vitest'
import {
  toFaceInfo,
  toIdentity,
  sortIdentities,
  collectFaceIdsForIdentity,
  toMassUnassignResult,
  toMassAssignResult,
  faceHasPerson,
  FACE_ID_RESOLUTION_QUERY,
} from '../use-face-gallery.js'

describe('toFaceInfo — faceGallery.getFaceByTrack row narrowing', () => {
  const valid = {
    faceId: 'f1',
    deviceId: 7,
    trackId: 't1',
    timestamp: 1_700_000_000_000,
    assigned: true,
    recognizedIdentityId: 'id1',
    identityName: 'Alice',
    base64: 'AAAA',
  }

  it('parses a fully-populated assigned face', () => {
    const f = toFaceInfo(valid)
    expect(f).toEqual({
      faceId: 'f1',
      deviceId: 7,
      trackId: 't1',
      timestamp: 1_700_000_000_000,
      assigned: true,
      identityId: 'id1',
      identityName: 'Alice',
      cropUrl: undefined,
      base64: 'AAAA',
      bestMatchScore: undefined,
      nativeFaceShortSidePx: undefined,
      suggestedIdentityId: undefined,
      suggestedMatchScore: undefined,
    })
  })

  it('parses an unassigned face (optional fields absent)', () => {
    const f = toFaceInfo({ faceId: 'f2', deviceId: 3, trackId: 't9', timestamp: 5, assigned: false })
    expect(f).toEqual({
      faceId: 'f2',
      deviceId: 3,
      trackId: 't9',
      timestamp: 5,
      assigned: false,
      identityId: undefined,
      identityName: undefined,
      cropUrl: undefined,
      base64: undefined,
      bestMatchScore: undefined,
      nativeFaceShortSidePx: undefined,
      suggestedIdentityId: undefined,
      suggestedMatchScore: undefined,
    })
  })

  it('parses a cropUrl when the hub sends one instead of bytes', () => {
    const f = toFaceInfo({
      faceId: 'f3',
      deviceId: 1,
      trackId: 't3',
      timestamp: 9,
      assigned: false,
      cropUrl: '/addon/pipeline-analytics/event-media/k',
    })
    expect(f?.cropUrl).toBe('/addon/pipeline-analytics/event-media/k')
    expect(f?.base64).toBeUndefined()
  })

  it('rejects malformed rows (null / missing / mistyped ids)', () => {
    expect(toFaceInfo(null)).toBeNull()
    expect(toFaceInfo({})).toBeNull()
    expect(toFaceInfo({ ...valid, faceId: 7 })).toBeNull()
    expect(toFaceInfo({ ...valid, deviceId: 'x' })).toBeNull()
    expect(toFaceInfo({ ...valid, trackId: undefined })).toBeNull()
  })
})

describe('toIdentity — faceGallery.listIdentities row narrowing', () => {
  it('parses an identity with cover', () => {
    const i = toIdentity({ id: 'p1', name: 'Bob', sampleCount: 4, coverBase64: 'BBBB' })
    expect(i).toEqual({
      id: 'p1',
      name: 'Bob',
      sampleCount: 4,
      coverMediaId: undefined,
      coverBase64: 'BBBB',
    })
  })

  it('parses an identity without cover, defaults sampleCount 0 on mistype', () => {
    const i = toIdentity({ id: 'p2', name: 'Carol', sampleCount: 'x' })
    expect(i).toEqual({
      id: 'p2',
      name: 'Carol',
      sampleCount: 0,
      coverMediaId: undefined,
      coverBase64: undefined,
    })
  })

  it('rejects malformed rows', () => {
    expect(toIdentity(null)).toBeNull()
    expect(toIdentity({ id: 'p3' })).toBeNull() // no name
    expect(toIdentity({ name: 'NoId' })).toBeNull()
  })
})

describe('collectFaceIdsForIdentity — mass-unassign faceId resolution', () => {
  // Rows shaped like faceGallery.listRecentFaces output: faceId + recognizedIdentityId.
  const rows = [
    { faceId: 'f1', deviceId: 1, trackId: 't1', timestamp: 1, assigned: true, recognizedIdentityId: 'idA' },
    { faceId: 'f2', deviceId: 1, trackId: 't2', timestamp: 2, assigned: false, recognizedIdentityId: 'idA' }, // auto-recognized, not enrolled
    { faceId: 'f3', deviceId: 2, trackId: 't3', timestamp: 3, assigned: true, recognizedIdentityId: 'idB' },
    { faceId: 'f4', deviceId: 2, trackId: 't4', timestamp: 4, assigned: false }, // unassigned
  ]

  it('collects EVERY faceId linked to the identity (assigned AND auto-recognized)', () => {
    expect(collectFaceIdsForIdentity(rows, 'idA')).toEqual(['f1', 'f2'])
  })

  it('returns only the matching identity, excluding other persons and unassigned faces', () => {
    expect(collectFaceIdsForIdentity(rows, 'idB')).toEqual(['f3'])
  })

  it('returns [] for an unknown identity, a non-array, or an empty identityId', () => {
    expect(collectFaceIdsForIdentity(rows, 'idZ')).toEqual([])
    expect(collectFaceIdsForIdentity(null, 'idA')).toEqual([])
    expect(collectFaceIdsForIdentity(undefined, 'idA')).toEqual([])
    expect(collectFaceIdsForIdentity(rows, '')).toEqual([])
  })

  it('skips malformed rows without throwing', () => {
    const mixed = [
      { faceId: 'ok', deviceId: 1, trackId: 't', timestamp: 1, assigned: true, recognizedIdentityId: 'idA' },
      null,
      { faceId: 7, recognizedIdentityId: 'idA' }, // bad faceId
      { recognizedIdentityId: 'idA' }, // missing faceId
    ]
    expect(collectFaceIdsForIdentity(mixed, 'idA')).toEqual(['ok'])
  })
})

describe('FACE_ID_RESOLUTION_QUERY — the id-only listRecentFaces input', () => {
  // Two call sites resolve faceIds this way (useUnassignAllForIdentity here and
  // use-face-info's unassignAll). They must not diverge, and neither may ask the
  // server to inline a crop it will never render: `filter:'all'` is UNBOUNDED,
  // so with crops it is ~3.2 MB / 7.7 s on the live hub versus ~0.28 MB / 78 ms
  // without — paid on a phone, to extract a list of ids.
  it('asks for every face but NO inline crops', () => {
    expect(FACE_ID_RESOLUTION_QUERY.filter).toBe('all')
    expect(FACE_ID_RESOLUTION_QUERY.includeCrops).toBe(false)
  })

  it('is satisfiable by rows that carry no crop at all — collection reads ids only', () => {
    const cropless = [
      { faceId: 'f1', deviceId: 1, trackId: 't1', timestamp: 1, assigned: true, recognizedIdentityId: 'idA' },
      { faceId: 'f2', deviceId: 1, trackId: 't2', timestamp: 2, assigned: false, recognizedIdentityId: 'idA' },
    ]
    expect(collectFaceIdsForIdentity(cropless, 'idA')).toEqual(['f1', 'f2'])
  })
})

describe('toMassUnassignResult — unassignFaces result narrowing', () => {
  it('parses a full result', () => {
    expect(toMassUnassignResult({ unassigned: 3, failed: ['f9'] })).toEqual({ unassigned: 3, failed: ['f9'] })
  })

  it('defaults missing/mistyped fields to 0 / [] and drops non-string failures', () => {
    expect(toMassUnassignResult({})).toEqual({ unassigned: 0, failed: [] })
    expect(toMassUnassignResult(null)).toEqual({ unassigned: 0, failed: [] })
    expect(toMassUnassignResult({ unassigned: 'x', failed: ['f1', 2, null] })).toEqual({ unassigned: 0, failed: ['f1'] })
  })
})

describe('toMassAssignResult — assignFaces result narrowing (batch-review write path)', () => {
  it('parses a full result', () => {
    expect(toMassAssignResult({ assigned: 5, failed: ['f9'] })).toEqual({ assigned: 5, failed: ['f9'] })
  })

  it('defaults missing/mistyped fields to 0 / [] and drops non-string failures', () => {
    expect(toMassAssignResult({})).toEqual({ assigned: 0, failed: [] })
    expect(toMassAssignResult(null)).toEqual({ assigned: 0, failed: [] })
    expect(toMassAssignResult({ assigned: 'x', failed: ['f1', 2, null] })).toEqual({ assigned: 0, failed: ['f1'] })
  })
})

describe('faceHasPerson — unassign-affordance gate (pre-assigned bug fix)', () => {
  it('is TRUE for a PRE-ASSIGNED (auto-recognized) face — identity set, assigned:false', () => {
    // The recognizer inserts auto rows with assigned:false but recognizedIdentityId
    // set; the previous `assigned` gate hid the remove button for exactly these.
    const face = toFaceInfo({
      faceId: 'f1', deviceId: 1, trackId: 't1', timestamp: 1,
      assigned: false, recognizedIdentityId: 'idA', identityName: 'Alice',
    })
    expect(face?.assigned).toBe(false)
    expect(faceHasPerson(face?.identityId)).toBe(true)
  })

  it('is TRUE for a manually assigned face (identity set, assigned:true)', () => {
    expect(faceHasPerson('idA')).toBe(true)
  })

  it('is FALSE for an unassigned face and for empty / nullish ids', () => {
    expect(faceHasPerson(undefined)).toBe(false)
    expect(faceHasPerson(null)).toBe(false)
    expect(faceHasPerson('')).toBe(false)
  })
})

describe('sortIdentities', () => {
  it('orders alphabetically by name (case-insensitive), stable for the picker', () => {
    const list = [
      { id: '1', name: 'zoe', sampleCount: 1, coverMediaId: undefined, coverBase64: undefined },
      { id: '2', name: 'Alice', sampleCount: 2, coverMediaId: undefined, coverBase64: undefined },
      { id: '3', name: 'bob', sampleCount: 0, coverMediaId: undefined, coverBase64: undefined },
    ]
    expect(sortIdentities(list).map((i) => i.name)).toEqual(['Alice', 'bob', 'zoe'])
    // input untouched (immutability)
    expect(list[0]?.name).toBe('zoe')
  })
})
