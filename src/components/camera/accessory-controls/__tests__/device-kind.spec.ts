/**
 * `device-kind.ts` hand-copies hub `CLIMATE_ROLES`; this spec fails when the hub
 * list drifts from the viewer copy or from hub `DeviceRole` (specs may read
 * `@camstack/types`; `/client` carries `DeviceType` only until `DeviceRole` ships).
 */
import { describe, expect, it } from 'vitest'
import { DeviceRole } from '@camstack/types'
import { VIEWER_CLIMATE_ROLES } from '../device-kind.js'

/** Hub `packages/types/src/device/device-kind.ts` — `CLIMATE_ROLES` order. */
const HUB_CLIMATE_ROLES: readonly DeviceRole[] = [
  DeviceRole.ClimateThermostat,
  DeviceRole.ClimateAc,
  DeviceRole.ClimateRadiator,
  DeviceRole.ClimateFloor,
  DeviceRole.ClimateHeater,
  DeviceRole.ClimateHeatPumpCircuit,
]

const hubClimateRoleSet = new Set<string>(HUB_CLIMATE_ROLES)

describe('viewer device-kind climate roles', () => {
  it('matches hub CLIMATE_ROLES order and membership', () => {
    expect([...VIEWER_CLIMATE_ROLES]).toEqual([...HUB_CLIMATE_ROLES])
  })

  it('includes every hub climate role published on DeviceRole', () => {
    const fromClient = Object.values(DeviceRole).filter((role) => hubClimateRoleSet.has(role))
    expect(new Set(fromClient)).toEqual(hubClimateRoleSet)
    expect(fromClient).toHaveLength(HUB_CLIMATE_ROLES.length)
  })
})
