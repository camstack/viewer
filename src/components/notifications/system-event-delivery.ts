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
  NC_SYSTEM_EVENT_SUMMARY_FAMILIES,
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
  NcTemplateVarDescriptor,
} from '../../data/notification-center.js'
import { formToActions } from './rule-action-form.js'
// TYPE-only: `rule-editor.ts` imports this module at runtime.
import type { NcRuleFormState } from './rule-editor.js'

/** One send time as the editor presents it: the days it is sent on, and the minute. */
export interface NcSummarySendTime {
  readonly days: readonly number[]
  /** Minute of the day, 0–1439. */
  readonly minute: number
}

/** A summary rule's delivery — the one variant that carries a schedule. */
export type NcSummaryDelivery = Extract<NcSystemEventDelivery, { readonly mode: 'summary' }>

const DAY_MINUTES = 1440
const EVERY_DAY: readonly number[] = [0, 1, 2, 3, 4, 5, 6]

/** A new send time: every day at 08:00 — the admin's default. */
export const NC_SUMMARY_DEFAULT_SEND_TIME: NcSummarySendTime = { days: EVERY_DAY, minute: 8 * 60 }

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
  return { mode: 'summary', schedule: scheduleForSendTimes([NC_SUMMARY_DEFAULT_SEND_TIME]) }
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

/** Is this form a scheduled STATE SUMMARY? Absent and `instant` are the same answer. */
export function isStateSummaryForm(form: NcDeliveryFormSlice): boolean {
  return form.delivery === 'system-event' && form.systemEventDelivery?.mode === 'summary'
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
export function systemEventDeliveryForSave(
  form: NcDeliveryFormSlice,
): { readonly systemEventDelivery?: NcSystemEventDelivery } {
  const delivery = form.systemEventDelivery
  if (delivery === undefined) return {}
  if (form.delivery === 'system-event') return { systemEventDelivery: delivery }
  return delivery.mode === 'summary' ? { systemEventDelivery: { mode: 'instant' } } : {}
}

/** Why the save of a summary rule is blocked — each a `v2.nc.rules.editor.problem.*` key. */
export const NC_SUMMARY_FORM_PROBLEMS = [
  'summaryFamily',
  'summaryNoSendTime',
  'summaryDegenerateWindow',
  'summaryActions',
  'summaryActionsByAdmin',
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
  if (!isStateSummaryForm(form)) return []
  const { actions } = formToActions(form.actions)
  // The actions mirror IS the hub's shape now (hook bindings to shared
  // sequences), so the hub's own verdict judges them — 'actions-beside-summary'
  // included.
  const problems: readonly NcSystemEventDeliveryProblem[] = systemEventDeliveryProblems({
    delivery: form.delivery,
    conditions: form.conditions,
    ...systemEventDeliveryForSave(form),
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
export function summaryBodyWarning(form: Pick<NcRuleFormState, 'delivery' | 'systemEventDelivery' | 'templateBody'>): boolean {
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
  const delivery = form.systemEventDelivery
  if (!isStateSummaryForm(form) || delivery?.mode !== 'summary' || summarySplitOf(delivery) !== 'section') return false
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
export const NC_SUMMARY_WEEKDAYS: readonly { readonly value: number; readonly labelKey: string }[] = [
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
    .map((g) => `${daysPhrase(g.days, t)} ${[...g.minutes].sort((a, b) => a - b).map(hhmmOfMinute).join(', ')}`)
    .join('; ')
  return t(`${LABEL}.label`, { when })
}

// ── History: a summary row is about no one device ─────────────────────────

/** The part of a history row that says whether it is a state summary. */
export interface NcHistoryRowSlice {
  readonly recordId: string
  readonly subject: { readonly systemEvent?: { readonly data: Readonly<Record<string, unknown>> } }
}

/**
 * Is this delivery a STATE SUMMARY? The hub files one under the system device
 * (0), with `data.stateSummary` and a `state-summary:<rule>:<window end>`
 * record id — so the row is named "State summary", never "Device #0".
 */
export function isStateSummaryHistoryRow(entry: NcHistoryRowSlice): boolean {
  return entry.subject.systemEvent?.data['stateSummary'] === true || entry.recordId.startsWith('state-summary:')
}

