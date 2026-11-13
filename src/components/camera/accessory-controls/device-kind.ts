/**
 * The two device-kind accessors the control pick reads (D1033).
 *
 * They live in `@camstack/types` (`device/device-kind.ts`) and are not on the
 * `/client` entry a phone bundle may import, so this file is that pair, the
 * same predicates: a climate device with no climate role is a room thermostat,
 * and a plug-in heater is a `switch` with role `switch-heater`.
 */
import { DeviceType } from '@camstack/types/client'

const CLIMATE_ROLES = [
  'climate-thermostat',
  'climate-ac',
  'climate-radiator',
  'climate-floor',
  'climate-heater',
  'climate-heat-pump-circuit',
] as const

export type ClimateRole = (typeof CLIMATE_ROLES)[number]

/** `thermostat` was retired into `climate`. A stored row is read as the live type. */
const RETIRED_DEVICE_TYPES: Readonly<Record<string, string>> = {
  thermostat: DeviceType.Climate,
}

/** The live type a stored `type` value stands for (itself unless retired). */
export function canonicalStoredDeviceType(stored: string): string {
  return RETIRED_DEVICE_TYPES[stored] ?? stored
}

function isClimateRole(role: string): role is ClimateRole {
  return CLIMATE_ROLES.some((candidate) => candidate === role)
}

/**
 * Which climate device this is. No role, or a role that is not a climate one,
 * is a room thermostat — what most of them are.
 */
export function climateRoleOf(role: string | null | undefined): ClimateRole {
  return role !== null && role !== undefined && isClimateRole(role) ? role : 'climate-thermostat'
}

/** A plug-in heater: a `switch` with role `switch-heater`. Power only, no setpoint. */
export function isSwitchHeater(type: string, role: string | null | undefined): boolean {
  return type === DeviceType.Switch && role === 'switch-heater'
}
