/**
 * The rows of the device-info popover. A row with no value is absent; the
 * provider-declared identifiers follow the id/parent rows. The
 * device id and the reachability are always present: an unanswered
 * reachability is a value (Unknown), not a blank.
 */
import { capturedLabel } from '../data/nc-artifact-format.js'
import type { Translate } from '../data/export-format.js'
import type { DeviceReachability, DeviceSeenAt } from '../data/device-identity-fields.js'
import { identifierRows, type DeviceIdentifierKey } from '../data/device-identifiers.js'

export interface DeviceInfoFactInput {
  readonly provider: string | null
  readonly typeId: string | null
  readonly roleId: string | null
  readonly deviceId: number
  readonly parentName: string | null
  readonly reachability: DeviceReachability
  readonly seenAt: DeviceSeenAt | null
  readonly nowMs: number
  /** The row's raw `identifiers`; parsed here, and a refused payload adds no row. */
  readonly identifiers: unknown
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

const IDENTIFIER_LABEL_KEY: Readonly<Record<DeviceIdentifierKey, string>> = {
  mac: 'v2.deviceInfo.identifier.mac',
  serial: 'v2.deviceInfo.identifier.serial',
  'vendor-uid': 'v2.deviceInfo.identifier.vendorUid',
  'machine-uuid': 'v2.deviceInfo.identifier.machineUuid',
  hostname: 'v2.deviceInfo.identifier.hostname',
  ip: 'v2.deviceInfo.identifier.ip',
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
  for (const id of identifierRows(input.identifiers)) {
    rows.push({ labelKey: IDENTIFIER_LABEL_KEY[id.key], value: id.value })
  }
  rows.push({ labelKey: 'v2.deviceInfo.reachability', value: t(REACHABILITY_KEY[input.reachability]) })
  if (input.seenAt !== null) {
    rows.push({
      labelKey: input.seenAt.kind === 'seen' ? 'v2.deviceInfo.lastSeen' : 'v2.deviceInfo.lastUpdate',
      value: capturedLabel(input.seenAt.ms, input.nowMs, t),
    })
  }
  return rows
}
