/**
 * The three system-event families (D637), as the viewer's editor offers them.
 *
 * A system rule used to be one editor for every kind and every filter; the
 * battery kinds sat under a liveness `deviceTypes` filter and went silent for
 * two weeks (D636). A rule now answers ONE family's question — devices, the
 * installation, or the alarm panel — and the editor offers only that family's
 * kinds and filters. The tables are the shared ones in `@camstack/types`.
 */
import { NC_SYSTEM_EVENT_KIND_GROUP_SPECS } from '@camstack/types/client'
import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import { NcConditionsSchema } from '../../../data/notification-center.js'
import {
  batteryKindsNarrowedByType,
  familyFilterVisibility,
  pruneSystemEventForFamily,
  systemEventGroupLabelKey,
  systemEventKindGroupsForFamily,
  systemEventOptionsForFamily,
} from '../system-event-family.js'

describe('viewer system-event families (D637)', () => {
  it('offers only the family’s kinds, in group order — each reachable through exactly one chip', () => {
    expect(systemEventOptionsForFamily('system', undefined).flatMap((o) => o.clears)).toEqual([
      'node-offline', 'node-online', 'node-restarting', 'node-inference-unavailable',
      'addon-crash-loop', 'addon-update-available', 'addon-updated',
      'server-update-available', 'node-updating', 'server-updated', 'wrapper-update-available',
      'backup-completed', 'export-completed',
      'storage-location-low', 'storage-location-critical', 'storage-location-ok',
      'alert-critical', 'alert-critical-resolved', 'alert-error',
      'rule-broken', 'rule-repaired',
    ])
  })
  it('a paired class (D906) is ONE chip; a one-edge kind stays single', () => {
    const options = systemEventOptionsForFamily('system', undefined)
    expect(options.filter((o) => o.classId === 'node-connectivity')).toEqual([
      expect.objectContaining({ kind: 'node-offline', clears: ['node-offline', 'node-online'] }),
    ])
    expect(options.find((o) => o.kind === 'node-restarting')).toEqual(
      expect.objectContaining({ writes: ['node-restarting'], clears: ['node-restarting'] }),
    )
    expect(options.find((o) => o.kind === 'node-restarting')?.classId).toBeUndefined()
  })
  it('prefers the hub’s label for a kind it served', () => {
    expect(systemEventOptionsForFamily('alarm', [{ value: 'alarm-armed', label: 'Armed!' }]).find((o) => o.kind === 'alarm-armed')?.fallback).toBe('Armed!')
  })
  it('falls back to the kind itself when the hub served no label', () => {
    expect(systemEventOptionsForFamily('alarm', undefined).find((o) => o.kind === 'alarm-armed')?.fallback).toBe('alarm-armed')
  })
  it('the device-events family carries the battery and consumable kinds', () => {
    const kinds = systemEventOptionsForFamily('device-events', undefined).flatMap((o) => o.clears)
    expect(kinds).toEqual(expect.arrayContaining(['device-battery-low', 'device-consumable-normal', 'detection-blind']))
    expect(kinds).not.toContain('node-offline')
  })
  it('motion without a subject (D907) and a device that needs attention (D911) are ONE chip each', () => {
    const chips = systemEventOptionsForFamily('device-events', undefined)
    for (const [classId, bad, recovery] of [
      ['motion-noise', 'motion-noisy', 'motion-calm'],
      ['device-attention', 'device-attention-required', 'device-attention-resolved'],
    ] as const) {
      const chip = chips.find((o) => o.classId === classId)
      expect(chip?.clears, classId).toEqual(expect.arrayContaining([bad, recovery]))
    }
    // The device filters speak about the new kinds like any other device event.
    expect(familyFilterVisibility('device-events', ['motion-noisy']).devices).toBe(true)
    expect(familyFilterVisibility('device-events', ['device-attention-required']).devices).toBe(true)
  })
  it('alarm camera filter only with alarm-triggered; no node box on device events', () => {
    expect(familyFilterVisibility('alarm', ['alarm-armed']).devices).toBe(false)
    expect(familyFilterVisibility('alarm', ['alarm-triggered']).devices).toBe(true)
    expect(familyFilterVisibility('device-events', ['device-offline']).nodes).toBe(false)
  })
  it('each family shows only the filters it may carry', () => {
    expect(familyFilterVisibility('device-events', ['device-offline'])).toEqual({
      devices: true, excludeDevices: true, deviceTypes: true, nodes: false, packages: false, consumableThreshold: false,
    })
    expect(familyFilterVisibility('alarm', ['alarm-triggered']).excludeDevices).toBe(false)
    expect(familyFilterVisibility('system', ['addon-update-available'])).toEqual({
      devices: false, excludeDevices: false, deviceTypes: false, nodes: true, packages: true, consumableThreshold: false,
    })
    // `export-completed` names no device, node or package.
    expect(familyFilterVisibility('system', ['export-completed'])).toEqual({
      devices: false, excludeDevices: false, deviceTypes: false, nodes: false, packages: false, consumableThreshold: false,
    })
  })
  it('a filter outside the family stays hidden even when a stray kind speaks about it', () => {
    // Such a rule classifies `mixed` and never mounts a family editor; this is
    // the defence behind that: the hub refuses the filter on that family, so
    // the family's visibility never offers it whatever kinds it is handed.
    expect(familyFilterVisibility('system', ['node-offline', 'device-offline'])).toEqual({
      devices: false, excludeDevices: false, deviceTypes: false, nodes: true, packages: false, consumableThreshold: false,
    })
    expect(familyFilterVisibility('alarm', ['alarm-triggered', 'device-offline']).excludeDevices).toBe(false)
    expect(familyFilterVisibility('alarm', ['alarm-triggered', 'device-offline']).deviceTypes).toBe(false)
  })
  it('keeps the D636 warning', () => {
    expect(batteryKindsNarrowedByType({ kinds: ['device-battery-low'], deviceTypes: ['camera'] })).toBe(true)
    expect(batteryKindsNarrowedByType({ kinds: ['device-battery-low'] })).toBe(false)
    expect(batteryKindsNarrowedByType({ kinds: ['device-offline'], deviceTypes: ['camera'] })).toBe(false)
    expect(batteryKindsNarrowedByType(undefined)).toBe(false)
  })
})

describe('the exclude list survives a phone save', () => {
  it('the viewer mirror PARSES excludeDeviceIds — an unmirrored key is stripped on save', () => {
    const parsed = NcConditionsSchema.parse({
      systemEvent: { kinds: ['device-battery-low'], excludeDeviceIds: [3615] },
    })
    expect(parsed.systemEvent?.excludeDeviceIds).toEqual([3615])
  })
})

describe('words', () => {
  function lookupLocale(tree: unknown, key: string): string | undefined {
    let node: unknown = tree
    for (const part of key.split('.')) {
      if (node === null || typeof node !== 'object' || !(part in node)) return undefined
      const record: Record<string, unknown> = { ...node }
      node = record[part]
    }
    return typeof node === 'string' ? node : undefined
  }

  it('every kind group, and the filter words, exist in en and it', () => {
    const keys = [
      ...NC_SYSTEM_EVENT_KIND_GROUP_SPECS.map((group) => systemEventGroupLabelKey(group.id)),
      'v2.nc.rules.editor.systemFilters.excludeDevices',
      'v2.nc.rules.editor.systemFilters.batteryTypesWarning',
      'v2.nc.rules.mustRecreate',
    ]
    expect(keys.length).toBeGreaterThanOrEqual(13)
    for (const key of keys) {
      expect(lookupLocale(enLocale, key), `en ${key}`).toBeTypeOf('string')
      expect(lookupLocale(itLocale, key), `it ${key}`).toBeTypeOf('string')
    }
  })

  it('no battery-only word survives the fold into device events', () => {
    for (const locale of [enLocale, itLocale]) {
      expect(lookupLocale(locale, 'v2.nc.rules.kind.battery')).toBeUndefined()
      expect(lookupLocale(locale, 'v2.nc.rules.kindCreate.battery')).toBeUndefined()
      expect(lookupLocale(locale, 'v2.nc.rules.kindEmpty.battery')).toBeUndefined()
      expect(lookupLocale(locale, 'v2.nc.rules.editor.kindBlurb.battery')).toBeUndefined()
    }
  })
})

describe('the family editor’s group headings (D637)', () => {
  it('cuts the family’s kinds into its own groups, in the shared table’s order', () => {
    const groups = systemEventKindGroupsForFamily('device-events', undefined)
    expect(groups.map((group) => group.id)).toEqual(
      NC_SYSTEM_EVENT_KIND_GROUP_SPECS.filter((group) => group.family === 'device-events').map((group) => group.id),
    )
    expect(groups.find((group) => group.id === 'battery')?.options).toEqual([
      expect.objectContaining({ classId: 'battery', clears: ['device-battery-low', 'device-battery-normal'] }),
    ])
    expect(groups.every((group) => group.labelKey === systemEventGroupLabelKey(group.id))).toBe(true)
  })

})

describe('pruneSystemEventForFamily (D637)', () => {
  it('drops an empty list rather than sending `[]`', () => {
    expect(pruneSystemEventForFamily('device-events', { kinds: ['device-offline'], deviceIds: [] })).toEqual({
      kinds: ['device-offline'],
    })
  })

  it('keeps a system rule’s node and package filters for the kinds that speak about them', () => {
    expect(
      pruneSystemEventForFamily('system', {
        kinds: ['node-offline', 'server-update-available'],
        nodeIds: ['hub'],
        packageNames: ['@camstack/server'],
        deviceIds: [102],
      }),
    ).toEqual({ kinds: ['node-offline', 'server-update-available'], nodeIds: ['hub'], packageNames: ['@camstack/server'] })
  })
})
