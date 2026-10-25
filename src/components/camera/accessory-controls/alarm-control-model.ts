/**
 * The alarm control's decisions, pure so they are testable without React
 * Native (D630).
 *
 * ARMING has two paths, and which one is not a preference:
 *
 *  - the Notification Center's own panel, for a CONFIRMED admin, goes through
 *    the `nc.*` bridge — the only path on which a refused arm comes back as a
 *    result with an id, so the control can offer Arm anyway bound to it;
 *  - every other panel, and every non-admin (the bridge refuses them), goes
 *    through the device-scoped `alarm-panel` cap. A refusal there is a thrown
 *    error, shown inline; Arm anyway reaches a non-admin through the refusal
 *    notification's own button.
 *
 * A pending role, or an admin whose panel lookup has not answered (or failed
 * for a reason that is not a refusal by name), is neither path yet: arming
 * waits rather than guessing (D315).
 *
 * DISARMING never waits on a read (C1). The cap's disarm and `nc.disarmAlarm`
 * end in the same `panel.disarm()`, so "which path" is a question only Arm
 * needs answered: until it is, Disarm goes through the cap. And an unreadable
 * panel is UNKNOWN — never "disarmed" — so Disarm stays reachable (D49, D393).
 */
import type { AlarmState } from '@camstack/types'
import type { AdminVerdict } from '../../../data/use-me.js'
import type { AlarmArmMode, AlarmStatus } from '../../../data/use-accessory-controls.js'
import type {
  NcAlarmArmAnywayRejection,
  NcAlarmArmOutcome,
  NcAlarmLive,
  NcAlarmOpenDevice,
  NcPanelLookup,
} from '../../../data/nc-alarm.js'

export interface AlarmControlModelInput {
  /** The panel's cap status; null when the read failed or could not be parsed. */
  readonly status: AlarmStatus | null
  /** The NC panel's own live view (`nc.getAlarmStatus`), when the phone has it. */
  readonly ncLive: NcAlarmLive | null
  /** Ms epoch the live view was fetched at (react-query `dataUpdatedAt`). */
  readonly ncLiveAt: number | null
  readonly ncPanel: NcPanelLookup
  readonly verdict: AdminVerdict
  readonly deviceId: number
  /** What the last nc.* arm / Arm anyway on this control came to. */
  readonly lastOutcome: NcAlarmArmOutcome | null
  /** Ms epoch that outcome arrived at. */
  readonly lastOutcomeAt: number | null
}

/** A refused arm the operator can still get past — the id Arm anyway sends. */
export interface AlarmRefusalView {
  readonly refusalId: string
  readonly blocking: readonly NcAlarmOpenDevice[]
}

/** A device an armed panel is ignoring. `name` may be empty: the UI says "Device #id". */
export interface AlarmExcludedView {
  readonly deviceId: number
  readonly name: string
}

/**
 * An input (a rule × device pair) the armed panel is ignoring until the next
 * disarm, and how many of its triggers were dropped since. `name` may be
 * empty: the UI says "Device #id".
 */
export interface AlarmBypassedView {
  readonly ruleId: string
  readonly deviceId: number
  readonly name: string
  readonly dropped: number
}

export type AlarmPath = 'nc' | 'cap'

export interface AlarmControlModel {
  /** One arm button per mode; empty for a coded panel (no PIN entry inline). */
  readonly modes: readonly AlarmArmMode[]
  /** Null while it cannot be decided — no arm is offered. */
  readonly armPath: AlarmPath | null
  /** Always decided: the cap until the nc path is. */
  readonly disarmPath: AlarmPath
  /** The panel's state; null = UNKNOWN (never folded into `disarmed`). */
  readonly state: AlarmState | null
  /** Armed, or on its way / going off — every state Disarm is the answer to. */
  readonly armed: boolean
  readonly canArm: boolean
  readonly canDisarm: boolean
  /** An admin's panel lookup failed for a reason that is not "no panel": say so. */
  readonly lookupUnknown: boolean
  readonly refusal: AlarmRefusalView | null
  /** Why the last Arm anyway was not honoured, if it was not (and the panel is not armed since). */
  readonly rejected: NcAlarmArmAnywayRejection | null
  /** What the armed panel is NOT watching. */
  readonly excluded: readonly AlarmExcludedView[]
  /**
   * Inputs bypassed for the rest of this arm session (`live.bypassedInputs`),
   * so an armed panel with a silenced input never reads as fully armed (D62).
   * Only the NC panel's own live view knows them; empty while disarmed.
   */
  readonly bypassed: readonly AlarmBypassedView[]
}

const ARMED_STATES: ReadonlySet<AlarmState> = new Set<AlarmState>([
  'armed_home',
  'armed_away',
  'armed_night',
  'armed_vacation',
  'armed_custom_bypass',
  'arming',
  'pending',
  'triggered',
])

function armPathOf(input: AlarmControlModelInput, isNcPanel: boolean): AlarmPath | null {
  if (input.verdict === 'pending') return null
  if (input.verdict !== 'admin') return 'cap'
  if (input.ncPanel.kind !== 'known') return null
  return isNcPanel ? 'nc' : 'cap'
}

/**
 * How alarming a state is — the tie-breaker when the NC row's two sources
 * disagree. Higher wins: a disagreement is settled on the side where Disarm is
 * reachable (D49), because the dangerous mistake is a panel that IS armed
 * reading disarmed, never the other way round.
 */
const ALARM_SEVERITY: Readonly<Record<AlarmState, number>> = {
  disarmed: 0,
  disarming: 1,
  arming: 2,
  armed_home: 3,
  armed_away: 3,
  armed_night: 3,
  armed_vacation: 3,
  armed_custom_bypass: 3,
  pending: 4,
  triggered: 5,
}

/**
 * The cap status, merged — on the NC panel's own row only — with the nc live
 * view (R1). The cap slice is event-invalidated with a five-minute backstop;
 * the live view is polled every 2–15 s. A dropped device event (D8) must not
 * leave a cached "disarmed" hiding a panel live reads as armed, so the state
 * is the MORE alarming of the two; modes and the PIN flag stay the cap's when
 * it answered.
 */
function effectiveStatus(input: AlarmControlModelInput, isNcPanel: boolean): AlarmStatus | null {
  const live = isNcPanel ? input.ncLive : null
  if (live === null) return input.status
  const fromLive: AlarmStatus = { state: live.state, availableModes: live.availableModes, requiresCode: false }
  if (input.status === null) return fromLive
  return ALARM_SEVERITY[live.state] > ALARM_SEVERITY[input.status.state]
    ? { ...input.status, state: live.state }
    : input.status
}

/**
 * True when the live view has caught up with this row's last arm: fetched
 * AFTER the outcome arrived, and reading armed (a fetch that STARTED before
 * the arm can land after it and still read the pre-arm panel).
 */
function liveCaughtUp(input: AlarmControlModelInput, live: NcAlarmLive): boolean {
  if (input.lastOutcomeAt === null) return true
  if (input.ncLiveAt === null || input.ncLiveAt <= input.lastOutcomeAt) return false
  return ALARM_SEVERITY[live.state] >= ALARM_SEVERITY.arming
}

/**
 * The panel's OWN list wins once it has caught up with this row's last arm:
 * the outcome is only what THIS row did, and a panel disarmed and re-armed
 * elsewhere since has a different list (N3). Right after an Arm anyway the
 * live snapshot still predates it, and would blank the line the operator just
 * earned, so the outcome holds until live catches up — and it is the fallback
 * for a row without the live view at all (a failed nc read).
 */
function excludedOf(input: AlarmControlModelInput, armed: boolean, isNcPanel: boolean): readonly AlarmExcludedView[] {
  if (!armed) return []
  const outcome = input.lastOutcome
  const fromOutcome = outcome?.outcome === 'armed' || outcome?.outcome === 'arming'
  const live = isNcPanel ? input.ncLive : null
  if (live !== null && (!fromOutcome || liveCaughtUp(input, live))) {
    return live.exclusions.map((x) => ({ deviceId: x.deviceId, name: x.name }))
  }
  if (fromOutcome) {
    return outcome.excluded.map((d) => ({ deviceId: d.deviceId, name: d.name }))
  }
  return []
}

function bypassedOf(input: AlarmControlModelInput, armed: boolean, isNcPanel: boolean): readonly AlarmBypassedView[] {
  const live = isNcPanel ? input.ncLive : null
  if (!armed || live === null) return []
  return live.bypassedInputs.map((b) => ({ ruleId: b.ruleId, deviceId: b.deviceId, name: b.name, dropped: b.dropped }))
}

export function alarmControlModel(input: AlarmControlModelInput): AlarmControlModel {
  const isNcPanel = input.ncPanel.kind === 'known' && input.ncPanel.panelId === input.deviceId
  const armPath = armPathOf(input, isNcPanel)
  const status = effectiveStatus(input, isNcPanel)
  const state = status?.state ?? null
  const armed = state !== null && ARMED_STATES.has(state)
  const requiresCode = status?.requiresCode ?? false
  const modes = status === null || requiresCode ? [] : [...status.availableModes]
  const outcome = input.lastOutcome
  return {
    modes,
    armPath,
    disarmPath: armPath === 'nc' ? 'nc' : 'cap',
    state,
    armed,
    canArm: armPath !== null && state === 'disarmed' && modes.length > 0,
    // Unknown is reachable, and so is `disarming`: disarm is idempotent, and a
    // panel stuck there (an HA panel can be) must be finishable from the row.
    canDisarm: state === null || armed || state === 'disarming' || requiresCode,
    lookupUnknown: input.verdict === 'admin' && input.ncPanel.kind === 'unknown',
    // A refusal the panel has since moved past (armed from anywhere) is history,
    // and its Arm anyway would only come back `stale`.
    refusal:
      outcome?.outcome === 'refused' && !armed
        ? { refusalId: outcome.refusalId, blocking: outcome.blocking }
        : null,
    rejected: outcome?.outcome === 'rejected' && !armed ? outcome.reason : null,
    excluded: excludedOf(input, armed, isNcPanel),
    bypassed: bypassedOf(input, armed, isNcPanel),
  }
}

/**
 * The devices named by the cap's refusal (`NcAlarmArmRefusedError`: "arm
 * refused — open: A, B. Use "Arm anyway" …"), so a non-admin reads our own
 * translated line rather than the hub's English one. The code does not survive
 * tRPC; the wording is the hub's and is matched loosely. Null = not a refusal.
 */
export function capRefusalDevices(text: string): string | null {
  const match = /arm refused — open: (.+?)\. Use "Arm anyway"/.exec(text)
  return match?.[1] ?? null
}

/**
 * The line a refused arm leaves on screen. A refusal that names NO device (the
 * hub refused, and every device it held against the arm has since become
 * unreadable) gets its own words: "open: " followed by nothing reads as a
 * rendering bug, not as a refusal.
 */
export type AlarmRefusalLine =
  | { readonly key: 'v2.accessories.alarmRefused'; readonly devices: readonly NcAlarmOpenDevice[] }
  | { readonly key: 'v2.accessories.alarmRefusedNone' }

export function alarmRefusalLine(blocking: readonly NcAlarmOpenDevice[]): AlarmRefusalLine {
  return blocking.length === 0
    ? { key: 'v2.accessories.alarmRefusedNone' }
    : { key: 'v2.accessories.alarmRefused', devices: blocking }
}
