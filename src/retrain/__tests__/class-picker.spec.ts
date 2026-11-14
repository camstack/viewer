/**
 * The retrain class picker: macros offered, sub-classes filtered by macro,
 * and the "was" text of a reclassified box.
 */
import { describe, expect, it } from 'vitest'
import type { NcTaxonomy } from '../../data/notification-center.js'
import { RETRAIN_OFFERED_MACROS } from '../../data/retrain-parse.js'
import { pickSingle } from '../../components/notifications/single-pick.js'
import {
  classLabelPickerItems,
  classLabelPickId,
  macroPickerItems,
  originalClassText,
  parseClassLabelPick,
  subClassPickerItems,
} from '../class-picker.js'
import { isRetrainMacroClass } from '../../data/retrain-parse.js'
import type { BoxDiff } from '../live-review.js'

const entry = (kind: string, parentKind: string | null) => ({
  kind,
  label: kind.toUpperCase(),
  parentKind,
})
const taxonomy: NcTaxonomy = {
  videoClasses: [
    entry('animal', null),
    entry('dog', 'animal'),
    entry('cat', 'animal'),
    entry('vehicle', null),
    entry('car', 'vehicle'),
    entry('person', null),
  ],
  audioKinds: [],
  labels: [],
}
const name = (m: string): string => m

describe('offered macros', () => {
  it('never offers face or plate', () => {
    expect(RETRAIN_OFFERED_MACROS).toEqual(['person', 'vehicle', 'animal', 'package'])
    const ids = macroPickerItems(taxonomy, name).map((i) => i.id)
    expect(ids).not.toContain('face')
    expect(ids).not.toContain('plate')
    expect(ids).toEqual(['person', 'vehicle', 'animal', 'package'])
  })
  it('names a macro from the taxonomy, else by the fallback', () => {
    const items = macroPickerItems(taxonomy, name)
    expect(items.find((i) => i.id === 'animal')?.name).toBe('ANIMAL')
    expect(items.find((i) => i.id === 'package')?.name).toBe('package')
  })
})

describe('sub-class list', () => {
  it('lists only the entries under the chosen macro, never the macro itself', () => {
    expect(subClassPickerItems(taxonomy, 'animal').map((i) => i.id)).toEqual(['dog', 'cat'])
    expect(subClassPickerItems(taxonomy, 'vehicle').map((i) => i.id)).toEqual(['car'])
  })
  it('is empty when the taxonomy lacks the macro or is missing (free text takes over)', () => {
    expect(subClassPickerItems(taxonomy, 'package')).toEqual([])
    expect(subClassPickerItems(undefined, 'animal')).toEqual([])
  })
})

it('a single pick is the tapped id alone', () => {
  expect(pickSingle('dog')).toEqual(['dog'])
})

describe('originalClassText', () => {
  const diff = (over: Partial<BoxDiff>): BoxDiff => ({
    kind: 'reclassified',
    approximate: false,
    ...over,
  })
  it('same macro: original label to new label', () => {
    expect(
      originalClassText({
        diff: diff({ originMacroClass: 'animal', originLabel: 'cat' }),
        macroClass: 'animal',
        label: 'dog',
        macroName: name,
      }),
    ).toEqual({ original: 'cat', current: 'dog' })
  })
  it('macro changed: prefixes the macro', () => {
    expect(
      originalClassText({
        diff: diff({ originMacroClass: 'animal', originLabel: 'cat' }),
        macroClass: 'person',
        label: undefined,
        macroName: name,
      }),
    ).toEqual({ original: 'animal/cat', current: 'person' })
  })
  it('says nothing for another kind, an unknown original, or no change', () => {
    const base = { macroClass: 'animal', label: 'dog', macroName: name } as const
    expect(
      originalClassText({ ...base, diff: diff({ kind: 'adjusted', originMacroClass: 'animal' }) }),
    ).toBeNull()
    expect(originalClassText({ ...base, diff: diff({}) })).toBeNull()
    expect(originalClassText({ ...base, diff: undefined })).toBeNull()
    expect(
      originalClassText({
        ...base,
        diff: diff({ originMacroClass: 'animal', originLabel: 'dog' }),
      }),
    ).toBeNull()
  })
})

describe('the one-step class-and-label list', () => {
  it('offers every class with its labels grouped under it, in one list', () => {
    const items = classLabelPickerItems(taxonomy, name)
    const animal = items.filter((i) => i.type === 'animal').map((i) => i.id)
    expect(animal).toEqual(['animal', 'animal:dog', 'animal:cat'])
    expect(items.filter((i) => i.type === 'vehicle').map((i) => i.id)).toEqual(['vehicle', 'vehicle:car'])
    expect(new Set(items.map((i) => i.type))).toEqual(new Set(RETRAIN_OFFERED_MACROS))
  })
  it('one pick names both the class and the label', () => {
    expect(parseClassLabelPick('animal:dog', isRetrainMacroClass)).toEqual({ macroClass: 'animal', label: 'dog' })
    expect(parseClassLabelPick('vehicle', isRetrainMacroClass)).toEqual({ macroClass: 'vehicle', label: '' })
    expect(parseClassLabelPick('nope:x', isRetrainMacroClass)).toBeNull()
  })
  it('round-trips the box it shows', () => {
    expect(classLabelPickId('person', undefined)).toBe('person')
    expect(classLabelPickId('person', '')).toBe('person')
    expect(parseClassLabelPick(classLabelPickId('person', 'Marco: Rossi'), isRetrainMacroClass)).toEqual({
      macroClass: 'person',
      label: 'Marco: Rossi',
    })
  })
})
