/**
 * accessory-icon-keys — the icon choices of the camera accessory panel.
 *
 * There is no viewer vocabulary any more: an accessory icon is a key of the
 * `@camstack/types` icon catalog (D854), the same spelling the hub's
 * `DeviceDisplayOverride.icon` uses, so an admin's override and an operator's
 * local pick compare without anyone knowing what a glyph is. Glyphs are drawn
 * by `CatalogIcon` from generated node data. This module is strings only, so
 * the precedence rule in `accessory-panel-rows.ts` stays free of React.
 *
 * Type and role icons are resolved only through `@camstack/types/client`
 * (`deviceTypeIconKey`, `deviceRoleIconKey`) — the same tables as admin-ui.
 *
 * A value the catalog does not know is not an icon: the precedence rule falls
 * through to the next level rather than drawing a blank.
 */
import {
  canonicalIconKey,
  deviceIconKey,
  deviceTypeIconKey,
  DeviceType,
} from '@camstack/types/client'
import type { IconKey } from '@camstack/types'

export type AccessoryIconKey = IconKey

/** The glyph a row wears when nothing names a better one (unknown device type). */
export const DEFAULT_ACCESSORY_ICON_KEY: AccessoryIconKey = deviceTypeIconKey('')

/** A stored or wire value as a catalog key, or `undefined` when the catalog
 *  does not know it. Old spellings (`gauge2`, `home`) resolve to their
 *  canonical key, so nothing persisted goes stale. */
export function accessoryIconKey(value: unknown): AccessoryIconKey | undefined {
  return canonicalIconKey(value)
}

/** Built-in type icon — hub `deviceTypeIconKey`. */
export function iconKeyForDeviceType(type: string): AccessoryIconKey {
  return deviceTypeIconKey(type)
}

/** Built-in role icon when the hub knows the role; otherwise `null`. */
export function builtInIconKeyForRole(role: string | null): AccessoryIconKey | null {
  if (role === null) return null
  const resolved = deviceIconKey(DeviceType.Generic, role)
  return resolved === deviceTypeIconKey(DeviceType.Generic) ? null : resolved
}
