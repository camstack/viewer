/**
 * The `zones.listZones` boundary — parsing the hub's zone list into the
 * `{id, name}` pairs the occupancy condition picker needs.
 *
 * The cap is device-scoped, so the picker fans one query out per selected
 * camera and merges. Parsing is defensive for the same reason every other cap
 * read here is: a zone whose row is malformed costs THAT zone, never the list
 * (a rule editor with no zones at all is indistinguishable from a camera that
 * has none).
 */
import { describe, it, expect } from 'vitest'
import { mergeZoneLists, parseZoneList } from '../zones.js'

describe('parseZoneList', () => {
  it('keeps id + name and ignores the geometry it does not need', () => {
    expect(
      parseZoneList([
        { id: 'z1', name: 'Driveway', kind: 'polygon', polygon: [{ x: 0, y: 0 }], color: '#fff' },
      ]),
    ).toEqual([{ id: 'z1', name: 'Driveway' }])
  })

  it('falls back to the id when the name is missing or blank', () => {
    // A blank label renders as an unlabelled row the operator cannot identify.
    expect(parseZoneList([{ id: 'z1' }, { id: 'z2', name: '   ' }])).toEqual([
      { id: 'z1', name: 'z1' },
      { id: 'z2', name: 'z2' },
    ])
  })

  it('drops only the malformed entry, never the list', () => {
    expect(parseZoneList([{ id: 'z1', name: 'A' }, null, { name: 'no id' }, 7])).toEqual([
      { id: 'z1', name: 'A' },
    ])
  })

  it('returns nothing for a non-list (an absent cap answers null)', () => {
    expect(parseZoneList(null)).toEqual([])
    expect(parseZoneList(undefined)).toEqual([])
    expect(parseZoneList({ zones: [] })).toEqual([])
  })
})

describe('mergeZoneLists', () => {
  it('unions the per-camera lists, first name wins on a repeated id', () => {
    expect(
      mergeZoneLists([
        [{ id: 'z1', name: 'Driveway' }],
        [
          { id: 'z1', name: 'Driveway (copy)' },
          { id: 'z2', name: 'Porch' },
        ],
      ]),
    ).toEqual([
      { id: 'z1', name: 'Driveway' },
      { id: 'z2', name: 'Porch' },
    ])
  })

  it('is empty for no cameras selected', () => {
    expect(mergeZoneLists([])).toEqual([])
  })
})
