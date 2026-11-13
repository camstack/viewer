/**
 * The rows of the device-info popover. A row with no value is absent. The
 * device id and the reachability are always present: an unanswered
 * reachability is a value (Unknown), not a blank.
 */
import { capturedLabel } from '../data/nc-artifact-format.js'
import type { Translate } from '../data/export-format.js'
import type { DeviceReachability, DeviceSeenAt } from '../data/device-identity-fields.js'

export interface DeviceInfoFactInput {
  readonly provider: string | null
  readonly typeId: string | null
  readonly roleId: string | null
  readonly deviceId: number
  readonly parentName: string | null
  readonly reachability: DeviceReachability
  readonly seenAt: DeviceSeenAt | null
  readonly nowMs: number
}

export interface DeviceInfoFact {
  readonly labelKey: string
  readonly value: string
}

const REACHABILITY_KEY: Readonly<Record<DeviceReachability, string>> = {
  online: 'v2.deviceInfo.online',
  offline: 'v2.deviceInfo.offline',
  unknown: 'v2.deviceInfo.unknown',
}

function filled(value: string | null): value is string {
  return value !== null && value !== ''
}

/** The notification editor's type name (`v2.nc.deviceType.<type>`), or a spaced id. */
function typeLabel(type: string, t: Translate): string {
  const spaced = type.replaceAll('-', ' ')
  const fallback = spaced.charAt(0).toUpperCase() + spaced.slice(1)
  return t(`v2.nc.deviceType.${type}`, { defaultValue: fallback })
}

/** Label + value rows, in the order the popover draws them. */
export function deviceInfoFacts(input: DeviceInfoFactInput, t: Translate): readonly DeviceInfoFact[] {
  const rows: DeviceInfoFact[] = []
  if (filled(input.provider)) rows.push({ labelKey: 'v2.deviceInfo.provider', value: input.provider })
  if (filled(input.typeId)) {
    rows.push({
      labelKey: 'v2.deviceInfo.type',
      value: typeLabel(input.typeId, t),
    })
  }
  if (filled(input.roleId)) rows.push({ labelKey: 'v2.deviceInfo.role', value: input.roleId })
  rows.push({ labelKey: 'v2.deviceInfo.id', value: String(input.deviceId) })
  if (filled(input.parentName)) rows.push({ labelKey: 'v2.deviceInfo.parent', value: input.parentName })
  rows.push({ labelKey: 'v2.deviceInfo.reachability', value: t(REACHABILITY_KEY[input.reachability]) })
  if (input.seenAt !== null) {
    rows.push({
      labelKey: input.seenAt.kind === 'seen' ? 'v2.deviceInfo.lastSeen' : 'v2.deviceInfo.lastUpdate',
      value: capturedLabel(input.seenAt.ms, input.nowMs, t),
    })
  }
  return rows
}
