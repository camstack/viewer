import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import { NC_RULE_EDITOR_SECTION_ORDER } from '@camstack/types/client'
import { emptyRuleForm } from '../rule-editor.js'
import { NC_ACTIONS_EMPTY_FORM } from '../rule-action-form.js'
import { ruleScopeDraftOf, switchRuleScopeMode } from '../rule-scope-model.js'
import {
  NC_SUMMARY_DEVICE_LIST_KEYS,
  NC_SUMMARY_LINE_KEYS,
  sectionSummary,
  summaryClassLabels,
  summaryDeviceList,
} from '../rule-summary-lines.js'

const ctx = { targetNames: new Map([['t1', 'Phone']]), deviceCount: 0 }

/** Resolve a dotted i18n key against a locale JSON tree, without a cast. */
function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return typeof node === 'string' ? node : undefined
}

describe('summary lines', () => {
  it('devices: none selected means every camera', () => {
    expect(sectionSummary('devices', emptyRuleForm(), ctx)).toEqual({ key: 'v2.nc.rules.summary.devices.all' })
  })
  it('devices: counts the selection', () => {
    const form = { ...emptyRuleForm(), deviceScope: ruleScopeDraftOf([1, 2], undefined) }
    expect(sectionSummary('devices', form, ctx)).toEqual({ key: 'v2.nc.rules.summary.devices.some', params: { count: 2 } })
  })
  it('devices: "all except" for an exclusion scope (D641)', () => {
    const form = { ...emptyRuleForm(), deviceScope: ruleScopeDraftOf<number>(undefined, [3, 4, 5]) }
    expect(sectionSummary('devices', form, ctx)).toEqual({ key: 'v2.nc.rules.summary.devices.except', params: { count: 3 } })
  })
  it('devices: a legacy rule with BOTH lists says its exclusions too — never hides them', () => {
    const form = { ...emptyRuleForm(), deviceScope: ruleScopeDraftOf([1, 2], [3]) }
    expect(sectionSummary('devices', form, ctx)).toEqual({
      key: 'v2.nc.rules.summary.devices.someExcept',
      params: { count: 2, excluded: 1 },
    })
  })
  it('devices: the line follows the ACTIVE mode, not a list the mode left behind', () => {
    const form = { ...emptyRuleForm(), deviceScope: switchRuleScopeMode(ruleScopeDraftOf([1, 2], undefined), 'all') }
    expect(sectionSummary('devices', form, ctx)).toEqual({ key: 'v2.nc.rules.summary.devices.all' })
  })
  it('devices: a SENSOR rule\'s line speaks of sensors, never of cameras', () => {
    const sensors = { ...ctx, deviceNoun: 'sensors' as const }
    expect(sectionSummary('devices', emptyRuleForm(), sensors)).toEqual({ key: 'v2.nc.rules.summary.devices.sensorsAll' })
    const some = { ...emptyRuleForm(), deviceScope: ruleScopeDraftOf([3223, 3229, 3235], undefined) }
    expect(sectionSummary('devices', some, sensors)).toEqual({
      key: 'v2.nc.rules.summary.devices.sensorsSome',
      params: { count: 3 },
    })
    const except = { ...emptyRuleForm(), deviceScope: ruleScopeDraftOf<number>(undefined, [1]) }
    expect(sectionSummary('devices', except, sensors).key).toBe('v2.nc.rules.summary.devices.sensorsExcept')
    const legacy = { ...emptyRuleForm(), deviceScope: ruleScopeDraftOf([1, 2], [3]) }
    expect(sectionSummary('devices', legacy, sensors).key).toBe('v2.nc.rules.summary.devices.sensorsSomeExcept')
  })
  it('rule: names the targets', () => {
    const form = { ...emptyRuleForm(), targetIds: ['t1'] }
    expect(sectionSummary('rule', form, ctx)).toEqual({ key: 'v2.nc.rules.summary.rule.targets', params: { names: 'Phone' } })
  })
  it('rule: no target is said, not left blank', () => {
    expect(sectionSummary('rule', emptyRuleForm(), ctx)).toEqual({ key: 'v2.nc.rules.summary.rule.noTargets' })
  })
  it('rule: a target the caller cannot name is dropped from the list, not shown as an id', () => {
    const form = { ...emptyRuleForm(), targetIds: ['t1', 'ghost'] }
    expect(sectionSummary('rule', form, ctx)).toEqual({ key: 'v2.nc.rules.summary.rule.targets', params: { names: 'Phone' } })
  })
  it('notification: says when the message is the hub default', () => {
    expect(sectionSummary('notification', emptyRuleForm(), ctx).key).toBe('v2.nc.rules.summary.notification.default')
  })
  it('notification: a non-blank title is a custom message, and the priority travels', () => {
    const form = { ...emptyRuleForm(), templateTitle: 'Hi', priority: 4 }
    expect(sectionSummary('notification', form, ctx)).toEqual({
      key: 'v2.nc.rules.summary.notification.custom',
      params: { priority: 4 },
    })
  })
  it('conditions: counts authored conditions and the class scope, never the device scope', () => {
    const form = {
      ...emptyRuleForm(),
      deviceScope: ruleScopeDraftOf([1], undefined),
      classScope: ruleScopeDraftOf(['person'], undefined),
      conditions: { minConfidence: 0.5 },
    }
    expect(sectionSummary('conditions', form, ctx)).toEqual({ key: 'v2.nc.rules.summary.conditions.count', params: { count: 2 } })
    const only = { ...emptyRuleForm(), deviceScope: ruleScopeDraftOf([1], undefined) }
    expect(sectionSummary('conditions', only, ctx)).toEqual({ key: 'v2.nc.rules.summary.conditions.none' })
  })
  it('conditions: an emptied class scope is not an authored condition', () => {
    const form = { ...emptyRuleForm(), classScope: ruleScopeDraftOf<string>([], undefined) }
    expect(sectionSummary('conditions', form, ctx).key).toBe('v2.nc.rules.summary.conditions.none')
  })
  it('conditions: "all classes except …" names the excluded classes (D641)', () => {
    const form = { ...emptyRuleForm(), classScope: ruleScopeDraftOf<string>(undefined, ['cat', 'dog']) }
    expect(sectionSummary('conditions', form, ctx)).toEqual({
      key: 'v2.nc.rules.summary.conditions.classesExcept',
      params: { classes: 'cat, dog' },
    })
    const more = { ...form, conditions: { minConfidence: 0.5 } }
    expect(sectionSummary('conditions', more, ctx).params?.['count']).toBe(1)
  })
  it('conditions: "all classes except …" says the taxonomy LABELS, not the raw ids; an unlisted id stays itself', () => {
    const form = { ...emptyRuleForm(), classScope: ruleScopeDraftOf<string>(undefined, ['cat', 'truck', 'ufo']) }
    const labelled = { ...ctx, classLabels: new Map([['cat', 'Gatto'], ['truck', 'Camion']]) }
    expect(sectionSummary('conditions', form, labelled)).toEqual({
      key: 'v2.nc.rules.summary.conditions.classesExcept',
      params: { classes: 'Gatto, Camion, ufo' },
    })
  })
  it('conditions: the labels are the class picker\'s — built from the served taxonomy', () => {
    const labels = summaryClassLabels({
      videoClasses: [
        { kind: 'vehicle', label: 'Vehicle', parentKind: null },
        { kind: 'truck', label: 'Truck', parentKind: 'vehicle' },
      ],
      audioKinds: [],
      labels: [],
    })
    expect(labels.get('truck')).toBe('Truck')
    expect(summaryClassLabels(undefined).size).toBe(0)
  })
  it('conditions: classesExceptMore keeps the other-conditions count', () => {
    const form = { ...emptyRuleForm(), classScope: ruleScopeDraftOf<string>(undefined, ['cat', 'dog']) }
    const more = { ...form, conditions: { minConfidence: 0.5 } }
    expect(sectionSummary('conditions', more, ctx)).toEqual({
      key: 'v2.nc.rules.summary.conditions.classesExceptMore',
      params: { classes: 'cat, dog', count: 1 },
    })
  })
  it('actions: none until a sequence or a button exists', () => {
    expect(sectionSummary('actions', emptyRuleForm(), ctx)).toEqual({ key: 'v2.nc.rules.summary.actions.none' })
  })
  it('actions: counts the DRAFT, not the stored rule — an edit shows before it is saved', () => {
    const step = { editId: 't1', kind: 'wait' as const, seconds: 2, deviceId: undefined, cap: '', method: '', args: [] }
    const form = {
      ...emptyRuleForm(),
      actions: {
        ...NC_ACTIONS_EMPTY_FORM,
        onActivation: [{ editId: 'b1', kind: 'sequence' as const, sequenceId: 'a' }],
        onTrigger: [{ editId: 'b1', kind: 'do' as const, step }],
        buttons: [{ id: 'x', label: 'X', sequenceId: 'a' }],
      },
    }
    expect(sectionSummary('actions', form, ctx)).toEqual({
      key: 'v2.nc.rules.summary.actions.count',
      params: { bindings: 2, buttons: 1 },
    })
  })
  it('actions: a block that does not parse says how many problems, not a count that will not save', () => {
    const form = {
      ...emptyRuleForm(),
      actions: {
        ...NC_ACTIONS_EMPTY_FORM,
        onTrigger: [{ editId: 'b1', kind: 'sequence' as const, sequenceId: '' }],
        buttons: [{ id: 'x', label: '', sequenceId: '' }],
      },
    }
    expect(sectionSummary('actions', form, ctx)).toEqual({
      key: 'v2.nc.rules.summary.actions.invalid',
      params: { count: 3 },
    })
  })
  it('actions: the count is of problem INSTANCES — two unpicked sequences are two problems, not one kind', () => {
    const blank = { kind: 'sequence' as const, sequenceId: '' }
    const form = {
      ...emptyRuleForm(),
      actions: {
        ...NC_ACTIONS_EMPTY_FORM,
        onTrigger: [{ ...blank, editId: 'b1' }],
        onTriggerOff: [{ ...blank, editId: 'b1' }],
      },
    }
    expect(sectionSummary('actions', form, ctx)).toEqual({
      key: 'v2.nc.rules.summary.actions.invalid',
      params: { count: 2 },
    })
  })
  it('advanced: the cooldown in seconds when the rule has one', () => {
    expect(sectionSummary('advanced', emptyRuleForm(), { ...ctx, cooldownSec: 90 })).toEqual({
      key: 'v2.nc.rules.summary.advanced.cooldown',
      params: { seconds: 90 },
    })
  })
  it('advanced: no cooldown known → the plain line; the retired wait line is gone', () => {
    expect(sectionSummary('advanced', emptyRuleForm(), ctx)).toEqual({ key: 'v2.nc.rules.summary.advanced.none' })
    expect(NC_SUMMARY_LINE_KEYS.some((key) => key.endsWith('.advanced.wait') || key.endsWith('.advanced.cooldownWait'))).toBe(false)
  })
  it('rule: a grouped rule says its trigger — "Immediate, grouped · 20 s"', () => {
    const form = { ...emptyRuleForm(), groupingSec: 20 }
    expect(sectionSummary('rule', form, ctx)).toEqual({
      key: 'v2.nc.rules.editor.delivery.immediateGrouped',
      params: { n: 20 },
    })
    expect(lookupLocale(itLocale, 'v2.nc.rules.editor.delivery.immediateGrouped')).toBe('Immediata raggruppata · {{n}} s')
    expect(lookupLocale(enLocale, 'v2.nc.rules.editor.delivery.immediateGrouped')).toBe('Immediate, grouped · {{n}} s')
  })
  it('rule: a leftover window on a rule that cannot group is not a grouped trigger', () => {
    const form = { ...emptyRuleForm(), delivery: 'track-end' as const, groupingSec: 20 }
    expect(sectionSummary('rule', form, ctx).key).toBe('v2.nc.rules.summary.rule.noTargets')
  })
  it('every line key exists in BOTH locales, and every section has one', () => {
    for (const section of NC_RULE_EDITOR_SECTION_ORDER) {
      expect(NC_SUMMARY_LINE_KEYS.some((key) => key.startsWith(`v2.nc.rules.summary.${section}.`))).toBe(true)
    }
    for (const key of NC_SUMMARY_LINE_KEYS) {
      expect(lookupLocale(enLocale, key), `en ${key}`).toBeTypeOf('string')
      expect(lookupLocale(itLocale, key), `it ${key}`).toBeTypeOf('string')
    }
  })
})

/**
 * The overview's "active devices" collapsible (operator, 2026-09-26: "in the
 * overview table, add a collapsible with the active devices"). What it lists
 * follows the ACTIVE scope mode, exactly as the one line above it does.
 */
describe('summaryDeviceList — the devices a rule is active on', () => {
  it('All: "All devices", and nothing to list', () => {
    expect(summaryDeviceList(ruleScopeDraftOf<number>(undefined, undefined))).toEqual({
      mode: 'all',
      headline: { key: 'v2.nc.rules.summary.deviceList.all' },
      listed: [],
      excluded: [],
    })
  })

  it('Only these: those devices, and only those', () => {
    expect(summaryDeviceList(ruleScopeDraftOf([3223, 3229], undefined))).toEqual({
      mode: 'only',
      headline: { key: 'v2.nc.rules.summary.deviceList.only', params: { count: 2 } },
      listed: [3223, 3229],
      excluded: [],
    })
  })

  it('All except these: "All devices except N" plus the excluded list', () => {
    expect(summaryDeviceList(ruleScopeDraftOf<number>(undefined, [7, 8, 9]))).toEqual({
      mode: 'except',
      headline: { key: 'v2.nc.rules.summary.deviceList.except', params: { count: 3 } },
      listed: [],
      excluded: [7, 8, 9],
    })
  })

  it('a legacy Only rule keeps its exclusions visible (D49)', () => {
    const list = summaryDeviceList(ruleScopeDraftOf([1, 2], [3]))
    expect(list.mode).toBe('only')
    expect(list.listed).toEqual([1, 2])
    expect(list.excluded).toEqual([3])
  })

  it('follows the ACTIVE mode, not a list the mode left behind', () => {
    const list = summaryDeviceList(switchRuleScopeMode(ruleScopeDraftOf([1, 2], undefined), 'all'))
    expect(list.mode).toBe('all')
    expect(list.listed).toEqual([])
  })

  it('an emptied Only list reads All — the rule then runs on every device', () => {
    const emptied = { ...ruleScopeDraftOf([1], undefined), include: [] }
    expect(summaryDeviceList(emptied).mode).toBe('all')
  })

  it('every key it can say exists in en and it', () => {
    for (const key of NC_SUMMARY_DEVICE_LIST_KEYS) {
      expect(lookupLocale(enLocale, key), `en ${key}`).toBeTypeOf('string')
      expect(lookupLocale(itLocale, key), `it ${key}`).toBeTypeOf('string')
    }
  })
})
