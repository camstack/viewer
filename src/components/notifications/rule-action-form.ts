/**
 * rule-action-form — a rule's `actions` as form state, mirroring the admin's
 * model (`addon-admin-ui` `notification-rule-actions.ts`): four hook edges,
 * each an ordered list of Action ids, plus the buttons the notification
 * carries, each running one Action by id. Actions themselves are authored on
 * the hub's Actions page; a rule only names them. ADMIN-ONLY on the hub; the
 * Actions sub-screen is admin-only too.
 */
import type { ActionStep } from '@camstack/types'
import { actionStepsResolver, type NcListedAction } from '../../data/listed-actions.js'
import {
  NC_ACTION_BUTTON_ID_MAX,
  NC_ACTION_BUTTON_LABEL_MAX,
  NC_ACTION_BUTTONS_MAX,
  NC_HOOK_ACTIONS_MAX,
  type NcRuleActions,
  type NcRuleNotificationButton,
} from '../../data/notification-center.js'

/** The hook edges a rule's actions run on, in the order the editor shows them. */
export type NcHookKey = 'onActivation' | 'onDeactivation' | 'onTrigger' | 'onTriggerOff'

export const NC_HOOK_KEYS: readonly NcHookKey[] = ['onActivation', 'onDeactivation', 'onTrigger', 'onTriggerOff']

export interface NcActionsFormState {
  readonly onActivation: readonly string[]
  readonly onDeactivation: readonly string[]
  readonly onTrigger: readonly string[]
  readonly onTriggerOff: readonly string[]
  /** As on the wire; `actionId` may be blank while the draft is being written. */
  readonly buttons: readonly NcRuleNotificationButton[]
}

export interface NcFormToActions {
  /** Absent when nothing is authored (never `{}`) — and when there are errors. */
  readonly actions?: NcRuleActions
  /** Distinct error KEYS, for a list that names each kind once. */
  readonly errors: readonly string[]
  /** Every problem INSTANCE (two unpicked Actions are two) — for a count. */
  readonly problemCount: number
}

const ERR = 'v2.nc.rules.actions'

export const NC_ACTIONS_EMPTY_FORM: NcActionsFormState = {
  onActivation: [],
  onDeactivation: [],
  onTrigger: [],
  onTriggerOff: [],
  buttons: [],
}

/** Hydrate from a persisted rule. Absent reads as empty, not as a change. */
export function actionsToForm(actions: NcRuleActions | undefined): NcActionsFormState {
  if (actions === undefined) return NC_ACTIONS_EMPTY_FORM
  return {
    onActivation: [...(actions.onActivation ?? [])],
    onDeactivation: [...(actions.onDeactivation ?? [])],
    onTrigger: [...(actions.onTrigger ?? [])],
    onTriggerOff: [...(actions.onTriggerOff ?? [])],
    buttons: (actions.buttons ?? []).map((button) => ({ ...button })),
  }
}

function hookIds(ids: readonly string[], errors: string[]): readonly string[] {
  if (ids.length > NC_HOOK_ACTIONS_MAX) errors.push(`${ERR}.tooManyActions`)
  const out: string[] = []
  for (const id of ids) {
    const trimmed = id.trim()
    if (trimmed.length === 0) {
      errors.push(`${ERR}.hookMissingAction`)
      continue
    }
    out.push(trimmed)
  }
  return out
}

function buttonErrors(buttons: readonly NcRuleNotificationButton[], errors: string[]): void {
  if (buttons.length > NC_ACTION_BUTTONS_MAX) errors.push(`${ERR}.tooManyButtons`)
  const ids = new Set<string>()
  for (const button of buttons) {
    if (button.label.trim().length === 0 || button.id.trim().length === 0) {
      errors.push(`${ERR}.buttonMissingLabel`)
    }
    if (button.label.length > NC_ACTION_BUTTON_LABEL_MAX) errors.push(`${ERR}.labelTooLong`)
    if (button.id.length > NC_ACTION_BUTTON_ID_MAX) errors.push(`${ERR}.idTooLong`)
    if (ids.has(button.id)) errors.push(`${ERR}.duplicateButton`)
    ids.add(button.id)
    if (button.actionId.trim().length === 0) errors.push(`${ERR}.buttonMissingAction`)
  }
}

/**
 * Back to the wire shape. Every problem is reported (not just the first), and
 * any problem means NO actions — a partial block would silently drop the
 * broken id on save. An id the hub does not list is NOT an error here (the hub
 * accepts it, and the list may simply not have been read); the editor warns
 * about it through {@link unknownActionRefs}.
 */
export function formToActions(form: NcActionsFormState): NcFormToActions {
  const errors: string[] = []
  const hooks = {
    onActivation: hookIds(form.onActivation, errors),
    onDeactivation: hookIds(form.onDeactivation, errors),
    onTrigger: hookIds(form.onTrigger, errors),
    onTriggerOff: hookIds(form.onTriggerOff, errors),
  }
  buttonErrors(form.buttons, errors)
  const unique = [...new Set(errors)]
  if (unique.length > 0) return { errors: unique, problemCount: errors.length }
  const buttons = form.buttons.map((button) => ({ ...button, actionId: button.actionId.trim() }))
  const anyHook = NC_HOOK_KEYS.some((key) => hooks[key].length > 0)
  if (!anyHook && buttons.length === 0) return { errors: [], problemCount: 0 }
  return {
    actions: {
      ...(hooks.onActivation.length > 0 ? { onActivation: [...hooks.onActivation] } : {}),
      ...(hooks.onDeactivation.length > 0 ? { onDeactivation: [...hooks.onDeactivation] } : {}),
      ...(hooks.onTrigger.length > 0 ? { onTrigger: [...hooks.onTrigger] } : {}),
      ...(hooks.onTriggerOff.length > 0 ? { onTriggerOff: [...hooks.onTriggerOff] } : {}),
      ...(buttons.length > 0 ? { buttons } : {}),
    },
    errors: [],
    problemCount: 0,
  }
}

/** How many Action ids the form carries across every hook edge. */
export function bindingCount(form: NcActionsFormState): number {
  return NC_HOOK_KEYS.reduce((sum, key) => sum + form[key].length, 0)
}

/** Every Action id a form references (hooks and buttons). Blank ids are the save's error, not this. */
export function referencedActionIds(form: NcActionsFormState): readonly string[] {
  const ids = new Set<string>()
  for (const key of NC_HOOK_KEYS) {
    for (const id of form[key]) if (id.trim().length > 0) ids.add(id.trim())
  }
  for (const button of form.buttons) {
    const id = button.actionId.trim()
    if (id.length > 0) ids.add(id)
  }
  return [...ids]
}

/**
 * The Action ids the form points at that the hub's ANSWERED list does not
 * carry. A button bound to one is dropped from the notification by the
 * dispatcher; a hook id to one never runs. Blank ids are the save's error.
 */
export function unknownActionRefs(form: NcActionsFormState, knownIds: ReadonlySet<string>): readonly string[] {
  return referencedActionIds(form).filter((id) => !knownIds.has(id))
}

/** Steps of every Action the form names — for the snooze exemption. */
export function formActionSteps(form: NcActionsFormState, actions: readonly NcListedAction[]): readonly ActionStep[] {
  const resolve = actionStepsResolver(actions)
  const out: ActionStep[] = []
  for (const id of referencedActionIds(form)) out.push(...(resolve(id) ?? []))
  return out
}

/** The same over a STORED rule's actions — what the rules list reads. */
export function storedActionSteps(
  actions: NcRuleActions | undefined,
  listed: readonly NcListedAction[],
): readonly ActionStep[] {
  if (actions === undefined) return []
  return formActionSteps(actionsToForm(actions), listed)
}

/** Does a stored actions block SAY anything — an id on any edge, or a button? */
export function storedActionsAreSet(actions: NcRuleActions | undefined): boolean {
  if (actions === undefined) return false
  return NC_HOOK_KEYS.some((key) => (actions[key]?.length ?? 0) > 0) || (actions.buttons?.length ?? 0) > 0
}
