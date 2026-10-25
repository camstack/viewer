import { describe, expect, it } from 'vitest'
import type { NcActionsFormState, NcActionStepForm, NcArgRow } from '../rule-action-form.js'
import { NC_ACTIONS_EMPTY_FORM, actionsToForm, formToActions } from '../rule-action-form.js'
import {
  NC_NEW_WAIT_SEC,
  addBinding,
  argRowError,
  canAddBinding,
  capChoices,
  newArgRow,
  newButtonForm,
  newDoBindingForm,
  newSequenceBindingForm,
  newStepForm,
  removeAt,
  removeBinding,
  replaceAt,
  replaceBinding,
  withStepKind,
} from '../rule-action-edit.js'

const capStep: NcActionStepForm = {
  editId: 't1',
  kind: 'cap',
  seconds: 0,
  deviceId: 7,
  cap: 'switch',
  method: 'setState',
  args: [{ editId: 'a1', key: 'on', type: 'boolean', text: 'true' }],
}

describe('list helpers', () => {
  it('replaceAt / removeAt are immutable', () => {
    const list = ['a', 'b', 'c']
    expect(replaceAt(list, 1, 'x')).toEqual(['a', 'x', 'c'])
    expect(removeAt(list, 0)).toEqual(['b', 'c'])
    expect(list).toEqual(['a', 'b', 'c'])
  })
})

describe('bindings on one hook edge', () => {
  it('adds a sequence binding pointing at the given shared sequence, with a sibling-unique id', () => {
    const one = addBinding(NC_ACTIONS_EMPTY_FORM, 'onTrigger', (s) => newSequenceBindingForm(s, 'seq-1'))
    const two = addBinding(one, 'onTrigger', (s) => newSequenceBindingForm(s, 'seq-2'))
    expect(two.onTrigger).toEqual([
      { editId: 'b1', kind: 'sequence', sequenceId: 'seq-1' },
      { editId: 'b2', kind: 'sequence', sequenceId: 'seq-2' },
    ])
    expect(two.onActivation).toEqual([])
  })

  it('a new Do binding is a cap step with NO device — the save refuses it until one is chosen', () => {
    const form = addBinding(NC_ACTIONS_EMPTY_FORM, 'onTriggerOff', newDoBindingForm)
    const binding = form.onTriggerOff[0]
    expect(binding?.kind).toBe('do')
    if (binding?.kind !== 'do') throw new Error('not a do binding')
    expect(binding.step.kind).toBe('cap')
    expect(binding.step.deviceId).toBeUndefined()
    expect(formToActions(form).errors).toContain('v2.nc.rules.actions.stepMissingDevice')
  })

  it('stops at the hub cap of 4 per edge — the form is returned unchanged', () => {
    let form: NcActionsFormState = NC_ACTIONS_EMPTY_FORM
    for (let i = 0; i < 6; i += 1) form = addBinding(form, 'onActivation', newDoBindingForm)
    expect(form.onActivation).toHaveLength(4)
    expect(canAddBinding(form, 'onActivation')).toBe(false)
    expect(canAddBinding(form, 'onDeactivation')).toBe(true)
  })

  it('replaces and removes one binding without touching the other edges', () => {
    const form = actionsToForm({
      onTrigger: [
        { kind: 'sequence', sequenceId: 'a' },
        { kind: 'sequence', sequenceId: 'b' },
      ],
      onActivation: [{ kind: 'sequence', sequenceId: 'c' }],
    })
    const replaced = replaceBinding(form, 'onTrigger', 1, { editId: 'b2', kind: 'sequence', sequenceId: 'z' })
    expect(formToActions(replaced).actions?.onTrigger).toEqual([
      { kind: 'sequence', sequenceId: 'a' },
      { kind: 'sequence', sequenceId: 'z' },
    ])
    const removed = removeBinding(replaced, 'onTrigger', 0)
    expect(formToActions(removed).actions).toEqual({
      onActivation: [{ kind: 'sequence', sequenceId: 'c' }],
      onTrigger: [{ kind: 'sequence', sequenceId: 'z' }],
    })
    // Immutable.
    expect(form.onTrigger).toHaveLength(2)
  })
})

describe('buttons', () => {
  it('a new button has an unused id and runs the given sequence', () => {
    let form: NcActionsFormState = NC_ACTIONS_EMPTY_FORM
    for (let i = 0; i < 4; i += 1) form = { ...form, buttons: [...form.buttons, newButtonForm(form, 'A', 'seq')] }
    expect(new Set(form.buttons.map((b) => b.id)).size).toBe(4)
    expect(form.buttons.every((b) => b.sequenceId === 'seq')).toBe(true)
  })

  it('skips an id a stored button already holds', () => {
    const form = { ...NC_ACTIONS_EMPTY_FORM, buttons: [{ id: 'action-2', label: 'x', sequenceId: 's' }] }
    expect(newButtonForm(form, 'A', 's').id).toBe('action-3')
  })

  it('with no known sequence, it is blank — and the save names it', () => {
    const button = newButtonForm(NC_ACTIONS_EMPTY_FORM, 'A', '')
    expect(formToActions({ ...NC_ACTIONS_EMPTY_FORM, buttons: [button] }).errors).toContain(
      'v2.nc.rules.actions.buttonMissingSequence',
    )
  })
})

describe('steps and rows', () => {
  it('a new step is the harmless wait, with a sibling-unique id', () => {
    const step = newStepForm([capStep])
    expect(step).toEqual({ editId: 't2', kind: 'wait', seconds: NC_NEW_WAIT_SEC, deviceId: undefined, cap: '', method: '', args: [] })
  })
  it('switching kind keeps the other half, so Wait → Do → Wait loses nothing', () => {
    const toWait = withStepKind(capStep, 'wait')
    expect(toWait.kind).toBe('wait')
    expect(withStepKind(toWait, 'cap')).toEqual(capStep)
  })
  it('a fresh arg row is an empty string row with its own id', () => {
    expect(newArgRow(capStep.args)).toEqual({ editId: 'a2', key: '', type: 'string', text: '' })
  })
})

describe('arg row error, per row', () => {
  it('names the error of the row that has it, and only that row', () => {
    const rows: readonly NcArgRow[] = [
      { editId: 'a1', key: 'a', type: 'number', text: '1' },
      { editId: 'a2', key: 'b', type: 'json', text: '{"x":' },
    ]
    expect(argRowError(rows, 0)).toBeUndefined()
    expect(argRowError(rows, 1)).toBe('v2.nc.rules.actions.args.invalidJson')
  })
})

describe('cap choices', () => {
  it('unique and sorted, from the device bindings', () => {
    expect(capChoices(['switch', 'battery', 'switch'], '')).toEqual(['battery', 'switch'])
  })
  it('a stored cap the device no longer lists still shows, so it can be seen and changed', () => {
    expect(capChoices(['switch'], 'siren')).toEqual(['siren', 'switch'])
  })
})
