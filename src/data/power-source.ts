/**
 * power-source — the viewer's reading of the hub's `powerSource` capability: a
 * camera (or any device) whose power is cut and restored through a linked
 * switch.
 *
 * Pure parsing, no I/O. Two rules the parsers carry:
 *
 *  - **Unreadable is not absent.** A payload that does not parse is `null`,
 *    and the caller draws "unknown" for it; only a well-formed `linked: false`
 *    means the device has no power source.
 *  - **Unknown is not off.** `switchOn` stays `null` while the switch has not
 *    reported; it is never coerced to `false`.
 *
 * An action answers a typed result and never throws for an expected refusal
 * (switch offline, a restart already running); the refusal carries the hub's
 * one-line message and a reason id the row maps to its own copy.
 */
import { isRecord } from './cap-query.js'

export interface PowerSourceStatus {
  readonly linked: boolean
  readonly switchName: string | null
  /** `null` while the switch has not reported — never `false` for unknown. */
  readonly switchOn: boolean | null
  readonly switchOnline: boolean | null
  readonly restartInProgress: boolean
}

export type PowerSourceAction = 'powerOn' | 'powerOff' | 'forceRestart'

export type PowerSourceActionResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: string; readonly message: string }

function nullableBoolean(v: unknown): boolean | null | undefined {
  if (v === null) return null
  return typeof v === 'boolean' ? v : undefined
}

export function parsePowerSourceStatus(raw: unknown): PowerSourceStatus | null {
  if (!isRecord(raw)) return null
  if (typeof raw.linked !== 'boolean') return null
  const switchOn = nullableBoolean(raw.switchOn)
  const switchOnline = nullableBoolean(raw.switchOnline)
  if (switchOn === undefined || switchOnline === undefined) return null
  return {
    linked: raw.linked,
    switchName: typeof raw.switchName === 'string' ? raw.switchName : null,
    switchOn,
    switchOnline,
    restartInProgress: raw.restartInProgress === true,
  }
}

export function parsePowerSourceActionResult(raw: unknown): PowerSourceActionResult | null {
  if (!isRecord(raw)) return null
  if (raw.accepted === true) return { accepted: true }
  if (raw.accepted === false && typeof raw.reason === 'string') {
    return {
      accepted: false,
      reason: raw.reason,
      message: typeof raw.message === 'string' ? raw.message : '',
    }
  }
  return null
}

/** What the row's label says about the switch: on, off, or not known yet. */
export type PowerSwitchState = 'on' | 'off' | 'unknown'

export function powerSwitchState(status: PowerSourceStatus): PowerSwitchState {
  if (status.switchOn === null) return 'unknown'
  return status.switchOn ? 'on' : 'off'
}
