/**
 * sensor-transition — D640 "Notify when" on the phone: a sensor rule fires on
 * the raise, the clear, or both (`conditions.sensorTransition`, ABSENT = both;
 * there is no `'both'` member, and choosing "both" deletes the key).
 *
 * Every rule is SHARED with the admin and the hub, from `@camstack/types`:
 *  - the support rule, `sensorTransitionOffered(sensorKinds)` — offered only
 *    when the rule names at least one sensor kind and every one raises and
 *    clears;
 *  - the reason a save prunes it, `NC_SENSOR_TRANSITION_UNSUPPORTED_REASON`;
 *  - the alarm rule that can never fire, `sensorTransitionNeverFires`.
 *
 * What this file adds: the widget's choices (served, with a local fallback),
 * and the ONE prune the save funnel applies — so the warning next to Save and
 * what the save drops are the same set.
 *
 * Pure and RN-free.
 */
import {
  NC_SENSOR_TRANSITION_UNSUPPORTED_REASON,
  sensorTransitionNeverFires,
  sensorTransitionOffered,
} from '@camstack/types/client'
import type { NcDroppedCondition, NcRuleKind } from '@camstack/types'
import type { ActionStep } from '@camstack/types'
import type {
  NcConditionDescriptor,
  NcConditions,
  NcDelivery,
  NcRuleActions,
} from '../../data/notification-center.js'

/** The stored edge; `undefined` is both. */
export type NcSensorTransition = NonNullable<NcConditions['sensorTransition']>

/** A choice's value on the control: `''` is the ABSENT state (both edges). */
export type NcSensorTransitionChoiceValue = '' | NcSensorTransition

/** One choice as the control draws it. */
export interface NcSensorTransitionChoice {
  readonly value: NcSensorTransitionChoiceValue
  /** i18n key of the label. */
  readonly labelKey: string
  /** The English label (served, or local) — the i18n default. */
  readonly fallbackLabel: string
  /** i18n key of what this choice matches. */
  readonly hintKey: string
  /** The served hint, when the hub sent one — the i18n default. */
  readonly hint?: string
}

const PREFIX = 'v2.nc.rules.editor.sensorTransition'

/** The i18n key under which a CHOICE value is named (`''` is `both`). */
function choiceKey(value: NcSensorTransitionChoiceValue): string {
  return value === '' ? 'both' : value
}

/** One choice before it is keyed: its value, English label and served hint. */
interface SensorTransitionSourceChoice {
  readonly value: NcSensorTransitionChoiceValue
  readonly label: string
  readonly hint?: string
}

/** The local fallback, for a hub that serves no options. */
const LOCAL_CHOICES: readonly SensorTransitionSourceChoice[] = [
  { value: '', label: 'It triggers and when it clears' },
  { value: 'raised', label: 'Only when it triggers' },
  { value: 'cleared', label: 'Only when it clears' },
]

/** A select's raw value back to the condition; `''`, `'both'` and unknown → absent. */
export function parseSensorTransition(value: string): NcConditions['sensorTransition'] {
  return value === 'raised' || value === 'cleared' ? value : undefined
}

/** Narrow a served option value to a choice this build understands. */
function parseChoiceValue(value: string): NcSensorTransitionChoiceValue | undefined {
  if (value === '') return ''
  return parseSensorTransition(value)
}

/**
 * The control's choices: the hub's SET when it serves one (it knows which
 * choices exist, with a hint each), this build's words where it has them; the
 * local three otherwise — never an empty control.
 */
export function sensorTransitionChoices(
  served: NcConditionDescriptor['options'],
): readonly NcSensorTransitionChoice[] {
  const source: readonly SensorTransitionSourceChoice[] =
    served !== undefined && served.length > 0
      ? served.flatMap((option): SensorTransitionSourceChoice[] => {
          const value = parseChoiceValue(option.value)
          return value === undefined
            ? []
            : [{ value, label: option.label, ...(option.hint !== undefined ? { hint: option.hint } : {}) }]
        })
      : LOCAL_CHOICES
  return source.map((choice) => ({
    value: choice.value,
    labelKey: `${PREFIX}.${choiceKey(choice.value)}`,
    fallbackLabel: choice.label,
    hintKey: `${PREFIX}.hint.${choiceKey(choice.value)}`,
    ...(choice.hint !== undefined ? { hint: choice.hint } : {}),
  }))
}

/**
 * The one condition whose offer depends on ANOTHER condition of the same
 * rule: "Notify when" only when every chosen sensor kind raises and clears.
 * Hidden in the editor otherwise, on top of the kind/trigger visibility.
 */
export function conditionSupportedByRule(conditionId: string, conditions: NcConditions): boolean {
  if (conditionId === 'sensorTransition') return sensorTransitionOffered(conditions.sensorKinds)
  return true
}

/** May a save keep the chosen edge? A device-event SENSOR rule whose kinds all raise. */
function sensorTransitionKept(conditions: NcConditions, delivery: NcDelivery, kind: NcRuleKind): boolean {
  return delivery === 'device-event' && kind === 'sensor' && sensorTransitionOffered(conditions.sensorKinds)
}

/** The save's prune: the edge is dropped wherever it cannot apply. */
export function pruneSensorTransition(
  conditions: NcConditions,
  delivery: NcDelivery,
  kind: NcRuleKind,
): NcConditions {
  if (conditions.sensorTransition === undefined) return conditions
  if (sensorTransitionKept(conditions, delivery, kind)) return conditions
  const { sensorTransition, ...rest } = conditions
  void sensorTransition
  return rest
}

/**
 * The drop a SENSOR rule announces before the save: it carries an edge while
 * a chosen kind has no raise (or none is chosen). Other kinds announce it
 * through the shared kind table (`droppedConditionsForKind`).
 */
export function sensorTransitionDrop(conditions: NcConditions, kind: NcRuleKind): NcDroppedCondition | null {
  if (kind !== 'sensor' || conditions.sensorTransition === undefined) return null
  if (sensorTransitionOffered(conditions.sensorKinds)) return null
  return { conditionId: 'sensorTransition', reason: NC_SENSOR_TRANSITION_UNSUPPORTED_REASON }
}

/** The i18n key of the drop reason (the shared sentence is its English). */
export function sensorTransitionReasonKey(): string {
  return 'v2.nc.rules.editor.dropReason.sensor.sensorTransition'
}

/** The i18n key of the never-fires warning (the shared sentence is its English). */
export const SENSOR_TRANSITION_NEVER_FIRES_KEY = `${PREFIX}.neverFires`

/** The actions half of the never-fires question: what the rule runs, and how
 *  an Action id resolves to its steps (`actions.list`). */
export interface NcSensorTransitionAlarmActions {
  /** The rule's actions, as the save would send them. */
  readonly actions?: NcRuleActions
  /** An Action's steps — without it an Action id proves nothing. */
  readonly actionStepsOf?: (actionId: string) => readonly ActionStep[] | undefined
}

/** What the never-fires question reads off an editor form. */
export interface NcSensorTransitionAlarmSubject extends NcSensorTransitionAlarmActions {
  readonly conditions: NcConditions
}

/**
 * Openings the alarm refuses a closing edge for — the same list as
 * `NC_ALARM_OPENING_EVENT_KINDS` in `alarm-membership.ts`. Not imported: the
 * value is not on the client entry the phone loads.
 */
const ALARM_OPENING_KINDS: readonly string[] = ['contact', 'cover', 'lock', 'switch']
const ALARM_PANEL_CAP = 'alarm-panel'
const ALARM_PANEL_TRIGGER = 'trigger'

function isOpeningKind(kind: string): boolean {
  const normalized = kind.trim().toLowerCase()
  return ALARM_OPENING_KINDS.some((opening) => opening === normalized)
}

/** An on-match Action whose steps pull `alarm-panel.trigger`. */
function onTriggerPullsAlarm(subject: NcSensorTransitionAlarmSubject): boolean {
  const resolve = subject.actionStepsOf
  for (const actionId of subject.actions?.onTrigger ?? []) {
    const steps = resolve?.(actionId)
    if (
      steps?.some(
        (step) => step.kind === 'cap' && step.cap === ALARM_PANEL_CAP && step.method === ALARM_PANEL_TRIGGER,
      )
    ) {
      return true
    }
  }
  return false
}

/**
 * An alarm rule over openings asking for "only when it clears" — the alarm
 * refuses every closing, the edge refuses every opening. Not refused on save
 * (alarm membership is derived and can change with an action edit), but SAID.
 *
 * The armed-state half is the shared predicate. An Action id proves membership
 * here, from the steps `actions.list` returned: the build the phone loads
 * still resolves the retired sequence bindings, which an id cannot.
 */
export function sensorTransitionNeverFiresFor(subject: NcSensorTransitionAlarmSubject): boolean {
  if (subject.conditions.sensorTransition !== 'cleared') return false
  const kinds = subject.conditions.sensorKinds ?? []
  if (kinds.length === 0 || !kinds.every(isOpeningKind)) return false
  if (onTriggerPullsAlarm(subject)) return true
  return sensorTransitionNeverFires({ conditions: subject.conditions })
}
