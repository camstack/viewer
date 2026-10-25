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
 * A value the catalog does not know is not an icon: the precedence rule falls
 * through to the next level rather than drawing a blank.
 */
import { canonicalIconKey } from '@camstack/types/client'
import type { IconKey } from '@camstack/types'

export type AccessoryIconKey = IconKey

/** The glyph a row wears when nothing names a better one. */
export const DEFAULT_ACCESSORY_ICON_KEY: AccessoryIconKey = 'cpu'

/** A stored or wire value as a catalog key, or `undefined` when the catalog
 *  does not know it. Old spellings (`gauge2`, `home`) resolve to their
 *  canonical key, so nothing persisted goes stale. */
export function accessoryIconKey(value: unknown): AccessoryIconKey | undefined {
  return canonicalIconKey(value)
}

/**
 * The type icon the panel has always computed — the LAST level of the
 * precedence, unchanged from the pre-edit-mode panel so a camera nobody has
 * customised looks exactly as it did.
 */
const ICON_BY_DEVICE_TYPE: Readonly<Record<string, AccessoryIconKey>> = {
  light: 'lightbulb',
  siren: 'bell',
  lock: 'door-open',
  'media-player': 'volume-2',
  switch: 'toggle-right',
  thermostat: 'thermometer',
  'water-heater': 'thermometer',
  humidifier: 'thermometer',
  sensor: 'activity',
  presence: 'activity',
  cover: 'blinds',
  valve: 'blinds',
  fan: 'fan',
  'alarm-panel': 'shield-alert',
}

export function iconKeyForDeviceType(type: string): AccessoryIconKey {
  return Object.hasOwn(ICON_BY_DEVICE_TYPE, type)
    ? ICON_BY_DEVICE_TYPE[type]
    : DEFAULT_ACCESSORY_ICON_KEY
}

/**
 * The built-in role glyphs, mirrored from ui-library's `DEVICE_ROLE_META` for
 * the roles whose glyph this viewer carries. A role missing here falls through
 * to the type icon — it is not an error, it is a glyph the bundle does not
 * have (see `lib/icons.ts` for why the set is closed).
 */
const ICON_BY_DEVICE_ROLE: Readonly<Record<string, AccessoryIconKey>> = {
  siren: 'siren',
  floodlight: 'lightbulb',
  spotlight: 'flashlight',
  'pir-sensor': 'radar',
  chime: 'bell',
  nightvision: 'moon',
  'privacy-mask': 'eye-off',
  'motion-sensor': 'footprints',
  'contact-sensor': 'door-open',
  'leak-sensor': 'droplet',
  'co-sensor': 'wind',
  'gas-sensor': 'flame',
  'tamper-sensor': 'shield-alert',
  'vibration-sensor': 'vibrate',
}

export function builtInIconKeyForRole(role: string | null): AccessoryIconKey | null {
  if (role === null) return null
  return Object.hasOwn(ICON_BY_DEVICE_ROLE, role) ? ICON_BY_DEVICE_ROLE[role] : null
}
