/**
 * rule-editor — pure, RN-free form helpers behind the catalog-driven personal
 * rule editor (B5). A rule is authored as {@link NcRuleFormState}; these helpers
 * seed a blank form, hydrate one from a persisted {@link NcRule}, validate it,
 * and serialize it into the wire {@link NcRuleInput} the bridge accepts.
 *
 * Split out of the React components (mirroring B3's `target-form.ts` and the
 * admin `notification-rules.helpers.ts`) so the value-shaping — condition
 * pruning, delivery-applicability filtering, own-target constraint, template
 * omission — is unit-tested directly in the repo's node test env.
 *
 * Ownership discipline (spec §5): {@link formToInput} NEVER writes
 * `ownerUserId` — personal-rule ownership is server-stamped from the forwarded
 * identity, never trusted from a client. It also constrains `targets` to the
 * caller's OWN target ids (re-validated server-side anyway) so a foreign/unknown
 * id can never ride along. The server remains the validation authority.
 */
// `@camstack/types` is a RUNTIME import here (`DeviceType` feeds
// `NC_DEVICE_TYPE_OPTIONS` below). Which filter speaks about which system-event
// kind is read from it too, never restated — see `familyFilterVisibility` in
// `system-event-family.ts`, the one viewer reader of that scoping.
import {
  conditionVisibleForKind,
  DeviceType,
  droppedConditionsForKind,
  NC_GROUPING_DEFAULT_SEC,
  NC_GROUPING_MAX_SEC,
  NC_GROUPING_MIN_SEC,
  ruleGroupingApplies,
  ruleKindOf,
  ruleKindSpec,
  systemFamilyOfKind,
} from '@camstack/types/client'
import type { NcDroppedCondition, NcRuleKind } from '@camstack/types'
import { pruneSystemEventForFamily } from './system-event-family.js'
import { reconcileOccupancyClasses } from './occupancy-condition.js'
import { linkedCamerasApplies } from './rule-field-choices.js'
import {
  NC_MEDIA_IMAGE_MODES,
  normalizeMediaPolicy,
  resolveNcMediaImage,
  subjectPathDrawable,
  triggerZoneDrawable,
} from './rule-media-image.js'
import {
  actionsToForm,
  formToActions,
  NC_ACTIONS_EMPTY_FORM,
  storedActionsAreSet,
  type NcActionsFormState,
} from './rule-action-form.js'
import {
  confirmToForm,
  formToConfirm,
  NC_CONFIRM_FORM_DEFAULT,
  type NcConfirmFormState,
} from './rule-confirm-form.js'
import { isAuthoredEmptyScope } from './recognition-scope.js'
import { ruleScopeDraftOf, type RuleScopeDraft } from './rule-scope-model.js'
import { formScopedConditions, splitRuleScopes } from './rule-scope-form.js'
import { withDeliveryChange } from './rule-kind-nav.js'
import { pruneSensorTransition, sensorTransitionDrop } from './sensor-transition.js'
import {
  isStateSummaryForm,
  summaryFormProblems,
  systemEventDeliveryForSave,
  type NcSummaryFormProblem,
} from './system-event-delivery.js'
import {
  NcConditionsSchema,
  type NcCamProfile,
  type NcConditionDescriptor,
  type NcConditions,
  type NcConfirmExpect,
  type NcDelivery,
  type NcMediaImage,
  type NcMediaPolicy,
  type NcRule,
  type NcRuleClearableKey,
  type NcRuleInput,
  type NcRuleTarget,
  type NcSchedule,
  type NcSystemEventDelivery,
  type NcSystemEventKind,
} from '../../data/notification-center.js'
import {
  ownershipSafeTargets,
  savedTargetIds,
  targetOwnershipPolicy,
  type TargetSaveContext,
} from './target-ownership.js'

/** Per-target passthrough params, keyed by `targetId`. Carried across an edit —
 *  never authored here — so params set elsewhere are not dropped. */
export type NcTargetParamsMap = Readonly<Record<string, Readonly<Record<string, unknown>>>>

/** The editable form state for one rule. */
export interface NcRuleFormState {
  readonly name: string
  readonly enabled: boolean
  readonly delivery: NcDelivery
  readonly targetIds: readonly string[]
  /** Preserved per-target passthrough params — carried verbatim, not authored. */
  readonly targetParams: NcTargetParamsMap
  readonly priority: number
  /** The WHOLE media policy — the picture mode (D897), the trigger-zone
   *  outline, gif/clip and their roll seconds, and the footage profile. A
   *  stored rule is read through `normalizeMediaPolicy` (the legacy
   *  attach/frame/zoneCrop triple folded into `image`); an absent `image` is
   *  the kind's default (`resolveNcMediaImage`). Every other field is
   *  absent-means-default, and the editor only writes one the operator moved. */
  readonly media: NcMediaPolicy
  readonly templateTitle: string
  readonly templateBody: string
  /** Authored conditions (all-optional); empties are pruned at build time —
   *  EXCEPT the authored-empty recognition scopes (see `recognition-scope.ts`).
   *  NEVER the scope lists (`devices`, `classes`, `zones`, `identities`,
   *  `labelEquals` and their exclusions): those live in the `*Scope` drafts
   *  and a save projects them back (`rule-scope-form.ts`, D641). */
  readonly conditions: NcConditions
  /**
   * The device scope (D641): "All | Only these | All except these" over
   * `conditions.devices` / `conditions.devicesExclude`. The mode is derived
   * when the rule is opened, never stored.
   */
  readonly deviceScope: RuleScopeDraft<number>
  /** The detection-class scope, the same pre-selector over `classes` / `classesExclude`. */
  readonly classScope: RuleScopeDraft<string>
  /** The zone scope — `zones.ids` / `zonesExclude`, the same control. */
  readonly zoneScope: RuleScopeDraft<string>
  /** The face scope — `identities` / `identitiesExclude`; an empty Only list is "any known face". */
  readonly identityScope: RuleScopeDraft<string>
  /** The label scope — `labelEquals` (Only; the hub has no label exclusion). */
  readonly labelScope: RuleScopeDraft<string>
  /** Weekly schedule windows (rule-level, `schedule` catalog group). */
  readonly schedule: NcSchedule | undefined
  /**
   * A `device-events` / `system` rule's delivery (D647): absent / instant = a
   * notification per event, summary = the current state at set times. Held
   * as stored, so a rule authored before D647 saves back WITHOUT the key; the
   * active-hours {@link schedule} is kept beside a summary (switching back to
   * Instant restores it) but never sent with one.
   */
  readonly systemEventDelivery: NcSystemEventDelivery | undefined
  /** USERS the rule addresses besides its targets. ADMIN-ONLY: authored, sent
   *  and cleared only by an admin (see {@link FormToInputOptions.isAdmin}). */
  readonly targetUsers: readonly string[]
  /** `throttle.cooldownSec` — the scope and granularity ride along unauthored. */
  readonly cooldownSec: number
  /** The snooze buttons. `undefined` = the hub's defaults, `[]` = none. */
  readonly snoozeOptions: readonly number[] | undefined
  /** May a non-admin snooze this rule for everyone. Absent and `false` agree. */
  readonly snoozeAllowGlobal: boolean
  /**
   * Ask the recipient to confirm the detection (`askVerdict`). `undefined` =
   * never authored (absent on the wire); `false` is sent once a rule had it on,
   * so the hub's merge turns it off. Sent only where {@link verdictApplies}.
   */
  readonly askVerdict: boolean | undefined
  /**
   * The window of an "Immediate, grouped" rule, in seconds (D692); `undefined` is
   * plain Immediate. Meaningful only while the rule is an `immediate` DETECTION
   * rule ({@link groupingIsSent}): the save drops it, and `clear` removes a
   * stored one, everywhere else — so a value left behind by a trigger the
   * operator moved away from is never sent. Held even out of range so the
   * stepper can be walked; {@link ruleFormProblems} blocks the save.
   */
  readonly groupingSec: number | undefined
  /** The AI confirm gate. */
  readonly confirm: NcConfirmFormState
  /** Device actions + notification buttons. ADMIN-ONLY, like `targetUsers`. */
  readonly actions: NcActionsFormState
}

/** The cooldown a rule gets when nobody said otherwise (the hub's P1 default). */
export const NC_DEFAULT_COOLDOWN_SEC = 60

/** A blank form for the "New rule" flow. */
export function emptyRuleForm(): NcRuleFormState {
  return {
    name: '',
    enabled: true,
    delivery: 'immediate',
    targetIds: [],
    targetParams: {},
    priority: 3,
    media: {},
    templateTitle: '',
    templateBody: '',
    conditions: {},
    deviceScope: ruleScopeDraftOf<number>(undefined, undefined),
    classScope: ruleScopeDraftOf<string>(undefined, undefined),
    zoneScope: ruleScopeDraftOf<string>(undefined, undefined),
    identityScope: ruleScopeDraftOf<string>(undefined, undefined),
    labelScope: ruleScopeDraftOf<string>(undefined, undefined),
    schedule: undefined,
    systemEventDelivery: undefined,
    targetUsers: [],
    cooldownSec: NC_DEFAULT_COOLDOWN_SEC,
    snoozeOptions: undefined,
    snoozeAllowGlobal: false,
    askVerdict: undefined,
    // Plain Immediate: grouping is a deliberate choice on the trigger.
    groupingSec: undefined,
    confirm: NC_CONFIRM_FORM_DEFAULT,
    actions: NC_ACTIONS_EMPTY_FORM,
  }
}

/** Hydrate the form from a persisted rule (the "Edit" flow). */
export function inputToForm(rule: NcRule): NcRuleFormState {
  const targetParams: Record<string, Readonly<Record<string, unknown>>> = {}
  for (const target of rule.targets) {
    if (target.params && Object.keys(target.params).length > 0) {
      targetParams[target.targetId] = target.params
    }
  }
  return {
    name: rule.name,
    enabled: rule.enabled,
    delivery: rule.delivery,
    targetIds: rule.targets.map((target) => target.targetId),
    targetParams,
    priority: rule.priority,
    media: normalizeMediaPolicy(rule.media, rule),
    templateTitle: rule.template?.title ?? '',
    templateBody: rule.template?.body ?? '',
    ...splitRuleScopes(rule.conditions),
    schedule: rule.schedule,
    systemEventDelivery: rule.systemEventDelivery,
    targetUsers: rule.targetUsers ?? [],
    cooldownSec: rule.throttle.cooldownSec,
    snoozeOptions: rule.snoozeOptions,
    snoozeAllowGlobal: rule.snoozeAllowGlobal === true,
    askVerdict: rule.askVerdict,
    groupingSec: rule.groupingSec,
    confirm: confirmToForm(rule.confirm),
    actions: actionsToForm(rule.actions),
  }
}

/** A field that blocks a save. The summary ones are the hub's D647 verdict. */
export type RuleFormProblem =
  | 'name'
  | 'targets'
  | 'actions'
  | 'groupingSec'
  | 'groupedConfirm'
  | NcSummaryFormProblem

/** Who is judging the form — see {@link ruleFormProblems}. */
export interface RuleFormProblemOptions {
  /** A CONFIRMED admin. Absent = not admin. */
  readonly isAdmin?: boolean
  /**
   * The caller's targets, once known (`targetSaveContext`). The `targets`
   * problem then counts what the save will SEND, not ids it will drop (m3).
   */
  readonly targets?: TargetSaveContext
}

/**
 * Everything that blocks a save, named — the ONE authority {@link isRuleFormValid}
 * derives from.
 *
 *  - `targets`: the hub needs at least one ADDRESSEE — a target or a user.
 *  - `actions`: an actions block that does not parse — for an ADMIN only. An
 *    admin's save would neither send it (a partial block drops the broken
 *    sequence) nor clear it. A non-admin neither sends nor clears actions at
 *    all, cannot open the Actions screen, and must not be locked out of their
 *    own rule by an admin-wired block they can neither see nor fix.
 *  - `groupingSec` / `groupedConfirm` (D692): the two choices the hub's save
 *    guard refuses on a GROUPED rule — a window outside 5..60, and an AI
 *    confirm expecting more than one subject (a tile judges ONE picture, so it
 *    would never send). Said before the save; judged only while the rule is
 *    grouped, because anywhere else the window is not sent. The confirm is read
 *    off the form, which holds the STORED rule's confirm until the operator
 *    changes it.
 */
export function ruleFormProblems(
  form: NcRuleFormState,
  options: RuleFormProblemOptions = {},
): readonly RuleFormProblem[] {
  const problems: RuleFormProblem[] = []
  if (form.name.trim().length === 0) problems.push('name')
  if (savedTargetIds(form.targetIds, options.targets).length === 0 && form.targetUsers.length === 0) {
    problems.push('targets')
  }
  if (options.isAdmin === true && formToActions(form.actions).errors.length > 0) problems.push('actions')
  if (groupingIsSent(form)) {
    const seconds = form.groupingSec
    if (
      seconds !== undefined &&
      (!Number.isInteger(seconds) || seconds < NC_GROUPING_MIN_SEC || seconds > NC_GROUPING_MAX_SEC)
    ) {
      problems.push('groupingSec')
    }
    const confirm = formToConfirm(form.confirm)
    if (confirm?.enabled === true && confirm.expect !== undefined && !expectationMetByOneSubject(confirm.expect)) {
      problems.push('groupedConfirm')
    }
  }
  // Said BEFORE the save rather than read back as the hub's refusal.
  problems.push(...summaryFormProblems(form, { isAdmin: options.isAdmin === true }))
  return problems
}

/** True when the form can be saved. */
export function isRuleFormValid(form: NcRuleFormState, options: RuleFormProblemOptions = {}): boolean {
  return ruleFormProblems(form, options).length === 0
}

/**
 * Does THIS form send a `groupingSec`? Only an `immediate` DETECTION rule that
 * holds one ({@link ruleGroupingApplies}, the predicate the hub's save guard and
 * the admin editor read). The single place the save, the problems and the
 * choice consult, so the three cannot disagree about which rules are grouped.
 * Judged on the scoped conditions, like every other rule-kind question here.
 */
export function groupingIsSent(
  form: NcRuleFormState,
): boolean {
  return form.groupingSec !== undefined && ruleGroupingApplies({ delivery: form.delivery, conditions: formScopedConditions(form) })
}

/**
 * Is an AI-confirm expectation met by a count of ONE subject? A mirror of the
 * engine's `satisfies(1, expect)` (`confirm-gate.ts`), which the app cannot
 * import. `>=` is the default arm there too: an unknown comparison reads as "at
 * least", the one reading that cannot silence a camera.
 */
function expectationMetByOneSubject(expect: NcConfirmExpect): boolean {
  switch (expect.op) {
    case '>':
      return 1 > expect.count
    case '<=':
      return 1 <= expect.count
    case '<':
      return 1 < expect.count
    case '==':
      return 1 === expect.count
    default:
      return 1 >= expect.count
  }
}

// ── The trigger CHOICE (D692 §10) ───────────────────────────────────

/**
 * What the trigger select offers: every {@link NcDelivery} plus the grouped
 * presentation of `immediate`. `immediate-grouped` is UI-only — it is saved as
 * `delivery: 'immediate'` plus `groupingSec`, and `NcDelivery` does not change.
 * (The admin's `deliveryChoiceOf` / `applyDeliveryChoice`, by the same names.)
 */
export type NcDeliveryChoice = NcDelivery | 'immediate-grouped'

/** One entry of the trigger choice list; `label` is an i18n key suffix under `v2.nc.rules.editor`. */
export interface NcDeliveryChoiceOption {
  readonly value: NcDeliveryChoice
  /** Key under `v2.nc.rules.editor`. */
  readonly labelKey: string
}

/**
 * Which choice a form currently IS. Grouped only while the rule can group: a
 * leftover `groupingSec` on a track-end or sound rule is not a choice, and is
 * never sent.
 */
/**
 * Does the rule report a track, so there is a detection to ask about? A mirror
 * of the admin's `verdictApplies` (`rule-form-state.ts`): a flag left on the
 * form by a trigger the operator moved away from must not reach the hub.
 */
export function verdictApplies(form: Pick<NcRuleFormState, 'delivery'>): boolean {
  return form.delivery === 'immediate' || form.delivery === 'track-end'
}

export function deliveryChoiceOf(
  form: NcRuleFormState,
): NcDeliveryChoice {
  return groupingIsSent(form) ? 'immediate-grouped' : form.delivery
}

/**
 * The trigger choices of a DETECTION rule, in authoring order — `immediate`,
 * then its grouped presentation, then `track-end` — plus the form's own trigger
 * when it is none of those (a stored package-event rule still shows it).
 *
 * The grouped option is hidden wherever `ruleGroupingApplies` refuses it,
 * evaluated as if the rule were `immediate`, because choosing it makes it so; a
 * sound rule (its `audio` condition) is refused by the predicate itself, and a
 * form on any non-detection trigger never sees it.
 */
export function deliveryChoicesFor(
  form: NcRuleFormState,
): readonly NcDeliveryChoiceOption[] {
  const groupable =
    (form.delivery === 'immediate' || form.delivery === 'track-end') &&
    ruleGroupingApplies({ delivery: 'immediate', conditions: formScopedConditions(form) })
  const choices: readonly NcDeliveryChoiceOption[] = [
    { value: 'immediate', labelKey: 'delivery.immediate' },
    ...(groupable ? [{ value: 'immediate-grouped' as const, labelKey: 'grouping.choice' }] : []),
    { value: 'track-end', labelKey: 'delivery.trackEnd' },
  ]
  if (choices.some((choice) => choice.value === form.delivery)) return choices
  const own = NC_DELIVERY_OPTIONS.find((option) => option.value === form.delivery)
  return own === undefined ? choices : [...choices, { value: own.value, labelKey: `delivery.${own.label}` }]
}

/** Narrow a raw select value to a known choice (no cast); `undefined` for a stray one. */
export function parseDeliveryChoice(value: string): NcDeliveryChoice | undefined {
  return value === 'immediate-grouped' ? value : parseDelivery(value)
}

/**
 * The form patch for a changed trigger CHOICE. `immediate-grouped` is
 * `immediate` plus the window — kept if the operator already chose one, else
 * {@link NC_GROUPING_DEFAULT_SEC}. Every other choice is a plain delivery,
 * through {@link withDeliveryChange} (the detection seed's pipeline source never
 * follows the rule onto a non-detection trigger), and forgets the window: the
 * hub refuses `groupingSec` on a rule that cannot group.
 */
export function applyDeliveryChoice(
  form: Pick<NcRuleFormState, 'groupingSec' | 'conditions'>,
  choice: NcDeliveryChoice,
): Pick<NcRuleFormState, 'delivery' | 'conditions' | 'groupingSec'> {
  if (choice === 'immediate-grouped') {
    return { ...withDeliveryChange(form, 'immediate'), groupingSec: form.groupingSec ?? NC_GROUPING_DEFAULT_SEC }
  }
  return { ...withDeliveryChange(form, choice), groupingSec: undefined }
}

/** True when the descriptor applies to the rule's current trigger. */
export function conditionApplies(descriptor: NcConditionDescriptor, delivery: NcDelivery): boolean {
  return descriptor.appliesTo.includes(delivery)
}

// ── The rule's KIND ─────────────────────────────────────────────────
//
// `delivery` alone cannot answer what a rule IS. Two features have no delivery
// of their own — an occupancy rule is `device-event` carrying
// `conditions.occupancy`, a sound rule is `immediate` carrying
// `conditions.audio` — and the ENGINE discriminates them on that condition. So
// the editor asks the shared model (`@camstack/types`), which is the same table
// the admin UI reads: which fields the kind can use, each exclusion carrying the
// engine reason, and whether the kind's subject owns a frame at all.
//
// Before this, the viewer filtered on `appliesTo` alone and offered an occupancy
// rule `sensorKinds`, `eventTypeTokens` and `source` — three fields the engine
// fails closed on for that subject, so the rule sat enabled, in the list, and
// permanently silent.

/** What kind of rule is this form authoring? */
export function ruleFormKind(form: NcRuleFormState): NcRuleKind {
  return ruleKindOf(form)
}

/**
 * Conditions the form CARRIES that its kind cannot use — what Save will drop.
 *
 * Shown next to Save rather than applied silently. Every entry is a condition
 * the engine fails closed on for this subject, so the rule is currently enabled
 * and permanently silent: keeping it keeps it silent, and dropping it is what
 * makes the rule fire again. Saying nothing about the drop is the third option,
 * and it is the one this repo has paid for before.
 *
 * {@link formToInput} drops exactly this set — the spec asserts the pair, in
 * both directions. A warning naming a field the save keeps trains the operator
 * to ignore it; a save dropping one the warning did not name is the silent
 * rewrite the warning exists to prevent.
 */
export function droppedRuleConditions(form: NcRuleFormState): readonly NcDroppedCondition[] {
  const kind = ruleFormKind(form)
  // Judged on what the form MEANS, scope axes included (D641): a sound rule
  // carrying a class scope must SAY it drops it.
  const byKind = droppedConditionsForKind(formScopedConditions(form), kind)
  // D640: a sensor rule carrying "Notify when" over a kind with no raise.
  const edge = sensorTransitionDrop(form.conditions, kind)
  return edge === null ? byKind : [...byKind, edge]
}

/**
 * The i18n key for a drop reason.
 *
 * The reason SENTENCE is the shared model's and is rendered through
 * `defaultValue`, so `en.json` holds no second copy of a sentence the hoist
 * exists to keep single. The key is here so a translation can be added without
 * touching code.
 */
export function dropReasonKey(kind: NcRuleKind, conditionId: string): string {
  return `v2.nc.rules.editor.dropReason.${kind}.${conditionId}`
}

/**
 * Is an authored condition value effectively unset (→ omit from the wire)?
 *  - `undefined` / `null` / empty array → unset
 *  - empty string, or `sourceSelect` = `any` → unset
 *  - a finite number → SET (0 is a legitimate authored threshold)
 *  - a `zoneSelection`/`plateMatcher` object with no ids/values → unset
 *
 * VALUE-ONLY, deliberately: two keys (`identities`, `plates`) give an empty list
 * a MEANING of its own, and they are excepted by KEY in {@link buildConditions}
 * via `isAuthoredEmptyScope` — not by teaching this predicate about them, which
 * would silently change what "empty" means for the auto-expand check and every
 * future caller.
 */
export function isConditionValueEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'string') return value.length === 0 || value === 'any'
  if (typeof value === 'number') return !Number.isFinite(value)
  if (typeof value === 'object') {
    if ('ids' in value) {
      const ids = value.ids
      return !Array.isArray(ids) || ids.length === 0
    }
    if ('values' in value) {
      const values = value.values
      return !Array.isArray(values) || values.length === 0
    }
    return false
  }
  return false
}

/**
 * Prune authored conditions to the wire shape: keep only keys the operator
 * touched (non-empty) AND whose descriptor applies to the current trigger.
 * Switching the trigger therefore drops conditions that no longer apply.
 * With an empty catalog every touched key is kept (nothing to judge against).
 * The result is re-parsed through {@link NcConditionsSchema} so it is a
 * genuinely-typed `NcConditions` with no cast.
 *
 * The occupancy × classes reconcile runs here, and here only: this is the ONE
 * funnel every save passes through, so no path can persist the pairing that
 * silently ANDs itself into a rule that never fires.
 *
 * The same funnel is why the authored-empty exception lives here: `identities:
 * []` ("only known faces") and `plates: { values: [] }` ("any readable plate")
 * are empty AND authored, and every save used to drop them — so opening a rule
 * on the phone and tapping Save widened it to "anybody" / "any vehicle" without
 * a word. See `recognition-scope.ts`.
 */
export function buildConditions(
  conditions: NcConditions,
  delivery: NcDelivery,
  catalog: readonly NcConditionDescriptor[],
  kind: NcRuleKind = ruleKindOf({ delivery, conditions }),
): NcConditions {
  const applicableIds =
    catalog.length === 0
      ? null
      : new Set(
          catalog
            .filter(
              (descriptor) =>
                descriptor.id !== 'schedule' &&
                // The trigger AND the kind. `appliesTo` alone kept the three
                // `device-event` fields an occupancy rule can never satisfy, so
                // the rule was saved carrying a filter the engine fails closed
                // on — enabled, listed, and permanently silent.
                conditionVisibleForKind(descriptor, delivery, kind),
            )
            .map((descriptor) => descriptor.id),
        )
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(conditions)) {
    if (applicableIds !== null && !applicableIds.has(key)) continue
    if (isConditionValueEmpty(value) && !isAuthoredEmptyScope(key, value)) continue
    out[key] = value
  }
  return reconcileOccupancyClasses(NcConditionsSchema.parse(out))
}

/** True when the schedule carries at least one window (else it is omitted). */
export function scheduleHasWindows(schedule: NcSchedule | undefined): boolean {
  return schedule !== undefined && schedule.windows.length > 0
}

/** Options for {@link formToInput}. */
export interface FormToInputOptions {
  /** The caller's OWN target ids. Provided → `targets` is constrained to this
   *  set (foreign/unknown ids dropped). Absent → every target id is kept
   *  (defensive; the screen always supplies it). */
  readonly ownTargetIds?: readonly string[]
  /** The condition catalog — drives delivery-applicability pruning. */
  readonly catalog?: readonly NcConditionDescriptor[]
  /**
   * Fields not authored in the UI, carried verbatim across an edit.
   *
   * This is the strip-on-save trap, and it has already cost this rule set its
   * media policy once: the form does not model these, so anything not
   * re-emitted here is written back MISSING the moment someone opens the rule
   * on a phone and taps Save.
   *
   *  - `throttle` — its `scope` and `granularity` (the cooldown is authored).
   *    Required on the wire, so an absent one would be replaced by the P1
   *    default rather than merely dropped.
   */
  readonly preserve?: Pick<NcRule, 'throttle'>
  /**
   * Is the CALLER an admin? `actions` and `targetUsers` are admin-only on the
   * hub (a non-admin CHANGE or clear is refused; an unchanged echo is not). So
   * a non-admin neither sends nor clears them — the hub keeps what it stored —
   * and only an admin's form is the authority on them. Absent = not admin.
   */
  readonly isAdmin?: boolean
  /**
   * The rule as the hub STORED it (edit only). {@link ruleClearsFor} clears a
   * key only when the stored value MEANT something: a stored
   * `snoozeAllowGlobal: false` or a disabled all-defaults `confirm` is already
   * absent to the engine, and an untouched save must clear nothing. Absent =
   * judge by the form alone.
   */
  readonly stored?: Partial<NcRuleInput>
  /**
   * Is the hub KNOWN to keep a state summary (D647 — `hubKeepsSummaryDelivery`)?
   * Decides one clear: the stored active-hours `schedule` beside a summary.
   * A hub older than D647 applies the clear and STRIPS the summary, so the
   * rule would come back instant with its active hours gone — all day. Not
   * known (older hub, catalog unanswered) = not cleared: an older hub then
   * keeps the active hours with the rule it keeps instant, and a D647 hub
   * refuses the save by name, which is loud and loses nothing. Verified in
   * camstack-server (b33c00c30), all paths under
   * packages/addon-post-analysis/src/notification-center/ unless stated:
   *  - nc-actions.ts:1289 — `nc.updateRule` calls
   *    `guardPatchSystemEventDelivery(existing, patch, clear, {…})` (the cap
   *    route makes the same call at index.ts:4111);
   *  - rule-summary-guard.ts:71-73 — `mergedDeliverySubject` keeps
   *    `existing.schedule` when `!clear.includes('schedule')`;
   *  - rule-summary-guard.ts:126 — `if (existing === null) return`;
   *  - :127 — `const merged = mergedDeliverySubject(existing, patch, clear)`;
   *  - :128 — `if (merged === null) return` (the patch changes nothing judged);
   *  - :129 — `logRefusal(() => assertSystemEventDelivery(merged), ctx)`,
   *    which throws `NcSystemEventDeliveryRefusal`;
   *  - packages/types/src/notification/system-event-summary.ts:105 —
   *    `if (rule.schedule !== undefined) problems.push({ code:
   *    'schedule-beside-summary' })`, described as "a summary rule is sent on
   *    its summary schedule — remove the active-hours schedule".
   * `summary-old-hub-save.spec.ts` replays it through the published judge.
   * Absent = not known.
   */
  readonly hubKeepsSummary?: boolean
}

/**
 * Assemble the wire {@link NcRuleInput} from the form. Conditions are pruned to
 * touched + applicable keys; the schedule is emitted only when it has windows
 * and applies to the trigger; targets are constrained to the caller's own ids
 * with their preserved params re-attached; the template is omitted when both
 * fields are blank; `throttle` and `snoozeOptions` are preserved (P1 default /
 * absent for a new rule). `ownerUserId` is NEVER emitted — the server stamps it.
 *
 * `groupingSec` (D692) is written only while the rule is an `immediate` detection
 * rule that holds one ({@link groupingIsSent}); anywhere else it is absent and
 * `ruleClearsFor` removes a stored one. The two keys it replaced,
 * `waitForEnhancement` and `groupIdleSec`, are never emitted.
 */
export function formToInput(form: NcRuleFormState, options: FormToInputOptions = {}): NcRuleInput {
  const catalog = options.catalog ?? []
  const kind = ruleFormKind(form)
  const title = form.templateTitle.trim()
  const body = form.templateBody.trim()
  const template =
    title.length > 0 || body.length > 0
      ? {
          ...(title.length > 0 ? { title } : {}),
          ...(body.length > 0 ? { body } : {}),
        }
      : undefined

  const scheduleApplies =
    catalog.length === 0
      ? true
      : catalog.some((descriptor) => descriptor.id === 'schedule' && conditionApplies(descriptor, form.delivery))
  // A SUMMARY rule is sent on its summary schedule (D647); the hub refuses an
  // active-hours schedule beside it, so it is not sent (and a stored one is
  // cleared by `ruleClearsFor`, which sees it absent here).
  const schedule =
    !isStateSummaryForm(form) && scheduleApplies && scheduleHasWindows(form.schedule) ? form.schedule : undefined

  const confirm = formToConfirm(form.confirm)

  const targetFromForm = (targetId: string): NcRuleTarget => {
    const params = form.targetParams[targetId]
    return params && Object.keys(params).length > 0 ? { targetId, params } : { targetId }
  }
  // Ownership-safe (`target-ownership.ts`): for a confirmed ADMIN a stored
  // target outside his list rides through verbatim (he must not delete other
  // users' targets he is never shown); for anyone else it is dropped, because
  // the hub refuses a non-admin save that carries it.
  const targets = options.ownTargetIds
    ? ownershipSafeTargets(
        form.targetIds,
        options.stored?.targets ?? [],
        options.ownTargetIds,
        (id) => targetFromForm(id),
        targetOwnershipPolicy(options.isAdmin === true),
      )
    : form.targetIds.map(targetFromForm)

  const conditions = withFamilySystemEvent(
    pruneSensorTransition(
      buildConditions(formScopedConditions(form), form.delivery, catalog, kind),
      form.delivery,
      kind,
    ),
    kind,
  )

  return {
    name: form.name.trim(),
    enabled: form.enabled,
    delivery: form.delivery,
    // Both scope axes projected (D641): only the active mode's list is written,
    // and it passes the same trigger × kind gate as every other condition.
    // "Notify when" (D640) is pruned wherever it cannot apply — the set
    // `droppedRuleConditions` announced.
    conditions,
    ...(schedule ? { schedule } : {}),
    ...systemEventDeliveryForSave(form),
    targets,
    // ONE picture mode (D897), judged against the rule it is saved on: the
    // kind decides which modes exist (a sound is never a crop, a system event
    // has no picture) and the SAVED conditions decide whether a trigger zone
    // can be drawn. The hub refuses anything else, so nothing else is written —
    // the legacy attach/frame/zoneCrop triple included.
    media: pruneMediaPolicy(form.media, { kind, conditions }),
    throttle: {
      cooldownSec: form.cooldownSec,
      scope: options.preserve?.throttle.scope ?? 'rule-device',
      ...(options.preserve?.throttle.granularity !== undefined
        ? { granularity: options.preserve.throttle.granularity }
        : {}),
    },
    priority: form.priority,
    ...(template ? { template } : {}),
    // Absent stays absent (the hub decides), and `[]` stays `[]` (no buttons):
    // `!== undefined`, never truthiness, or "no buttons" becomes "the hub's".
    ...(form.snoozeOptions !== undefined ? { snoozeOptions: [...form.snoozeOptions] } : {}),
    ...(form.snoozeAllowGlobal ? { snoozeAllowGlobal: true } : {}),
    ...(form.askVerdict !== undefined && verdictApplies(form) ? { askVerdict: form.askVerdict } : {}),
    ...(groupingIsSent(form) && form.groupingSec !== undefined ? { groupingSec: form.groupingSec } : {}),
    ...(confirm !== undefined ? { confirm } : {}),
    ...adminOnlyFields(form, options.isAdmin === true),
  }
}

/**
 * A family rule's `systemEvent` with only the filters its family shows for its
 * kinds (D637) — an alarm rule's camera list without `alarm-triggered`, or a
 * device list on a system rule, never leaves the phone. A `mixed` rule has no
 * family and is read-only: it is sent as it stands.
 */
function withFamilySystemEvent(conditions: NcConditions, kind: NcRuleKind): NcConditions {
  const family = systemFamilyOfKind(kind)
  const systemEvent = conditions.systemEvent
  if (family === undefined || systemEvent === undefined) return conditions
  return { ...conditions, systemEvent: pruneSystemEventForFamily(family, systemEvent) }
}

/** The admin-only half of the input — nothing at all for a non-admin. */
function adminOnlyFields(
  form: NcRuleFormState,
  isAdmin: boolean,
): Pick<NcRuleInput, 'targetUsers' | 'actions'> {
  if (!isAdmin) return {}
  const { actions } = formToActions(form.actions)
  return {
    ...(form.targetUsers.length > 0 ? { targetUsers: [...form.targetUsers] } : {}),
    ...(actions !== undefined ? { actions } : {}),
  }
}

// The keys the phone authors — every one a real `NcRuleInput` field, so
// `input[key]` below indexes without a cast. The retired `waitForEnhancement` and
// `groupIdleSec` are NOT here: nothing authors them any more (D692).
const RULE_CLEARS_AUTHORED_KEYS = [
  'template',
  'schedule',
  'snoozeOptions',
  'snoozeAllowGlobal',
  'groupingSec',
  'confirm',
] as const satisfies readonly NcRuleClearableKey[]
/** Authored — and so cleared — only by an admin (the hub refuses the rest). */
const RULE_CLEARS_ADMIN_KEYS = ['targetUsers', 'actions'] as const satisfies readonly NcRuleClearableKey[]
type NcRuleClearsAuthoredKey =
  | (typeof RULE_CLEARS_AUTHORED_KEYS)[number]
  | (typeof RULE_CLEARS_ADMIN_KEYS)[number]

/**
 * The optional fields this editor authors and the form leaves empty — sent as
 * `clear` beside the patch. The hub merges a patch over the stored rule, so an
 * omitted key survives: empty the message, save, reopen, and it was back.
 *
 * `targetUsers` / `actions` only for an admin: a non-admin's clear of either is
 * refused by the hub. And never `actions` while the block does not parse — it
 * is then absent from the input for being BROKEN, not for being empty.
 */
export function ruleClearsFor(
  form: NcRuleFormState,
  options: FormToInputOptions = {},
): NcRuleClearsAuthoredKey[] {
  const input = formToInput(form, options)
  const actionsBroken = formToActions(form.actions).errors.length > 0
  const keys: readonly NcRuleClearsAuthoredKey[] = [
    ...RULE_CLEARS_AUTHORED_KEYS,
    ...(options.isAdmin === true ? RULE_CLEARS_ADMIN_KEYS : []),
  ]
  const stored = options.stored
  const keepsStoredSchedule = isStateSummaryForm(form) && options.hubKeepsSummary !== true
  return keys.filter(
    (key) =>
      input[key] === undefined &&
      !(key === 'schedule' && keepsStoredSchedule) &&
      !(key === 'actions' && actionsBroken) &&
      (stored === undefined || storedValueIsMeaningful(key, stored)),
  )
}

/** Did the stored rule SAY something under this key, or is it absent in all but name? */
function storedValueIsMeaningful(key: NcRuleClearsAuthoredKey, stored: Partial<NcRuleInput>): boolean {
  switch (key) {
    case 'template':
      return (stored.template?.title ?? '').trim().length > 0 || (stored.template?.body ?? '').trim().length > 0
    case 'schedule':
      return stored.schedule !== undefined && stored.schedule.windows.length > 0
    // `[]` MEANS something here ("no snooze buttons") — only absence does not.
    case 'snoozeOptions':
      return stored.snoozeOptions !== undefined
    case 'snoozeAllowGlobal':
      return stored.snoozeAllowGlobal === true
    case 'groupingSec':
      return stored.groupingSec !== undefined
    case 'confirm':
      return stored.confirm !== undefined && formToConfirm(confirmToForm(stored.confirm)) !== undefined
    case 'targetUsers':
      return (stored.targetUsers?.length ?? 0) > 0
    case 'actions':
      return storedActionsAreSet(stored.actions)
  }
}

// ── Static option lists (delivery / media / source / phase) ────

/** A trigger/urgency choice. */
export interface NcDeliveryOption {
  readonly value: NcDelivery
  readonly label: string
}

/** Triggers in authoring order. Labels are i18n keys (see below). */
export const NC_DELIVERY_OPTIONS: readonly NcDeliveryOption[] = [
  { value: 'immediate', label: 'immediate' },
  { value: 'track-end', label: 'trackEnd' },
  { value: 'device-event', label: 'deviceEvent' },
  { value: 'package-event', label: 'packageEvent' },
  { value: 'system-event', label: 'systemEvent' },
]

/** Narrow a raw string to a known delivery (no cast). */
export function parseDelivery(value: string): NcDelivery | undefined {
  return NC_DELIVERY_OPTIONS.find((option) => option.value === value)?.value
}

/** Narrow a raw string to a picture mode (no cast). */
export function parseMediaImage(value: string): NcMediaImage | undefined {
  return NC_MEDIA_IMAGE_MODES.find((mode) => mode === value)
}

// ── Media policy: the absent-means-default contract ─────────────────────────
//
// `image` is always written (the hub derives it from the kind otherwise, and
// the admin UI writes it too). Every other field is optional and absent
// carries a meaning: `gif`/`clip`/`showTriggerZone` absent = off, the roll
// seconds absent = the hub's defaults, `profile` absent = the cheapest assigned
// profile. The editor authors the default as absence — never `gif: false` —
// so a rule whose media the operator did not touch serializes as it arrived.

/** Footage profile choices. `auto` is the UI stand-in for an ABSENT `profile`
 *  (the hub then cuts from the cheapest assigned profile). */
export const NC_MEDIA_PROFILE_VALUES = ['auto', 'high', 'mid', 'low'] as const
export type NcMediaProfileValue = (typeof NC_MEDIA_PROFILE_VALUES)[number]
export function parseMediaProfile(value: string): NcCamProfile | undefined {
  return value === 'high' || value === 'mid' || value === 'low' ? value : undefined
}

/** Roll defaults the hub applies when the field is absent (cap docblock). */
export const NC_CLIP_PRE_ROLL_DEFAULT_SEC = 3
export const NC_CLIP_POST_ROLL_DEFAULT_SEC = 7
/** Bounds the cap enforces on both roll fields. */
export const NC_CLIP_ROLL_MIN_SEC = 0
export const NC_CLIP_ROLL_MAX_SEC = 30
/** Absent `clipSpeed` on the cap means 2×. */
export const NC_CLIP_SPEED_DEFAULT = 2

/** What the save judges a media policy against: the rule's kind and its SAVED conditions. */
export interface NcMediaPruneSubject {
  readonly kind: NcRuleKind
  readonly conditions: NcConditions
}

/**
 * The media policy as it is SAVED: the picture mode resolved for the kind,
 * `showTriggerZone` only where a zone can be drawn, and every other field
 * dropped when it equals its absent-means-default. Without the pruning the
 * editor would stamp `gif: false` and `clipPreRollSec: 3` onto every rule it
 * ever saved, turning "unset" into "explicitly the default".
 */
export function pruneMediaPolicy(media: NcMediaPolicy, subject: NcMediaPruneSubject): NcMediaPolicy {
  // A kind whose subject freezes no frame has no picture: every media control
  // on it is a knob that does nothing.
  if (!ruleKindSpec(subject.kind).carriesMedia) return { image: 'none' }
  const image = resolveNcMediaImage(media, subject.kind)
  const cutsFootage = media.gif === true || media.clip === true
  return {
    image,
    ...(media.showTriggerZone === true && triggerZoneDrawable(image, subject.conditions)
      ? { showTriggerZone: true }
      : {}),
    ...(media.showSubjectPath === true && subjectPathDrawable(image, subject.kind)
      ? { showSubjectPath: true }
      : {}),
    ...(media.gif === true ? { gif: true } : {}),
    ...(media.clip === true ? { clip: true } : {}),
    ...(cutsFootage &&
    media.clipPreRollSec !== undefined &&
    media.clipPreRollSec !== NC_CLIP_PRE_ROLL_DEFAULT_SEC
      ? { clipPreRollSec: media.clipPreRollSec }
      : {}),
    ...(cutsFootage &&
    media.clipPostRollSec !== undefined &&
    media.clipPostRollSec !== NC_CLIP_POST_ROLL_DEFAULT_SEC
      ? { clipPostRollSec: media.clipPostRollSec }
      : {}),
    ...(cutsFootage && media.profile !== undefined ? { profile: media.profile } : {}),
    ...(cutsFootage &&
    media.clipSpeed !== undefined &&
    media.clipSpeed !== NC_CLIP_SPEED_DEFAULT
      ? { clipSpeed: media.clipSpeed }
      : {}),
    // How a SENSOR rule shows its linked cameras (ADR 0632). Only a sensor
    // has linked cameras to compose, and only a picture can be one.
    ...(linkedCamerasApplies(subject.kind) && image !== 'none' && media.linkedCameras !== undefined
      ? { linkedCameras: media.linkedCameras }
      : {}),
  }
}

/** Detection-source choices (`sourceSelect` valueType). `any` = unrestricted.
 *  `audio` is the D62 audio marker — offered because the hub stamps it and a
 *  choice the control cannot render is a rule the operator cannot author. */
export const NC_SOURCE_VALUES = ['any', 'pipeline', 'onboard', 'sensor', 'audio'] as const
export type NcSourceValue = (typeof NC_SOURCE_VALUES)[number]
export function parseSource(value: string): NcConditions['source'] {
  return NC_SOURCE_VALUES.find((v) => v === value)
}

/** Package-phase choices (`packagePhase` valueType). */
export const NC_PACKAGE_PHASE_VALUES = ['delivered', 'picked-up', 'both'] as const
export type NcPackagePhaseValue = (typeof NC_PACKAGE_PHASE_VALUES)[number]
export function parsePackagePhase(value: string): NcConditions['packagePhase'] {
  return NC_PACKAGE_PHASE_VALUES.find((v) => v === value)
}

// ── System events: the editor's shapes ──────────────────────────────────────
//
// VOCABULARY IS SHARED, DELIBERATELY. Which kinds are authorable, their
// authoring order (`NC_SYSTEM_EVENT_KIND_GROUP_SPECS`) and the filter-visibility
// rule come from `@camstack/types`, read here through `system-event-family.ts`
// and in the admin UI through
// `packages/addon-admin-ui/src/pages/system/notification-system-events.ts`.
// Two surfaces that name the same event differently is how an operator
// concludes they are two different features.

/**
 * One chip of the kind picker, with the label to show when i18n has no key for
 * it: a one-edge kind, or a paired CLASS (D906) — a "went bad" and a "came
 * back" edge of one condition. The admin twin is `NcSystemEventGroupOption`.
 */
export interface NcSystemEventKindOption {
  /** The chip's own kind, or the class's first kind in authoring order. */
  readonly kind: NcSystemEventKind
  readonly fallback: string
  /** Set when the chip stands for a paired class. */
  readonly classId?: string
  /**
   * What ticking writes: the kind itself; a class's BOTH edges on an instant
   * rule; its bad edges only on a scheduled state summary.
   */
  readonly writes: readonly NcSystemEventKind[]
  /** What the chip stands for: ticked while any is listed, all cleared on untick. */
  readonly clears: readonly NcSystemEventKind[]
  /** A summary class the state summary has no source for — it reports nothing. */
  readonly noSnapshot?: boolean
}

/**
 * Which optional narrowing filters are meaningful for the selected kinds, keyed
 * by the EDITOR's label for each box. The condition field each one writes is
 * `devices` → `deviceIds`, `deviceTypes` → `deviceTypes`, `nodes` → `nodeIds`,
 * `packages` → `packageNames`, `consumableThreshold` → `consumableLowPercent`. Which kinds it speaks about is stated once in
 * `@camstack/types`, never here — `familyFilterVisibility`
 * (`system-event-family.ts`) is the one reader.
 */
export interface NcSystemEventFilterVisibility {
  readonly devices: boolean
  readonly deviceTypes: boolean
  readonly nodes: boolean
  readonly packages: boolean
  /** The rule's consumable threshold (D642) → `consumableLowPercent`. */
  readonly consumableThreshold: boolean
}

/**
 * The device types a liveness rule can be narrowed to, built from the shared
 * enum — a type added server-side appears here without an edit.
 *
 * `label` is the DERIVED English name (`media-player` → "Media player"), the
 * same one the admin UI derives. The chip SHOWS `t(deviceTypeLabelKey(type))`
 * with this as its `defaultValue`, so the phone speaks Italian for every type
 * it knows and still names a type added after this build (in English) rather
 * than showing a raw key.
 */
export const NC_DEVICE_TYPE_OPTIONS: readonly { readonly value: string; readonly label: string }[] =
  Object.values(DeviceType)
    .map((type) => ({ value: type, label: deviceTypeLabel(type) }))
    // `.sort`, not `.toSorted`: Hermes has never shipped the ES2023 copying
    // methods, and this line runs at MODULE EVALUATION — it took the whole
    // Notifications tab down on v1.0.336. `.map` already returned a fresh
    // array, so sorting it in place mutates nothing shared.
    .sort((a, b) => a.label.localeCompare(b.label))

/** The i18n key naming one device type (`v2.nc.deviceType.<type>`). */
export function deviceTypeLabelKey(type: string): string {
  return `v2.nc.deviceType.${type}`
}

/** "media-player" → "Media player". */
export function deviceTypeLabel(type: string): string {
  const spaced = type.replaceAll('-', ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Priority ordinals 1..5. */
export const NC_PRIORITY_MIN = 1
export const NC_PRIORITY_MAX = 5

// ── Condition-key ↔ widget mapping (valueType narrowing, no casts) ──────────
//
// `ConditionField` chooses a widget from the catalog descriptor's `valueType`,
// but two value-types (`stringList`, `number01`) map to MANY concrete
// `NcConditions` keys, so the descriptor id must be narrowed to the exact key
// before it can index the conditions object. These whitelists ARE that mapping.
//
// They MUST stay in lockstep with the string-array / 0..1-number fields of
// `NcConditionsSchema`: a future A1 catalog addition that adds such a field
// without extending the matching whitelist would render a BLANK widget. The
// `rule-editor.spec.ts` exhaustiveness guard derives the expected key sets from
// the live Zod schema and asserts set-equality, so that drift breaks a test
// loudly instead of silently rendering nothing.

/** `NcConditions` keys whose value is a string array (`stringList` widget). */
export const NC_STRING_LIST_KEYS = {
  classes: true,
  classesExclude: true,
  labelEquals: true,
  identities: true,
  identitiesExclude: true,
  zonesExclude: true,
  eventTypeTokens: true,
  sensorKinds: true,
} as const
export type NcStringListKey = keyof typeof NC_STRING_LIST_KEYS

/** Narrow a catalog descriptor id to a string-array conditions key (no cast). */
export function isStringListKey(id: string): id is NcStringListKey {
  return Object.prototype.hasOwnProperty.call(NC_STRING_LIST_KEYS, id)
}

/** `NcConditions` keys whose value is a 0..1 number (`number01` widget). */
export const NC_NUMBER01_KEYS = {
  minConfidence: true,
  minImportance: true,
  minLabelConfidence: true,
} as const
export type NcNumber01Key = keyof typeof NC_NUMBER01_KEYS

/** Narrow a catalog descriptor id to a 0..1-number conditions key (no cast). */
export function isNumber01Key(id: string): id is NcNumber01Key {
  return Object.prototype.hasOwnProperty.call(NC_NUMBER01_KEYS, id)
}

/** Read a string-array condition value, defaulting to an empty list. */
export function readStringList(conditions: NcConditions, key: NcStringListKey): readonly string[] {
  const value = conditions[key]
  return Array.isArray(value) ? value : []
}

/** Read a 0..1-number condition value (`undefined` = unset). */
export function readNumber01(conditions: NcConditions, key: NcNumber01Key): number | undefined {
  const value = conditions[key]
  return typeof value === 'number' ? value : undefined
}
