import { describe, it, expect } from 'vitest'
import {
  knownValues as sharedKnownValues,
  pickerForCondition as sharedPickerForCondition,
} from '@camstack/types/client'
import { pickerForCondition, knownValues } from '../condition-taxonomy.js'
import type { NcTaxonomy } from '../../../data/notification-center.js'

const TAXONOMY: NcTaxonomy = {
  videoClasses: [
    { kind: 'person', label: 'Person', parentKind: null },
    { kind: 'vehicle', label: 'Vehicle', parentKind: null },
    { kind: 'car', label: 'Car', parentKind: 'vehicle' },
    { kind: 'truck', label: 'Truck', parentKind: 'vehicle' },
    { kind: 'animal', label: 'Animal', parentKind: null },
    { kind: 'dog', label: 'Dog', parentKind: 'animal' },
  ],
  audioKinds: [
    { kind: 'audio-scream', label: 'Scream / Shout', parentKind: 'audio' },
    { kind: 'audio-glass_breaking', label: 'Glass Breaking', parentKind: 'audio' },
  ],
  labels: [
    { kind: 'contact', label: 'Contact', parentKind: 'sensor' },
    { kind: 'doorbell', label: 'Doorbell', parentKind: 'control' },
    { kind: 'lock', label: 'Lock', parentKind: 'control' },
  ],
}

describe('pickerForCondition', () => {
  it('returns null when taxonomy is absent', () => {
    expect(pickerForCondition('classes', undefined)).toBeNull()
  })

  it('returns null for free-text conditions (identities, tokens, zones)', () => {
    for (const id of ['identities', 'identitiesExclude', 'labelEquals', 'eventTypeTokens', 'zonesExclude']) {
      expect(pickerForCondition(id, TAXONOMY)).toBeNull()
    }
  })

  it('groups video classes by macro and appends an audio group for classes', () => {
    const picker = pickerForCondition('classes', TAXONOMY)
    expect(picker).not.toBeNull()
    const keys = picker!.groups.map((g) => g.key)
    expect(keys).toEqual(['person', 'vehicle', 'animal', 'audio'])

    const vehicle = picker!.groups.find((g) => g.key === 'vehicle')!
    expect(vehicle.fallbackLabel).toBe('Vehicle')
    // The macro itself leads its group, followed by its subs.
    expect(vehicle.options.map((o) => o.value)).toEqual(['vehicle', 'car', 'truck'])

    const audio = picker!.groups.find((g) => g.key === 'audio')!
    expect(audio.options.map((o) => o.value)).toEqual(['audio-scream', 'audio-glass_breaking'])
  })

  it('offers occupancy ONLY the macro classes — a sub-type can never be counted', () => {
    const picker = pickerForCondition('occupancy', TAXONOMY)
    expect(picker).not.toBeNull()
    expect(picker!.groups).toHaveLength(1)
    expect(picker!.groups[0]!.options.map((o) => o.value)).toEqual(['person', 'vehicle', 'animal'])
  })

  it('never offers occupancy a sub class or an audio kind', () => {
    const known = knownValues(pickerForCondition('occupancy', TAXONOMY)!)
    expect(known.has('car')).toBe(false)
    expect(known.has('dog')).toBe(false)
    expect(known.has('audio-scream')).toBe(false)
  })

  it('classesExclude uses the same class picker as classes', () => {
    const a = pickerForCondition('classes', TAXONOMY)
    const b = pickerForCondition('classesExclude', TAXONOMY)
    expect(b?.groups.map((g) => g.key)).toEqual(a?.groups.map((g) => g.key))
  })

  it('groups sensorKinds labels by sensor/control category', () => {
    const picker = pickerForCondition('sensorKinds', TAXONOMY)
    expect(picker).not.toBeNull()
    expect(picker!.groups.map((g) => g.key)).toEqual(['sensor', 'control'])
    const control = picker!.groups.find((g) => g.key === 'control')!
    expect(control.options.map((o) => o.value)).toEqual(['doorbell', 'lock'])
  })

  it('knownValues enumerates every option value across groups', () => {
    const picker = pickerForCondition('classes', TAXONOMY)!
    const known = knownValues(picker)
    expect(known.has('car')).toBe(true)
    expect(known.has('audio-scream')).toBe(true)
    expect(known.has('doorbell')).toBe(false)
  })
})

/**
 * The COLLAPSE, asserted as identity rather than as behaviour.
 *
 * Everything above would pass just as well against a second implementation that
 * happens to agree today — which is exactly the state this file was in for
 * months, with a TODO saying so. `toBe` on the function itself is the only
 * assertion a copy cannot satisfy: the module is the shared one or it is not.
 */
describe('it IS the shared module, not a copy that agrees', () => {
  it('re-exports @camstack/types', () => {
    expect(pickerForCondition).toBe(sharedPickerForCondition)
    expect(knownValues).toBe(sharedKnownValues)
  })
})
