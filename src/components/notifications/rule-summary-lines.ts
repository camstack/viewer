/**
 * rule-summary-lines — the one line under each row of the rule summary screen.
 *
 * The summary screen lists the rule's sections; each row says what that
 * section currently holds, so the operator can find the one to change without
 * opening them all. Pure, and it returns an i18n key plus params — never
 * English — so the phone says it in the operator's language.
 */
import type { NcRuleEditorSectionKey } from '@camstack/types'
import {
  isConditionValueEmpty,
  groupingIsSent,
  scheduleHasWindows,
  type NcRuleFormState,
} from './rule-editor.js'
import { bindingCount, formToActions } from './rule-action-form.js'
import {
  ruleScopeLegacyExclusions,
  ruleScopeList,
  type RuleScopeDraft,
} from './rule-scope-model.js'
import { classPickerItems, formScopedConditions } from './rule-scope-form.js'
import { NC_ADVANCED_CONDITION_IDS } from './rule-editor-sections.js'
import type { NcTaxonomy } from '../../data/notification-center.js'

/** What the form alone cannot say: target names, and fields the form does not carry. */
export interface SummaryContext {
  /** targetId → display name, the caller's own targets. */
  readonly targetNames: ReadonlyMap<string, string>
  /** The stored rule's throttle cooldown; absent for a rule not saved yet. */
  readonly cooldownSec?: number
  /**
   * class id → its taxonomy display label ({@link summaryClassLabels}) — the
   * words the class scope field shows. An id it lacks is said as itself.
   */
  readonly classLabels?: ReadonlyMap<string, string>
  /**
   * What the rule's devices ARE, for the Devices line's words: a sensor rule
   * scopes sensors (`rule-device-source.ts`), and "Every camera" on it would
   * be the very confusion the Devices section fixed. Absent = cameras.
   */
  readonly deviceNoun?: SummaryDeviceNoun
}

/** The noun the Devices line uses. */
export type SummaryDeviceNoun = 'cameras' | 'sensors'

/**
 * The class labels a summary names classes with: the SAME list the class
 * scope picker draws (`classPickerItems` over the served taxonomy), so the
 * summary and the field never call one class two things. Empty with no
 * taxonomy — every id is then said as itself.
 */
export function summaryClassLabels(taxonomy: NcTaxonomy | undefined): ReadonlyMap<string, string> {
  return new Map((classPickerItems(taxonomy)?.items ?? []).map((item) => [item.id, item.name]))
}

export interface SummaryLine {
  readonly key: string
  readonly params?: Readonly<Record<string, string | number>>
}

const PREFIX = 'v2.nc.rules.summary'

/** The grouped trigger's words — owned by the editor's strings, so the select and the summary say one thing. */
const GROUPED_TRIGGER_KEY = 'v2.nc.rules.editor.delivery.immediateGrouped'

/** Every key this module can return — the locale parity spec walks it. */
export const NC_SUMMARY_LINE_KEYS: readonly string[] = [
  `${PREFIX}.rule.targets`,
  `${PREFIX}.rule.noTargets`,
  GROUPED_TRIGGER_KEY,
  `${PREFIX}.devices.all`,
  `${PREFIX}.devices.some`,
  `${PREFIX}.devices.except`,
  `${PREFIX}.devices.someExcept`,
  `${PREFIX}.devices.sensorsAll`,
  `${PREFIX}.devices.sensorsSome`,
  `${PREFIX}.devices.sensorsExcept`,
  `${PREFIX}.devices.sensorsSomeExcept`,
  `${PREFIX}.conditions.count`,
  `${PREFIX}.conditions.classesExcept`,
  `${PREFIX}.conditions.classesExceptMore`,
  `${PREFIX}.conditions.none`,
  `${PREFIX}.notification.custom`,
  `${PREFIX}.notification.default`,
  `${PREFIX}.actions.count`,
  `${PREFIX}.actions.invalid`,
  `${PREFIX}.actions.none`,
  `${PREFIX}.advanced.cooldown`,
  `${PREFIX}.advanced.none`,
]

function ruleLine(form: NcRuleFormState, ctx: SummaryContext): SummaryLine {
  // The trigger first when it is the grouped one (D692): "Immediate, grouped · 20 s".
  if (form.groupingSec !== undefined && groupingIsSent(form)) {
    return { key: GROUPED_TRIGGER_KEY, params: { n: form.groupingSec } }
  }
  const names = form.targetIds.flatMap((id) => {
    const name = ctx.targetNames.get(id)
    return name === undefined ? [] : [name]
  })
  return names.length > 0
    ? { key: `${PREFIX}.rule.targets`, params: { names: names.join(', ') } }
    : { key: `${PREFIX}.rule.noTargets` }
}

/**
 * The device scope in the ACTIVE mode (D641): every camera (sensor), these N, every
 * camera except N — and a legacy rule's kept exclusions beside its Only list,
 * never hidden (D49).
 */
function devicesLine(form: NcRuleFormState, ctx: SummaryContext): SummaryLine {
  const scope = form.deviceScope
  const count = ruleScopeList(scope).length
  const key = (camera: string, sensor: string): string =>
    `${PREFIX}.devices.${ctx.deviceNoun === 'sensors' ? sensor : camera}`
  if (scope.mode === 'except' && count > 0) return { key: key('except', 'sensorsExcept'), params: { count } }
  if (scope.mode !== 'only' || count === 0) return { key: key('all', 'sensorsAll') }
  const excluded = ruleScopeLegacyExclusions(scope).length
  return excluded > 0
    ? { key: key('someExcept', 'sensorsSomeExcept'), params: { count, excluded } }
    : { key: key('some', 'sensorsSome'), params: { count } }
}

/**
 * Authored conditions other than the device and class scopes (the zone, face
 * and label scopes projected as a save writes them) and the two the Advanced
 * section draws, the class scope when it narrows, and a schedule with
 * windows. An "all classes except …" scope NAMES what it excludes: that
 * sentence is the rule, a count would hide it.
 */
function conditionsLine(form: NcRuleFormState, ctx: SummaryContext): SummaryLine {
  const authored = Object.entries(formScopedConditions(form)).filter(
    ([key, value]) => !SCOPE_KEYS.has(key) && !NC_ADVANCED_CONDITION_IDS.has(key) && !isConditionValueEmpty(value),
  ).length
  const others = authored + (scheduleHasWindows(form.schedule) ? 1 : 0)
  const classes = ruleScopeList(form.classScope)
  if (form.classScope.mode === 'except' && classes.length > 0) {
    const names = classes.map((id) => ctx.classLabels?.get(id) ?? id).join(', ')
    return others > 0
      ? { key: `${PREFIX}.conditions.classesExceptMore`, params: { classes: names, count: others } }
      : { key: `${PREFIX}.conditions.classesExcept`, params: { classes: names } }
  }
  const count = others + (form.classScope.mode === 'only' && classes.length > 0 ? 1 : 0)
  return count > 0 ? { key: `${PREFIX}.conditions.count`, params: { count } } : { key: `${PREFIX}.conditions.none` }
}

/** Keys the scope fields own — never counted as a condition here. */
const SCOPE_KEYS: ReadonlySet<string> = new Set(['devices', 'devicesExclude', 'classes', 'classesExclude'])

function notificationLine(form: NcRuleFormState): SummaryLine {
  const custom = form.templateTitle.trim().length > 0 || form.templateBody.trim().length > 0
  return {
    key: `${PREFIX}.notification.${custom ? 'custom' : 'default'}`,
    params: { priority: form.priority },
  }
}

/** What the DRAFT holds — and, while it does not parse, how many problems (each
 *  instance, not each kind) stop the save. */
function actionsLine(form: NcRuleFormState): SummaryLine {
  const { problemCount } = formToActions(form.actions)
  if (problemCount > 0) return { key: `${PREFIX}.actions.invalid`, params: { count: problemCount } }
  const bindings = bindingCount(form.actions)
  const buttons = form.actions.buttons.length
  return bindings + buttons > 0
    ? { key: `${PREFIX}.actions.count`, params: { bindings, buttons } }
    : { key: `${PREFIX}.actions.none` }
}

function advancedLine(ctx: SummaryContext): SummaryLine {
  return ctx.cooldownSec !== undefined
    ? { key: `${PREFIX}.advanced.cooldown`, params: { seconds: ctx.cooldownSec } }
    : { key: `${PREFIX}.advanced.none` }
}

export function sectionSummary(
  key: NcRuleEditorSectionKey,
  form: NcRuleFormState,
  ctx: SummaryContext,
): SummaryLine {
  switch (key) {
    case 'rule':
      return ruleLine(form, ctx)
    case 'devices':
      return devicesLine(form, ctx)
    case 'conditions':
      return conditionsLine(form, ctx)
    case 'notification':
      return notificationLine(form)
    case 'actions':
      return actionsLine(form)
    case 'advanced':
      return advancedLine(ctx)
  }
}

const DEVICE_LIST = `${PREFIX}.deviceList`

/** Every key the "active devices" list says — the locale spec walks it. */
export const NC_SUMMARY_DEVICE_LIST_KEYS: readonly string[] = [
  `${DEVICE_LIST}.all`,
  `${DEVICE_LIST}.only`,
  `${DEVICE_LIST}.except`,
  `${DEVICE_LIST}.excludedTitle`,
]

/** Which of the three sentences the list opens on. */
export type SummaryDeviceListMode = 'all' | 'only' | 'except'

/** What the overview's "active devices" list holds. */
export interface SummaryDeviceList {
  readonly mode: SummaryDeviceListMode
  /** "All devices" / "Only these N devices" / "All devices except N". */
  readonly headline: SummaryLine
  /** The devices the rule runs on BY NAME — the Only list; empty otherwise. */
  readonly listed: readonly number[]
  /** The devices it never runs on: the Except list, or a legacy Only rule's
   *  kept exclusions (D49) — said, never hidden. */
  readonly excluded: readonly number[]
}

/**
 * The devices a rule is active on, in the ACTIVE scope mode — the same
 * reading as the Devices row's one line ({@link sectionSummary}): an Only or
 * Except list that is empty means every device, since that is what the save
 * writes. "All except" is the headline plus the excluded list, never the
 * fleet minus it: that would need the whole fleet read to say one sentence.
 */
export function summaryDeviceList(scope: RuleScopeDraft<number>): SummaryDeviceList {
  const list = ruleScopeList(scope)
  if (scope.mode === 'except' && list.length > 0) {
    return {
      mode: 'except',
      headline: { key: `${DEVICE_LIST}.except`, params: { count: list.length } },
      listed: [],
      excluded: list,
    }
  }
  if (scope.mode === 'only' && list.length > 0) {
    return {
      mode: 'only',
      headline: { key: `${DEVICE_LIST}.only`, params: { count: list.length } },
      listed: list,
      excluded: ruleScopeLegacyExclusions(scope),
    }
  }
  return { mode: 'all', headline: { key: `${DEVICE_LIST}.all` }, listed: [], excluded: [] }
}
