/**
 * The rule editor's two SCOPE axes (D641) — devices and detection classes —
 * as ONE field each: "All | Only these | All except these" over one picker.
 *
 * What these pin, end to end through the editor's save funnel (`formToInput`):
 *  - the draft lives on the FORM, never in `conditions` (a stray key there is
 *    not what a save writes);
 *  - the three modes and what each save writes — only the active mode's list;
 *  - a legacy rule carrying BOTH lists keeps its exclusions until the operator
 *    removes them (D49);
 *  - an old descriptor can never write `devices` from an exclusion;
 *  - "All except these" is offered only where the hub serves the exclusion.
 */
import { describe, expect, it } from 'vitest'
import type { NcConditionDescriptor, NcRule, NcTaxonomy } from '../../../data/notification-center.js'
import { emptyRuleForm, formToInput, inputToForm, type NcRuleFormState } from '../rule-editor.js'
import {
  removeRuleScopeExclusions,
  ruleScopeClearedOnSave,
  ruleScopeDraftOf,
  ruleScopeLegacyExclusions,
  switchRuleScopeMode,
} from '../rule-scope-model.js'
import {
  classPickerItems,
  deviceListConditionKey,
  formScopedConditions,
  formScopedDeviceIds,
  RULE_SCOPE_MODE_LABEL_KEYS,
  ruleScopeExceptOffered,
  scopeDescriptorRole,
  splitRuleScopes,
  withClassScope,
} from '../rule-scope-form.js'
import { occupancyDroppedClasses } from '../occupancy-condition.js'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'

const SCOPED: readonly NcConditionDescriptor['appliesTo'][number][] = [
  'immediate',
  'track-end',
  'device-event',
  'package-event',
]

function descriptor(
  id: string,
  valueType: NcConditionDescriptor['valueType'],
  group: NcConditionDescriptor['group'],
  appliesTo: NcConditionDescriptor['appliesTo'] = [...SCOPED],
): NcConditionDescriptor {
  return { id, group, label: id, valueType, operator: 'in', appliesTo, phase: 'P1' }
}

const CATALOG: readonly NcConditionDescriptor[] = [
  descriptor('devices', 'deviceIdList', 'scope'),
  descriptor('devicesExclude', 'deviceIdExcludeList', 'scope'),
  descriptor('classes', 'stringList', 'class', ['immediate', 'track-end']),
  descriptor('classesExclude', 'stringList', 'class', ['immediate', 'track-end']),
]

/** The same catalog from a hub that does not serve the exclusions. */
const PRE_D641_CATALOG: readonly NcConditionDescriptor[] = CATALOG.filter(
  (d) => d.id !== 'devicesExclude' && d.id !== 'classesExclude',
)

function form(overrides: Partial<NcRuleFormState> = {}): NcRuleFormState {
  return { ...emptyRuleForm(), name: 'Vialetto', delivery: 'track-end', targetIds: ['t'], ...overrides }
}

const RULE: NcRule = {
  id: 'r1',
  name: 'Vialetto',
  enabled: true,
  delivery: 'track-end',
  conditions: {},
  targets: [{ targetId: 't' }],
  media: { attach: 'best' },
  throttle: { cooldownSec: 60, scope: 'rule-device' },
  priority: 3,
  createdBy: 'me',
  createdAt: 0,
  updatedAt: 0,
  disabledTargetIds: [],
}

function save(f: NcRuleFormState, catalog: readonly NcConditionDescriptor[] = CATALOG) {
  return formToInput(f, { catalog }).conditions
}

function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return typeof node === 'string' ? node : undefined
}

describe('the scope draft lives on the form, not in conditions', () => {
  it('opening a rule lifts all four lists out of conditions', () => {
    const split = splitRuleScopes({
      devices: [1],
      devicesExclude: [2],
      classes: ['person'],
      classesExclude: ['cat'],
      minConfidence: 0.5,
    })
    expect(split.conditions).toEqual({ minConfidence: 0.5 })
    expect(split.deviceScope).toEqual(ruleScopeDraftOf([1], [2]))
    expect(split.classScope).toEqual(ruleScopeDraftOf(['person'], ['cat']))
  })

  it('inputToForm opens an exclusion-only rule in Except, and emptyRuleForm in All', () => {
    const opened = inputToForm({ ...RULE, conditions: { devicesExclude: [7, 8] } })
    expect(opened.deviceScope.mode).toBe('except')
    expect(opened.deviceScope.exclude).toEqual([7, 8])
    expect(opened.conditions).toEqual({})
    expect(emptyRuleForm().deviceScope.mode).toBe('all')
    expect(emptyRuleForm().classScope.mode).toBe('all')
  })

  it('a stray scope key in conditions is NOT what a save writes', () => {
    const f = form({ conditions: { devices: [99], classesExclude: ['dog'] } })
    expect(formScopedConditions(f)).toEqual({})
    expect(save(f)).toEqual({})
  })
})

describe('the three modes and the save projection', () => {
  it('All writes neither list, whatever the draft still holds', () => {
    const scope = switchRuleScopeMode(ruleScopeDraftOf([1, 2], undefined), 'all')
    const saved = save(form({ deviceScope: scope }))
    expect(saved).not.toHaveProperty('devices')
    expect(saved).not.toHaveProperty('devicesExclude')
  })

  it('Only writes devices alone', () => {
    const saved = save(form({ deviceScope: ruleScopeDraftOf([1, 2], undefined) }))
    expect(saved).toEqual({ devices: [1, 2] })
  })

  it('Except writes devicesExclude alone — never devices', () => {
    const scope = { ...switchRuleScopeMode(ruleScopeDraftOf<number>([], []), 'except'), exclude: [5] }
    const saved = save(form({ deviceScope: scope }))
    expect(saved).toEqual({ devicesExclude: [5] })
  })

  it('switching Only → Except keeps the Only list in the draft, and says what Save clears', () => {
    const opened = ruleScopeDraftOf([1, 2], undefined)
    const except = { ...switchRuleScopeMode(opened, 'except'), exclude: [9] }
    expect(except.include).toEqual([1, 2])
    expect(ruleScopeClearedOnSave(except)).toEqual([1, 2])
    expect(save(form({ deviceScope: except }))).toEqual({ devicesExclude: [9] })
    // Back to Only: nothing was lost.
    expect(save(form({ deviceScope: switchRuleScopeMode(except, 'only') }))).toEqual({ devices: [1, 2] })
  })

  it('classes: the same three modes over classes / classesExclude', () => {
    const only = save(form({ classScope: ruleScopeDraftOf(['person'], undefined) }))
    expect(only).toEqual({ classes: ['person'] })
    const except = save(form({ classScope: ruleScopeDraftOf<string>(undefined, ['cat']) }))
    expect(except).toEqual({ classesExclude: ['cat'] })
    const all = save(form({ classScope: switchRuleScopeMode(ruleScopeDraftOf(['person'], undefined), 'all') }))
    expect(all).toEqual({})
  })

  it('the class scope still passes the trigger gate: a sensor rule carries no classes', () => {
    const f = form({ delivery: 'device-event', classScope: ruleScopeDraftOf(['person'], undefined) })
    expect(save(f)).not.toHaveProperty('classes')
  })

  it('zone pickers read the Only list — an Except list is not "these cameras"', () => {
    expect(formScopedDeviceIds(form({ deviceScope: ruleScopeDraftOf([1], undefined) }))).toEqual([1])
    expect(formScopedDeviceIds(form({ deviceScope: ruleScopeDraftOf<number>(undefined, [1]) }))).toEqual([])
  })
})

describe('a legacy rule carrying BOTH lists (D49)', () => {
  const legacy = inputToForm({ ...RULE, conditions: { devices: [1, 2], devicesExclude: [3] } })

  it('opens in Only with its exclusions listed for the notice', () => {
    expect(legacy.deviceScope.mode).toBe('only')
    expect(ruleScopeLegacyExclusions(legacy.deviceScope)).toEqual([3])
  })

  it('an untouched save keeps both lists — nothing is dropped by a read or a save', () => {
    expect(save(legacy)).toEqual({ devices: [1, 2], devicesExclude: [3] })
    expect(ruleScopeClearedOnSave(legacy.deviceScope)).toEqual([])
  })

  it('only "Remove exclusions" drops them', () => {
    const removed = { ...legacy, deviceScope: removeRuleScopeExclusions(legacy.deviceScope) }
    expect(save(removed)).toEqual({ devices: [1, 2] })
  })
})

describe('old-descriptor safety', () => {
  it('only the `devices` descriptor of valueType deviceIdList binds to conditions.devices', () => {
    expect(deviceListConditionKey({ id: 'devices', valueType: 'deviceIdList' })).toBe('devices')
    expect(deviceListConditionKey({ id: 'devicesExclude', valueType: 'deviceIdExcludeList' })).toBeNull()
    // An exclusion served under the OLD valueType must not write `devices` either.
    expect(deviceListConditionKey({ id: 'devicesExclude', valueType: 'deviceIdList' })).toBeNull()
    expect(deviceListConditionKey({ id: 'somethingElse', valueType: 'deviceIdList' })).toBeNull()
  })

  it('the scope ids are drawn as ONE field: include draws it, exclude is merged into it', () => {
    expect(scopeDescriptorRole('devices')).toEqual({ kind: 'field', axis: 'devices' })
    expect(scopeDescriptorRole('devicesExclude')).toEqual({ kind: 'merged', axis: 'devices' })
    expect(scopeDescriptorRole('classes')).toEqual({ kind: 'field', axis: 'classes' })
    expect(scopeDescriptorRole('classesExclude')).toEqual({ kind: 'merged', axis: 'classes' })
    // Zones, faces and labels are the same control since 2026-10-01.
    expect(scopeDescriptorRole('zones')).toEqual({ kind: 'field', axis: 'zones' })
    expect(scopeDescriptorRole('zonesExclude')).toEqual({ kind: 'merged', axis: 'zones' })
    expect(scopeDescriptorRole('identities')).toEqual({ kind: 'field', axis: 'identities' })
    expect(scopeDescriptorRole('identitiesExclude')).toEqual({ kind: 'merged', axis: 'identities' })
    expect(scopeDescriptorRole('labelEquals')).toEqual({ kind: 'field', axis: 'labels' })
    expect(scopeDescriptorRole('plates')).toBeNull()
  })
})

describe('"All except these" is offered only where the hub serves the exclusion', () => {
  it('served for this trigger and kind → offered', () => {
    expect(ruleScopeExceptOffered(CATALOG, 'devicesExclude', 'track-end', 'detection')).toBe(true)
    expect(ruleScopeExceptOffered(CATALOG, 'classesExclude', 'immediate', 'detection')).toBe(true)
  })
  it('not served, or not for this trigger → not offered', () => {
    expect(ruleScopeExceptOffered(PRE_D641_CATALOG, 'devicesExclude', 'track-end', 'detection')).toBe(false)
    expect(ruleScopeExceptOffered(CATALOG, 'classesExclude', 'device-event', 'sensor')).toBe(false)
  })
  it('an empty (unanswered) catalog offers nothing it cannot vouch for', () => {
    expect(ruleScopeExceptOffered([], 'devicesExclude', 'track-end', 'detection')).toBe(false)
  })
})

describe('the class picker over the shared taxonomy', () => {
  const taxonomy: NcTaxonomy = {
    videoClasses: [
      { kind: 'person', label: 'Person', parentKind: null },
      { kind: 'vehicle', label: 'Vehicle', parentKind: null },
      { kind: 'car', label: 'Car', parentKind: 'vehicle' },
      { kind: 'truck', label: 'Truck', parentKind: 'vehicle' },
    ],
    audioKinds: [],
    labels: [],
  }

  it('one item per option, grouped by its taxonomy category, no duplicates', () => {
    const picker = classPickerItems(taxonomy)
    expect(picker).not.toBeNull()
    const ids = (picker?.items ?? []).map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(expect.arrayContaining(['person', 'vehicle', 'car', 'truck']))
    const car = picker?.items.find((item) => item.id === 'car')
    expect(car?.type).toBe('vehicle')
    expect(picker?.groupLabels.get('vehicle')).toBe('Vehicle')
  })

  it('no taxonomy → null, so the caller keeps its free-text input', () => {
    expect(classPickerItems(undefined)).toBeNull()
  })

  // Operator, 2026-10-01 (R13): a detection rule that picked a sound broke
  // itself. Sounds are a sound rule's own condition, never a class here.
  it('never offers the audio labels', () => {
    const withAudio: NcTaxonomy = {
      ...taxonomy,
      audioKinds: [{ kind: 'audio-dog-bark', label: 'Dog bark', parentKind: null }],
    }
    const picker = classPickerItems(withAudio)
    const ids = (picker?.items ?? []).map((item) => item.id)
    expect(ids).toContain('person')
    expect(ids).not.toContain('audio-dog-bark')
    expect(picker?.groupLabels.has('audio')).toBe(false)
  })
})

/**
 * Operator, 2026-10-01 (R8): faces, zones and labels use the SAME control as
 * the object classes — one list, each item included OR excluded, one mode —
 * and the zones' "any of / all of" is gone.
 */
describe('zones, faces and labels are scope fields too', () => {
  it('a stored rule opens with each axis in its mode, and none of its keys left in conditions', () => {
    const split = splitRuleScopes({
      zones: { ids: ['z1'], match: 'all' },
      identitiesExclude: ['p9'],
      labelEquals: ['AB123CD'],
      minConfidence: 0.5,
    })
    expect(split.conditions).toEqual({ minConfidence: 0.5 })
    expect(split.zoneScope).toMatchObject({ mode: 'only', include: ['z1'] })
    expect(split.identityScope).toMatchObject({ mode: 'except', exclude: ['p9'] })
    expect(split.labelScope).toMatchObject({ mode: 'only', include: ['AB123CD'] })
  })

  it('a save writes the active list — and never a zone quantifier', () => {
    const form: NcRuleFormState = {
      ...emptyRuleForm(),
      ...splitRuleScopes({ zones: { ids: ['z1', 'z2'], match: 'all' } }),
    }
    expect(formScopedConditions(form)).toEqual({ zones: { ids: ['z1', 'z2'] } })
    const except: NcRuleFormState = {
      ...form,
      zoneScope: { ...switchRuleScopeMode(form.zoneScope, 'except'), exclude: ['z3'] },
    }
    expect(formScopedConditions(except)).toEqual({ zonesExclude: ['z3'] })
  })

  it('faces: an EMPTY Only list is "any known face" and survives the save', () => {
    const split = splitRuleScopes({ identities: [] })
    expect(split.identityScope.mode).toBe('only')
    const form: NcRuleFormState = { ...emptyRuleForm(), ...split }
    expect(formScopedConditions(form)).toEqual({ identities: [] })
    // All writes nothing — anyone.
    const all: NcRuleFormState = { ...form, identityScope: switchRuleScopeMode(form.identityScope, 'all') }
    expect(formScopedConditions(all)).toEqual({})
  })

  it('an item is included OR excluded: switching the mode saves only that list', () => {
    const form: NcRuleFormState = {
      ...emptyRuleForm(),
      ...splitRuleScopes({ identities: ['p1'] }),
    }
    const excluded = { ...switchRuleScopeMode(form.identityScope, 'except'), exclude: ['p2'] }
    expect(formScopedConditions({ ...form, identityScope: excluded })).toEqual({ identitiesExclude: ['p2'] })
    expect(ruleScopeClearedOnSave(excluded)).toEqual(['p1'])
  })

  it('offers "All except these" for zones and faces only where the hub serves it', () => {
    const catalog = [
      ...CATALOG,
      descriptor('zonesExclude', 'zoneIdList', 'zones', ['immediate', 'track-end', 'package-event']),
    ]
    expect(ruleScopeExceptOffered(catalog, 'zonesExclude', 'immediate', 'detection')).toBe(true)
    expect(ruleScopeExceptOffered(catalog, 'identitiesExclude', 'immediate', 'detection')).toBe(false)
  })
})

describe('i18n', () => {
  it('every scope string exists in both locales', () => {
    const keys = [
      ...Object.values(RULE_SCOPE_MODE_LABEL_KEYS),
      'v2.nc.rules.scope.clearedOnSave',
      'v2.nc.rules.scope.legacyExclusions',
      'v2.nc.rules.scope.removeExclusions',
      'v2.nc.rules.scope.everyDevice',
      'v2.nc.rules.scope.everyClass',
      'v2.nc.rules.scope.classNotListed',
      'v2.nc.rules.scope.everyZone',
      'v2.nc.rules.scope.zoneTitle',
      'v2.nc.rules.scope.zonesEmptyWidens',
      'v2.nc.rules.scope.zonesUnavailable',
      'v2.nc.rules.scope.zoneSearch',
      'v2.nc.rules.scope.zoneNoMatches',
      'v2.nc.rules.scope.zoneNotListed',
      'v2.nc.rules.scope.everyPerson',
      'v2.nc.rules.scope.anyKnownFace',
      'v2.nc.rules.scope.noFaceExcluded',
      'v2.nc.rules.scope.faceTitle',
      'v2.nc.rules.scope.facesUnavailable',
      'v2.nc.rules.scope.faceSearch',
      'v2.nc.rules.scope.faceNoMatches',
      'v2.nc.rules.scope.faceNotListed',
      'v2.nc.rules.scope.everyLabel',
    ]
    for (const key of keys) {
      expect(lookupLocale(enLocale, key), `en ${key}`).toBeTypeOf('string')
      expect(lookupLocale(itLocale, key), `it ${key}`).toBeTypeOf('string')
    }
    expect(lookupLocale(itLocale, RULE_SCOPE_MODE_LABEL_KEYS.except)).toBe('Tutti tranne i selezionati')
  })
})

describe('an occupancy rule still SAYS it drops its class scope (D49)', () => {
  const occupancy = { op: 'became-occupied' as const, count: 1, sustainSeconds: 15 }
  it('the pre-save warning reads the class DRAFT, not `conditions`', () => {
    const scoped = withClassScope({ occupancy }, ruleScopeDraftOf<string>(undefined, ['cat']))
    expect(occupancyDroppedClasses(scoped)).toEqual(['cat'])
  })
  it('an All class scope carries nothing to drop', () => {
    const all = switchRuleScopeMode(ruleScopeDraftOf(['person'], undefined), 'all')
    expect(occupancyDroppedClasses(withClassScope({ occupancy }, all))).toEqual([])
  })
})
