/**
 * rule-action-form — a rule's `actions` as form state, mirroring the admin's
 * model (`addon-admin-ui` `notification-rule-actions.ts`): four hook edges
 * (`onActivation`, `onDeactivation`, `onTrigger`, `onTriggerOff`), each a list
 * of BINDINGS — a shared sequence by id, or one inline step ("Do") — plus the
 * buttons the notification carries, each running one shared sequence by id.
 * Sequences themselves are SHARED entities in the hub's sequence store
 * (authored on the admin's Notifications → Sequences); a rule never carries
 * one. ADMIN-ONLY on the hub; the Actions sub-screen is admin-only too.
 *
 * A Do step's method arguments are held as ROWS of the text the operator
 * typed, never as the parsed value: re-deriving a JSON field from its parse
 * would snap a half-typed object back to the last valid one under the
 * operator's cursor. The rows are parsed at SAVE, and a row that does not
 * parse is an error that blocks the save — never a silent drop, because a
 * dropped argument is an actuator called with arguments nobody wrote.
 *
 * Every binding, step and args row carries an `editId`: a DRAFT-LOCAL
 * identity (React keys), never sent.
 */
import {
  NC_ACTION_BUTTON_ID_MAX,
  NC_ACTION_BUTTON_LABEL_MAX,
  NC_ACTION_BUTTONS_MAX,
  NC_ACTION_WAIT_MAX_SEC,
  NC_HOOK_BINDINGS_MAX,
  type NcActionBinding,
  type NcRuleAction,
  type NcRuleActions,
  type NcRuleNotificationButton,
} from '../../data/notification-center.js'

export type NcArgValueType = 'string' | 'number' | 'boolean' | 'json'

/** A draft-local identity (sibling-unique), never sent — see the header. */
export type NcEditId = string

export interface NcArgRow {
  readonly editId: NcEditId
  readonly key: string
  readonly type: NcArgValueType
  /** Exactly what the operator typed — never re-derived from the parsed value. */
  readonly text: string
}

export interface NcActionStepForm {
  readonly editId: NcEditId
  readonly kind: 'wait' | 'cap'
  /** `wait` only. */
  readonly seconds: number
  /** `cap` only — `undefined` until a device is picked. */
  readonly deviceId: number | undefined
  readonly cap: string
  readonly method: string
  readonly args: readonly NcArgRow[]
}

/** The hook edges a rule's actions run on, in the order the editor shows them. */
export type NcHookKey = 'onActivation' | 'onDeactivation' | 'onTrigger' | 'onTriggerOff'

export const NC_HOOK_KEYS: readonly NcHookKey[] = ['onActivation', 'onDeactivation', 'onTrigger', 'onTriggerOff']

/** One binding as edited: a shared sequence by id (blank until picked), or one inline step. */
export type NcBindingForm =
  | { readonly editId: NcEditId; readonly kind: 'sequence'; readonly sequenceId: string }
  | { readonly editId: NcEditId; readonly kind: 'do'; readonly step: NcActionStepForm }

export interface NcActionsFormState {
  readonly onActivation: readonly NcBindingForm[]
  readonly onDeactivation: readonly NcBindingForm[]
  readonly onTrigger: readonly NcBindingForm[]
  readonly onTriggerOff: readonly NcBindingForm[]
  /** As on the wire; `sequenceId` may be blank while the draft is being written. */
  readonly buttons: readonly NcRuleNotificationButton[]
}

export type NcArgParse =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly errorKey: string }

export interface NcArgRowError {
  readonly index: number
  readonly errorKey: string
}

export interface NcRowsToArgs {
  /** Absent when there are no rows — and when any row is in error. */
  readonly args?: Record<string, unknown>
  readonly errors: readonly NcArgRowError[]
}

export interface NcFormToActions {
  /** Absent when nothing is authored (never `{}`) — and when there are errors. */
  readonly actions?: NcRuleActions
  /** Distinct error KEYS, for a list that names each kind once. */
  readonly errors: readonly string[]
  /** Every problem INSTANCE (two unpicked sequences are two) — for a count. */
  readonly problemCount: number
}

const ERR = 'v2.nc.rules.actions'

/** `${prefix}${n}` with n one past the highest suffix among `siblings`. */
export function nextEditId(prefix: string, siblings: readonly { readonly editId: NcEditId }[]): NcEditId {
  let max = 0
  for (const { editId } of siblings) {
    if (!editId.startsWith(prefix)) continue
    const n = Number(editId.slice(prefix.length))
    if (Number.isInteger(n) && n > max) max = n
  }
  return `${prefix}${max + 1}`
}

export const NC_BINDING_ID_PREFIX = 'b'
export const NC_STEP_ID_PREFIX = 't'
export const NC_ARG_ID_PREFIX = 'a'

function withIds<T>(items: readonly T[], prefix: string): readonly (T & { readonly editId: NcEditId })[] {
  return items.map((item, index) => ({ ...item, editId: `${prefix}${index + 1}` }))
}

export const NC_ACTIONS_EMPTY_FORM: NcActionsFormState = {
  onActivation: [],
  onDeactivation: [],
  onTrigger: [],
  onTriggerOff: [],
  buttons: [],
}

export function parseArgRow(row: NcArgRowBody): NcArgParse {
  switch (row.type) {
    case 'string':
      return { ok: true, value: row.text }
    case 'number': {
      const trimmed = row.text.trim()
      const value = Number(trimmed)
      return trimmed.length > 0 && Number.isFinite(value)
        ? { ok: true, value }
        : { ok: false, errorKey: `${ERR}.args.invalidNumber` }
    }
    case 'boolean': {
      const trimmed = row.text.trim()
      if (trimmed === 'true') return { ok: true, value: true }
      if (trimmed === 'false') return { ok: true, value: false }
      return { ok: false, errorKey: `${ERR}.args.invalidBoolean` }
    }
    case 'json':
      try {
        const value: unknown = JSON.parse(row.text)
        return { ok: true, value }
      } catch {
        return { ok: false, errorKey: `${ERR}.args.invalidJson` }
      }
  }
}

type NcArgRowBody = Omit<NcArgRow, 'editId'>

function rowFor(key: string, value: unknown): NcArgRowBody {
  if (typeof value === 'number') return { key, type: 'number', text: String(value) }
  if (typeof value === 'boolean') return { key, type: 'boolean', text: String(value) }
  if (typeof value === 'string') return { key, type: 'string', text: value }
  return { key, type: 'json', text: JSON.stringify(value) }
}

export function argsToRows(args: Readonly<Record<string, unknown>> | undefined): readonly NcArgRow[] {
  if (args === undefined) return []
  return withIds(
    Object.entries(args).map(([key, value]) => rowFor(key, value)),
    NC_ARG_ID_PREFIX,
  )
}

export function rowsToArgs(rows: readonly NcArgRowBody[]): NcRowsToArgs {
  const errors: NcArgRowError[] = []
  const args: Record<string, unknown> = {}
  const seen = new Set<string>()
  rows.forEach((row, index) => {
    const key = row.key.trim()
    if (key.length === 0) {
      errors.push({ index, errorKey: `${ERR}.args.emptyKey` })
      return
    }
    if (seen.has(key)) {
      errors.push({ index, errorKey: `${ERR}.args.duplicateKey` })
      return
    }
    seen.add(key)
    const parsed = parseArgRow(row)
    if (parsed.ok) args[key] = parsed.value
    else errors.push({ index, errorKey: parsed.errorKey })
  })
  if (errors.length > 0 || rows.length === 0) return { errors }
  return { args, errors }
}

function stepToForm(action: NcRuleAction): Omit<NcActionStepForm, 'editId'> {
  return action.kind === 'wait'
    ? { kind: 'wait', seconds: action.seconds, deviceId: undefined, cap: '', method: '', args: [] }
    : {
        kind: 'cap',
        seconds: 0,
        deviceId: action.deviceId,
        cap: action.cap,
        method: action.method,
        args: argsToRows(action.args),
      }
}

function bindingToForm(binding: NcActionBinding, index: number): NcBindingForm {
  const editId = `${NC_BINDING_ID_PREFIX}${index + 1}`
  return binding.kind === 'sequence'
    ? { editId, kind: 'sequence', sequenceId: binding.sequenceId }
    : { editId, kind: 'do', step: { ...stepToForm(binding.action), editId: `${NC_STEP_ID_PREFIX}1` } }
}

/** Hydrate from a persisted rule. Absent reads as empty, not as a change. */
export function actionsToForm(actions: NcRuleActions | undefined): NcActionsFormState {
  if (actions === undefined) return NC_ACTIONS_EMPTY_FORM
  return {
    onActivation: (actions.onActivation ?? []).map(bindingToForm),
    onDeactivation: (actions.onDeactivation ?? []).map(bindingToForm),
    onTrigger: (actions.onTrigger ?? []).map(bindingToForm),
    onTriggerOff: (actions.onTriggerOff ?? []).map(bindingToForm),
    buttons: (actions.buttons ?? []).map((button) => ({ ...button })),
  }
}

function formToStep(step: NcActionStepForm, errors: string[]): NcRuleAction | undefined {
  if (step.kind === 'wait') {
    if (!(step.seconds >= 0 && step.seconds <= NC_ACTION_WAIT_MAX_SEC)) {
      errors.push(`${ERR}.waitOutOfRange`)
      return undefined
    }
    return { kind: 'wait', seconds: step.seconds }
  }
  const cap = step.cap.trim()
  const method = step.method.trim()
  if (step.deviceId === undefined) errors.push(`${ERR}.stepMissingDevice`)
  if (cap.length === 0 || method.length === 0) errors.push(`${ERR}.stepMissingMethod`)
  const built = rowsToArgs(step.args)
  for (const error of built.errors) errors.push(error.errorKey)
  if (step.deviceId === undefined || cap.length === 0 || method.length === 0 || built.errors.length > 0) {
    return undefined
  }
  return {
    kind: 'cap',
    deviceId: step.deviceId,
    cap,
    method,
    ...(built.args !== undefined ? { args: built.args } : {}),
  }
}

function formToBinding(binding: NcBindingForm, errors: string[]): NcActionBinding | undefined {
  if (binding.kind === 'sequence') {
    const sequenceId = binding.sequenceId.trim()
    if (sequenceId.length === 0) {
      errors.push(`${ERR}.bindingMissingSequence`)
      return undefined
    }
    return { kind: 'sequence', sequenceId }
  }
  const action = formToStep(binding.step, errors)
  return action === undefined ? undefined : { kind: 'do', action }
}

function formToHook(bindings: readonly NcBindingForm[], errors: string[]): readonly NcActionBinding[] {
  if (bindings.length > NC_HOOK_BINDINGS_MAX) errors.push(`${ERR}.tooManyBindings`)
  return bindings
    .map((binding) => formToBinding(binding, errors))
    .filter((binding): binding is NcActionBinding => binding !== undefined)
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
    if (button.sequenceId.trim().length === 0) errors.push(`${ERR}.buttonMissingSequence`)
  }
}

/**
 * Back to the wire shape. Every problem is reported (not just the first), and
 * any problem means NO actions — a partial block would silently drop the
 * broken binding on save. A binding to a sequence the hub does not list is NOT
 * an error here (the hub accepts it, and the list may simply not have been
 * read); the editor warns about it through {@link unknownSequenceRefs}.
 */
export function formToActions(form: NcActionsFormState): NcFormToActions {
  const errors: string[] = []
  const hooks = {
    onActivation: formToHook(form.onActivation, errors),
    onDeactivation: formToHook(form.onDeactivation, errors),
    onTrigger: formToHook(form.onTrigger, errors),
    onTriggerOff: formToHook(form.onTriggerOff, errors),
  }
  buttonErrors(form.buttons, errors)
  const unique = [...new Set(errors)]
  if (unique.length > 0) return { errors: unique, problemCount: errors.length }
  const buttons = form.buttons.map((button) => ({ ...button, sequenceId: button.sequenceId.trim() }))
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

/** How many bindings the form carries across every hook edge. */
export function bindingCount(form: NcActionsFormState): number {
  return NC_HOOK_KEYS.reduce((sum, key) => sum + form[key].length, 0)
}

/**
 * The sequence ids the form points at (bindings and buttons) that the hub's
 * ANSWERED list does not carry — the admin's `unknown-sequence` warning. A
 * button bound to one is dropped from the notification by the dispatcher; a
 * binding to one never runs. Blank ids are the save's error, not this.
 */
export function unknownSequenceRefs(
  form: NcActionsFormState,
  knownIds: ReadonlySet<string>,
): readonly string[] {
  const out = new Set<string>()
  for (const key of NC_HOOK_KEYS) {
    for (const binding of form[key]) {
      const id = binding.kind === 'sequence' ? binding.sequenceId.trim() : ''
      if (id.length > 0 && !knownIds.has(id)) out.add(id)
    }
  }
  for (const button of form.buttons) {
    const id = button.sequenceId.trim()
    if (id.length > 0 && !knownIds.has(id)) out.add(id)
  }
  return [...out]
}

/**
 * Every step the form can actuate, with sequence bindings and buttons resolved
 * through the shared list (an unresolvable id contributes nothing) — the
 * admin's `formStepsForSnooze`, for the snooze-exempt derivation.
 */
export function formActionSteps(
  form: NcActionsFormState,
  sequenceActionsOf: (sequenceId: string) => readonly NcRuleAction[] | undefined,
): readonly NcRuleAction[] {
  const out: NcRuleAction[] = []
  for (const key of NC_HOOK_KEYS) {
    for (const binding of form[key]) {
      if (binding.kind === 'sequence') out.push(...(sequenceActionsOf(binding.sequenceId) ?? []))
      else {
        const step = formToStep(binding.step, [])
        if (step !== undefined) out.push(step)
      }
    }
  }
  for (const button of form.buttons) out.push(...(sequenceActionsOf(button.sequenceId) ?? []))
  return out
}

/** The same over a STORED rule's actions — what the rules list reads. */
export function storedActionSteps(
  actions: NcRuleActions | undefined,
  sequenceActionsOf: (sequenceId: string) => readonly NcRuleAction[] | undefined,
): readonly NcRuleAction[] {
  if (actions === undefined) return []
  const out: NcRuleAction[] = []
  for (const key of NC_HOOK_KEYS) {
    for (const binding of actions[key] ?? []) {
      if (binding.kind === 'do') out.push(binding.action)
      else out.push(...(sequenceActionsOf(binding.sequenceId) ?? []))
    }
  }
  for (const button of actions.buttons ?? []) out.push(...(sequenceActionsOf(button.sequenceId) ?? []))
  return out
}

/** Does a stored actions block SAY anything — a binding on any edge, or a button? */
export function storedActionsAreSet(actions: NcRuleActions | undefined): boolean {
  if (actions === undefined) return false
  return NC_HOOK_KEYS.some((key) => (actions[key]?.length ?? 0) > 0) || (actions.buttons?.length ?? 0) > 0
}
