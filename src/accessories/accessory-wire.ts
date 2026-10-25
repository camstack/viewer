/**
 * accessory-wire — narrowing the hub payloads the accessory panel's LOCAL
 * side reads. Pure; every parser answers `null` for a payload it could not
 * read, and the callers draw that as "not loaded", never as "nothing"
 * (D393 / D315).
 */
import { isRecord } from '../data/cap-query.js'
import { toAccessory } from '../data/use-accessories.js'
import { readDeviceIconFields } from '../data/use-linked-devices.js'
import type { AccessoryPanelDevice } from './accessory-panel-rows.js'

/** One `listAll` row → a panel device, or null when it is not a device row. */
export function toAccessoryPanelDevice(raw: unknown): AccessoryPanelDevice | null {
  const base = toAccessory(raw)
  if (base === null || !isRecord(raw)) return null
  const location = typeof raw.location === 'string' && raw.location.length > 0 ? raw.location : null
  return { ...base, location, ...readDeviceIconFields(raw) }
}

/** A `listAll` payload → panel devices. A payload that is not a list is
 *  UNKNOWN, never an empty fleet. Rows that are not devices are dropped. */
export function parseAccessoryPanelDevices(raw: unknown): readonly AccessoryPanelDevice[] | null {
  if (!Array.isArray(raw)) return null
  return raw.flatMap((row) => {
    const device = toAccessoryPanelDevice(row)
    return device === null ? [] : [device]
  })
}

/** `deviceManager.getRoleDisplayDefaults` → `{ role: iconKey }`, icon only.
 *  Null when unreadable; a role default without an icon is simply absent. */
export function parseRoleIconDefaults(raw: unknown): Readonly<Record<string, string>> | null {
  if (!isRecord(raw) || !isRecord(raw.defaults)) return null
  const out: Record<string, string> = {}
  for (const [role, value] of Object.entries(raw.defaults)) {
    if (isRecord(value) && typeof value.icon === 'string' && value.icon.length > 0) {
      out[role] = value.icon
    }
  }
  return out
}
