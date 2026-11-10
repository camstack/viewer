import { describe, expect, it } from 'vitest'
import type { NcListedAction } from '../../../data/listed-actions.js'
import {
  NcRuleActionsSchema,
  type NcRuleActions,
  type NcRuleNotificationButton,
} from '../../../data/notification-center.js'
import {
  NC_ACTIONS_EMPTY_FORM,
  actionsToForm,
  bindingCount,
  formActionSteps,
  formToActions,
  storedActionSteps,
  storedActionsAreSet,
  unknownActionRefs,
} from '../rule-action-form.js'

const PANEL = { kind: 'cap' as const, cap: 'alarm-panel', method: 'trigger', deviceId: 1 }

describe('actions form — hook edges name Actions by id', () => {
  it('round-trips a stored block, including a button icon', () => {
    const actions: NcRuleActions = {
      onActivation: ['act-arm'],
      onDeactivation: ['act-wait'],
      onTrigger: ['act-siren', 'act-switch'],
      onTriggerOff: ['act-off'],
      buttons: [
        { id: 'b1', label: 'Siren', actionId: 'act-siren' },
        { id: 'b2', label: 'Arm', actionId: 'act-arm', icon: 'arm-away', destructive: true },
      ],
    }
    expect(formToActions(actionsToForm(actions))).toEqual({ actions, errors: [], problemCount: 0 })
    expect(NcRuleActionsSchema.safeParse(formToActions(actionsToForm(actions)).actions).success).toBe(true)
  })

  it('copies the ids — the form does not invent steps', () => {
    const { actions } = formToActions(
      actionsToForm({ onTrigger: ['act-s'], buttons: [{ id: 'b', label: 'L', actionId: 'act-s' }] }),
    )
    expect(actions?.onTrigger).toEqual(['act-s'])
    expect(actions?.buttons?.[0]?.actionId).toBe('act-s')
  })

  it('an absent block and an empty form both say nothing', () => {
    expect(formToActions(actionsToForm(undefined)).actions).toBeUndefined()
    expect(formToActions(NC_ACTIONS_EMPTY_FORM)).toEqual({ errors: [], problemCount: 0 })
  })

  it('a blank id is an error, and an error means no actions are sent', () => {
    const form = {
      ...NC_ACTIONS_EMPTY_FORM,
      onTrigger: [' '],
      buttons: [{ id: 'b', label: 'x', actionId: '' }],
    }
    const res = formToActions(form)
    expect(res.actions).toBeUndefined()
    expect(res.errors).toEqual([
      'v2.nc.rules.actions.hookMissingAction',
      'v2.nc.rules.actions.buttonMissingAction',
    ])
    expect(res.problemCount).toBe(2)
  })

  it('more than four ids on one edge is an error; four is the hub cap', () => {
    const many = ['a', 'b', 'c', 'd', 'e']
    expect(formToActions({ ...NC_ACTIONS_EMPTY_FORM, onTrigger: many }).errors).toContain(
      'v2.nc.rules.actions.tooManyActions',
    )
    expect(formToActions({ ...NC_ACTIONS_EMPTY_FORM, onTrigger: many.slice(0, 4) }).errors).toEqual([])
  })
})

describe('buttons', () => {
  const button = (over: Partial<NcRuleNotificationButton> = {}): NcRuleNotificationButton => ({
    id: 'b',
    label: 'L',
    actionId: 'act',
    ...over,
  })

  it('trims the Action id it sends', () => {
    const res = formToActions({
      ...NC_ACTIONS_EMPTY_FORM,
      onTrigger: [' act '],
      buttons: [button({ actionId: ' act ' })],
    })
    expect(res.actions?.onTrigger).toEqual(['act'])
    expect(res.actions?.buttons?.[0]?.actionId).toBe('act')
  })

  it('refuses too many, a long label, a long id, and a repeated id', () => {
    const buttons = Array.from({ length: 9 }, (_, i) => button({ id: `b${i}` }))
    expect(formToActions({ ...NC_ACTIONS_EMPTY_FORM, buttons }).errors).toContain('v2.nc.rules.actions.tooManyButtons')
    expect(formToActions({ ...NC_ACTIONS_EMPTY_FORM, buttons: buttons.slice(0, 8) }).errors).toEqual([])
    expect(formToActions({ ...NC_ACTIONS_EMPTY_FORM, buttons: [button({ label: 'x'.repeat(41) })] }).errors).toContain(
      'v2.nc.rules.actions.labelTooLong',
    )
    expect(formToActions({ ...NC_ACTIONS_EMPTY_FORM, buttons: [button({ id: 'x'.repeat(65) })] }).errors).toContain(
      'v2.nc.rules.actions.idTooLong',
    )
    expect(formToActions({ ...NC_ACTIONS_EMPTY_FORM, buttons: [button(), button()] }).errors).toContain(
      'v2.nc.rules.actions.duplicateButton',
    )
  })
})

describe('reading the hub Actions', () => {
  const listed: readonly NcListedAction[] = [
    { id: 'known', name: 'Known', steps: [{ kind: 'wait', seconds: 1 }] },
    { id: 'panel', name: 'Panel', steps: [PANEL] },
  ]
  const form = actionsToForm({
    onTrigger: ['known', 'panel'],
    buttons: [{ id: 'b', label: 'L', actionId: 'gone' }],
  })

  it('names the ids the answered list does not carry', () => {
    expect(unknownActionRefs(form, new Set(listed.map((action) => action.id)))).toEqual(['gone'])
    expect(unknownActionRefs(form, new Set(['known', 'panel', 'gone']))).toEqual([])
    expect(bindingCount(form)).toBe(2)
  })

  it('collects the steps of every named Action, hooks and buttons', () => {
    expect(formActionSteps(form, listed)).toEqual([{ kind: 'wait', seconds: 1 }, PANEL])
    expect(storedActionSteps(formToActions(form).actions, listed)).toEqual(formActionSteps(form, listed))
    expect(formActionSteps(form, [])).toEqual([])
  })

  it('a stored block is set when any edge or a button carries something', () => {
    expect(storedActionsAreSet(undefined)).toBe(false)
    expect(storedActionsAreSet({})).toBe(false)
    expect(storedActionsAreSet({ onTriggerOff: ['act'] })).toBe(true)
    expect(storedActionsAreSet({ buttons: [{ id: 'b', label: 'L', actionId: 'act' }] })).toBe(true)
  })
})
