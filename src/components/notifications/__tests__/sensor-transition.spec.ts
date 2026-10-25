/**
 * D640 "Notify when": a sensor rule fires on the raise, the clear, or both
 * (`conditions.sensorTransition`, ABSENT = both).
 *
 * Pinned here, through the editor's own save funnel:
 *  - the control is offered only when every chosen sensor kind raises and
 *    clears (`sensorTransitionOffered`, shared with the admin and the hub);
 *  - a save DROPS it on any other rule — and the drop is SAID, with the shared
 *    reason, before the save (the warning and the prune are one set);
 *  - "both" is the absent key, never a stored `'both'`;
 *  - the alarm case that can never fire is warned about.
 */
import { describe, expect, it } from 'vitest'
import { NC_SENSOR_TRANSITION_UNSUPPORTED_REASON } from '@camstack/types/client'
import { NC_SENSOR_TRANSITION_NEVER_FIRES_WARNING } from '@camstack/types'
import type { NcConditionDescriptor } from '../../../data/notification-center.js'
import { NcConditionsSchema } from '../../../data/notification-center.js'
import {
  droppedRuleConditions,
  emptyRuleForm,
  formToInput,
  type NcRuleFormState,
} from '../rule-editor.js'
import {
  conditionSupportedByRule,
  parseSensorTransition,
  SENSOR_TRANSITION_NEVER_FIRES_KEY,
  sensorTransitionChoices,
  sensorTransitionNeverFiresFor,
  sensorTransitionReasonKey,
} from '../sensor-transition.js'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'

const DESCRIPTOR: NcConditionDescriptor = {
  id: 'sensorTransition',
  group: 'device',
  label: 'Notify when',
  valueType: 'sensorTransition',
  operator: 'in',
  appliesTo: ['device-event'],
  phase: 'P2',
  options: [
    { value: '', label: 'It triggers and when it clears', hint: 'Every change.' },
    { value: 'raised', label: 'Only when it triggers', hint: 'The alert.' },
    { value: 'cleared', label: 'Only when it clears', hint: 'The return.' },
  ],
}

const CATALOG: readonly NcConditionDescriptor[] = [
  DESCRIPTOR,
  {
    id: 'sensorKinds',
    group: 'device',
    label: 'Sensor kinds',
    valueType: 'stringList',
    operator: 'in',
    appliesTo: ['device-event'],
    phase: 'P2',
  },
]

function sensorForm(conditions: NcRuleFormState['conditions']): NcRuleFormState {
  return { ...emptyRuleForm(), name: 'Allagamento', delivery: 'device-event', targetIds: ['t'], conditions }
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

describe('the mirror', () => {
  it('parses both edges and refuses a stored "both"', () => {
    expect(NcConditionsSchema.parse({ sensorTransition: 'raised' }).sensorTransition).toBe('raised')
    expect(NcConditionsSchema.parse({ sensorTransition: 'cleared' }).sensorTransition).toBe('cleared')
    expect(NcConditionsSchema.safeParse({ sensorTransition: 'both' }).success).toBe(false)
  })
})

describe('shown only when offered', () => {
  it('every chosen kind raises and clears → offered', () => {
    expect(conditionSupportedByRule('sensorTransition', { sensorKinds: ['flood'] })).toBe(true)
    expect(conditionSupportedByRule('sensorTransition', { sensorKinds: ['flood', 'smoke'] })).toBe(true)
  })
  it('no kind, or one kind without a raise → not offered', () => {
    expect(conditionSupportedByRule('sensorTransition', {})).toBe(false)
    expect(conditionSupportedByRule('sensorTransition', { sensorKinds: [] })).toBe(false)
    expect(conditionSupportedByRule('sensorTransition', { sensorKinds: ['flood', 'doorbell'] })).toBe(false)
  })
  it('every other condition is unaffected', () => {
    expect(conditionSupportedByRule('sensorKinds', {})).toBe(true)
  })
})

describe('the choices', () => {
  it('"both" is the absent key: parsing it writes nothing', () => {
    expect(parseSensorTransition('')).toBeUndefined()
    expect(parseSensorTransition('both')).toBeUndefined()
    expect(parseSensorTransition('raised')).toBe('raised')
    expect(parseSensorTransition('cleared')).toBe('cleared')
  })
  it('the served options drive the set, with their hints; a local fallback when none are served', () => {
    const served = sensorTransitionChoices(DESCRIPTOR.options)
    expect(served.map((c) => c.value)).toEqual(['', 'raised', 'cleared'])
    expect(served[1]?.hint).toBe('The alert.')
    const local = sensorTransitionChoices(undefined)
    expect(local.map((c) => c.value)).toEqual(['', 'raised', 'cleared'])
    expect(local.every((c) => c.fallbackLabel.length > 0)).toBe(true)
  })
})

describe('pruned on save, with the reason', () => {
  it('kept on a sensor rule whose kinds all raise', () => {
    const input = formToInput(sensorForm({ sensorKinds: ['flood'], sensorTransition: 'raised' }), { catalog: CATALOG })
    expect(input.conditions.sensorTransition).toBe('raised')
    expect(droppedRuleConditions(sensorForm({ sensorKinds: ['flood'], sensorTransition: 'raised' }))).toEqual([])
  })

  it('dropped when a chosen kind has no raise — and the drop is SAID with the shared reason', () => {
    const form = sensorForm({ sensorKinds: ['flood', 'doorbell'], sensorTransition: 'cleared' })
    expect(formToInput(form, { catalog: CATALOG }).conditions).not.toHaveProperty('sensorTransition')
    expect(droppedRuleConditions(form)).toContainEqual({
      conditionId: 'sensorTransition',
      reason: NC_SENSOR_TRANSITION_UNSUPPORTED_REASON,
    })
  })

  it('dropped with no sensor kind at all', () => {
    const form = sensorForm({ sensorTransition: 'raised' })
    expect(formToInput(form, { catalog: CATALOG }).conditions).not.toHaveProperty('sensorTransition')
    expect(droppedRuleConditions(form).map((d) => d.conditionId)).toContain('sensorTransition')
  })

  it('dropped off device-event even with no catalog to judge against', () => {
    const form = { ...sensorForm({ sensorKinds: ['flood'], sensorTransition: 'raised' }), delivery: 'immediate' as const }
    expect(formToInput(form, {}).conditions).not.toHaveProperty('sensorTransition')
  })

  it('dropped on an occupancy rule (not a sensor kind)', () => {
    const form = sensorForm({
      sensorKinds: ['flood'],
      sensorTransition: 'raised',
      occupancy: { zoneId: 'z', className: 'person', op: 'became-occupied', count: 1, sustainSeconds: 15 },
    })
    expect(formToInput(form, {}).conditions).not.toHaveProperty('sensorTransition')
  })

  it('the reason has a translated key in both locales', () => {
    const key = sensorTransitionReasonKey()
    expect(lookupLocale(enLocale, key)).toBe(NC_SENSOR_TRANSITION_UNSUPPORTED_REASON)
    expect(lookupLocale(itLocale, key)).toBeTypeOf('string')
  })
})

describe('the alarm rule that can never fire', () => {
  const alarm = (edge: 'raised' | 'cleared'): NcRuleFormState =>
    sensorForm({
      deviceState: { deviceId: 900, states: ['armed_away'] },
      sensorKinds: ['contact'],
      sensorTransition: edge,
    })

  const cleared = sensorForm({ sensorKinds: ['contact'], sensorTransition: 'cleared' }).conditions
  const TRIGGER = { kind: 'cap' as const, deviceId: 900, cap: 'alarm-panel', method: 'trigger' }

  it('warns for "only when it clears" on an alarm rule over openings', () => {
    expect(sensorTransitionNeverFiresFor({ conditions: alarm('cleared').conditions })).toBe(true)
  })
  it('does not warn for "only when it triggers", nor for a rule outside the alarm', () => {
    expect(sensorTransitionNeverFiresFor({ conditions: alarm('raised').conditions })).toBe(false)
    expect(sensorTransitionNeverFiresFor({ conditions: cleared })).toBe(false)
  })
  it('an onTrigger Do binding that pulls the panel trigger makes it an alarm rule', () => {
    const actions = { onTrigger: [{ kind: 'do' as const, action: TRIGGER }] }
    expect(sensorTransitionNeverFiresFor({ conditions: cleared, actions })).toBe(true)
  })
  it('a sequence binding proves it only through the shared list', () => {
    const actions = { onTrigger: [{ kind: 'sequence' as const, sequenceId: 'seq-alarm' }] }
    expect(sensorTransitionNeverFiresFor({ conditions: cleared, actions })).toBe(false)
    expect(
      sensorTransitionNeverFiresFor({
        conditions: cleared,
        actions,
        sequenceActionsOf: (id) => (id === 'seq-alarm' ? [TRIGGER] : undefined),
      }),
    ).toBe(true)
  })
  it('the warning has a translated key in both locales', () => {
    expect(lookupLocale(enLocale, SENSOR_TRANSITION_NEVER_FIRES_KEY)).toBe(NC_SENSOR_TRANSITION_NEVER_FIRES_WARNING)
    expect(lookupLocale(itLocale, SENSOR_TRANSITION_NEVER_FIRES_KEY)).toBeTypeOf('string')
  })
})

describe('i18n', () => {
  it('every choice and the label exist in both locales', () => {
    const keys = [
      'v2.nc.rules.editor.condition.sensorTransition',
      ...sensorTransitionChoices(undefined).flatMap((c) => [c.labelKey, c.hintKey]),
    ]
    for (const key of keys) {
      expect(lookupLocale(enLocale, key), `en ${key}`).toBeTypeOf('string')
      expect(lookupLocale(itLocale, key), `it ${key}`).toBeTypeOf('string')
    }
    expect(lookupLocale(itLocale, 'v2.nc.rules.editor.condition.sensorTransition')).toBe('Notifica quando')
  })
})
