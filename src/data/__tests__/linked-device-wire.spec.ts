/**
 * linked-device-wire — the catalogue the accessory picker offers from.
 *
 * D393: **a measurement that FAILED is `null`, never `0`.** A fleet that did
 * not arrive is unknown, not empty — an empty picker and an unreachable hub
 * look identical to an operator and only one of them is worth waiting on.
 */
import { describe, expect, it } from 'vitest'
import { parsePickerCandidates } from '../linked-device-wire.js'

describe('parsePickerCandidates', () => {
  it('keeps the fields the picker reads and drops a row that is not a device', () => {
    const rows = [
      {
        id: 3520,
        name: 'Faretti hall 2',
        type: 'switch',
        location: 'Hall',
        parentDeviceId: 3513,
        features: ['switch', 'motion-trigger'],
      },
      { id: 1, name: 'No parent', type: 'switch' },
      { name: 'no id', type: 'switch' },
      'nonsense',
    ]
    expect(parsePickerCandidates(rows)).toEqual([
      {
        id: 3520,
        name: 'Faretti hall 2',
        type: 'switch',
        location: 'Hall',
        parentDeviceId: 3513,
        features: ['switch', 'motion-trigger'],
      },
      { id: 1, name: 'No parent', type: 'switch', location: null, parentDeviceId: null, features: [] },
    ])
  })

  it('a payload that is not a list is UNKNOWN, never an empty fleet', () => {
    expect(parsePickerCandidates(null)).toBeNull()
    expect(parsePickerCandidates({})).toBeNull()
  })
})
