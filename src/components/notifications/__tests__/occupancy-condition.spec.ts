/**
 * The occupancy condition's pure logic — the half of the widget that decides
 * what gets STORED, kept out of the React tree so it is asserted directly in
 * the node test env (the repo precedent: `rule-editor.ts`, `target-form.ts`).
 *
 * Three of these tests pin failures the admin widget already taught us about:
 *  - a stored zone the hub no longer serves must stay VISIBLE and removable,
 *    never be tidied into "— whole frame —" (that silently rewrites the rule
 *    the operator is looking at);
 *  - `sustainSeconds: 0` is a legal value but a terrible default — a 0-second
 *    hold fires on the first frame that crosses, which is the chatter the
 *    debounce exists to prevent;
 *  - `classes` and `occupancy` silently AND. `classes:['vehicle']` next to
 *    `occupancy.className:'person'` is a rule that can NEVER fire, and nothing
 *    in the editor said so.
 */
import { describe, it, expect } from 'vitest'
import {
  NC_OCCUPANCY_DEFAULTS,
  NC_OCCUPANCY_OP_VALUES,
  NC_OCCUPANCY_SUSTAIN_DEFAULT_SEC,
  NC_OCCUPANCY_SUSTAIN_MAX_SEC,
  occupancyClassChoices,
  occupancyCountLabelKey,
  occupancyOrDefaults,
  occupancySustainIsInstant,
  occupancyZoneChoices,
  parseOccupancyOp,
  patchOccupancy,
  reconcileOccupancyClasses,
} from '../occupancy-condition.js'
import { buildConditions } from '../rule-editor.js'
import { NcConditionsSchema } from '../../../data/notification-center.js'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import type { NcConditionDescriptor, NcTaxonomy } from '../../../data/notification-center.js'

describe('occupancy op vocabulary', () => {
  it('offers exactly the four ops the cap schema declares', () => {
    expect(NC_OCCUPANCY_OP_VALUES).toEqual(['became-occupied', 'became-free', '>=', '<='])
  })

  it('narrows a known op and refuses anything else (no cast)', () => {
    expect(parseOccupancyOp('became-free')).toBe('became-free')
    expect(parseOccupancyOp('>=')).toBe('>=')
    expect(parseOccupancyOp('became-crowded')).toBeUndefined()
  })

  it('labels the number Threshold on an EDGE op and Count on a level op', () => {
    // The same stored field means two different things: on an edge op it is the
    // level the count must cross, on `>=`/`<=` it is the level itself.
    expect(occupancyCountLabelKey('became-occupied')).toBe('threshold')
    expect(occupancyCountLabelKey('became-free')).toBe('threshold')
    expect(occupancyCountLabelKey('>=')).toBe('count')
    expect(occupancyCountLabelKey('<=')).toBe('count')
  })
})

describe('defaults', () => {
  it('authors the cap schema defaults, with a 15s hold — never 0', () => {
    expect(NC_OCCUPANCY_DEFAULTS).toEqual({ op: 'became-occupied', count: 1, sustainSeconds: 15 })
    expect(NC_OCCUPANCY_SUSTAIN_DEFAULT_SEC).toBe(15)
  })

  it('parses as a valid condition against the mirrored schema', () => {
    expect(NcConditionsSchema.parse({ occupancy: NC_OCCUPANCY_DEFAULTS }).occupancy).toEqual(
      NC_OCCUPANCY_DEFAULTS,
    )
  })

  it('shows the defaults for an unset condition without authoring them', () => {
    expect(occupancyOrDefaults(undefined)).toEqual(NC_OCCUPANCY_DEFAULTS)
    const stored = { op: '<=' as const, count: 4, sustainSeconds: 60 }
    expect(occupancyOrDefaults(stored)).toEqual(stored)
  })

  it('flags a 0-second hold as instant, so the editor can warn', () => {
    expect(occupancySustainIsInstant({ op: 'became-occupied', count: 1, sustainSeconds: 0 })).toBe(true)
    expect(occupancySustainIsInstant(NC_OCCUPANCY_DEFAULTS)).toBe(false)
    expect(occupancySustainIsInstant(undefined)).toBe(false)
  })
})

describe('patchOccupancy', () => {
  it('seeds from the defaults when nothing is stored yet', () => {
    expect(patchOccupancy(undefined, { count: 3 })).toEqual({
      op: 'became-occupied',
      count: 3,
      sustainSeconds: 15,
    })
  })

  it('keeps the untouched fields', () => {
    const current = { zoneId: 'z1', className: 'person', op: '>=' as const, count: 2, sustainSeconds: 30 }
    expect(patchOccupancy(current, { op: '<=' })).toEqual({ ...current, op: '<=' })
  })

  it('clamps count to a non-negative integer', () => {
    expect(patchOccupancy(undefined, { count: -5 }).count).toBe(0)
    expect(patchOccupancy(undefined, { count: 2.7 }).count).toBe(3)
    expect(patchOccupancy(undefined, { count: Number.NaN }).count).toBe(0)
  })

  it('clamps the hold to the cap bounds', () => {
    expect(patchOccupancy(undefined, { sustainSeconds: -1 }).sustainSeconds).toBe(0)
    expect(patchOccupancy(undefined, { sustainSeconds: 9999 }).sustainSeconds).toBe(
      NC_OCCUPANCY_SUSTAIN_MAX_SEC,
    )
  })

  it('OMITS a cleared scope key instead of storing an explicit undefined', () => {
    // `zoneId: undefined` on the wire is not the same as no key: it survives a
    // merge patch as a deliberate erase and reads as authored in a diff.
    const cleared = patchOccupancy({ zoneId: 'z1', op: 'became-occupied', count: 1, sustainSeconds: 15 }, {
      zoneId: undefined,
    })
    expect('zoneId' in cleared).toBe(false)
    const scoped = patchOccupancy(undefined, { zoneId: 'z9', className: 'vehicle' })
    expect(scoped.zoneId).toBe('z9')
    expect(scoped.className).toBe('vehicle')
  })

  it('always yields something the mirrored schema accepts', () => {
    const next = patchOccupancy(undefined, { count: 12.4, sustainSeconds: 4000, op: '<=' })
    expect(NcConditionsSchema.parse({ occupancy: next }).occupancy).toEqual(next)
  })
})

describe('occupancyZoneChoices — a deleted zone stays visible', () => {
  const zones = [
    { id: 'z1', name: 'Driveway' },
    { id: 'z2', name: 'Porch' },
  ]

  it('offers the REAL zone names, deduped across the fanned-out cameras', () => {
    const { choices } = occupancyZoneChoices([...zones, { id: 'z1', name: 'Driveway' }], undefined)
    expect(choices).toEqual([
      { value: 'z1', label: 'Driveway', unknown: false },
      { value: 'z2', label: 'Porch', unknown: false },
    ])
  })

  it('keeps a stored zone the hub no longer serves, marked unknown', () => {
    const { choices, unknownZoneId } = occupancyZoneChoices(zones, 'z-deleted')
    expect(unknownZoneId).toBe('z-deleted')
    expect(choices.at(-1)).toEqual({ value: 'z-deleted', label: 'z-deleted', unknown: true })
  })

  it('does NOT invent an unknown entry while the zone list is still empty', () => {
    // Zones load per camera. Treating "not loaded yet" as "deleted" would flag
    // every zone on first paint.
    const { choices, unknownZoneId } = occupancyZoneChoices([], 'z1')
    expect(unknownZoneId).toBeUndefined()
    expect(choices).toEqual([])
  })

  it('reports no unknown when the stored zone IS served', () => {
    expect(occupancyZoneChoices(zones, 'z2').unknownZoneId).toBeUndefined()
    expect(occupancyZoneChoices(zones, undefined).unknownZoneId).toBeUndefined()
  })
})

describe('occupancyClassChoices — the SHARED class vocabulary', () => {
  const taxonomy: NcTaxonomy = {
    videoClasses: [
      { kind: 'person', label: 'Person', parentKind: null },
      { kind: 'vehicle', label: 'Vehicle', parentKind: null },
      { kind: 'car', label: 'Car', parentKind: 'vehicle' },
    ],
    audioKinds: [],
    labels: [],
  }

  /**
   * MACRO CLASSES ONLY, and it is not a style choice.
   *
   * An occupancy count is `byClass[className]` read straight out of the
   * ZoneAnalytics snapshot, and that record is keyed on macros — the executor
   * maps every raw COCO label onto its macro and drops the rest. Occupancy is
   * also the one class condition the engine does NOT macro-expand. So a
   * sub-type names a key that does not exist: 0 on every frame, forever, no
   * edge possible. Two rules on device 102 were authored on `car` and were
   * silent for a day (2026-08-12).
   *
   * The previous version of this test asserted `['person', 'vehicle', 'car']`
   * and passed all along — it pinned the vocabulary being SHARED, which was
   * true, and said nothing about it being countable.
   */
  it('offers ONLY the macro classes — a sub-type can never be counted', () => {
    const { choices } = occupancyClassChoices(taxonomy, undefined)
    expect(choices.map((c) => c.value)).toEqual(['person', 'vehicle'])
    expect(choices[0]).toEqual({ value: 'person', label: 'Person', unknown: false })
  })

  it('keeps a stored class the taxonomy does not know', () => {
    const { choices, unknownClassName } = occupancyClassChoices(taxonomy, 'unicorn')
    expect(unknownClassName).toBe('unicorn')
    expect(choices.at(-1)).toEqual({ value: 'unicorn', label: 'unicorn', unknown: true })
  })

  it('surfaces a stored SUB-TYPE as unknown, so the widget warns instead of hiding it', () => {
    const { choices, unknownClassName } = occupancyClassChoices(taxonomy, 'car')
    expect(unknownClassName).toBe('car')
    expect(choices.at(-1)).toEqual({ value: 'car', label: 'car', unknown: true })
  })

  it('degrades to nothing offered when the hub served no taxonomy', () => {
    expect(occupancyClassChoices(undefined, undefined).choices).toEqual([])
    expect(occupancyClassChoices(undefined, 'person').unknownClassName).toBeUndefined()
  })
})

describe('reconcileOccupancyClasses — the silent AND', () => {
  it('leaves conditions untouched when there is no occupancy condition', () => {
    const conditions = NcConditionsSchema.parse({ classes: ['person'], classesExclude: ['car'] })
    expect(reconcileOccupancyClasses(conditions)).toBe(conditions)
  })

  it('ADOPTS a single authored class as the occupancy scope, then drops it', () => {
    // The operator's intent survives; the unfireable pairing does not.
    const next = reconcileOccupancyClasses(
      NcConditionsSchema.parse({
        classes: ['person'],
        occupancy: { op: 'became-occupied', count: 1, sustainSeconds: 15 },
      }),
    )
    expect(next.occupancy?.className).toBe('person')
    expect('classes' in next).toBe(false)
  })

  it('never overwrites a class the occupancy condition already scopes', () => {
    const next = reconcileOccupancyClasses(
      NcConditionsSchema.parse({
        classes: ['vehicle'],
        occupancy: { className: 'person', op: 'became-occupied', count: 1, sustainSeconds: 15 },
      }),
    )
    // The pairing that can never fire: `vehicle` is dropped, `person` stands.
    expect(next.occupancy?.className).toBe('person')
    expect('classes' in next).toBe(false)
  })

  it('drops a multi-class list rather than guessing which one was meant', () => {
    const next = reconcileOccupancyClasses(
      NcConditionsSchema.parse({
        classes: ['person', 'vehicle'],
        occupancy: { op: 'became-occupied', count: 1, sustainSeconds: 15 },
      }),
    )
    expect(next.occupancy?.className).toBeUndefined()
    expect('classes' in next).toBe(false)
  })

  it('drops `classesExclude` too — it subtracts from a one-class subject', () => {
    const next = reconcileOccupancyClasses(
      NcConditionsSchema.parse({
        classesExclude: ['car'],
        occupancy: { op: 'became-free', count: 0, sustainSeconds: 15 },
      }),
    )
    expect('classesExclude' in next).toBe(false)
  })
})

describe('buildConditions — the reconcile rides the single serialization funnel', () => {
  const catalog: readonly NcConditionDescriptor[] = [
    {
      id: 'occupancy',
      group: 'occupancy',
      label: 'Occupancy',
      valueType: 'occupancy',
      operator: 'anyOf',
      appliesTo: ['device-event'],
      phase: 'P1',
    },
    {
      id: 'classes',
      group: 'class',
      label: 'Classes',
      valueType: 'stringList',
      operator: 'in',
      // The pairing is only reachable at all if a hub ever serves `classes` on
      // `device-event`. The guard must not depend on it never doing so.
      appliesTo: ['immediate', 'device-event'],
      phase: 'P1',
    },
  ]

  it('emits the occupancy condition on the wire (it used to be STRIPPED)', () => {
    const out = buildConditions(
      { occupancy: { op: '>=', count: 3, sustainSeconds: 20 } },
      'device-event',
      catalog,
    )
    expect(out.occupancy).toEqual({ op: '>=', count: 3, sustainSeconds: 20 })
  })

  it('never saves a rule whose classes contradict its occupancy scope', () => {
    const out = buildConditions(
      {
        classes: ['vehicle'],
        occupancy: { className: 'person', op: 'became-occupied', count: 2, sustainSeconds: 15 },
      },
      'device-event',
      catalog,
    )
    expect('classes' in out).toBe(false)
    expect(out.occupancy?.className).toBe('person')
  })

  it('leaves a plain classes rule alone on another trigger', () => {
    const out = buildConditions({ classes: ['person'] }, 'immediate', catalog)
    expect(out.classes).toEqual(['person'])
  })
})

describe('i18n — every string the occupancy widget asks for exists in BOTH locales', () => {
  /** Resolve a dotted i18n key against a locale JSON tree. */
  function lookup(tree: unknown, key: string): string | undefined {
    const value = key.split('.').reduce<unknown>((node, part) => {
      if (node != null && typeof node === 'object' && part in node) {
        return (node as Record<string, unknown>)[part]
      }
      return undefined
    }, tree)
    return typeof value === 'string' ? value : undefined
  }

  const BASE = 'v2.nc.rules.editor.occupancy'
  const KEYS: readonly string[] = [
    'v2.nc.rules.editor.group.occupancy',
    `${BASE}.zoneLabel`,
    `${BASE}.wholeFrame`,
    `${BASE}.zonesLoading`,
    `${BASE}.zonesNeedCamera`,
    `${BASE}.zonesNone`,
    `${BASE}.zoneMissing`,
    `${BASE}.classLabel`,
    `${BASE}.anyClass`,
    `${BASE}.classesNone`,
    `${BASE}.classMissing`,
    `${BASE}.opLabel`,
    `${BASE}.thresholdLabel`,
    `${BASE}.countLabel`,
    `${BASE}.sustainLabel`,
    `${BASE}.sustainInstantHint`,
    `${BASE}.hint`,
    `${BASE}.classesDropped`,
    ...NC_OCCUPANCY_OP_VALUES.map((op) => `${BASE}.op.${op}`),
  ]

  it('English', () => {
    expect(KEYS.filter((key) => lookup(enLocale, key) === undefined)).toEqual([])
  })

  it('Italian', () => {
    expect(KEYS.filter((key) => lookup(itLocale, key) === undefined)).toEqual([])
  })

  it('interpolates the values the widget passes', () => {
    // A hint that says "no longer exists" without naming WHICH zone leaves the
    // operator hunting through a rule they cannot read.
    expect(lookup(enLocale, `${BASE}.zoneMissing`)).toContain('{{id}}')
    expect(lookup(itLocale, `${BASE}.zoneMissing`)).toContain('{{id}}')
    expect(lookup(enLocale, `${BASE}.classMissing`)).toContain('{{name}}')
    expect(lookup(itLocale, `${BASE}.classMissing`)).toContain('{{name}}')
    expect(lookup(enLocale, `${BASE}.classesDropped`)).toContain('{{classes}}')
    expect(lookup(itLocale, `${BASE}.classesDropped`)).toContain('{{classes}}')
  })
})
