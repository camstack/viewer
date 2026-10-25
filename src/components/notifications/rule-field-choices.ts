/**
 * rule-field-choices — what the parity controls of the rule editor OFFER.
 *
 * RN-free, so every offer is pinned against the mirror's schema in a node spec:
 * a chip the hub would refuse is a save that fails for a reason the operator
 * cannot see.
 */
import {
  NC_ALARM_SYSTEM_EVENT_KINDS,
  NC_GROUPING_MAX_SEC,
  NC_GROUPING_MIN_SEC,
} from '@camstack/types/client'
import type { NcRuleKind } from '@camstack/types'
import {
  NcConfirmExpectSchema,
  type NcConditions,
  type NcConfirmExpect,
  type NcRuleAction,
  type NcSharedSequence,
} from '../../data/notification-center.js'

/** The cooldown stepper's ceiling. The hub accepts a day; a phone stepper past
 *  an hour is not a control anybody uses — a stored longer value still shows. */
export const NC_COOLDOWN_UI_MAX_SEC = 3_600
export const NC_COOLDOWN_STEP_SEC = 10

/** The grouping window stepper (D692): the cap's own 5..60, imported — never copied. */
export const NC_GROUPING_STEPPER = {
  min: NC_GROUPING_MIN_SEC,
  max: NC_GROUPING_MAX_SEC,
  step: 5,
} as const

/** Clip playback speeds offered (the admin's list). The schema is `1..8`. */
export const NC_CLIP_SPEED_CHOICES: readonly number[] = [1, 2, 3, 4, 6, 8]

/**
 * Is the linked-cameras mode meaningful for this kind? Only a SENSOR rule has
 * linked cameras to compose — every other kind's picture is its own camera's.
 */
export function linkedCamerasApplies(kind: NcRuleKind): boolean {
  return kind === 'sensor'
}

export type NcConfirmOp = NcConfirmExpect['op']

/** The comparisons the AI confirm gate's count may be held to. */
export const NC_CONFIRM_OPS: readonly NcConfirmOp[] = NcConfirmExpectSchema.shape.op.options

/** A picked value back to an operator — `undefined` for "the model decides". */
export function parseConfirmOp(value: string): NcConfirmOp | undefined {
  return NC_CONFIRM_OPS.find((op) => op === value)
}

/**
 * A zone the runtime can resolve. Blank is NOT a zone: an unset timezone means
 * "the hub's zone" and is written as absent.
 */
export function isValidTimeZone(zone: string): boolean {
  if (zone.trim().length === 0) return false
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * Every zone the runtime lists, or `null` when it cannot list them (Hermes
 * without `Intl.supportedValuesOf`) — the screen then offers a validated text
 * box instead of a picker with nothing in it.
 */
export function timeZoneChoices(): readonly string[] | null {
  if (typeof Intl.supportedValuesOf !== 'function') return null
  try {
    return Intl.supportedValuesOf('timeZone')
  } catch {
    return null
  }
}

const ALARM_KINDS: ReadonlySet<string> = new Set<string>(NC_ALARM_SYSTEM_EVENT_KINDS)
const ALARM_PANEL_CAP = 'alarm-panel'

/**
 * Is this rule one a snooze can never silence? The admin's
 * `isRuleSnoozeExempt`: true when the rule is ABOUT the panel (a system-event
 * alarm kind — the PUBLISHED list) or ACTUATES it (a step on the `alarm-panel`
 * cap, among the steps its bindings and buttons run — resolved through the
 * shared sequences by `formActionSteps` / `storedActionSteps`). Derived, never
 * stored — the hub's `snooze-exempt` is the authority, and this exists so the
 * editor does not offer what the hub ignores.
 */
export function isSnoozeExempt(conditions: NcConditions, steps: readonly NcRuleAction[]): boolean {
  if (isAboutAlarm(conditions)) return true
  return steps.some((step) => step.kind === 'cap' && step.cap === ALARM_PANEL_CAP)
}

/** A shared sequence's steps by id — `undefined` for one the list does not carry. */
export function sequenceResolver(
  sequences: readonly NcSharedSequence[],
): (sequenceId: string) => readonly NcRuleAction[] | undefined {
  const byId = new Map(sequences.map((sequence) => [sequence.id, sequence.actions]))
  return (sequenceId) => byId.get(sequenceId)
}

function isAboutAlarm(conditions: NcConditions): boolean {
  return (conditions.systemEvent?.kinds ?? []).some((kind) => ALARM_KINDS.has(kind))
}
