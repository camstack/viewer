/**
 * nc-alarm — the viewer's mirror of the Notification Center's ALARM bridge
 * actions (`nc.getAlarmStatus`, `nc.armAlarm`, `nc.armAlarmAnyway`,
 * `nc.disarmAlarm`, `nc.getAlarmConfig`, `nc.setAlarmConfig`,
 * `nc.getAlarmSensors` on
 * `pipeline-analytics`), D630.
 *
 * Authority: `addon-post-analysis/src/notification-center/nc-actions.ts`
 * (`NcAlarmStatusSchema`) and `alarm/alarm-arm-guard.ts`
 * (`NcAlarmArmOutcomeSchema`). The outcome lives in the ADDON, not in
 * `@camstack/types`, because it is the response of the bridge — the cap
 * (`alarm-panel.arm`) answers `void` and can only THROW a refusal, which loses
 * the id Arm anyway must carry. So it is mirrored here, field for field.
 *
 * The config and the patch ARE published (`@camstack/types`), and are taken
 * from there rather than re-declared. The live sub-schema is not on the
 * barrel; it is derived from the config exactly as the server derives it.
 *
 * Every write and the status read are ADMIN-ONLY on the hub: a non-admin keeps
 * the device-scoped cap (`alarm-panel.arm/disarm`).
 */
import { z } from 'zod'
import {
  AlarmArmModeSchema,
  NcAlarmConfigSchema,
  NcAlarmSensorsSchema,
  NcAlarmSettingsPatchSchema,
} from '@camstack/types/client'
import type {
  AlarmState,
  AlarmArmMode,
  NcAlarmConfig,
  NcAlarmSensors,
  NcAlarmSettingsPatch,
} from '@camstack/types'

export { NcAlarmConfigSchema, NcAlarmSensorsSchema, NcAlarmSettingsPatchSchema, AlarmArmModeSchema }
export type { AlarmArmMode, NcAlarmConfig, NcAlarmSensors, NcAlarmSettingsPatch }

/** One covered device that reads open: its name and the word its cap reported. */
export const NcAlarmOpenDeviceSchema = z
  .object({ deviceId: z.number().int(), name: z.string(), state: z.string() })
  .readonly()
export type NcAlarmOpenDevice = z.infer<typeof NcAlarmOpenDeviceSchema>

/**
 * Why an Arm anyway was not honoured. A refusal id is held in the hub's RAM
 * only, one at a time, for `ARM_ANYWAY_TTL_MS`: a second press is `used`, a
 * panel that moved since is `stale`, an old one `expired`, and a restarted hub
 * no longer knows it (`unknown-refusal`).
 */
export const NcAlarmArmAnywayRejectionSchema = z.enum(['unknown-refusal', 'stale', 'expired', 'used'])
export type NcAlarmArmAnywayRejection = z.infer<typeof NcAlarmArmAnywayRejectionSchema>

/** What one arm attempt — plain or Arm anyway — came to. */
export const NcAlarmArmOutcomeSchema = z.discriminatedUnion('outcome', [
  z
    .object({
      outcome: z.enum(['armed', 'arming']),
      excluded: z.array(NcAlarmOpenDeviceSchema).readonly(),
    })
    .readonly(),
  z
    .object({
      outcome: z.literal('refused'),
      refusalId: z.string(),
      blocking: z.array(NcAlarmOpenDeviceSchema).readonly(),
    })
    .readonly(),
  z.object({ outcome: z.literal('rejected'), reason: NcAlarmArmAnywayRejectionSchema }).readonly(),
])
export type NcAlarmArmOutcome = z.infer<typeof NcAlarmArmOutcomeSchema>

/** The panel as it is NOW — `NcAlarmConfig.live`, derived, never re-declared. */
export const NcAlarmLiveSchema = NcAlarmConfigSchema.shape.live.unwrap()
export type NcAlarmLive = z.infer<typeof NcAlarmLiveSchema>

/**
 * `nc.getAlarmStatus`. `deviceId: null` with `live: null` is a node with no
 * panel, which a client must not read as "disarmed, nothing open".
 */
export const NcAlarmStatusSchema = z.object({
  deviceId: z.number().int().nullable(),
  live: NcAlarmLiveSchema.nullable(),
})
export type NcAlarmStatus = z.infer<typeof NcAlarmStatusSchema>

/** While a delay runs, the state moves on its own — ask often. */
export const NC_ALARM_FAST_POLL_MS = 2_000
/** At rest the device-state events carry changes; this is only the backstop. */
export const NC_ALARM_SLOW_POLL_MS = 15_000

const FAST_POLL_STATES: ReadonlySet<AlarmState> = new Set<AlarmState>(['arming', 'pending', 'triggered'])

/** The poll cadence for a panel in `state` (unanswered = at rest). */
export function ncAlarmPollMs(state: AlarmState | undefined): number {
  return state !== undefined && FAST_POLL_STATES.has(state) ? NC_ALARM_FAST_POLL_MS : NC_ALARM_SLOW_POLL_MS
}

/**
 * Which device is the Notification Center's panel, as far as the phone knows.
 *
 *  - `pending`: the read has not answered yet;
 *  - `known`: it answered — `panelId: null` is a hub with no panel, or one that
 *    refused the read BY NAME (too old to have it). Either way the device cap
 *    is the arm path;
 *  - `unknown`: it failed for any other reason (a timeout, a respawning addon,
 *    a dropped socket). Not-yet-known must not look like not-installed (D315),
 *    so this is NOT "no panel": arming waits and says so, and it is retried.
 */
export type NcPanelLookup =
  | { readonly kind: 'pending' }
  | { readonly kind: 'known'; readonly panelId: number | null }
  | { readonly kind: 'unknown' }

/** The slice of the status query a lookup is read from. */
export interface NcAlarmPanelSource {
  readonly data: NcAlarmStatus | undefined
  /** The query's error, or its failure reason while it is still retrying. */
  readonly error: unknown
}

/** What a failed `nc.getAlarmStatus` means for the control. */
export type NcAlarmStatusFailure = 'no-nc-panel' | 'transient'

/**
 * The refusals that NAME the action — the only ones that prove this hub has no
 * alarm bridge. The three wordings of "no such action" are the hub router's
 * (`cap-providers.ts` `describeUnresolved`), a forked addon's
 * (`child-addon-call-dispatch.ts`) and an in-process addon's
 * (`addon-registry.service.ts`). "not wired" is a current hub with no panel
 * (`nc-actions.ts` `requireAlarm`).
 *
 * `no addon '…' registers custom actions` is deliberately NOT here: that is
 * the addon being down or respawning, which is exactly the transient case.
 */
const NO_NC_PANEL_PATTERNS: readonly RegExp[] = [
  /has no (?:handler for )?custom action ["']nc\.getAlarmStatus["']/,
  /the alarm is not wired on this node/,
]

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : null
}

/** Pure. Only a refusal by name is "no nc panel"; everything else is transient. */
export function classifyNcAlarmStatusError(error: unknown): NcAlarmStatusFailure {
  const message = errorMessage(error)
  if (message === null) return 'transient'
  return NO_NC_PANEL_PATTERNS.some((re) => re.test(message)) ? 'no-nc-panel' : 'transient'
}

/** How many times a transient failure is retried (react-query's own backoff). */
export const NC_ALARM_STATUS_MAX_RETRIES = 4

/** React-query `retry`: a by-name refusal is final; a transient one is retried, bounded. */
export function ncAlarmStatusShouldRetry(failureCount: number, error: unknown): boolean {
  return classifyNcAlarmStatusError(error) === 'transient' && failureCount < NC_ALARM_STATUS_MAX_RETRIES
}

/** Pure. An answer wins over a later failed refetch. */
export function ncAlarmPanelFrom(source: NcAlarmPanelSource): NcPanelLookup {
  if (source.data !== undefined) return { kind: 'known', panelId: source.data.deviceId }
  if (source.error === null || source.error === undefined) return { kind: 'pending' }
  return classifyNcAlarmStatusError(source.error) === 'no-nc-panel'
    ? { kind: 'known', panelId: null }
    : { kind: 'unknown' }
}

/**
 * React-query `refetchInterval` for ONE row: only the NC panel's own row polls
 * (at its state's cadence), and an unknown lookup keeps asking. Every other
 * alarm row reads the id once — the status is a batched read of every covered
 * device, and nothing else on those rows consumes it.
 */
export function ncAlarmStatusIntervalMs(deviceId: number, source: NcAlarmPanelSource): number | false {
  const lookup = ncAlarmPanelFrom(source)
  if (lookup.kind === 'unknown') return NC_ALARM_SLOW_POLL_MS
  if (lookup.kind === 'known' && lookup.panelId === deviceId) return ncAlarmPollMs(source.data?.live?.state)
  return false
}
