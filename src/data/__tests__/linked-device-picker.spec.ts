/**
 * linked-device-picker — the ordering rule D356 spells out, ported.
 *
 * The admin UI's control is `device-multiselect` with `suggestLocation`
 * (`packages/ui-library/src/composites/device-select-filter.ts`, guarded by
 * `device-multiselect-linked.test.tsx`). It is a web React component and this
 * is React Native, so what is shared is the SEMANTICS, not the code — and this
 * spec is the place they are held to it:
 *
 *   - same-location devices are SUGGESTED first and never pre-selected;
 *   - a container is never offered, its children are, named after it;
 *   - the search narrows name, location and id.
 *
 * The fleet below is the one from the server-side test, because the two
 * spotlights inside "Pulsante faretti hall" are the exact case the retired
 * `auto` rule could not express.
 */
import { describe, expect, it } from 'vitest'
import {
  CONTAINER_DEVICE_TYPE,
  buildPickerGroups,
  filterPickerGroups,
  boundOptions,
  pickerOptionsInOrder,
  resolvePickedOptions,
  type PickerCandidate,
} from '../linked-device-picker.js'

const fleet: readonly PickerCandidate[] = [
  { id: 104, name: 'Camera hall', type: 'camera', location: 'Hall', parentDeviceId: null },
  {
    id: 3513,
    name: 'Pulsante faretti hall',
    type: 'container',
    location: 'Hall',
    parentDeviceId: null,
  },
  { id: 3519, name: 'Faretti hall 1', type: 'switch', location: 'Hall', parentDeviceId: 3513 },
  { id: 3520, name: 'Faretti hall 2', type: 'switch', location: 'Hall', parentDeviceId: 3513 },
  { id: 3510, name: 'Faretti kitchen', type: 'switch', location: 'Kitchen', parentDeviceId: null },
  { id: 4161, name: 'Sensore hall', type: 'sensor', location: 'Hall', parentDeviceId: null },
  { id: 4200, name: 'Sirena', type: 'siren', location: null, parentDeviceId: null },
]

const filter = { excludeDeviceId: 104, excludeTypes: ['container'] } as const

describe('buildPickerGroups', () => {
  it('suggests the camera’s own location first and offers everything else after', () => {
    const groups = buildPickerGroups(fleet, filter, 'Hall')
    expect(groups.suggested.map((o) => o.id)).toEqual([3519, 3520, 4161])
    expect(groups.others.map((o) => o.id)).toEqual([3510, 4200])
  })

  it('SUGGESTS ONLY — nothing in the groups is selected on its own (D356)', () => {
    const groups = buildPickerGroups(fleet, filter, 'Hall')
    // The option carries no selection at all: the picked set is the operator's
    // and lives outside this module. An `auto` rule is exactly what D356 removed.
    for (const option of pickerOptionsInOrder(groups)) {
      expect('selected' in option).toBe(false)
    }
  })

  it('never offers a container — its children are offered instead', () => {
    const ids = pickerOptionsInOrder(buildPickerGroups(fleet, filter, 'Hall')).map((o) => o.id)
    expect(ids).not.toContain(3513)
    expect(ids).toContain(3519)
    expect(ids).toContain(3520)
  })

  it('excludes a container even when the hub sent no excludeTypes (version skew)', () => {
    const groups = buildPickerGroups(fleet, { excludeDeviceId: 104, excludeTypes: [] }, 'Hall')
    expect(pickerOptionsInOrder(groups).map((o) => o.id)).not.toContain(3513)
    expect(CONTAINER_DEVICE_TYPE).toBe('container')
  })

  it('names a container child after its container, so both spotlights are tellable apart', () => {
    const groups = buildPickerGroups(fleet, filter, 'Hall')
    const second = pickerOptionsInOrder(groups).find((o) => o.id === 3520)
    expect(second?.label).toBe('Faretti hall 2 (Hall)')
    expect(second?.description).toBe('Hall · switch · in Pulsante faretti hall')
  })

  it('drops the camera itself', () => {
    const ids = pickerOptionsInOrder(buildPickerGroups(fleet, filter, 'Hall')).map((o) => o.id)
    expect(ids).not.toContain(104)
  })

  it('suggests nothing when the camera has no location — everything is just offered', () => {
    const groups = buildPickerGroups(fleet, filter, null)
    expect(groups.suggested).toEqual([])
    expect(groups.others.map((o) => o.id)).toEqual([3519, 3520, 3510, 4161, 4200])
  })

  it('sorts each group by label, case-insensitively', () => {
    const groups = buildPickerGroups(
      [
        { id: 1, name: 'zeta', type: 'switch', location: null, parentDeviceId: null },
        { id: 2, name: 'Alpha', type: 'switch', location: null, parentDeviceId: null },
      ],
      { excludeDeviceId: null, excludeTypes: [] },
      null,
    )
    expect(groups.others.map((o) => o.label)).toEqual(['Alpha', 'zeta'])
  })
})

describe('filterPickerGroups', () => {
  it('matches name, location and id, and keeps the two groups apart', () => {
    const groups = buildPickerGroups(fleet, filter, 'Hall')
    expect(pickerOptionsInOrder(filterPickerGroups(groups, 'faretti')).map((o) => o.id)).toEqual([
      3519, 3520, 3510,
    ])
    expect(pickerOptionsInOrder(filterPickerGroups(groups, 'kitchen')).map((o) => o.id)).toEqual([
      3510,
    ])
    expect(pickerOptionsInOrder(filterPickerGroups(groups, '3520')).map((o) => o.id)).toEqual([3520])
  })

  it('ANDs the whitespace tokens', () => {
    const groups = buildPickerGroups(fleet, filter, 'Hall')
    expect(pickerOptionsInOrder(filterPickerGroups(groups, 'faretti hall')).map((o) => o.id)).toEqual(
      [3519, 3520],
    )
  })

  it('an empty query changes nothing', () => {
    const groups = buildPickerGroups(fleet, filter, 'Hall')
    expect(filterPickerGroups(groups, '   ')).toEqual(groups)
  })
})

describe('resolvePickedOptions', () => {
  it('draws the picks in SELECTION order, named after their container', () => {
    const rows = resolvePickedOptions(fleet, [3520, 4200])
    expect(rows.map((r) => r.id)).toEqual([3520, 4200])
    expect(rows[0]?.description).toBe('Hall · switch · in Pulsante faretti hall')
  })

  it('keeps a pick whose device is GONE, so it can still be taken off the list', () => {
    const rows = resolvePickedOptions(fleet, [99999])
    expect(rows).toEqual([{ id: 99999, label: 'Device #99999', description: '', location: null }])
  })
})

describe('boundOptions', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    label: `d${i}`,
    description: '',
    location: null,
  }))

  it('says how many matches it did NOT draw — a cut list must never read as the whole list', () => {
    const bounded = boundOptions(many, 50)
    expect(bounded.shown).toHaveLength(50)
    expect(bounded.hidden).toBe(10)
  })

  it('hides nothing, and reports nothing hidden, when the list already fits', () => {
    const bounded = boundOptions(many.slice(0, 3), 50)
    expect(bounded.shown).toHaveLength(3)
    expect(bounded.hidden).toBe(0)
  })
})
