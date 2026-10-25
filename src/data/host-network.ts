/**
 * Pure mapping of a `@react-native-community/netinfo` state onto what the
 * device-information overlay draws. No React, no native import.
 *
 * Permissions (none new): `type`/`isConnected` need only the normal
 * `ACCESS_NETWORK_STATE` the module already declares. `details.strength` of a
 * wifi link is Android-only and rides on `ACCESS_WIFI_STATE` (also a normal,
 * install-time permission, already merged by the module) — iOS exposes no wifi
 * strength without a location-gated entitlement, so there it stays `null` and
 * the overlay shows the link type only. `cellularGeneration` is read when the
 * platform volunteers it and never requested (Android needs the dangerous
 * `READ_PHONE_STATE` for it, which we do NOT ask for).
 */

export type HostNetworkKind = 'wifi' | 'cellular' | 'ethernet' | 'other' | 'offline'

export interface HostNetworkStatus {
  readonly kind: HostNetworkKind
  /** 0–100 wifi signal quality, or `null` when the platform does not expose it. */
  readonly strengthPct: number | null
  /** `'4g'`, `'5g'`… when the platform volunteers it, else `null`. */
  readonly generation: string | null
}

/** The slice of a NetInfo state this module reads. */
export interface NetInfoLike {
  readonly isConnected: boolean | null
  readonly type: string
  readonly details?: unknown
}

function detailsRecord(details: unknown): Record<string, unknown> {
  return typeof details === 'object' && details !== null ? (details as Record<string, unknown>) : {}
}

/** NetInfo state → overlay status. `null` while the platform has not answered. */
export function toHostNetwork(state: NetInfoLike | null): HostNetworkStatus | null {
  if (state === null) return null
  if (state.isConnected === false || state.type === 'none') {
    return { kind: 'offline', strengthPct: null, generation: null }
  }
  const details = detailsRecord(state.details)
  if (state.type === 'wifi') {
    const s = details['strength']
    const strengthPct =
      typeof s === 'number' && Number.isFinite(s) ? Math.round(Math.min(100, Math.max(0, s))) : null
    return { kind: 'wifi', strengthPct, generation: null }
  }
  if (state.type === 'cellular') {
    const g = details['cellularGeneration']
    return {
      kind: 'cellular',
      strengthPct: null,
      generation: typeof g === 'string' && g.length > 0 ? g : null,
    }
  }
  if (state.type === 'ethernet') return { kind: 'ethernet', strengthPct: null, generation: null }
  return { kind: 'other', strengthPct: null, generation: null }
}

/** Text next to the icon: `82%` (wifi), `4G` (cellular), `LAN`, or nothing. */
export function networkLabel(status: HostNetworkStatus): string | null {
  switch (status.kind) {
    case 'wifi':
      return status.strengthPct === null ? null : `${String(status.strengthPct)}%`
    case 'cellular':
      return status.generation === null ? null : status.generation.toUpperCase()
    case 'ethernet':
      return 'LAN'
    default:
      return null
  }
}
