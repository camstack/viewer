/**
 * Fields the device-info popover reads off a `deviceManager.listAll` row that
 * {@link toAccessory} drops: the parent id, a tri-state reachability, and a
 * last-seen / last-update instant.
 *
 * Reachability is unanswered until the row says `true` or `false`. A missing
 * `online` is Unknown — never Offline (an unanswered query is not a negative).
 * An instant of 0 is the epoch, not a sighting, and is not shown.
 */
import { isRecord } from './cap-query.js'

export type DeviceReachability = 'online' | 'offline' | 'unknown'

export type DeviceSeenKind = 'seen' | 'updated'

export interface DeviceSeenAt {
  readonly kind: DeviceSeenKind
  readonly ms: number
}

const SEEN_FIELDS: readonly { readonly key: string; readonly kind: DeviceSeenKind }[] = [
  { key: 'lastSeen', kind: 'seen' },
  { key: 'updatedAt', kind: 'updated' },
  { key: 'lastUpdated', kind: 'updated' },
]

/** `true` / `false` are answers. Anything else has not been answered. */
export function reachabilityOf(online: unknown): DeviceReachability {
  if (online === true) return 'online'
  if (online === false) return 'offline'
  return 'unknown'
}

/** The parent id a row names, or null when it names none. */
export function parentDeviceIdOf(row: unknown): number | null {
  if (!isRecord(row) || typeof row.parentDeviceId !== 'number') return null
  return row.parentDeviceId
}

/** A positive instant on the row, preferring last-seen over last-update. */
export function deviceSeenAt(row: unknown): DeviceSeenAt | null {
  if (!isRecord(row)) return null
  for (const field of SEEN_FIELDS) {
    const value = row[field.key]
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return { kind: field.kind, ms: value }
    }
  }
  return null
}
