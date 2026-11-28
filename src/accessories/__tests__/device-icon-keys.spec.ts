/**
 * Every icon `deviceTypeIconKey` / the hub role table can return must draw in
 * the viewer (`icon-nodes.generated.ts`).
 */
import { DeviceType, deviceIconKey, deviceTypeIconKey } from '@dominevo/types/client'
import { DeviceRole } from '@dominevo/types'
import { describe, expect, it } from 'vitest'

import { ICON_NODES } from '../../lib/icon-nodes.generated.js'
import { iconNodeFor } from '../../lib/icon-node-for.js'
import { builtInIconKeyForRole, iconKeyForDeviceType } from '../accessory-icon-keys.js'
import { resolveAccessoryIconKey } from '../accessory-panel-rows.js'

function drawable(key: string): boolean {
  return iconNodeFor(key, ICON_NODES) !== undefined
}

describe('hub device icons are drawable', () => {
  it('every device type resolves to a catalog node this viewer carries', () => {
    const missing: string[] = []
    for (const type of Object.values(DeviceType)) {
      const key = deviceTypeIconKey(type)
      if (!drawable(key)) missing.push(`${type}→${key}`)
    }
    expect(missing).toEqual([])
  })

  it('every known role resolves to a catalog node this viewer carries', () => {
    const missing: string[] = []
    for (const role of Object.values(DeviceRole)) {
      const key = deviceIconKey(DeviceType.Generic, role)
      if (!drawable(key)) missing.push(`${role}→${key}`)
    }
    expect(missing).toEqual([])
  })
})

describe('resolver parity with the accessory panel', () => {
  it('a switch-light wears the light glyph, not the switch type icon', () => {
    expect(builtInIconKeyForRole('switch-light')).toBe('lightbulb')
    expect(
      resolveAccessoryIconKey({
        localIcon: undefined,
        displayIcon: null,
        role: 'switch-light',
        roleIcons: {},
        type: 'switch',
      }),
    ).toBe('lightbulb')
  })

  it('a climate device wears the climate type icon', () => {
    expect(iconKeyForDeviceType(DeviceType.Climate)).toBe('thermometer')
    expect(
      resolveAccessoryIconKey({
        localIcon: undefined,
        displayIcon: null,
        role: 'climate-thermostat',
        roleIcons: {},
        type: DeviceType.Climate,
      }),
    ).toBe('thermometer')
  })
})

describe('workload and PoE-port devices are not drawn as generic', () => {
  it('a workload row wears the workload glyph, and each workload role its own', () => {
    const generic = iconKeyForDeviceType(DeviceType.Generic)
    expect(iconKeyForDeviceType(DeviceType.Workload)).not.toBe(generic)
    for (const role of ['vm', 'app-container', 'app', 'host', 'poe-port']) {
      const key = resolveAccessoryIconKey({ localIcon: undefined, displayIcon: null, role, roleIcons: {}, type: DeviceType.Workload })
      expect(key, role).not.toBe(generic)
      expect(drawable(key), role).toBe(true)
    }
  })
})
