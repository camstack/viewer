/**
 * system-event-delivery — how a `device-events` / `system` rule speaks (D647):
 * a notification per event (Instant), or a STATE SUMMARY at set times.
 *
 * The phone's twin of the admin's `NotificationSystemEventDelivery.tsx` /
 * `notification-system-event-delivery.ts`. What is decided on the hub is READ
 * from `@camstack/types`, never restated: which families may summarise
 * (`NC_SYSTEM_EVENT_SUMMARY_FAMILIES`), why a summary is refused
 * (`systemEventDeliveryProblems`) and whether a body carries the summary
 * (`templateCarriesSummary`).
 *
 * The send-time ⇄ schedule conversion is the one thing copied, and on purpose:
 * the published `scheduleForSendTimes` / `sendTimesOfSchedule` sort with
 * `Array.prototype.toSorted`, which Hermes has never shipped
 * (`scripts/check-hermes-builtins.mjs` — the v1.0.336 outage). The copies below
 * are the same arithmetic over `[...days].sort(…)`, and the spec pins them to
 * the published pair value for value.
 *
 * "Send at 08:00 on Mon–Fri" is stored as the ordinary `NcSchedule`: each send
 * time is a ONE-MINUTE window that ENDS at that minute, because a summary is
 * sent when a window ends. A stored schedule that is not a list of send times
 * (longer or inverted windows, authored elsewhere) is shown as its raw windows.
 *
 * Pure, RN-free, i18n-key-only.
 */
import {
  NC_SYSTEM_EVENT_CLASS_SPECS,
  NC_SYSTEM_EVENT_SUMMARY_FAMILIES,
  expandSystemEventClasses,
  systemEventDeliveryProblems,
  systemFamilyOfKind,
  templateCarriesSummary,
} from '@camstack/types/client'
import type { NcRuleKind, NcSystemEventDeliveryProblem } from '@camstack/types'
import type {
  NcDelivery,
  NcSchedule,
  NcScheduleWindow,
  NcStateSummarySplit,
  NcSystemEventDelivery,
  NcSystemEventKind,
  NcTemplateVarDescriptor,
} from '../../data/notification-center.js'
import { NcSystemEventKindSchema } from '../../data/notification-center.js'
import { formToActions } from './rule-action-form.js'
// TYPE-only: `rule-editor.ts` imports this module at runtime.
import type { NcRuleFormState } from './rule-editor.js'

/** One send time as the editor presents it: the days it is sent on, and the minute. */
export interface NcSummarySendTime {
  readonly days: readonly number[]
  /** Minute of the day, 0–1439. */
  readonly minute: number
}

/** The combined-moments delivery (D1019) — read-only on the phone. */
export type NcModesDelivery = Extract<NcSystemEventDelivery, { readonly mode: 'modes' }>

/** What a rule's delivery says, whatever shape it is stored in. */
export interface NcSystemEventDeliveryModes {
  readonly activation: boolean
  readonly deactivation: boolean
  /** The scheduled summary, or `null` when the rule sends none. */
  readonly schedule: {
    readonly schedule: NcSchedule
    readonly grouping: NcStateSummarySplit
  } | null
}

/**
 * The hub's `systemEventDeliveryModesOf`, mirrored: absent / `instant` speak on
 * both edges with no summary; the legacy `summary` sends no instant message,
 * only its schedule; `modes` says it itself.
 */
export function systemEventDeliveryModesOf(rule: {
  readonly systemEventDelivery?: NcSystemEventDelivery | undefined
}): NcSystemEventDeliveryModes {
  const delivery = rule.systemEventDelivery
  if (delivery === undefined || delivery.mode === 'instant') {
    return { activation: true, deactivation: true, schedule: null }
  }
  if (delivery.mode === 'summary') {
    return {
      activation: false,
      deactivation: false,
      schedule: {
        schedule: delivery.schedule,
        grouping: delivery.split ?? 'rule',
      },
    }
  }
  return {
    activation: delivery.onActivation,
    deactivation: delivery.onDeactivation,
    schedule: delivery.onSchedule ?? null,
  }
}

/** Is this delivery the combined-moments shape (D1019) — the only one the editor writes? */
export function isModesDelivery(delivery: NcSystemEventDelivery | undefined): delivery is NcModesDelivery {
  return delivery?.mode === 'modes'
}

/** The three moments a system-event rule can speak at (D1019). */
export type NcDeliveryMoment = 'activation' | 'deactivation' | 'schedule'

/** The scheduled summary of a delivery — its schedule and how it is grouped. */
export type NcScheduledSummary = NonNullable<NcSystemEventDeliveryModes['schedule']>

/** The stored `modes` shape for a set of moments — what the admin editor writes. */
export function modesDeliveryOf(modes: NcSystemEventDeliveryModes): NcModesDelivery {
  return {
    mode: 'modes',
    onActivation: modes.activation,
    onDeactivation: modes.deactivation,
    ...(modes.schedule !== null ? { onSchedule: modes.schedule } : {}),
  }
}

/** Is this kind a RECOVERY edge of some class (`device-online` for `device-offline`)? */
function isRecoveryKind(kind: string): boolean {
  return NC_SYSTEM_EVENT_CLASS_SPECS.some((spec) => spec.recovery.some((edge) => edge === kind))
}

/**
 * Does any selected kind have a recovery edge — so "when it resolves" can ever
 * speak? The hub's `systemEventDeliveryAsModes` derives its legacy
 * `onDeactivation` from exactly this, over the class-expanded kinds.
 */
export function kindsHaveRecovery(kinds: readonly string[]): boolean {
  // `expandSystemEventClasses` is typed on the kind enum; a rule's kinds are
  // that enum already, so the parameter is the enum, not a wider string.
  return expandSystemEventClasses(kinds.filter(isKindOfEnum)).some(isRecoveryKind)
}

function isKindOfEnum(kind: string): kind is NcSystemEventKind {
  return NcSystemEventKindSchema.safeParse(kind).success
}

/**
 * The moments a rule speaks at, KINDS-AWARE like the hub's
 * `systemEventDeliveryAsModes`: an absent / `instant` rule speaks on the
 * resolving edge only where its kinds have one — a kind with no recovery edge
 * says "when it starts" alone. `summary` and `modes` say themselves.
 */
export function systemEventMomentsOf(rule: {
  readonly systemEventDelivery?: NcSystemEventDelivery | undefined
  readonly kinds: readonly string[]
}): NcSystemEventDeliveryModes {
  const modes = systemEventDeliveryModesOf(rule)
  const legacyInstant = rule.systemEventDelivery === undefined || rule.systemEventDelivery.mode === 'instant'
  return legacyInstant ? { ...modes, deactivation: kindsHaveRecovery(rule.kinds) } : modes
}

/** Can "when it resolves" be switched ON for these kinds? Only where one has a recovery edge. */
export function resolveMomentOffered(kinds: readonly string[]): boolean {
  return kindsHaveRecovery(kinds)
}

/**
 * The delivery with ONE moment switched on or off, whatever shape it was
 * stored in (absent / `instant` / `summary` are read through
 * {@link systemEventMomentsOf}, and written back as `modes`).
 *
 * Two switches are REFUSED, the same delivery coming back: one that would
 * leave every moment off (the hub's `no-mode`), and "when it resolves" ON for
 * kinds with no recovery edge (a rule that could never speak on it). Switching
 * the scheduled summary on starts it every day at 08:00, one message per
 * category — the admin's default.
 */
export function withDeliveryMoment(
  value: NcSystemEventDelivery | undefined,
  moment: NcDeliveryMoment,
  on: boolean,
  kinds: readonly string[],
): NcSystemEventDelivery | undefined {
  const modes = systemEventMomentsOf({ systemEventDelivery: value, kinds })
  if (moment === 'deactivation' && on && !kindsHaveRecovery(kinds)) return value
  const next: NcSystemEventDeliveryModes =
    moment === 'schedule'
      ? {
          ...modes,
          schedule: on
            ? (modes.schedule ?? {
                schedule: scheduleForSendTimes([NC_SUMMARY_DEFAULT_SEND_TIME]),
                grouping: 'section',
              })
            : null,
        }
      : { ...modes, [moment === 'activation' ? 'activation' : 'deactivation']: on }
  if (!next.activation && !next.deactivation && next.schedule === null) return value
  return modesDeliveryOf(next)
}

/** The delivery with a new scheduled summary (schedule and/or grouping); the other moments KEPT. */
export function withScheduledSummary(
  value: NcSystemEventDelivery | undefined,
  schedule: NcScheduledSummary,
  kinds: readonly string[],
): NcModesDelivery {
  return modesDeliveryOf({ ...systemEventMomentsOf({ systemEventDelivery: value, kinds }), schedule })
}

/** A summary rule's delivery — the one variant that carries a schedule. */
export type NcSummaryDelivery = Extract<NcSystemEventDelivery, { readonly mode: 'summary' }>

const DAY_MINUTES = 1440
const EVERY_DAY: readonly number[] = [0, 1, 2, 3, 4, 5, 6]

/** A new send time: every day at 08:00 — the admin's default. */
export const NC_SUMMARY_DEFAULT_SEND_TIME: NcSummarySendTime = {
  days: EVERY_DAY,
  minute: 8 * 60,
}

function sortedDays(days: readonly number[]): number[] {
  return [...days].sort((a, b) => a - b)
}

/**
 * Send times → schedule. Midnight starts its window at 23:59 of the day
 * BEFORE, because a window's `days` are the days it STARTS on.
 */
export function scheduleForSendTimes(times: readonly NcSummarySendTime[], timezone?: string): NcSchedule {
  const windows: NcScheduleWindow[] = times.map((time) => ({
    days: sortedDays(time.minute === 0 ? time.days.map((day) => (day + 6) % 7) : time.days),
    startMinute: (time.minute + DAY_MINUTES - 1) % DAY_MINUTES,
    endMinute: time.minute,
  }))
  return { windows, ...(timezone !== undefined ? { timezone } : {}) }
}

/** Schedule → send times, or `null` when it is not a list of one-minute windows. */
export function sendTimesOfSchedule(schedule: NcSchedule): readonly NcSummarySendTime[] | null {
  if (schedule.invert === true) return null
  const times: NcSummarySendTime[] = []
  for (const window of schedule.windows) {
    if ((window.endMinute - window.startMinute + DAY_MINUTES) % DAY_MINUTES !== 1) return null
    const days = window.endMinute === 0 ? window.days.map((day) => (day + 1) % 7) : window.days
    times.push({ days: sortedDays(days), minute: window.endMinute })
  }
  return times
}

/** The delivery a switch to Summary starts on: one send time, every day at 08:00. */
export function defaultSummaryDelivery(): NcSummaryDelivery {
  return {
    mode: 'summary',
    schedule: scheduleForSendTimes([NC_SUMMARY_DEFAULT_SEND_TIME]),
  }
}

/** Does this rule kind offer the Delivery control? The alarm stays instant; `mixed` is read-only. */
export function summaryDeliveryOffered(kind: NcRuleKind): boolean {
  const family = systemFamilyOfKind(kind)
  return family !== undefined && NC_SYSTEM_EVENT_SUMMARY_FAMILIES.includes(family)
}

/** What the delivery is judged on — a form, or a stored rule (absent = instant). */
export interface NcDeliveryFormSlice {
  readonly delivery: NcDelivery
  readonly systemEventDelivery?: NcSystemEventDelivery | undefined
}

/**
 * Is this form a scheduled STATE SUMMARY — a rule that speaks ONLY on its
 * schedule, with no message per event (the hub's `isScheduleOnlySystemRule`)?
 * Absent and `instant` are the same answer, and so is a `modes` rule that
 * also speaks when a condition starts or clears.
 */
export function isStateSummaryForm(form: NcDeliveryFormSlice): boolean {
  if (form.delivery !== 'system-event') return false
  const modes = systemEventDeliveryModesOf({
    systemEventDelivery: form.systemEventDelivery,
  })
  return modes.schedule !== null && !modes.activation && !modes.deactivation
}

/** The summary's schedule, or `null` for any rule that is not a summary system rule. */
export function summaryScheduleOf(rule: NcDeliveryFormSlice): NcSchedule | null {
  const delivery = rule.systemEventDelivery
  return rule.delivery === 'system-event' && delivery?.mode === 'summary' ? delivery.schedule : null
}

/**
 * The delivery a save sends — the admin's `systemEventDeliveryForSave`. A
 * system rule sends what the form holds; a rule on ANOTHER trigger that still
 * carries a summary sends `{ mode: 'instant' }`, or the stored summary would
 * survive the hub's merge and the save be refused as `not-a-system-rule`.
 * Absent stays absent: a rule authored before D647 round-trips without the key.
 */
export function systemEventDeliveryForSave(form: NcDeliveryFormSlice): {
  readonly systemEventDelivery?: NcSystemEventDelivery
} {
  const delivery = form.systemEventDelivery
  if (delivery === undefined) return {}
  if (form.delivery === 'system-event') return { systemEventDelivery: delivery }
  return delivery.mode === 'instant' ? {} : { systemEventDelivery: { mode: 'instant' } }
}

/** Why the save of a summary rule is blocked — each a `v2.nc.rules.editor.problem.*` key. */
export const NC_SUMMARY_FORM_PROBLEMS = [
  'summaryFamily',
  'summaryNoSendTime',
  'summaryDegenerateWindow',
  'summaryActions',
  'summaryActionsByAdmin',
  'noMode',
  'noInstantKind',
] as const
export type NcSummaryFormProblem = (typeof NC_SUMMARY_FORM_PROBLEMS)[number]

function problemOf(problem: NcSystemEventDeliveryProblem, isAdmin: boolean): NcSummaryFormProblem | null {
  switch (problem.code) {
    case 'family-not-summarisable':
      return 'summaryFamily'
    case 'empty-schedule':
      return 'summaryNoSendTime'
    case 'degenerate-window':
      return 'summaryDegenerateWindow'
    // The Actions section is an admin's only (`editorSectionsFor`): a user is
    // told who can remove them, never pointed at a screen they do not have.
    case 'actions-beside-summary':
      return isAdmin ? 'summaryActions' : 'summaryActionsByAdmin'
    case 'no-mode':
      return 'noMode'
    case 'no-instant-kind':
      return 'noInstantKind'
    // Never reached from this editor: a save sends `instant` off a system
    // trigger, and never sends the active-hours schedule beside a summary.
    case 'not-a-system-rule':
    case 'schedule-beside-summary':
      return null
  }
}

/**
 * The hub's own D647 verdict on what a save would send, as editor problems.
 * The active-hours schedule is left out on purpose: `formToInput` never sends
 * it beside a summary (whether a stored one is CLEARED is `ruleClearsFor`'s
 * call — only on a hub known to keep the summary).
 */
export function summaryFormProblems(
  form: Pick<NcRuleFormState, 'delivery' | 'systemEventDelivery' | 'conditions' | 'actions'>,
  options: { readonly isAdmin?: boolean } = {},
): readonly NcSummaryFormProblem[] {
  const stored = form.systemEventDelivery
  // The hub judges every non-instant delivery (`summary` and `modes`); an
  // absent or `instant` one is never refused.
  if (form.delivery !== 'system-event' || stored === undefined || stored.mode === 'instant') return []
  const { actions } = formToActions(form.actions)
  // The actions mirror IS the hub's shape now (hook bindings to shared
  // sequences), so the hub's own verdict judges them — 'actions-beside-summary'
  // included.
  const problems: readonly NcSystemEventDeliveryProblem[] = systemEventDeliveryProblems({
    delivery: form.delivery,
    conditions: form.conditions,
    systemEventDelivery: stored,
    ...(actions !== undefined ? { actions } : {}),
  })
  const out: NcSummaryFormProblem[] = []
  for (const problem of problems) {
    const mapped = problemOf(problem, options.isAdmin === true)
    if (mapped !== null && !out.includes(mapped)) out.push(mapped)
  }
  return out
}

/**
 * Does this hub KEEP a summary it is sent (D647)? Read off the template
 * catalog it SERVED, before this build restores anything into it: a D647 hub
 * declares the delivery axis on its own descriptors (`{{eventKind}}` is
 * `systemEventDeliveries: ['instant']`), and an older one has never heard of
 * the key. `false` for an older hub AND for a catalog nobody answered — the
 * caller must treat both as "not known to keep it" (D315).
 */
export function hubKeepsSummaryDelivery(served: readonly NcTemplateVarDescriptor[] | undefined): boolean {
  return served !== undefined && served.some((descriptor) => descriptor.systemEventDeliveries !== undefined)
}

/**
 * Does the notification BODY need the "the hub appends the summary" warning?
 * A custom body that names none of the summary's content would send a summary
 * with nothing in it, so the hub appends `{{summaryText}}` to it.
 */
export function summaryBodyWarning(
  form: Pick<NcRuleFormState, 'delivery' | 'systemEventDelivery' | 'templateBody'>,
): boolean {
  return isStateSummaryForm(form) && !templateCarriesSummary(form.templateBody)
}

// ── The split (D698): one message, or one per category ─────────────────────

/** How this summary is sent; absent (every rule before D698) is one message. */
export function summarySplitOf(value: NcSummaryDelivery): NcStateSummarySplit {
  return value.split ?? 'rule'
}

/** The summary with a new schedule — its split KEPT. */
export function withSummarySchedule(value: NcSummaryDelivery, schedule: NcSchedule): NcSummaryDelivery {
  return { ...value, schedule }
}

/** The summary with a split; `rule` is stored as ABSENT, as on the admin. */
export function withSummarySplit(value: NcSummaryDelivery, split: NcStateSummarySplit): NcSummaryDelivery {
  const { split: _previous, ...rest } = value
  return split === 'section' ? { ...rest, split } : rest
}

/**
 * Does a SPLIT rule's body need the "completed on the other categories"
 * warning? A body naming one section's variable and no `{{summaryText}}` would
 * be empty on every other category's notification, so the hub appends
 * `{{summaryText}}` there (D698 review M3).
 */
export function summarySplitBodyWarning(
  form: Pick<NcRuleFormState, 'delivery' | 'systemEventDelivery' | 'templateBody'>,
): boolean {
  if (!isStateSummaryForm(form)) return false
  const summary = systemEventDeliveryModesOf({
    systemEventDelivery: form.systemEventDelivery,
  }).schedule
  if (summary?.grouping !== 'section') return false
  const body = form.templateBody
  return body.trim().length > 0 && templateCarriesSummary(body) && !/\{\{\s*summaryText\s*\}\}/.test(body)
}

const SPLIT_KEY = 'v2.nc.rules.editor.systemDelivery'

/** Every key the split control and its warning use — the locale spec walks it. */
export const NC_SUMMARY_SPLIT_KEYS: readonly string[] = [
  `${SPLIT_KEY}.splitRule`,
  `${SPLIT_KEY}.splitSection`,
  `${SPLIT_KEY}.splitHint`,
  `${SPLIT_KEY}.splitBodyWarning`,
]

// ── The words: "Summary · daily 08:00" ────────────────────────────────────

const LABEL = 'v2.nc.rules.summaryDelivery'

/** The weekday word keys, in the editor's Monday-first order. */
export const NC_SUMMARY_WEEKDAYS: readonly {
  readonly value: number
  readonly labelKey: string
}[] = [
  { value: 1, labelKey: 'v2.nc.rules.editor.weekday.mon' },
  { value: 2, labelKey: 'v2.nc.rules.editor.weekday.tue' },
  { value: 3, labelKey: 'v2.nc.rules.editor.weekday.wed' },
  { value: 4, labelKey: 'v2.nc.rules.editor.weekday.thu' },
  { value: 5, labelKey: 'v2.nc.rules.editor.weekday.fri' },
  { value: 6, labelKey: 'v2.nc.rules.editor.weekday.sat' },
  { value: 0, labelKey: 'v2.nc.rules.editor.weekday.sun' },
]

/** Every key {@link summaryDeliveryLabel} can use — the locale spec walks it. */
export const NC_SUMMARY_DELIVERY_LABEL_KEYS: readonly string[] = [
  `${LABEL}.label`,
  `${LABEL}.custom`,
  `${LABEL}.daily`,
  `${LABEL}.weekdays`,
  `${LABEL}.weekends`,
]

/** A translator, injected so the words stay testable without i18next. */
export type NcTranslate = (key: string, params?: Readonly<Record<string, string>>) => string

export function hhmmOfMinute(minute: number): string {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Minute of day from `HH:MM`, or `null` when it is not a time — never a guess. */
export function minuteOfHhmm(value: string): number | null {
  const match = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(value)
  if (match === null) return null
  const h = Number(match[1])
  const m = Number(match[2])
  return h <= 23 && m <= 59 ? h * 60 + m : null
}

function sameDays(a: readonly number[], b: readonly number[]): boolean {
  const x = sortedDays(a)
  const y = sortedDays(b)
  return x.length === y.length && x.every((day, i) => day === y[i])
}

function daysPhrase(days: readonly number[], t: NcTranslate): string {
  if (sameDays(days, EVERY_DAY)) return t(`${LABEL}.daily`)
  if (sameDays(days, [1, 2, 3, 4, 5])) return t(`${LABEL}.weekdays`)
  if (sameDays(days, [0, 6])) return t(`${LABEL}.weekends`)
  return NC_SUMMARY_WEEKDAYS.filter((d) => days.includes(d.value))
    .map((d) => t(d.labelKey))
    .join(', ')
}

/**
 * "Summary · daily 08:00", "Summary · weekdays 07:30, 19:00", "Summary · Mon,
 * Thu 09:00; weekends 10:00" — send times grouped by their days, in the order
 * they were authored. A schedule that is not a list of send times is "Summary
 * · custom schedule": its windows are shown in the editor, not squeezed here.
 */
export function summaryDeliveryLabel(schedule: NcSchedule, t: NcTranslate): string {
  const times = sendTimesOfSchedule(schedule)
  if (times === null || times.length === 0) return t(`${LABEL}.custom`)
  const groups: { days: readonly number[]; minutes: number[] }[] = []
  for (const time of times) {
    const group = groups.find((g) => sameDays(g.days, time.days))
    if (group === undefined) groups.push({ days: time.days, minutes: [time.minute] })
    else group.minutes.push(time.minute)
  }
  const when = groups
    .map(
      (g) =>
        `${daysPhrase(g.days, t)} ${[...g.minutes]
          .sort((a, b) => a - b)
          .map(hhmmOfMinute)
          .join(', ')}`,
    )
    .join('; ')
  return t(`${LABEL}.label`, { when })
}

// ── History: a summary row is about no one device ─────────────────────────

/** The part of a history row that says whether it is a state summary. */
export interface NcHistoryRowSlice {
  readonly recordId: string
  readonly subject: {
    readonly systemEvent?: { readonly data: Readonly<Record<string, unknown>> }
  }
}

/**
 * Is this delivery a STATE SUMMARY? The hub files one under the system device
 * (0), with `data.stateSummary` and a `state-summary:<rule>:<window end>`
 * record id — so the row is named "State summary", never "Device #0".
 */
export function isStateSummaryHistoryRow(entry: NcHistoryRowSlice): boolean {
  return entry.subject.systemEvent?.data['stateSummary'] === true || entry.recordId.startsWith('state-summary:')
}
