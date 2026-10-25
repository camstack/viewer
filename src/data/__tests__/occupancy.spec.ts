import { describe, it, expect } from 'vitest'
import {
  toCameraOccupancy,
  occupancyClassCounts,
  hasOccupancy,
  parseZoneNames,
} from '../occupancy.js'
import { replaceEqualDeep } from '@tanstack/query-core'

describe('toCameraOccupancy', () => {
  it('narrows a valid snapshot', () => {
    const snap = toCameraOccupancy({
      ts: 1000,
      frame: { totalObjects: 3, byClass: { person: 2, car: 1 } },
      stationaryObjects: [{ id: 'a' }],
    })
    expect(snap).not.toBeNull()
    expect(snap?.ts).toBe(1000)
    expect(snap?.frame.totalObjects).toBe(3)
    expect(snap?.frame.byClass).toEqual({ person: 2, car: 1 })
    expect(snap?.stationaryCount).toBe(1)
  })

  it('returns null for a null / non-object payload (cap "no frame yet")', () => {
    expect(toCameraOccupancy(null)).toBeNull()
    expect(toCameraOccupancy('nope')).toBeNull()
  })

  it('degrades missing / malformed fields to zero', () => {
    const snap = toCameraOccupancy({ frame: { byClass: { person: 'x', car: -1, dog: 2 } } })
    expect(snap?.ts).toBe(0)
    expect(snap?.frame.totalObjects).toBe(0)
    // wrong-typed / non-positive class counts are dropped
    expect(snap?.frame.byClass).toEqual({ dog: 2 })
    expect(snap?.stationaryCount).toBe(0)
  })
})

describe('occupancyClassCounts', () => {
  it('sorts by count desc, then class name asc', () => {
    const snap = toCameraOccupancy({
      ts: 1,
      frame: { totalObjects: 5, byClass: { car: 1, person: 3, dog: 1 } },
    })
    expect(occupancyClassCounts(snap)).toEqual([
      { className: 'person', count: 3 },
      { className: 'car', count: 1 },
      { className: 'dog', count: 1 },
    ])
  })

  it('is empty for a null snapshot', () => {
    expect(occupancyClassCounts(null)).toEqual([])
  })
})

describe('hasOccupancy', () => {
  it('is true only when at least one object is present', () => {
    expect(hasOccupancy(null)).toBe(false)
    expect(hasOccupancy(toCameraOccupancy({ frame: { totalObjects: 0, byClass: {} } }))).toBe(false)
    expect(hasOccupancy(toCameraOccupancy({ frame: { totalObjects: 2, byClass: { person: 2 } } }))).toBe(true)
  })
})

describe('parseZoneNames', () => {
  it('builds a zoneId→zoneName dictionary from a snapshot', () => {
    const names = parseZoneNames({
      zones: [
        { zoneId: 'z1', zoneName: 'Driveway', totalObjects: 1, byClass: {}, trackIds: [] },
        { zoneId: 'z2', zoneName: 'Porch', totalObjects: 0, byClass: {}, trackIds: [] },
      ],
    })
    expect(names).toEqual({ z1: 'Driveway', z2: 'Porch' })
  })

  it('skips malformed rows and returns empty for null/absent zones', () => {
    expect(parseZoneNames(null)).toEqual({})
    expect(parseZoneNames({})).toEqual({})
    expect(
      parseZoneNames({
        zones: [{ zoneId: '', zoneName: 'X' }, { zoneId: 'ok', zoneName: '' }, { zoneId: 'good', zoneName: 'Gate' }],
      }),
    ).toEqual({ good: 'Gate' })
  })

  it('refuses the one wire id that would replace the prototype', () => {
    const names = parseZoneNames({
      zones: [{ zoneId: '__proto__', zoneName: 'pwned' }, { zoneId: 'z1', zoneName: 'Gate' }],
    })
    expect(names).toEqual({ z1: 'Gate' })
    expect(Object.getPrototypeOf(names)).toBe(Object.prototype)
    expect(({} as Record<string, unknown>).zoneName).toBeUndefined()
  })
})

/**
 * REGRESSION (2026-09-06). `useZoneNames` returned a `Map`, and React Query's
 * structural sharing hands back anything that is not a plain object or array
 * VERBATIM — so every refetch minted a new identity even when the hub answered
 * exactly the same zones. Combined with the query key sitting under the
 * `['v2','occupancy']` invalidation prefix (see `zoneNamesQueryKey`), a busy
 * scene re-rendered the open track detail several times a second for an answer
 * that had not changed.
 *
 * This pins the property the fix rests on, against the REAL library rather than
 * a description of it: two parses of the same snapshot must collapse to the
 * previous reference. A `Map` fails this; a plain object passes.
 */
describe('the zone dictionary survives a refetch that changed nothing', () => {
  const snapshot = {
    zones: [
      { zoneId: 'z1', zoneName: 'Driveway', totalObjects: 1, byClass: {}, trackIds: [] },
      { zoneId: 'z2', zoneName: 'Porch', totalObjects: 0, byClass: {}, trackIds: [] },
    ],
  }

  it('is structurally shared: an identical answer keeps the previous identity', () => {
    const previous = parseZoneNames(snapshot)
    const refetched = parseZoneNames(snapshot)
    expect(refetched).not.toBe(previous)
    expect(replaceEqualDeep(previous, refetched)).toBe(previous)
  })

  it('still publishes a NEW identity when a zone is actually renamed', () => {
    const previous = parseZoneNames(snapshot)
    const renamed = parseZoneNames({
      zones: [
        { zoneId: 'z1', zoneName: 'Vialetto', totalObjects: 1, byClass: {}, trackIds: [] },
        { zoneId: 'z2', zoneName: 'Porch', totalObjects: 0, byClass: {}, trackIds: [] },
      ],
    })
    expect(replaceEqualDeep(previous, renamed)).not.toBe(previous)
    expect(replaceEqualDeep(previous, renamed)).toEqual({ z1: 'Vialetto', z2: 'Porch' })
  })

  it('a Map — the shape this replaced — could never be shared', () => {
    // The proof the fix is the fix: the old return type is un-dedupable by
    // construction, so no amount of caching upstream could have helped.
    const asMap = (): Map<string, string> => new Map([['z1', 'Driveway']])
    expect(replaceEqualDeep(asMap(), asMap())).not.toBe(undefined)
    const previous = asMap()
    expect(replaceEqualDeep(previous, asMap())).not.toBe(previous)
  })
})

describe('toCameraOccupancy stationary overlay objects', () => {
  it('normalizes drawable entries and drops undrawable ones', () => {
    const snap = toCameraOccupancy({
      ts: 1000,
      frame: { totalObjects: 1, byClass: { car: 1 } },
      stationaryObjects: [
        {
          id: 's1',
          className: 'vehicle',
          bbox: { x: 320, y: 90, w: 64, h: 36 },
          frameWidth: 640,
          frameHeight: 360,
          becameStationaryAt: 500,
          label: 'AB-CD-123',
        },
        { id: 'no-bbox' },
      ],
    })
    // Badge counts EVERY reported entry; overlay keeps only drawable ones.
    expect(snap?.stationaryCount).toBe(2)
    expect(snap?.stationaryObjects).toHaveLength(1)
    const s = snap!.stationaryObjects[0]!
    expect(s.id).toBe('s1')
    expect(s.x1).toBeCloseTo(0.5)
    expect(s.y1).toBeCloseTo(0.25)
    expect(s.x2).toBeCloseTo(0.6)
    expect(s.y2).toBeCloseTo(0.35)
    expect(s.label).toBe('AB-CD-123')
    expect(s.becameStationaryAt).toBe(500)
  })
})
