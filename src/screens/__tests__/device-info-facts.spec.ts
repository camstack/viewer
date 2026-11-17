/**
 * The device-info popover's rows: the provider-declared identifiers sit after
 * the id/parent rows and before reachability, in the hub admin's order (mac —
 * one row each — serial, vendor-uid, machine-uuid, hostname, ip). A payload
 * the identifiers schema refuses, or none at all, adds no row.
 */
import { describe, expect, it } from 'vitest'

import type { Translate } from '../../data/export-format.js'
import { deviceInfoFacts, type DeviceInfoFactInput } from '../device-info-facts.js'

const t: Translate = (key) => key

const BASE: DeviceInfoFactInput = {
  provider: null,
  typeId: null,
  roleId: null,
  deviceId: 7,
  parentName: 'Garage',
  reachability: 'online',
  seenAt: null,
  nowMs: 0,
  identifiers: undefined,
}

function entry(value: string): { value: string; origin: 'read'; readAt: number } {
  return { value, origin: 'read', readAt: 1 }
}

function labels(input: DeviceInfoFactInput): readonly string[] {
  return deviceInfoFacts(input, t).map((row) => row.labelKey)
}

describe('deviceInfoFacts — identifiers', () => {
  it('lists every identifier in order, one row per MAC, between parent and reachability', () => {
    const rows = deviceInfoFacts(
      {
        ...BASE,
        identifiers: {
          ip: entry('192.168.1.20'),
          hostname: entry('garage-cam'),
          'machine-uuid': entry('4c4c4544-0042-3510-8051-b4c04f4d3232'),
          'vendor-uid': entry('reolink:abc123'),
          serial: entry('reolink:sn-0099'),
          mac: [entry('aa:bb:cc:dd:ee:01'), entry('aa:bb:cc:dd:ee:02')],
        },
      },
      t,
    )
    expect(rows).toEqual([
      { labelKey: 'v2.deviceInfo.id', value: '7' },
      { labelKey: 'v2.deviceInfo.parent', value: 'Garage' },
      { labelKey: 'v2.deviceInfo.identifier.mac', value: 'aa:bb:cc:dd:ee:01' },
      { labelKey: 'v2.deviceInfo.identifier.mac', value: 'aa:bb:cc:dd:ee:02' },
      { labelKey: 'v2.deviceInfo.identifier.serial', value: 'reolink:sn-0099' },
      { labelKey: 'v2.deviceInfo.identifier.vendorUid', value: 'reolink:abc123' },
      {
        labelKey: 'v2.deviceInfo.identifier.machineUuid',
        value: '4c4c4544-0042-3510-8051-b4c04f4d3232',
      },
      { labelKey: 'v2.deviceInfo.identifier.hostname', value: 'garage-cam' },
      { labelKey: 'v2.deviceInfo.identifier.ip', value: '192.168.1.20' },
      { labelKey: 'v2.deviceInfo.reachability', value: 'v2.deviceInfo.online' },
    ])
  })

  it('shows only the keys the device declared', () => {
    expect(labels({ ...BASE, identifiers: { hostname: entry('nas') } })).toEqual([
      'v2.deviceInfo.id',
      'v2.deviceInfo.parent',
      'v2.deviceInfo.identifier.hostname',
      'v2.deviceInfo.reachability',
    ])
  })

  it('adds no row for a payload the schema refuses', () => {
    const refused: readonly unknown[] = [
      { mac: [entry('AA-BB-CC-DD-EE-FF')] },
      { ip: entry('not-an-ip') },
      { serial: { value: 'x:y', origin: 'guessed', readAt: 1 } },
      { mac: [] },
      'aa:bb:cc:dd:ee:ff',
      null,
    ]
    for (const identifiers of refused) {
      expect(labels({ ...BASE, identifiers })).toEqual([
        'v2.deviceInfo.id',
        'v2.deviceInfo.parent',
        'v2.deviceInfo.reachability',
      ])
    }
  })

  it('adds no row when the device declares no identifiers', () => {
    expect(labels(BASE)).toEqual([
      'v2.deviceInfo.id',
      'v2.deviceInfo.parent',
      'v2.deviceInfo.reachability',
    ])
  })
})
