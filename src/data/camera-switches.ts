/**
 * camera-switches — the PURE half of the per-camera function switch group
 * ([D62](../../../camstack-server/docs/decisions/adr-0062.md)).
 *
 * ## Nothing here knows what a switch IS
 *
 * The one rule this module exists to enforce: **the viewer never enumerates the
 * switches.** `id` is typed `string`, not a union, and no function in this file
 * branches on its value. Every operator-facing word a row needs — its `label`
 * and its `costWhenOff` — travels ON THE WIRE from
 * `pipelineOrchestrator.getCameraSwitches`, precisely so that a switch added on
 * the hub (a sixth, a seventh) renders here the day it ships with no viewer
 * release at all. A client-side catalog would be a second copy of the cost
 * lines, and two copies of a cost line is one that will eventually disagree
 * with the thing it describes.
 *
 * That is also why there is no i18n for `label`/`costWhenOff`: they are server
 * copy. The viewer translates only the words it owns — the section title, the
 * failure lines, the "off" badge.
 *
 * ## The three states a row can be in
 *
 * D62 is explicit that `available: false` must render as absent-or-explained,
 * **never as a flippable dead control** — a control that does nothing tells the
 * operator a feature exists. And `enabled` is meaningless when `available` is
 * false, so nothing may read it in that case.
 *
 * ## The admin gate
 *
 * `getCameraSwitches` is `auth: 'view'` and `setCameraSwitch` is `auth:
 * 'admin'` on the hub. So a non-admin may SEE that a camera was switched off —
 * that is the whole point of `switchedOff`, disabled must not look like broken
 * — and may not flip anything. Hiding the controls here is courtesy; the hub is
 * the gate. Unknown role reads as non-admin (see `use-me.ts`).
 */
import { isRecord } from './cap-query.js'

/**
 * One switch, as the hub resolved it for one camera.
 *
 * `id` is a `string` DELIBERATELY. Narrowing it to the ids that exist today
 * would make an unknown future id a parse failure — the group would silently
 * lose a row instead of rendering it from the label the server already sent.
 */
export interface CameraSwitchRow {
  readonly id: string
  readonly label: string
  /** What the operator loses while this is off. Server copy, always rendered. */
  readonly costWhenOff: string
  /** False = render no control. {@link unavailableReason} says why. */
  readonly available: boolean
  /** `'no-provider'` / `'source-unreachable'` today; any string tomorrow. */
  readonly unavailableReason: string | null
  /** Meaningless when `available` is false — read it as `true` there. */
  readonly enabled: boolean
  /**
   * Something true about a control that is nonetheless OFFERED — the hub's
   * `warning`. `'no-privacy-zones'` today; any string tomorrow.
   *
   * A warning travels WITH a live control; a `unavailableReason` replaces it.
   * The two never coexist.
   */
  readonly warning: string | null
}

/** The whole group for one camera. */
export interface CameraSwitchGroupView {
  readonly deviceId: number
  readonly switches: readonly CameraSwitchRow[]
}

/** How one row renders. Exhaustive: there is no fourth shape. */
export type SwitchControlKind =
  /** Admin + available → a live toggle. */
  | 'toggle'
  /** Available but the viewer may not write it → state shown, no control. */
  | 'read-only'
  /** Not offered for this camera → the reason, never a dead control. */
  | 'unavailable'

/** Narrow ONE row off the wire. Returns null when the row is unusable. */
function parseRow(raw: unknown): CameraSwitchRow | null {
  if (!isRecord(raw)) return null
  const { id, label, costWhenOff, available, enabled, unavailableReason, warning } = raw
  if (typeof id !== 'string' || id.length === 0) return null
  if (typeof label !== 'string' || typeof costWhenOff !== 'string') return null
  if (typeof available !== 'boolean' || typeof enabled !== 'boolean') return null
  return {
    id,
    label,
    costWhenOff,
    available,
    unavailableReason: typeof unavailableReason === 'string' ? unavailableReason : null,
    enabled,
    warning: typeof warning === 'string' ? warning : null,
  }
}

/**
 * Narrow the `getCameraSwitches` payload.
 *
 * Order is preserved exactly as the hub sent it: `CAMERA_SWITCH_ORDER` is a
 * server-side decision (broadest blast radius first, a source above the thing
 * that consumes it) and re-sorting here would be the viewer quietly disagreeing
 * with it.
 *
 * A malformed row is dropped without taking the group with it; a payload that
 * is not a group at all is `null`, which the caller renders as "could not be
 * read" rather than as an empty group. An empty group and an unreadable one
 * must not look the same.
 */
export function parseCameraSwitchGroup(raw: unknown): CameraSwitchGroupView | null {
  if (!isRecord(raw)) return null
  const deviceId = raw.deviceId
  if (typeof deviceId !== 'number' || !Number.isFinite(deviceId)) return null
  if (!Array.isArray(raw.switches)) return null
  const switches: CameraSwitchRow[] = []
  for (const entry of raw.switches) {
    const row = parseRow(entry)
    if (row !== null) switches.push(row)
  }
  return { deviceId, switches }
}

/**
 * The ids an operator has switched OFF — what a status surface badges.
 *
 * An UNAVAILABLE switch is never off: nobody turned off a function this
 * installation does not provide, and reading `enabled` there is reading a field
 * the contract calls meaningless.
 */
export function switchedOffIds(switches: readonly CameraSwitchRow[]): readonly string[] {
  return switches.filter((s) => s.available && !s.enabled).map((s) => s.id)
}

/**
 * How this row renders for this viewer.
 *
 * Note what it does NOT consult: `row.id`. A switch nobody has heard of gets a
 * working toggle, because availability — not identity — is what decides whether
 * a control is honest.
 */
export function switchControlKind(row: CameraSwitchRow, isAdmin: boolean): SwitchControlKind {
  if (!row.available && !isZonelessPrivacyMask(row)) return 'unavailable'
  return isAdmin ? 'toggle' : 'read-only'
}

export const PRIVACY_MASK_SWITCH_ID = 'privacy-mask'

/**
 * The privacy mask on a camera that CAN mask and has NO zone drawn.
 *
 * The hub reports it `not-configured` (its derivation: "flipping the master
 * enable would change not one pixel"). The viewer nonetheless offers the
 * control: the switch is the entry point to the feature, and greying the one
 * button that starts it teaches the operator the feature is broken. So it is
 * drawn as a live toggle carrying a WARNING that says what is missing
 * (`switchWarningKey`), and the operator's next step.
 *
 * Only that pair. `not-configured` is a KNOWN answer — zero zones, read from
 * the camera. `source-unreachable` (the count could not be read) stays
 * unavailable: not-yet-known must never look like known-empty (D315).
 */
export function isZonelessPrivacyMask(row: CameraSwitchRow): boolean {
  if (row.id !== PRIVACY_MASK_SWITCH_ID) return false
  // The hub says so itself since types 1.2.243: the switch is AVAILABLE and
  // carries `warning: 'no-privacy-zones'`.
  if (row.available) return row.warning === NO_PRIVACY_ZONES_WARNING
  // An older hub withheld the control and named the reason instead. Kept so
  // this app keeps working against a hub that has not been updated — not as a
  // second opinion: it only ever fires when `available` is false, which the
  // new hub never sends for this case.
  return row.unavailableReason === 'not-configured'
}

/** The hub's warning code for "the camera can mask, no zone is drawn". */
export const NO_PRIVACY_ZONES_WARNING = 'no-privacy-zones'

/**
 * The i18n key of the warning a LIVE control carries, or null when it carries
 * none.
 *
 * Driven by `row.warning` — a code the hub SENDS — with the derived
 * zero-zone case folded in for an older hub. An unknown code still renders
 * something: a warning nobody can read is better than a warning nobody sees,
 * and silence here would be the same gap D62 forbids.
 */
export function switchWarningKey(row: CameraSwitchRow): string | null {
  if (row.warning === NO_PRIVACY_ZONES_WARNING || isZonelessPrivacyMask(row))
    return 'v2.cameraSwitches.warnNoPrivacyZones'
  if (typeof row.warning === 'string' && row.warning.length > 0)
    return 'v2.cameraSwitches.warnUnknown'
  return null
}

/**
 * Whether the switch GROUP is shown at all.
 *
 * A non-admin sees the `switchedOff` badge on the camera's card and nothing
 * else: a row of controls that always fail is worse than no row.
 */
export function canOperateSwitches(isAdmin: boolean): boolean {
  return isAdmin
}

/**
 * The i18n key explaining why a switch is not offered.
 *
 * `switchId` REFINES the sentence, it never replaces the reason. Only one pair
 * is special today: a privacy mask reports `not-configured` on every camera
 * that has no zone drawn, and the general sentence ("nothing is set up for it
 * to act on yet") leaves the operator without the next step — which is not
 * even in this app, because the zones live on the camera. Naming the missing
 * thing is the difference between an explanation and a shrug.
 *
 * The rest deliberately stay general: per-switch copy for reasons nobody has
 * seen is how a translation file rots into text no surface renders.
 */
export function unavailableReasonKey(reason: string | null, switchId?: string): string {
  if (reason === 'no-provider') return 'v2.cameraSwitches.unavailableNoProvider'
  if (reason === 'source-unreachable') return 'v2.cameraSwitches.unavailableUnreachable'
  if (reason === 'not-configured')
    return switchId === 'privacy-mask'
      ? 'v2.cameraSwitches.unavailableNoPrivacyZones'
      : 'v2.cameraSwitches.unavailableNotConfigured'
  if (reason === 'device-disabled') return 'v2.cameraSwitches.unavailableDeviceDisabled'
  // An unknown reason from a newer hub still has to say SOMETHING; silence
  // would render a gap with no explanation, which is the state D62 forbids.
  return 'v2.cameraSwitches.unavailableUnknown'
}

/**
 * The group as it would look if the pending flip succeeds — a new object, the
 * old one untouched, so the rollback in `onError` is just "put the old one
 * back".
 *
 * Refuses to move an unavailable row: an optimistic write the server is going
 * to reject should never be drawn in the first place.
 */
export function applySwitchOptimistic(
  group: CameraSwitchGroupView,
  switchId: string,
  enabled: boolean,
): CameraSwitchGroupView {
  return {
    ...group,
    switches: group.switches.map((row) =>
      row.id === switchId && switchControlKind(row, true) === 'toggle' ? { ...row, enabled } : row,
    ),
  }
}
