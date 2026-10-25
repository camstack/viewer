/**
 * alarm-settings-model — the pure decisions behind the admin alarm screen
 * (`screens/notifications/AlarmSettingsScreen.tsx`, D630).
 *
 * Re-implemented from the admin UI's `notification-alarm.helpers.ts`
 * (`openingsSummary`, `nonBlockingOptions` - which rows exist; what each row
 * SHOWS is `alarm-sensor-table-model.ts`) because the viewer cannot import
 * admin-ui. Two things differ on purpose:
 *
 *  - The sensor table LISTS OPENINGS — devices bound to `contact`, `cover` or
 *    `lock-control`, the same three caps the hub's `alarm-openings.ts` reads —
 *    and, since D636, EVERY opening of the household: one no rule of the mode
 *    reads is listed and drawn muted ("never blocks"). A camera is never
 *    listed. Which devices are openings is ONE targeted read,
 *    `deviceManager.listDeviceIdsByCaps` (ids only); until it answers, only
 *    devices the hub already read and ids already listed are rows, and the
 *    screen says it is checking.
 *  - The form is a DRAFT over the stored settings, and the draft holds DELAYS
 *    AND RECIPIENTS only (D697). A device's non-blocking switch is not part of
 *    it: the switch writes ONE `nonBlockingEdit` straight away
 *    (`alarm-sensor-table-model.ts`, `useNcAlarmSwitch`), so a Save never
 *    carries a whole `nonBlocking` list that another admin's switch could be
 *    reverted by. Save sends only the fields whose value differs from what the
 *    hub last answered (`NcAlarmSettingsPatchSchema` is all-optional for
 *    exactly this). Nothing is written from a read that has not answered — the
 *    screen renders no form without one.
 */
import {
  NC_ALARM_DELAY_MAX_SEC,
  NC_ALARM_TRIGGERED_MAX_SEC,
  resolveModeDelays,
} from '@camstack/types/client'
import type {
  AlarmArmMode,
  NcAlarmModeCoverage,
  NcAlarmModeDelays,
  NcAlarmModeDelaysEdit,
  NcAlarmSettings,
  NcAlarmSettingsPatch,
} from '@camstack/types'
import { AlarmArmModeSchema, type NcAlarmLive } from '../../data/nc-alarm.js'
import type { SelectedDeviceRow } from './device-selection.js'

/** One mode's non-blocking list, as the settings carry it. */
export type NcAlarmNonBlockingEntry = NcAlarmSettings['nonBlocking'][number]

/** The fields this screen edits. */
export type AlarmSettingsDraft = Pick<
  NcAlarmSettings,
  'exitDelaySec' | 'entryDelaySec' | 'triggeredDurationSec'
>

export type AlarmDelayField = 'exitDelaySec' | 'entryDelaySec' | 'triggeredDurationSec'

/**
 * What the operator has changed and not yet saved, as CHANGES rather than
 * values: the typed delay strings. Save lays them over the LATEST config.
 *
 * There are no recipients here: the panel's own recipient list is retired —
 * who is told about the alarm is decided by alarm RULES only (D701/D706), and
 * the hub clears any leftover `announceTargets` at boot.
 */
export interface AlarmSettingsEdits {
  readonly delays: Readonly<Partial<Record<AlarmDelayField, string>>>
  /**
   * Per-mode delays (D697): a typed string, or `null` = "Use default". A field
   * with no entry is untouched. Nothing here is a value the mode already has -
   * the stored overrides are never copied into the draft.
   */
  readonly modeDelays: AlarmModeDelayEdits
}

/** The per-mode delay edits of a draft. */
export type AlarmModeDelayEdits = Readonly<
  Partial<Record<AlarmArmMode, Readonly<Partial<Record<AlarmDelayField, string | null>>>>>
>

export const EMPTY_ALARM_EDITS: AlarmSettingsEdits = {
  delays: {},
  modeDelays: {},
}

/** The schema's bounds (`NcAlarmSettingsSchema`), so a value is clamped here
 *  rather than refused by the hub. */
export const ALARM_DELAY_MAX: Readonly<Record<AlarmDelayField, number>> = {
  exitDelaySec: NC_ALARM_DELAY_MAX_SEC,
  entryDelaySec: NC_ALARM_DELAY_MAX_SEC,
  triggeredDurationSec: NC_ALARM_TRIGGERED_MAX_SEC,
}

/** The caps whose binding makes a device an opening (`alarm-openings.ts`). */
export const ALARM_OPENING_CAP_NAMES: readonly string[] = ['contact', 'cover', 'lock-control', 'switch']

// ── Delays ──────────────────────────────────────────────────────────

export function clampDelay(field: AlarmDelayField, value: number): number {
  const whole = Math.round(value)
  return Math.min(ALARM_DELAY_MAX[field], Math.max(0, whole))
}

/**
 * A typed delay, clamped — or null when the box holds nothing readable.
 * An emptied box is "leave it alone", never 0: 0 is a behaviour (no delay, or
 * until disarmed), and an operator clearing the box to retype must not commit it.
 */
export function parseDelayDraft(field: AlarmDelayField, raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return null
  return clampDelay(field, value)
}

// ── Non-blocking lists ──────────────────────────────────────────────

/** One mode's non-blocking ids. A mode with no list tolerates nothing open. */

/** Membership lists the sensor table needs; missing keys mean the hub defaults. */
export interface AlarmMembershipLists {
  readonly nonBlocking: readonly NcAlarmNonBlockingEntry[]
  readonly blocking: readonly NcAlarmNonBlockingEntry[]
  readonly secureOnArmOff: readonly NcAlarmNonBlockingEntry[]
}

function isModeDeviceList(value: unknown): value is readonly NcAlarmNonBlockingEntry[] {
  if (!Array.isArray(value)) return false
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return false
    if (!('mode' in entry) || !('deviceIds' in entry)) return false
  }
  return true
}

function modeDeviceListsFrom(
  settings: NcAlarmSettings,
  key: 'blocking' | 'secureOnArmOff',
): readonly NcAlarmNonBlockingEntry[] {
  if (!Object.prototype.hasOwnProperty.call(settings, key)) return []
  const value: unknown = Reflect.get(settings, key)
  return isModeDeviceList(value) ? value : []
}

export function alarmMembershipLists(settings: NcAlarmSettings): AlarmMembershipLists {
  return {
    nonBlocking: settings.nonBlocking,
    blocking: modeDeviceListsFrom(settings, 'blocking'),
    secureOnArmOff: modeDeviceListsFrom(settings, 'secureOnArmOff'),
  }
}

export function nonBlockingFor(
  lists: readonly NcAlarmNonBlockingEntry[],
  mode: AlarmArmMode,
): readonly number[] {
  return lists.find((l) => l.mode === mode)?.deviceIds ?? []
}

/** Controllable openings that force-block when open (opt-in; default empty). */
export function blockingFor(
  lists: readonly NcAlarmNonBlockingEntry[],
  mode: AlarmArmMode,
): readonly number[] {
  return lists.find((l) => l.mode === mode)?.deviceIds ?? []
}

/** Controllable openings that opt out of secure-on-arm (default empty = secure ON). */
export function secureOnArmOffFor(
  lists: readonly NcAlarmNonBlockingEntry[],
  mode: AlarmArmMode,
): readonly number[] {
  return lists.find((l) => l.mode === mode)?.deviceIds ?? []
}

/** The ids one mode's sensor table has rows for. */
export interface NonBlockingOptionsInput {
  readonly live: NcAlarmLive | undefined
  readonly listed: readonly number[]
  /** Every opening of the household (the scan); null while that is not known. */
  readonly openingIds: ReadonlySet<number> | null
}

export interface NonBlockingOptionsView {
  readonly ids: readonly number[]
  /** The household scan has not answered (pending or failed). */
  readonly unresolved: boolean
}

/**
 * What one mode's table has rows for (D636): EVERY opening of the household —
 * what the hub read under any mode (open, or an opening it could not read) and
 * every device the scan found bound to an opening cap — plus every id already
 * listed, so a stale pick can be switched off (D49). An opening no rule of
 * this mode reads is a row too (muted, `alarmCoverageNeverBlocks`): listing it
 * is harmless.
 */
export function nonBlockingOptions(input: NonBlockingOptionsInput): NonBlockingOptionsView {
  const ids = new Set<number>()
  for (const row of input.live?.openings ?? []) {
    for (const d of row.devices) ids.add(d.deviceId)
    for (const id of row.unknown) ids.add(id)
  }
  for (const id of input.openingIds ?? []) ids.add(id)
  for (const id of input.listed) ids.add(id)
  // A fresh array sorted in place: Hermes has no `toSorted`.
  const sorted = [...ids].sort((a, b) => a - b)
  return {
    ids: sorted,
    unresolved: input.openingIds === null,
  }
}

/**
 * Why a mode's table has no row, when it KNOWS: the household has no
 * opening (contact, cover or lock) at all. Null while the scan has not
 * answered — "none" is a claim only an answer can make (D315).
 */
export type NonBlockingEmptyLine = 'no-opening'

export function nonBlockingEmptyLine(view: NonBlockingOptionsView): NonBlockingEmptyLine | null {
  if (view.ids.length > 0 || view.unresolved) return null
  return 'no-opening'
}

// ── Coverage ────────────────────────────────────────────────────────

/**
 * Every device id one mode's coverage NAMES — the ids the screen's targeted
 * name lookup must ask for. An id no answer names yet reads "Device #id",
 * never "removed" (D315, `alarmDeviceLabel`).
 */
export function alarmCoverageIds(coverage: NcAlarmModeCoverage): readonly number[] {
  return [
    ...coverage.deviceIds,
    ...coverage.allDevicesExcept,
    ...coverage.skippedDevices.map((s) => s.deviceId),
  ]
}

// ── Openings now ────────────────────────────────────────────────────

export interface AlarmOpeningsSummary {
  readonly blocking: number
  readonly nonBlocking: number
  readonly unknown: number
}

/**
 * What arming `mode` would find right now. NULL when the hub gave no openings
 * for that mode — "nothing open" is a claim only an answer can make (D315).
 */
export function openingsSummary(live: NcAlarmLive | undefined, mode: AlarmArmMode): AlarmOpeningsSummary | null {
  const row = live?.openings.find((o) => o.mode === mode)
  if (row === undefined) return null
  const blocking = row.devices.filter((d) => d.blocking).length
  return { blocking, nonBlocking: row.devices.length - blocking, unknown: row.unknown.length }
}

// ── Draft and patch ─────────────────────────────────────────────────

const DELAY_FIELDS: readonly AlarmDelayField[] = ['exitDelaySec', 'entryDelaySec', 'triggeredDurationSec']

/**
 * A delay as typed — part of the draft at once, whether or not the box was
 * left. A number past its bound is stored AS the bound, so the box reads what
 * Save will send.
 */
export function typeDelay(edits: AlarmSettingsEdits, field: AlarmDelayField, raw: string): AlarmSettingsEdits {
  const value = Number(raw.trim())
  const shown = raw.trim() !== '' && Number.isFinite(value) && value > ALARM_DELAY_MAX[field] ? String(ALARM_DELAY_MAX[field]) : raw
  return { ...edits, delays: { ...edits.delays, [field]: shown } }
}

/**
 * The box once it is left: exactly what Save will send (a negative number
 * becomes 0, a decimal is rounded). A box holding nothing readable drops its
 * entry and shows the stored value again — never 0.
 */
export function commitDelay(edits: AlarmSettingsEdits, field: AlarmDelayField): AlarmSettingsEdits {
  const raw = edits.delays[field]
  if (raw === undefined) return edits
  const parsed = parseDelayDraft(field, raw)
  const rest = Object.fromEntries(Object.entries(edits.delays).filter(([key]) => key !== field))
  return { ...edits, delays: parsed === null ? rest : { ...rest, [field]: String(parsed) } }
}

/**
 * Whether the form SHOWS anything other than the stored settings: a change to
 * send, or a box whose text is not the stored value (an emptied box sends
 * nothing, and must still be discardable).
 */
export function draftVisiblyDiffers(latest: NcAlarmSettings, edits: AlarmSettingsEdits): boolean {
  if (alarmSettingsPatch(latest, edits) !== null) return true
  const globalBoxDiffers = DELAY_FIELDS.some((field) => {
    const raw = edits.delays[field]
    return raw !== undefined && raw !== String(latest[field])
  })
  if (globalBoxDiffers) return true
  return modeDelayCells(edits).some(({ mode, field, edit }) => {
    if (edit === null) return false
    const stored = resolveModeDelays(latest, mode)[field]
    return edit !== String(stored)
  })
}

function delayValue(base: NcAlarmSettings, edits: AlarmSettingsEdits, field: AlarmDelayField): number {
  const raw = edits.delays[field]
  const parsed = raw === undefined ? null : parseDelayDraft(field, raw)
  return parsed ?? base[field]
}

/** The form's values: the LATEST stored settings with the draft's changes laid over. */
export function effectiveAlarmSettings(latest: NcAlarmSettings, edits: AlarmSettingsEdits): AlarmSettingsDraft {
  return {
    exitDelaySec: delayValue(latest, edits, 'exitDelaySec'),
    entryDelaySec: delayValue(latest, edits, 'entryDelaySec'),
    triggeredDurationSec: delayValue(latest, edits, 'triggeredDurationSec'),
  }
}

export function alarmEditsEmpty(edits: AlarmSettingsEdits): boolean {
  return (
    Object.keys(edits.delays).length === 0 &&
    Object.values(edits.modeDelays).every((fields) => Object.keys(fields ?? {}).length === 0)
  )
}

/**
 * The patch a Save sends: the draft laid over the LATEST settings, keeping
 * only the fields whose value then differs from them. Null = nothing to send.
 */
export function alarmSettingsPatch(latest: NcAlarmSettings, edits: AlarmSettingsEdits): NcAlarmSettingsPatch | null {
  const next = effectiveAlarmSettings(latest, edits)
  const delays: NcAlarmSettingsPatch = {}
  for (const field of DELAY_FIELDS) {
    if (next[field] !== latest[field]) Object.assign(delays, delayPatch(field, next[field]))
  }
  const modeEdits = modeDelaysPatch(latest, edits)
  const patch: NcAlarmSettingsPatch = {
    ...delays,
    ...(modeEdits.length > 0 ? { modeDelays: modeEdits } : {}),
  }
  return Object.keys(patch).length === 0 ? null : patch
}

function delayPatch(field: AlarmDelayField, value: number): NcAlarmSettingsPatch {
  if (field === 'exitDelaySec') return { exitDelaySec: value }
  if (field === 'entryDelaySec') return { entryDelaySec: value }
  return { triggeredDurationSec: value }
}

/**
 * Whether the fields the DRAFT edits differ between two settings — "changed
 * elsewhere". A switch another admin flipped is not one of them.
 */
export function alarmSettingsChanged(a: NcAlarmSettings, b: NcAlarmSettings): boolean {
  return (
    DELAY_FIELDS.some((field) => a[field] !== b[field]) ||
    MODES_WITH_DELAYS.some((mode) =>
      DELAY_FIELDS.some((field) => storedModeDelay(a, mode, field) !== storedModeDelay(b, mode, field)),
    )
  )
}

// ── Per-mode delays (D697) ──────────────────────────────────────────

/** The modes a delay override can name (`AlarmArmMode`). */
const MODES_WITH_DELAYS: readonly AlarmArmMode[] = AlarmArmModeSchema.options

/** Settings as an older hub may send them: without `modeDelays`. */
interface ModeDelayOverrides {
  readonly modeDelays?: readonly NcAlarmModeDelays[]
}

/** The stored override of one field of a mode; undefined = the mode inherits it. */
function storedModeDelay(settings: ModeDelayOverrides, mode: AlarmArmMode, field: AlarmDelayField): number | undefined {
  return (settings.modeDelays ?? []).find((entry) => entry.mode === mode)?.[field]
}

interface ModeDelayCell {
  readonly mode: AlarmArmMode
  readonly field: AlarmDelayField
  readonly edit: string | null
}

/** Every touched (mode, field) of the draft. */
function modeDelayCells(edits: AlarmSettingsEdits): readonly ModeDelayCell[] {
  return MODES_WITH_DELAYS.flatMap((mode) =>
    DELAY_FIELDS.flatMap((field): ModeDelayCell[] => {
      const edit = edits.modeDelays[mode]?.[field]
      return edit === undefined ? [] : [{ mode, field, edit }]
    }),
  )
}

/** What one mode's delay box shows and says. */
export interface AlarmModeDelayView {
  /** The value the draft resolves to for this mode. */
  readonly value: number
  /** The box's text as typed; undefined = untouched, shows `value`. */
  readonly raw: string | undefined
  /** True when the mode has NO override of its own (after the draft). */
  readonly inherited: boolean
  /** The default it inherits (the global value, after the draft). */
  readonly defaultValue: number
}

/**
 * One mode's delay as the form shows it. Whether the mode is on the default is
 * decided by whether it HAS its own override - never by the value: an override
 * equal to the default is still an override, and can be cleared (plan M6).
 */
export function modeDelayView(
  latest: NcAlarmSettings,
  edits: AlarmSettingsEdits,
  mode: AlarmArmMode,
  field: AlarmDelayField,
): AlarmModeDelayView {
  const defaultValue = delayValue(latest, edits, field)
  const edit = edits.modeDelays[mode]?.[field]
  const stored = storedModeDelay(latest, mode, field)
  if (edit === null) return { value: defaultValue, raw: undefined, inherited: true, defaultValue }
  if (edit !== undefined) {
    const parsed = parseDelayDraft(field, edit)
    if (parsed !== null) return { value: parsed, raw: edit, inherited: false, defaultValue }
    // An emptied box shows what was there, never 0.
    return { value: stored ?? defaultValue, raw: edit, inherited: stored === undefined, defaultValue }
  }
  return { value: stored ?? defaultValue, raw: undefined, inherited: stored === undefined, defaultValue }
}

function withModeEdit(
  edits: AlarmSettingsEdits,
  mode: AlarmArmMode,
  field: AlarmDelayField,
  value: string | null | undefined,
): AlarmSettingsEdits {
  const fields = Object.fromEntries(Object.entries(edits.modeDelays[mode] ?? {}).filter(([key]) => key !== field))
  const next = value === undefined ? fields : { ...fields, [field]: value }
  const rest = Object.fromEntries(Object.entries(edits.modeDelays).filter(([key]) => key !== mode))
  return { ...edits, modeDelays: Object.keys(next).length === 0 ? rest : { ...rest, [mode]: next } }
}

/** A mode's delay as typed - part of the draft at once, clamped like the global ones. */
export function typeModeDelay(
  edits: AlarmSettingsEdits,
  mode: AlarmArmMode,
  field: AlarmDelayField,
  raw: string,
): AlarmSettingsEdits {
  const value = Number(raw.trim())
  const shown = raw.trim() !== '' && Number.isFinite(value) && value > ALARM_DELAY_MAX[field] ? String(ALARM_DELAY_MAX[field]) : raw
  return withModeEdit(edits, mode, field, shown)
}

/** The box once left: exactly what Save will send; an unreadable box drops its edit. */
export function commitModeDelay(edits: AlarmSettingsEdits, mode: AlarmArmMode, field: AlarmDelayField): AlarmSettingsEdits {
  const raw = edits.modeDelays[mode]?.[field]
  if (typeof raw !== 'string') return edits
  const parsed = parseDelayDraft(field, raw)
  return withModeEdit(edits, mode, field, parsed === null ? undefined : String(parsed))
}

/** "Use default": the mode stops overriding this field. */
export function setModeDelayDefault(edits: AlarmSettingsEdits, mode: AlarmArmMode, field: AlarmDelayField): AlarmSettingsEdits {
  return withModeEdit(edits, mode, field, null)
}

/**
 * The per-mode edits a Save sends, laid over the LATEST config and decided on
 * the PRESENCE of the override, never on the effective value: `null` iff the
 * edit is "Use default" AND the latest entry HAS the field; a number iff it
 * differs from the entry's field or the entry lacks it (an explicit value equal
 * to the default must be settable). One edit per mode, ONLY touched fields -
 * a field another admin changed meanwhile is not named, so not reverted.
 */
function modeDelaysPatch(latest: NcAlarmSettings, edits: AlarmSettingsEdits): NcAlarmModeDelaysEdit[] {
  const out: NcAlarmModeDelaysEdit[] = []
  for (const mode of MODES_WITH_DELAYS) {
    const fields: Partial<Record<AlarmDelayField, number | null>> = {}
    for (const field of DELAY_FIELDS) {
      const edit = edits.modeDelays[mode]?.[field]
      if (edit === undefined) continue
      const stored = storedModeDelay(latest, mode, field)
      if (edit === null) {
        if (stored !== undefined) fields[field] = null
        continue
      }
      const parsed = parseDelayDraft(field, edit)
      if (parsed === null) continue
      if (stored === undefined || stored !== parsed) fields[field] = parsed
    }
    if (Object.keys(fields).length > 0) out.push({ mode, ...fields })
  }
  return out
}

// ── Device names ────────────────────────────────────────────────────

/**
 * How one device id is named on the screen:
 *  - `named` — the hub named it (with an opening, or the answered lookup);
 *  - `removed` — the ANSWERED lookup no longer has it ("Device #id — removed",
 *    still listed so it can be unticked, D49);
 *  - `unnamed` — no answer names it yet ("Device #id"), never claimed removed (D315).
 */
export type AlarmDeviceLabel =
  | { readonly kind: 'named'; readonly name: string }
  | { readonly kind: 'removed' }
  | { readonly kind: 'unnamed' }

export function alarmDeviceLabel(
  id: number,
  rows: ReadonlyMap<number, SelectedDeviceRow>,
  openNames: ReadonlyMap<number, string>,
): AlarmDeviceLabel {
  const open = openNames.get(id)
  if (open !== undefined && open !== '') return { kind: 'named', name: open }
  const row = rows.get(id)
  if (row?.removed === true) return { kind: 'removed' }
  if (row?.name !== undefined) return { kind: 'named', name: row.name }
  return { kind: 'unnamed' }
}
