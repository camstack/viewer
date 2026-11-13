/**
 * The panel (and the add picker, which asks the same predicate) draws a
 * device that advertises `timed-run` even when its type has no control of its
 * own — a stove is a `switch-heater` and its one-tap run is the whole control.
 */
import { describe, expect, it } from 'vitest'
import {
  composeAccessoryRows,
  type AccessoryPanelDevice,
} from '../accessory-panel-rows.js'
import { EMPTY_ACCESSORY_PREFS } from '../accessory-prefs.js'
import { accessoryActuates } from '../use-accessory-panel.js'

function switchHeater(id: number, features: readonly string[]): AccessoryPanelDevice {
  return {
    id,
    name: `Stove ${id}`,
    type: 'switch',
    online: true,
    features,
    location: null,
    role: 'switch-heater',
    displayIcon: null,
  }
}

function inertAccessory(id: number, features: readonly string[]): AccessoryPanelDevice {
  return {
    id,
    name: `Read-only ${id}`,
    type: 'generic',
    online: true,
    features,
    location: null,
    role: null,
    displayIcon: null,
  }
}

function rowIds(server: readonly AccessoryPanelDevice[], local: readonly AccessoryPanelDevice[] = []) {
  return composeAccessoryRows({
    server,
    local,
    prefs: EMPTY_ACCESSORY_PREFS,
    roleIcons: {},
    actuates: accessoryActuates,
    stripParent: (name) => name,
    editing: false,
  }).map((r) => r.device.id)
}

describe('a timed-run device is drawn', () => {
  it('keeps a heater that advertises timed-run, from the hub and from local additions', () => {
    expect(rowIds([switchHeater(5391, ['timed-run'])], [switchHeater(5392, ['timed-run'])])).toEqual([
      5391,
      5392,
    ])
  })

  it('still drops a device with no actuating cap', () => {
    expect(rowIds([inertAccessory(5393, [])], [inertAccessory(5394, ['battery'])])).toEqual([])
  })

  it('keeps a heater that binds a plain switch', () => {
    expect(rowIds([switchHeater(5395, ['switch'])])).toEqual([5395])
  })

  it('the picker predicate agrees', () => {
    expect(accessoryActuates(switchHeater(1, ['timed-run']))).toBe(true)
    expect(accessoryActuates(inertAccessory(2, []))).toBe(false)
  })
})

describe('heater icon', () => {
  it('a switch-heater wears the flame glyph via the hub role table', async () => {
    const { builtInIconKeyForRole } = await import('../accessory-icon-keys.js')
    expect(builtInIconKeyForRole('switch-heater')).toBe('flame')
  })
})
