import { describe, it, expect } from 'vitest'

import { zoneMultiChoices, zonePickerItems } from '../zone-choices.js'

const ZONES = [
  { id: 'z-door', name: 'Porta front door' },
  { id: 'z-yard', name: 'Garden' },
] as const

describe('zoneMultiChoices', () => {
  it('offers every known zone by NAME and marks the selected ones', () => {
    const { options, unknownIds } = zoneMultiChoices(ZONES, ['z-yard'])
    expect(options).toEqual([
      { id: 'z-door', name: 'Porta front door', selected: false },
      { id: 'z-yard', name: 'Garden', selected: true },
    ])
    expect(unknownIds).toEqual([])
  })

  it('surfaces selected ids the zone list does not know, in selection order', () => {
    // A rule authored in the admin UI can reference a zone of a camera the
    // viewer has not loaded (or one since deleted). The id must stay visible
    // and removable — silently dropping it would rewrite the rule on save.
    const { unknownIds } = zoneMultiChoices(ZONES, ['z-gone', 'z-door', 'z-old'])
    expect(unknownIds).toEqual(['z-gone', 'z-old'])
  })

  it('an empty zone list keeps every selection as unknown rather than deleting it', () => {
    const { options, unknownIds } = zoneMultiChoices([], ['z-door'])
    expect(options).toEqual([])
    expect(unknownIds).toEqual(['z-door'])
  })
})

// Operator, 2026-10-01 (R14): zones are listed as "camera:zone", in both
// modes of the scope field, grouped by camera.
describe('zonePickerItems', () => {
  const names = new Map([
    [7, 'Garden'],
    [9, 'Front door'],
  ])

  it('names each zone camera:zone and groups it by camera', () => {
    const items = zonePickerItems(
      [
        { deviceId: 7, zones: [{ id: 'z-1', name: 'Prato' }] },
        { deviceId: 9, zones: [{ id: 'z-2', name: 'Prato' }] },
      ],
      names,
    )
    expect(items).toEqual([
      { id: 'z-1', name: 'Garden:Prato', type: 'Garden' },
      { id: 'z-2', name: 'Front door:Prato', type: 'Front door' },
    ])
  })

  it('keeps a repeated id once, under its first camera; an unnamed camera reads #id', () => {
    const items = zonePickerItems(
      [
        { deviceId: 7, zones: [{ id: 'z-1', name: 'Prato' }] },
        { deviceId: 42, zones: [{ id: 'z-1', name: 'Prato' }, { id: 'z-3', name: 'Viale' }] },
      ],
      names,
    )
    expect(items.map((item) => item.name)).toEqual(['Garden:Prato', '#42:Viale'])
  })
})
