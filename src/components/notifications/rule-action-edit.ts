/**
 * rule-action-edit — the EDITS the Actions sub-screen makes to its form state
 * (`rule-action-form.ts` owns the shape, the parse and the errors; this owns
 * the gestures). Pure and immutable, so the rules below are pinned by specs
 * instead of by a mounted screen:
 *
 *  - a hook edge takes at most `NC_HOOK_BINDINGS_MAX` bindings — adding stops
 *    there rather than authoring a save the hub refuses;
 *  - a new sequence binding / button points at the FIRST shared sequence the
 *    hub listed (blank when it listed none — the save then names it);
 *  - a new Do binding starts as a `cap` step with no device: the save refuses
 *    it until a device and a method are chosen, so it cannot actuate pointing
 *    nowhere;
 *  - switching a step between Wait and Do keeps the other half, since the form
 *    carries both.
 */
import { NC_HOOK_BINDINGS_MAX } from '../../data/notification-center.js'
import type { NcRuleNotificationButton } from '../../data/notification-center.js'
import {
  NC_ARG_ID_PREFIX,
  NC_BINDING_ID_PREFIX,
  NC_STEP_ID_PREFIX,
  nextEditId,
  rowsToArgs,
  type NcActionsFormState,
  type NcActionStepForm,
  type NcArgRow,
  type NcBindingForm,
  type NcHookKey,
} from './rule-action-form.js'

/** A new Wait step's pause. */
export const NC_NEW_WAIT_SEC = 5

const BUTTON_ID_PREFIX = 'action-'

export function replaceAt<T>(list: readonly T[], index: number, item: T): readonly T[] {
  return list.map((current, i) => (i === index ? item : current))
}

export function removeAt<T>(list: readonly T[], index: number): readonly T[] {
  return list.filter((_, i) => i !== index)
}

export function newStepForm(siblings: readonly NcActionStepForm[]): NcActionStepForm {
  return {
    editId: nextEditId(NC_STEP_ID_PREFIX, siblings),
    kind: 'wait',
    seconds: NC_NEW_WAIT_SEC,
    deviceId: undefined,
    cap: '',
    method: '',
    args: [],
  }
}

export function withStepKind(step: NcActionStepForm, kind: NcActionStepForm['kind']): NcActionStepForm {
  return { ...step, kind }
}

export function newArgRow(siblings: readonly NcArgRow[]): NcArgRow {
  return { editId: nextEditId(NC_ARG_ID_PREFIX, siblings), key: '', type: 'string', text: '' }
}

/** Can this hook edge take one more binding? */
export function canAddBinding(form: NcActionsFormState, hook: NcHookKey): boolean {
  return form[hook].length < NC_HOOK_BINDINGS_MAX
}

/** Append a binding to one hook — refused (unchanged) at the hub's cap. */
export function addBinding(
  form: NcActionsFormState,
  hook: NcHookKey,
  make: (siblings: readonly NcBindingForm[]) => NcBindingForm,
): NcActionsFormState {
  if (!canAddBinding(form, hook)) return form
  return { ...form, [hook]: [...form[hook], make(form[hook])] }
}

export function newSequenceBindingForm(siblings: readonly NcBindingForm[], sequenceId: string): NcBindingForm {
  return { editId: nextEditId(NC_BINDING_ID_PREFIX, siblings), kind: 'sequence', sequenceId }
}

export function newDoBindingForm(siblings: readonly NcBindingForm[]): NcBindingForm {
  return {
    editId: nextEditId(NC_BINDING_ID_PREFIX, siblings),
    kind: 'do',
    step: { ...newStepForm([]), kind: 'cap' },
  }
}

export function replaceBinding(
  form: NcActionsFormState,
  hook: NcHookKey,
  index: number,
  next: NcBindingForm,
): NcActionsFormState {
  return { ...form, [hook]: replaceAt(form[hook], index, next) }
}

export function removeBinding(form: NcActionsFormState, hook: NcHookKey, index: number): NcActionsFormState {
  return { ...form, [hook]: removeAt(form[hook], index) }
}

/** A fresh button with an unused id, running `sequenceId` (blank when none is known). */
export function newButtonForm(form: NcActionsFormState, label: string, sequenceId: string): NcRuleNotificationButton {
  const taken = new Set(form.buttons.map((button) => button.id))
  let n = form.buttons.length + 1
  while (taken.has(`${BUTTON_ID_PREFIX}${n}`)) n += 1
  return { id: `${BUTTON_ID_PREFIX}${n}`, label, sequenceId }
}

/** The error of ONE args row, drawn under it — or `undefined` when it parses. */
export function argRowError(rows: readonly NcArgRow[], index: number): string | undefined {
  return rowsToArgs(rows).errors.find((error) => error.index === index)?.errorKey
}

/** The caps a Do step may pick: the device's bindings, plus a stored cap the
 *  device no longer lists — so it stays visible and can be changed. */
export function capChoices(bound: readonly string[], current: string): readonly string[] {
  const all = new Set(bound)
  if (current.trim().length > 0) all.add(current)
  return [...all].sort((a, b) => a.localeCompare(b))
}
