import { describe, expect, it } from 'vitest'
import type { NcActionsFormState } from '../rule-action-form.js'
import { NC_ACTIONS_EMPTY_FORM, actionsToForm, formToActions } from '../rule-action-form.js'
import {
  addAction,
  canAddAction,
  moveAction,
  newButtonForm,
  removeAction,
  removeAt,
  replaceAction,
  replaceAt,
} from '../rule-action-edit.js'

describe('list helpers', () => {
  it('replaceAt / removeAt are immutable', () => {
    const list = ['a', 'b', 'c']
    expect(replaceAt(list, 1, 'x')).toEqual(['a', 'x', 'c'])
    expect(removeAt(list, 0)).toEqual(['b', 'c'])
    expect(list).toEqual(['a', 'b', 'c'])
  })
})

describe('Actions on one hook edge', () => {
  it('appends an Action id and leaves the other edges alone', () => {
    const one = addAction(NC_ACTIONS_EMPTY_FORM, 'onTrigger', 'act-1')
    const two = addAction(one, 'onTrigger', 'act-2')
    expect(two.onTrigger).toEqual(['act-1', 'act-2'])
    expect(two.onActivation).toEqual([])
    expect(one.onTrigger).toEqual(['act-1'])
  })

  it('refuses a blank id', () => {
    expect(addAction(NC_ACTIONS_EMPTY_FORM, 'onTrigger', '  ')).toEqual(NC_ACTIONS_EMPTY_FORM)
  })

  it('stops at the hub cap of 4 per edge — the form is returned unchanged', () => {
    let form: NcActionsFormState = NC_ACTIONS_EMPTY_FORM
    for (let i = 0; i < 6; i += 1) form = addAction(form, 'onActivation', `act-${i}`)
    expect(form.onActivation).toHaveLength(4)
    expect(canAddAction(form, 'onActivation')).toBe(false)
    expect(canAddAction(form, 'onDeactivation')).toBe(true)
  })

  it('replaces and removes one id without touching the other edges', () => {
    const form = actionsToForm({ onTrigger: ['a', 'b'], onActivation: ['c'] })
    const replaced = replaceAction(form, 'onTrigger', 1, 'z')
    expect(formToActions(replaced).actions?.onTrigger).toEqual(['a', 'z'])
    const removed = removeAction(replaced, 'onTrigger', 0)
    expect(formToActions(removed).actions).toEqual({ onActivation: ['c'], onTrigger: ['z'] })
    expect(form.onTrigger).toEqual(['a', 'b'])
  })

  it('moves an id one place and refuses to move off the end', () => {
    const form = actionsToForm({ onTrigger: ['a', 'b', 'c'] })
    expect(moveAction(form, 'onTrigger', 2, 1)).toBe(form)
    expect(moveAction(form, 'onTrigger', 0, -1)).toBe(form)
    const moved = moveAction(form, 'onTrigger', 2, -1)
    expect(moved.onTrigger).toEqual(['a', 'c', 'b'])
    expect(form.onTrigger).toEqual(['a', 'b', 'c'])
  })
})

describe('buttons', () => {
  it('a new button has an unused id and runs the given Action', () => {
    let form: NcActionsFormState = NC_ACTIONS_EMPTY_FORM
    for (let i = 0; i < 4; i += 1) form = { ...form, buttons: [...form.buttons, newButtonForm(form, 'A', 'act')] }
    expect(new Set(form.buttons.map((b) => b.id)).size).toBe(4)
    expect(form.buttons.every((b) => b.actionId === 'act')).toBe(true)
  })

  it('skips an id a stored button already holds', () => {
    const form = { ...NC_ACTIONS_EMPTY_FORM, buttons: [{ id: 'action-2', label: 'x', actionId: 'act' }] }
    expect(newButtonForm(form, 'A', 'act').id).toBe('action-3')
  })

  it('with no Action id, the save names it', () => {
    const button = newButtonForm(NC_ACTIONS_EMPTY_FORM, 'A', '')
    expect(formToActions({ ...NC_ACTIONS_EMPTY_FORM, buttons: [button] }).errors).toContain(
      'v2.nc.rules.actions.buttonMissingAction',
    )
  })
})
