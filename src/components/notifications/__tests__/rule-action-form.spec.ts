import { describe, expect, it } from 'vitest'
import { NcRuleActionsSchema as PublishedRuleActionsSchema } from '@camstack/types'
import {
  NcRuleActionsSchema,
  type NcRuleAction,
  type NcRuleActions,
  type NcRuleNotificationButton,
} from '../../../data/notification-center.js'
import {
  NC_ACTIONS_EMPTY_FORM,
  argsToRows,
  actionsToForm,
  bindingCount,
  formActionSteps,
  formToActions,
  parseArgRow,
  rowsToArgs,
  storedActionSteps,
  storedActionsAreSet,
  unknownSequenceRefs,
} from '../rule-action-form.js'

const CAP = { editId: 't1', kind: 'cap' as const, seconds: 0, deviceId: 1, cap: 'c', method: 'm', args: [] }

describe('args rows — typed text, parsed at save', () => {
  it('keeps half-typed JSON as text and reports it, instead of snapping back', () => {
    const rows = [{ key: 'payload', type: 'json' as const, text: '{"a":' }]
    const res = rowsToArgs(rows)
    expect(res.errors).toEqual([{ index: 0, errorKey: 'v2.nc.rules.actions.args.invalidJson' }])
    // No partial args: a broken row must not let the others through as if complete.
    expect(res.args).toBeUndefined()
  })
  it('parses each type', () => {
    expect(parseArgRow({ key: 'n', type: 'number', text: '12.5' })).toEqual({ ok: true, value: 12.5 })
    expect(parseArgRow({ key: 'b', type: 'boolean', text: 'true' })).toEqual({ ok: true, value: true })
    expect(parseArgRow({ key: 's', type: 'string', text: 'x' })).toEqual({ ok: true, value: 'x' })
    expect(parseArgRow({ key: 'n', type: 'number', text: 'abc' })).toEqual({
      ok: false,
      errorKey: 'v2.nc.rules.actions.args.invalidNumber',
    })
  })
  it('round-trips stored args through rows', () => {
    const args = { level: 50, on: true, name: 'x', nested: { a: [1] } }
    expect(rowsToArgs(argsToRows(args)).args).toEqual(args)
  })
  it('duplicate or empty keys are errors', () => {
    expect(rowsToArgs([{ key: '', type: 'string', text: 'x' }]).errors).toHaveLength(1)
    expect(
      rowsToArgs([
        { key: 'a', type: 'string', text: '1' },
        { key: 'a', type: 'string', text: '2' },
      ]).errors,
    ).toHaveLength(1)
  })
})

describe('actions form — hook bindings to shared sequences (the admin model)', () => {
  it('round-trips every hook edge, sequence and Do bindings, and buttons — nothing lost', () => {
    const actions: NcRuleActions = {
      onActivation: [{ kind: 'sequence', sequenceId: 'seq-arm' }],
      onDeactivation: [{ kind: 'do', action: { kind: 'wait', seconds: 2 } }],
      onTrigger: [
        { kind: 'sequence', sequenceId: 'seq-siren' },
        { kind: 'do', action: { kind: 'cap', deviceId: 7, cap: 'switch', method: 'setState', args: { on: true } } },
      ],
      onTriggerOff: [{ kind: 'do', action: { kind: 'cap', deviceId: 7, cap: 'switch', method: 'setState', args: { on: false } } }],
      buttons: [
        { id: 'b1', label: 'Siren', sequenceId: 'seq-siren' },
        { id: 'b2', label: 'Arm', sequenceId: 'seq-arm', icon: 'arm-away', destructive: true },
      ],
    }
    expect(formToActions(actionsToForm(actions))).toEqual({ actions, errors: [], problemCount: 0 })
    expect(NcRuleActionsSchema.safeParse(formToActions(actionsToForm(actions)).actions).success).toBe(true)
  })

  it('never emits the legacy inline-sequence shape the hub refuses', () => {
    const { actions } = formToActions(
      actionsToForm({ onTrigger: [{ kind: 'sequence', sequenceId: 's' }], buttons: [{ id: 'b', label: 'L', sequenceId: 's' }] }),
    )
    expect(actions?.onTrigger?.[0]).toEqual({ kind: 'sequence', sequenceId: 's' })
    expect(actions?.buttons?.[0]).not.toHaveProperty('sequence')
    expect(PublishedRuleActionsSchema.safeParse(actions).success).toBe(true)
  })

  it('an empty form is absent, never {}', () => {
    expect(formToActions(actionsToForm(undefined)).actions).toBeUndefined()
    expect(formToActions(NC_ACTIONS_EMPTY_FORM)).toEqual({ errors: [], problemCount: 0 })
  })

  it('a sequence binding not yet picked, and a button with no sequence, are errors', () => {
    const form = {
      ...NC_ACTIONS_EMPTY_FORM,
      onTrigger: [{ editId: 'b1', kind: 'sequence' as const, sequenceId: ' ' }],
      buttons: [{ id: 'b', label: 'x', sequenceId: '' }],
    }
    const res = formToActions(form)
    expect(res.errors).toEqual([
      'v2.nc.rules.actions.bindingMissingSequence',
      'v2.nc.rules.actions.buttonMissingSequence',
    ])
    expect(res.actions).toBeUndefined()
  })

  it('a Do step with an invalid args row is an error, not a silent drop', () => {
    const form = {
      ...NC_ACTIONS_EMPTY_FORM,
      onTrigger: [{ editId: 'b1', kind: 'do' as const, step: { ...CAP, args: [{ editId: 'a1', key: 'p', type: 'json' as const, text: '{' }] } }],
    }
    expect(formToActions(form).errors).toContain('v2.nc.rules.actions.args.invalidJson')
  })

  it('a Do step with no device or method is an error', () => {
    const form = { ...NC_ACTIONS_EMPTY_FORM, onActivation: [{ editId: 'b1', kind: 'do' as const, step: { ...CAP, deviceId: undefined, method: ' ' } }] }
    expect(formToActions(form).errors).toEqual([
      'v2.nc.rules.actions.stepMissingDevice',
      'v2.nc.rules.actions.stepMissingMethod',
    ])
  })

  it('more than 4 bindings on one edge is an error (the hub caps each edge)', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ editId: `b${i}`, kind: 'sequence' as const, sequenceId: 's' }))
    expect(formToActions({ ...NC_ACTIONS_EMPTY_FORM, onTrigger: many }).errors).toContain('v2.nc.rules.actions.tooManyBindings')
    expect(formToActions({ ...NC_ACTIONS_EMPTY_FORM, onTrigger: many.slice(0, 4) }).errors).toEqual([])
  })
})

describe('server bounds', () => {
  const WAIT = { editId: 't1', kind: 'wait' as const, seconds: 1, deviceId: undefined, cap: '', method: '', args: [] }
  const doHook = (step: typeof WAIT) => ({ ...NC_ACTIONS_EMPTY_FORM, onTrigger: [{ editId: 'b1', kind: 'do' as const, step }] })
  const button = (over: Partial<NcRuleNotificationButton> = {}): NcRuleNotificationButton => ({ id: 'b', label: 'L', sequenceId: 's', ...over })

  it('a padded sequence id is trimmed on the way out', () => {
    const res = formToActions({
      ...NC_ACTIONS_EMPTY_FORM,
      onTrigger: [{ editId: 'b1', kind: 'sequence', sequenceId: ' s ' }],
      buttons: [button({ sequenceId: ' s ' })],
    })
    expect(res.actions?.onTrigger?.[0]).toEqual({ kind: 'sequence', sequenceId: 's' })
    expect(res.actions?.buttons?.[0]?.sequenceId).toBe('s')
  })

  it('a wait longer than the hub allows (300 s) is an error', () => {
    expect(formToActions(doHook({ ...WAIT, seconds: 301 })).errors).toContain('v2.nc.rules.actions.waitOutOfRange')
    expect(formToActions(doHook({ ...WAIT, seconds: 300 })).errors).toEqual([])
  })

  it('more than 8 buttons is an error', () => {
    const buttons = Array.from({ length: 9 }, (_, i) => button({ id: `b${i}` }))
    expect(formToActions({ ...NC_ACTIONS_EMPTY_FORM, buttons }).errors).toContain('v2.nc.rules.actions.tooManyButtons')
    expect(formToActions({ ...NC_ACTIONS_EMPTY_FORM, buttons: buttons.slice(0, 8) }).errors).toEqual([])
  })

  it('labels and ids over the hub bounds, and duplicate ids, are errors', () => {
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

describe('reading the shared sequences', () => {
  const FORM = actionsToForm({
    onTrigger: [{ kind: 'sequence', sequenceId: 'known' }, { kind: 'do', action: { kind: 'cap', deviceId: 1, cap: 'alarm-panel', method: 'trigger' } }],
    buttons: [{ id: 'b', label: 'L', sequenceId: 'gone' }],
  })

  it('names the ids the answered list does not carry (the admin warning), and counts bindings', () => {
    expect(unknownSequenceRefs(FORM, new Set(['known']))).toEqual(['gone'])
    expect(unknownSequenceRefs(FORM, new Set(['known', 'gone']))).toEqual([])
    expect(bindingCount(FORM)).toBe(2)
  })

  it('resolves the steps every binding and button can run', () => {
    const steps: Readonly<Record<string, readonly NcRuleAction[]>> = {
      known: [{ kind: 'wait', seconds: 1 }],
      gone: [{ kind: 'cap', deviceId: 2, cap: 'switch', method: 'setState' }],
    }
    const of = (id: string) => steps[id]
    expect(formActionSteps(FORM, of)).toEqual([
      { kind: 'wait', seconds: 1 },
      { kind: 'cap', deviceId: 1, cap: 'alarm-panel', method: 'trigger' },
      { kind: 'cap', deviceId: 2, cap: 'switch', method: 'setState' },
    ])
    expect(storedActionSteps(formToActions(FORM).actions, of)).toEqual(formActionSteps(FORM, of))
    expect(formActionSteps(FORM, () => undefined)).toEqual([{ kind: 'cap', deviceId: 1, cap: 'alarm-panel', method: 'trigger' }])
  })

  it('a stored block says something only with a binding or a button', () => {
    expect(storedActionsAreSet(undefined)).toBe(false)
    expect(storedActionsAreSet({})).toBe(false)
    expect(storedActionsAreSet({ onTriggerOff: [{ kind: 'sequence', sequenceId: 's' }] })).toBe(true)
    expect(storedActionsAreSet({ buttons: [{ id: 'b', label: 'L', sequenceId: 's' }] })).toBe(true)
  })
})
