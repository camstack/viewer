/**
 * timelapse-form — the phone's form model for a SCHEDULED TIMELAPSE rule. Pure,
 * RN-free, unit-tested in the node env like every other `*-form` / `*-condition`
 * module here.
 *
 * ## Every field the admin authors — and a patch that is still a DIFF
 *
 * This surface used to author a subset, on the operator's earlier ask for a
 * simpler phone rule. On 2026-09-24 the operator decided for FULL PARITY with
 * the admin editor, so the form now owns the dense cadence, the minimum dwell,
 * the notification title/body, the preview caption and the reported classes
 * too. Three of them have an absent state that is itself a value, and each is
 * kept honest here:
 *
 *  - `denseCadenceSec` — absent means "derive it" as `max(1s, cadenceSec / 30)`
 *    at render time. The form holds `undefined` for that and the screen shows
 *    it as "auto"; a number PINS it.
 *  - `previewText` — an EMPTY box is ABSENT, and the hub's default caption
 *    applies. The desktop's third state (`''` = no caption at all) is not
 *    authored here, and a stored `''` is left alone rather than cleared: the
 *    phone reads it as a blank box, and clearing it would silently turn "no
 *    caption" into the default one.
 *  - `reportClasses` — empty is absent: "every class the window contained".
 *
 * **The patch is still a DIFF** ({@link timelapseFormToPatch}): the hub MERGES
 * it over the stored rule, so a field the operator did not touch is not
 * re-sent. The same merge is why an EMPTIED optional field cannot ride the
 * patch — omitting it would keep the stored value — and travels instead as
 * `clear` ({@link timelapseClearsFor}), the addon-local list
 * `nc.upsertTimelapseRule` takes (Plan A's `nc.updateRule` design).
 *
 * ## Schemas come from `@camstack/types`, not from a mirror
 *
 * `TimelapseRule` already ships in the package the app depends on, so there is
 * no second copy of the shape here — see the note in
 * `data/notification-center.ts`.
 */
import { TIMELAPSE_DENSE_FLOOR_SEC } from '@camstack/types/client'
import type {
  NcRuleTarget,
  NcSchedule,
  TimelapsePreviewMode,
  TimelapseRule,
  TimelapseRuleInput,
  TimelapseRulePatch,
  TimelapseTemplate,
} from '@camstack/types'
import type { NcTimelapseRuleClearableKey } from '../../data/notification-center.js'
import {
  ownershipSafeTargets,
  savedTargetIds,
  targetOwnershipPolicy,
  type TargetSaveContext,
} from './target-ownership.js'

// ── The bounds, from the schema's own vocabulary ────────────────────
//
// Mirrored as numbers because the constraint schemas are module-private in
// `timelapse-rule.ts`; `timelapse-form.spec.ts` pins each one against a save
// the server would refuse, so a bound that drifts fails here rather than in a
// toast the operator cannot act on.

export const TIMELAPSE_CADENCE_MIN_SEC = 2
export const TIMELAPSE_CADENCE_MAX_SEC = 3600
export const TIMELAPSE_FRAMERATE_MIN = 1
export const TIMELAPSE_FRAMERATE_MAX = 60
export const TIMELAPSE_PRIORITY_MIN = 1
export const TIMELAPSE_PRIORITY_MAX = 5
/** The hub's derivation of an ABSENT dense cadence, mirrored for one purpose:
 *  where the stepper starts when the operator pins "auto" — the admin editor
 *  seeds the explicit value the same way. Rounded to the stepper's 0.1 s. */
const DENSE_CADENCE_DIVISOR = 30
const DENSE_DERIVED_FLOOR_SEC = 1
export function timelapseDerivedDenseCadence(cadenceSec: number): number {
  return Math.round(Math.max(DENSE_DERIVED_FLOOR_SEC, cadenceSec / DENSE_CADENCE_DIVISOR) * 10) / 10
}

/** The dense cadence's floor is the SHARED constant; its ceiling is the schema's. */
export const TIMELAPSE_DENSE_MIN_SEC = TIMELAPSE_DENSE_FLOOR_SEC
export const TIMELAPSE_DENSE_MAX_SEC = 3600
export const TIMELAPSE_MIN_DWELL_MIN_SEC = 0
export const TIMELAPSE_MIN_DWELL_MAX_SEC = 60
export const TIMELAPSE_TITLE_MAX = 500
export const TIMELAPSE_BODY_MAX = 2000
export const TIMELAPSE_PREVIEW_TEXT_MAX = 200
export const TIMELAPSE_REPORT_CLASSES_MAX = 20
export const TIMELAPSE_REPORT_CLASS_MAX_LENGTH = 40

/** The schema's own `.default(...)` clauses, so a blank form saves cleanly. */
export const TIMELAPSE_DEFAULT_CADENCE_SEC = 15
export const TIMELAPSE_DEFAULT_FRAMERATE = 10
export const TIMELAPSE_DEFAULT_PRIORITY = 3

/** Every field this surface authors. Anything absent here is preserved. */
export interface TimelapseFormState {
  readonly name: string
  readonly enabled: boolean
  readonly deviceIds: readonly number[]
  /**
   * REQUIRED for a timelapse, unlike an `NcRule` where absence means "always
   * active": the window boundaries ARE the rule — open clears the scratch,
   * close assembles and delivers. `undefined` is the state of a form the
   * operator has not answered yet, never a rule that can be saved.
   */
  readonly schedule: NcSchedule | undefined
  readonly cadenceSec: number
  readonly framerate: number
  readonly previewMode: TimelapsePreviewMode
  readonly priority: number
  readonly targetIds: readonly string[]
  /** `undefined` = derived from the base cadence at render time ("auto"). */
  readonly denseCadenceSec: number | undefined
  /** `undefined` = no dwell guarantee. */
  readonly minDwellSec: number | undefined
  /** The notification's title/body; both blank = no template. */
  readonly template: TimelapseFormTemplate
  /** The preview-frame caption; blank = the hub's default caption. */
  readonly previewText: string
  /** Classes the notification counts; empty = every class the window had. */
  readonly reportClasses: readonly string[]
}

/** The template as two text boxes — a blank one is simply not sent. */
export interface TimelapseFormTemplate {
  readonly title: string
  readonly body: string
}

/** Why a save is refused. Ids, not sentences — the screen owns the words. */
export type TimelapseFormProblem =
  | 'name'
  | 'devices'
  | 'schedule'
  | 'targets'
  | 'cadence'
  | 'framerate'
  | 'denseCadence'
  | 'minDwell'
  | 'template'
  | 'previewText'
  | 'reportClasses'

/** What "New timelapse" opens on: the schema defaults, four blanks, and every
 *  optional field absent. */
export function emptyTimelapseForm(): TimelapseFormState {
  return {
    name: '',
    enabled: true,
    deviceIds: [],
    schedule: undefined,
    cadenceSec: TIMELAPSE_DEFAULT_CADENCE_SEC,
    framerate: TIMELAPSE_DEFAULT_FRAMERATE,
    previewMode: 'image',
    priority: TIMELAPSE_DEFAULT_PRIORITY,
    targetIds: [],
    denseCadenceSec: undefined,
    minDwellSec: undefined,
    template: { title: '', body: '' },
    previewText: '',
    reportClasses: [],
  }
}

/** Read a stored rule back into the form — every field the rule carries. */
export function timelapseRuleToForm(rule: TimelapseRule): TimelapseFormState {
  return {
    name: rule.name,
    enabled: rule.enabled,
    deviceIds: [...rule.deviceIds],
    schedule: rule.schedule,
    cadenceSec: rule.cadenceSec,
    framerate: rule.framerate,
    previewMode: rule.previewMode,
    priority: rule.priority,
    targetIds: rule.targets.map((target) => target.targetId),
    denseCadenceSec: rule.denseCadenceSec,
    minDwellSec: rule.minDwellSec,
    template: { title: rule.template?.title ?? '', body: rule.template?.body ?? '' },
    previewText: rule.previewText ?? '',
    reportClasses: [...(rule.reportClasses ?? [])],
  }
}

/**
 * Everything wrong with this form, as ids.
 *
 * The bounds are checked HERE and not left to the server round-trip: they are
 * the schema's own, and a save the operator cannot explain is worse than a
 * disabled button they can.
 */
export function timelapseFormProblems(
  form: TimelapseFormState,
  targets?: TargetSaveContext,
): readonly TimelapseFormProblem[] {
  const problems: TimelapseFormProblem[] = []
  if (form.name.trim().length === 0) problems.push('name')
  if (form.deviceIds.length === 0) problems.push('devices')
  // An absent schedule is a rule that never opens a window, never closes one and
  // therefore never produces anything — and 06:05 is not a moment anyone is
  // present to be told.
  if (form.schedule === undefined || form.schedule.windows.length === 0) problems.push('schedule')
  // What the save will SEND (m3): a non-admin's foreign ids are dropped by it.
  if (savedTargetIds(form.targetIds, targets).length === 0) problems.push('targets')
  if (!inRange(form.cadenceSec, TIMELAPSE_CADENCE_MIN_SEC, TIMELAPSE_CADENCE_MAX_SEC)) {
    problems.push('cadence')
  }
  if (!inRange(form.framerate, TIMELAPSE_FRAMERATE_MIN, TIMELAPSE_FRAMERATE_MAX)) {
    problems.push('framerate')
  }
  if (denseCadenceRefused(form.denseCadenceSec, form.cadenceSec)) problems.push('denseCadence')
  if (
    form.minDwellSec !== undefined &&
    !inRealRange(form.minDwellSec, TIMELAPSE_MIN_DWELL_MIN_SEC, TIMELAPSE_MIN_DWELL_MAX_SEC)
  ) {
    problems.push('minDwell')
  }
  const template = formTemplate(form.template)
  if ((template?.title?.length ?? 0) > TIMELAPSE_TITLE_MAX || (template?.body?.length ?? 0) > TIMELAPSE_BODY_MAX) {
    problems.push('template')
  }
  if (form.previewText.trim().length > TIMELAPSE_PREVIEW_TEXT_MAX) problems.push('previewText')
  if (
    form.reportClasses.length > TIMELAPSE_REPORT_CLASSES_MAX ||
    form.reportClasses.some((name) => name.length === 0 || name.length > TIMELAPSE_REPORT_CLASS_MAX_LENGTH)
  ) {
    problems.push('reportClasses')
  }
  return problems
}

/**
 * The hub's own two refusals of a dense cadence: below the recording's frame
 * interval (schema), and not strictly denser than the base (`assertTimelapseCadences`,
 * at upsert). Absent is "derive it" and never refused.
 */
function denseCadenceRefused(dense: number | undefined, cadenceSec: number): boolean {
  if (dense === undefined) return false
  return !inRealRange(dense, TIMELAPSE_DENSE_MIN_SEC, TIMELAPSE_DENSE_MAX_SEC) || dense >= cadenceSec
}

export function isTimelapseFormValid(form: TimelapseFormState, targets?: TargetSaveContext): boolean {
  return timelapseFormProblems(form, targets).length === 0
}

/** What the two builders need from the surface around them. */
export interface TimelapseBuildOptions {
  /**
   * The target ids the caller OWNS. A personal rule delivers only to those —
   * the server re-validates and REFUSES, so filtering here is what keeps the
   * operator from being shown a refusal for a target the picker offered.
   */
  readonly ownTargetIds: readonly string[]
  /**
   * A CONFIRMED admin (`useAdminVerdict() === 'admin'`): only then are stored
   * targets outside `ownTargetIds` kept (`target-ownership.ts`). The screen
   * blocks Save while the verdict is pending, so this is never a guess.
   */
  readonly isAdmin: boolean
}

/**
 * The CREATE payload.
 *
 * Throws on an absent schedule rather than inventing one: `TimelapseRuleInput`
 * has no shape without it, and a default window would be a rule the operator
 * never authored, running every night.
 */
export function timelapseFormToInput(
  form: TimelapseFormState,
  options: TimelapseBuildOptions,
): TimelapseRuleInput {
  const schedule = form.schedule
  if (schedule === undefined || schedule.windows.length === 0) {
    throw new Error('a timelapse rule needs a schedule — the window boundaries are the rule')
  }
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    deviceIds: [...form.deviceIds],
    schedule,
    cadenceSec: form.cadenceSec,
    framerate: form.framerate,
    previewMode: form.previewMode,
    priority: form.priority,
    targets: ownedTargets(form.targetIds, [], options.ownTargetIds, options.isAdmin),
    ...formOptionalFields(form),
  }
}

/**
 * The EDIT payload — a DIFF: only what the operator changed.
 *
 * Only the keys whose value actually changed. An absent key means "leave it
 * unchanged" on the wire (see `TimelapseRulePatchSchema`), so:
 *
 *  - a field the operator did not touch is not re-sent, and an EMPTIED optional
 *    field is not in the patch at all — see {@link timelapseClearsFor};
 *  - a RENAME does not re-send `deviceIds`, so it still succeeds on a rule
 *    whose camera has since stopped recording (the server re-checks only the
 *    cameras a patch ADDS);
 *  - a no-op save is a no-op request.
 */
export function timelapseFormToPatch(
  form: TimelapseFormState,
  rule: TimelapseRule,
  options: TimelapseBuildOptions,
): TimelapseRulePatch {
  const patch: {
    name?: string
    enabled?: boolean
    deviceIds?: number[]
    schedule?: NcSchedule
    cadenceSec?: number
    framerate?: number
    previewMode?: TimelapsePreviewMode
    priority?: number
    targets?: NcRuleTarget[]
    denseCadenceSec?: number
    minDwellSec?: number
    template?: TimelapseTemplate
    previewText?: string
    reportClasses?: string[]
  } = {}

  // Compared TRIMMED on both sides: whitespace the desktop stored is not an
  // edit, and re-sending it trimmed on every save would be one.
  const name = form.name.trim()
  if (name !== rule.name.trim()) patch.name = name
  if (form.enabled !== rule.enabled) patch.enabled = form.enabled
  if (!sameNumberSet(form.deviceIds, rule.deviceIds)) patch.deviceIds = [...form.deviceIds]
  if (form.schedule !== undefined && !sameJson(form.schedule, rule.schedule)) {
    patch.schedule = form.schedule
  }
  if (form.cadenceSec !== rule.cadenceSec) patch.cadenceSec = form.cadenceSec
  if (form.framerate !== rule.framerate) patch.framerate = form.framerate
  if (form.previewMode !== rule.previewMode) patch.previewMode = form.previewMode
  if (form.priority !== rule.priority) patch.priority = form.priority

  const targets = ownedTargets(form.targetIds, rule.targets, options.ownTargetIds, options.isAdmin)
  if (!sameJson(targets, rule.targets)) patch.targets = targets

  const next = formOptionalFields(form)
  if (next.denseCadenceSec !== undefined && next.denseCadenceSec !== rule.denseCadenceSec) {
    patch.denseCadenceSec = next.denseCadenceSec
  }
  if (next.minDwellSec !== undefined && next.minDwellSec !== rule.minDwellSec) {
    patch.minDwellSec = next.minDwellSec
  }
  if (next.template !== undefined && !sameJson(next.template, storedTemplate(rule))) {
    patch.template = next.template
  }
  if (next.previewText !== undefined && next.previewText !== (rule.previewText ?? '').trim()) {
    patch.previewText = next.previewText
  }
  if (next.reportClasses !== undefined && !sameJson(next.reportClasses, rule.reportClasses ?? [])) {
    patch.reportClasses = next.reportClasses
  }

  return patch
}

/**
 * The optional fields the operator EMPTIED — sent as `clear` beside the patch.
 *
 * Only a key the stored rule actually SAID something under: clearing an absent
 * key is noise, and clearing a stored `previewText: ''` would turn the
 * desktop's "no caption" into the default caption behind the operator's back
 * (the phone shows both as a blank box, see the file header).
 */
export function timelapseClearsFor(
  form: TimelapseFormState,
  rule: TimelapseRule,
): NcTimelapseRuleClearableKey[] {
  const next = formOptionalFields(form)
  const clears: NcTimelapseRuleClearableKey[] = []
  if (next.template === undefined && storedTemplate(rule) !== undefined) clears.push('template')
  if (next.previewText === undefined && (rule.previewText ?? '').trim().length > 0) {
    clears.push('previewText')
  }
  if (next.reportClasses === undefined && (rule.reportClasses?.length ?? 0) > 0) {
    clears.push('reportClasses')
  }
  if (next.denseCadenceSec === undefined && rule.denseCadenceSec !== undefined) {
    clears.push('denseCadenceSec')
  }
  if (next.minDwellSec === undefined && rule.minDwellSec !== undefined) clears.push('minDwellSec')
  return clears
}

// ── Local helpers ───────────────────────────────────────────────────

/** The optional fields as the wire wants them: an empty control is ABSENT. */
interface TimelapseOptionalFields {
  readonly denseCadenceSec?: number
  readonly minDwellSec?: number
  readonly template?: TimelapseTemplate
  readonly previewText?: string
  readonly reportClasses?: string[]
}

function formOptionalFields(form: TimelapseFormState): TimelapseOptionalFields {
  const template = formTemplate(form.template)
  const previewText = form.previewText.trim()
  return {
    ...(form.denseCadenceSec !== undefined ? { denseCadenceSec: form.denseCadenceSec } : {}),
    ...(form.minDwellSec !== undefined ? { minDwellSec: form.minDwellSec } : {}),
    ...(template !== undefined ? { template } : {}),
    ...(previewText.length > 0 ? { previewText } : {}),
    ...(form.reportClasses.length > 0 ? { reportClasses: [...form.reportClasses] } : {}),
  }
}

/** Trimmed, with a blank half left out and a wholly blank template absent —
 *  the detection-rule editor's convention (`formToInput`). */
function formTemplate(template: TimelapseFormTemplate): TimelapseTemplate | undefined {
  const title = template.title.trim()
  const body = template.body.trim()
  if (title.length === 0 && body.length === 0) return undefined
  return {
    ...(title.length > 0 ? { title } : {}),
    ...(body.length > 0 ? { body } : {}),
  }
}

/** The stored template in the form's own normal form, so a comparison sees
 *  only a real change — `{ title: 'x', body: '' }` and `{ title: 'x' }` agree. */
function storedTemplate(rule: TimelapseRule): TimelapseTemplate | undefined {
  return formTemplate({ title: rule.template?.title ?? '', body: rule.template?.body ?? '' })
}

function inRealRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max
}

/** Ownership-safe targets, PRESERVING a stored target's `params` — see
 *  `target-ownership.ts`. A stored target the caller cannot see rides through. */
function ownedTargets(
  selected: readonly string[],
  existing: readonly NcRuleTarget[],
  ownTargetIds: readonly string[],
  isAdmin: boolean,
): NcRuleTarget[] {
  return ownershipSafeTargets(
    selected,
    existing,
    ownTargetIds,
    (id, stored) => stored ?? { targetId: id },
    targetOwnershipPolicy(isAdmin),
  )
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

/** Cameras are a SET — reordering the checklist is not an edit. */
function sameNumberSet(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort((x, y) => x - y)
  const sortedB = [...b].sort((x, y) => x - y)
  return sortedA.every((value, index) => value === sortedB[index])
}

/**
 * Structural equality over plain JSON values — the schedule and the target list
 * are both trees of primitives, arrays and records, and neither carries a
 * `Date`, a `Map` or a cycle.
 */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
