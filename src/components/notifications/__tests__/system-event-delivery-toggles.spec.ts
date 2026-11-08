/**
 * The delivery moments as three switches (D1019): every stored shape is READ
 * as moments and written back as `modes`; the last moment cannot be switched
 * off; the whole rule — conditions included — rides the save.
 */
import { describe, expect, it } from 'vitest'
import { NcListRulesResultSchema, NcRuleInputSchema, type NcSchedule, type NcViewerRule } from '../../../data/notification-center.js'
import { ruleSaveRequest } from '../../../screens/notifications/rule-editor/rule-draft-source.js'
import { inputToForm, formToInput } from '../rule-editor.js'
import {
  isStateSummaryForm,
  kindsHaveRecovery,
  modesDeliveryOf,
  systemEventMomentsOf,
  scheduleForSendTimes,
  summaryFormProblems,
  systemEventDeliveryModesOf,
  withDeliveryMoment,
  withScheduledSummary,
} from '../system-event-delivery.js'

const DAILY_8: NcSchedule = scheduleForSendTimes([{ days: [0, 1, 2, 3, 4, 5, 6], minute: 480 }])
const DAILY_18: NcSchedule = scheduleForSendTimes([{ days: [0, 1, 2, 3, 4, 5, 6], minute: 1080 }])

const WITH_RECOVERY = ['device-offline'] as const
const NO_RECOVERY = ['addon-update-available'] as const

const BASE = {
  id: 'r1',
  enabled: true,
  targets: [{ targetId: 't1' }],
  media: { attach: 'none' },
  throttle: { cooldownSec: 60, scope: 'rule-device' },
  priority: 3,
  createdBy: 'u1',
  createdAt: 1,
  updatedAt: 2,
  disabledTargetIds: [],
  readOnly: false,
  name: 'Batteries',
  delivery: 'system-event',
  conditions: { systemEvent: { kinds: ['device-battery-low'] } },
}

function served(systemEventDelivery: unknown): NcViewerRule {
  const rule = NcListRulesResultSchema.parse({ rules: [{ ...BASE, systemEventDelivery }] }).rules[0]
  if (rule === undefined) throw new Error('dropped')
  return rule
}

describe('moments ↔ stored shapes', () => {
  it('absent and instant read as both edges; switching one off writes modes', () => {
    expect(withDeliveryMoment(undefined, 'deactivation', false, WITH_RECOVERY)).toEqual({
      mode: 'modes',
      onActivation: true,
      onDeactivation: false,
    })
    expect(withDeliveryMoment({ mode: 'instant' }, 'activation', false, WITH_RECOVERY)).toEqual({
      mode: 'modes',
      onActivation: false,
      onDeactivation: true,
    })
  })

  it('a legacy summary keeps its schedule and grouping when a moment is switched on', () => {
    const legacy = { mode: 'summary', schedule: DAILY_8, split: 'section' } as const
    expect(withDeliveryMoment(legacy, 'activation', true, WITH_RECOVERY)).toEqual({
      mode: 'modes',
      onActivation: true,
      onDeactivation: false,
      onSchedule: { schedule: DAILY_8, grouping: 'section' },
    })
  })

  it('switching the summary on starts every day 08:00, one per category (the admin default); off removes onSchedule', () => {
    const on = withDeliveryMoment(undefined, 'schedule', true, WITH_RECOVERY)
    expect(on).toEqual({
      mode: 'modes',
      onActivation: true,
      onDeactivation: true,
      onSchedule: { schedule: DAILY_8, grouping: 'section' },
    })
    expect(withDeliveryMoment(on, 'schedule', false, WITH_RECOVERY)).toEqual({
      mode: 'modes',
      onActivation: true,
      onDeactivation: true,
    })
  })

  it('round trip: modes → moments → modes is the identity', () => {
    const stored = modesDeliveryOf({
      activation: false,
      deactivation: true,
      schedule: { schedule: DAILY_18, grouping: 'section' },
    })
    expect(modesDeliveryOf(systemEventMomentsOf({ systemEventDelivery: stored, kinds: WITH_RECOVERY }))).toEqual(stored)
    expect(withScheduledSummary(stored, { schedule: DAILY_8, grouping: 'rule' }, WITH_RECOVERY)).toEqual({
      ...stored,
      onSchedule: { schedule: DAILY_8, grouping: 'rule' },
    })
  })
})

describe('at least one moment', () => {
  it('refuses to switch off the last one, whatever the stored shape', () => {
    const onlyStart = { mode: 'modes', onActivation: true, onDeactivation: false } as const
    expect(withDeliveryMoment(onlyStart, 'activation', false, WITH_RECOVERY)).toBe(onlyStart)
    const onlySummary = { mode: 'summary', schedule: DAILY_8 } as const
    expect(withDeliveryMoment(onlySummary, 'schedule', false, WITH_RECOVERY)).toBe(onlySummary)
  })

  it('the hub verdict on a stored no-mode rule is still the editor problem noMode', () => {
    const form = inputToForm(served({ mode: 'modes', onActivation: false, onDeactivation: false }))
    expect(summaryFormProblems(form)).toContain('noMode')
  })

  it('deactivation alone with no clearing kind is noInstantKind', () => {
    const rule = served({ mode: 'modes', onActivation: false, onDeactivation: true })
    const form = inputToForm({ ...rule, conditions: { systemEvent: { kinds: [] } } })
    expect(summaryFormProblems(form)).toContain('noInstantKind')
  })
})

describe('a schedule beside instant moments is not a schedule-only rule', () => {
  it('only a summary with both edges off is a scheduled state summary', () => {
    const both = inputToForm(served({ mode: 'modes', onActivation: true, onDeactivation: false, onSchedule: { schedule: DAILY_8, grouping: 'rule' } }))
    expect(isStateSummaryForm(both)).toBe(false)
    const only = inputToForm(served({ mode: 'modes', onActivation: false, onDeactivation: false, onSchedule: { schedule: DAILY_8, grouping: 'rule' } }))
    expect(isStateSummaryForm(only)).toBe(true)
    expect(isStateSummaryForm(inputToForm(served({ mode: 'summary', schedule: DAILY_8 })))).toBe(true)
  })
})

describe('the save sends the WHOLE rule', () => {
  it('an edited moment rides with name, conditions and targets — never a bare delivery patch', () => {
    const rule = served({ mode: 'instant' })
    const form = {
      ...inputToForm(rule),
      systemEventDelivery: withDeliveryMoment({ mode: 'instant' }, 'deactivation', false, ['device-battery-low']),
    }
    const request = ruleSaveRequest(form, rule, { isAdmin: true, ownTargetIds: ['t1'], hubKeepsSummary: true })
    if (request.mode !== 'update') throw new Error('expected an update')
    const parsed = NcRuleInputSchema.parse(request.patch)
    expect(parsed.systemEventDelivery).toEqual({ mode: 'modes', onActivation: true, onDeactivation: false })
    expect(parsed.conditions).toEqual(formToInput(form, { isAdmin: true }).conditions)
    expect(parsed.conditions.systemEvent?.kinds).toEqual(['device-battery-low'])
    expect(parsed.name).toBe('Batteries')
    expect(parsed.targets).toEqual([{ targetId: 't1' }])
  })
})

describe('kinds-aware legacy read (the hub systemEventDeliveryAsModes)', () => {
  it('absent / instant: "resolves" is on only where a selected kind has a recovery edge', () => {
    expect(kindsHaveRecovery(WITH_RECOVERY)).toBe(true)
    expect(kindsHaveRecovery(NO_RECOVERY)).toBe(false)
    expect(systemEventMomentsOf({ kinds: NO_RECOVERY })).toEqual({ activation: true, deactivation: false, schedule: null })
    expect(systemEventMomentsOf({ systemEventDelivery: { mode: 'instant' }, kinds: WITH_RECOVERY }).deactivation).toBe(true)
  })

  it('refuses "resolves" ON for kinds with no recovery edge, so no dead rule can be written', () => {
    expect(withDeliveryMoment(undefined, 'deactivation', true, NO_RECOVERY)).toBeUndefined()
    // and switching the start off there is refused as the last moment
    expect(withDeliveryMoment(undefined, 'activation', false, NO_RECOVERY)).toBeUndefined()
  })

  it('adding a summary to a no-recovery rule does not invent a resolving moment', () => {
    expect(withDeliveryMoment(undefined, 'schedule', true, NO_RECOVERY)).toEqual({
      mode: 'modes',
      onActivation: true,
      onDeactivation: false,
      onSchedule: { schedule: DAILY_8, grouping: 'section' },
    })
  })
})
