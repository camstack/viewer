/**
 * rule-action-edit — the EDITS the Actions sub-screen makes to its form state
 * (`rule-action-form.ts` owns the shape, the parse and the errors; this owns
 * the gestures). Pure and immutable:
 *
 *  - a hook edge takes at most `NC_HOOK_ACTIONS_MAX` Action ids — adding stops
 *    there rather than authoring a save the hub refuses;
 *  - order is the order the edge runs, so a row can move up or down;
 *  - a new button points at an Action the hub listed.
 */
import { NC_HOOK_ACTIONS_MAX, type NcRuleNotificationButton } from '../../data/notification-center.js'
import type { NcActionsFormState, NcHookKey } from './rule-action-form.js'

const BUTTON_ID_PREFIX = 'action-'

export function replaceAt<T>(list: readonly T[], index: number, item: T): readonly T[] {
  return list.map((current, i) => (i === index ? item : current))
}

export function removeAt<T>(list: readonly T[], index: number): readonly T[] {
  return list.filter((_, i) => i !== index)
}

/** Can this hook edge take one more Action? */
export function canAddAction(form: NcActionsFormState, hook: NcHookKey): boolean {
  return form[hook].length < NC_HOOK_ACTIONS_MAX
}

/** Append an Action id to one hook — refused (unchanged) at the hub's cap or when the id is blank. */
export function addAction(form: NcActionsFormState, hook: NcHookKey, actionId: string): NcActionsFormState {
  const id = actionId.trim()
  if (!canAddAction(form, hook) || id.length === 0) return form
  return { ...form, [hook]: [...form[hook], id] }
}

export function replaceAction(
  form: NcActionsFormState,
  hook: NcHookKey,
  index: number,
  actionId: string,
): NcActionsFormState {
  const id = actionId.trim()
  if (id.length === 0) return form
  return { ...form, [hook]: replaceAt(form[hook], index, id) }
}

export function removeAction(form: NcActionsFormState, hook: NcHookKey, index: number): NcActionsFormState {
  return { ...form, [hook]: removeAt(form[hook], index) }
}

/** Swap a row with its neighbour. Out of range is a no-op. */
export function moveAction(
  form: NcActionsFormState,
  hook: NcHookKey,
  index: number,
  delta: -1 | 1,
): NcActionsFormState {
  const list = form[hook]
  const next = index + delta
  const current = list[index]
  const neighbor = list[next]
  if (current === undefined || neighbor === undefined) return form
  return {
    ...form,
    [hook]: list.map((id, i) => (i === index ? neighbor : i === next ? current : id)),
  }
}

/** A fresh button with an unused id, running `actionId`. */
export function newButtonForm(form: NcActionsFormState, label: string, actionId: string): NcRuleNotificationButton {
  const taken = new Set(form.buttons.map((button) => button.id))
  let n = form.buttons.length + 1
  while (taken.has(`${BUTTON_ID_PREFIX}${n}`)) n += 1
  return { id: `${BUTTON_ID_PREFIX}${n}`, label, actionId }
}
