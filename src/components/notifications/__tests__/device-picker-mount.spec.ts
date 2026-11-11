/**
 * @vitest-environment jsdom
 *
 * The rule editor's pickers that are not the device → value picker, mounted
 * over the hub stub: the generic `ItemPicker` (every chip drawn, string ids),
 * the system family's node and package pickers (D637), the system-event
 * kinds, and the widening warning seeded from the SAVED rule through
 * `ConditionForm` (D49). The device fields themselves (`DeviceValueField`,
 * issue #496) are covered in `device-value-picker/__tests__`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom, within } from '@testing-library/react'
import React, { useState } from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { ItemPicker } from '../ItemPicker.js'
import { PICKER_SEARCH_DEBOUNCE_MS } from '../device-picker-model.js'
import { NodePicker, PackagePicker } from '../ScopePickers.js'
import { ConditionForm, type ConditionFormScopes } from '../ConditionForm.js'
import { DeviceScopeField } from '../ScopeFields.js'
import { ruleScopeDraftOf } from '../rule-scope-model.js'
import type { RuleDeviceSource } from '../rule-device-source.js'
import type { NcConditionDescriptor, NcConditions } from '../../../data/notification-center.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERAS = [
  { id: 1, name: 'Front door', type: 'camera', isCamera: true, online: true },
  { id: 5, name: 'Garden', type: 'camera', isCamera: true, online: true },
]

interface HubDevice {
  readonly id: number
}

/** The ids a `listAll` input asks for, or `null` for an unfiltered listing. */
function askedIds(input: unknown): readonly number[] | null {
  if (typeof input !== 'object' || input === null || !('deviceIds' in input)) return null
  const ids: unknown = input.deviceIds
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : null
}

/**
 * `deviceManager.listAll` answers two readers: the camera list (`isCamera`)
 * and the by-id lookup (`deviceIds`) a selected id outside the camera list is
 * judged against. The hub filters on both; so does this.
 */
function fleetHub(cameras: readonly HubDevice[], others: readonly HubDevice[] = []) {
  return {
    'deviceManager.listAll': (input?: unknown) => {
      if (typeof input === 'object' && input !== null && 'isCamera' in input) return cameras
      const ids = askedIds(input)
      const all = [...cameras, ...others]
      return ids === null ? all : all.filter((device) => ids.includes(device.id))
    },
  }
}

const WIDENS = 'No camera selected: the rule will apply to ALL cameras.'

afterEach(() => {
  cleanup()
})

/**
 * The seed has to REACH the picker: the editor passes the draft's baseline
 * down through `ConditionForm` → `ConditionField`. Mounted at that seam, so a
 * dropped prop anywhere on the way fails here rather than in the field.
 */
describe('ConditionForm — the saved rule seeds the widening warning', () => {
  const DEVICES: NcConditionDescriptor = {
    id: 'devices',
    group: 'scope',
    label: 'Cameras',
    valueType: 'deviceIdList',
    operator: 'in',
    appliesTo: ['immediate', 'track-end', 'device-event'],
    phase: 'ga',
  }
  const SYSTEM: NcConditionDescriptor = {
    id: 'systemEvent',
    group: 'system',
    label: 'System event',
    valueType: 'systemEvent',
    operator: 'in',
    appliesTo: ['system-event'],
    phase: 'P1',
  }

  function mountForm(
    descriptor: NcConditionDescriptor,
    delivery: 'immediate' | 'system-event',
    conditions: NcConditions,
    savedConditions: NcConditions | undefined,
  ): void {
    // The rule's devices are ONE scope field bound to the editor's draft
    // (D641): an emptied Only list, seeded from what the SAVED rule held.
    const savedDevices = savedConditions?.devices ?? []
    const scopes: ConditionFormScopes = {
      devices: {
        draft: { ...ruleScopeDraftOf(savedDevices.length > 0 ? savedDevices : [0], undefined), include: [] },
        onChange: () => undefined,
        exceptOffered: false,
        savedHad: savedDevices.length > 0,
      },
    }
    mountScreen(
      React.createElement(ConditionForm, {
        scopes,
        catalog: [descriptor],
        delivery,
        kind: delivery === 'system-event' ? 'device-events' : 'detection',
        systemFamily: delivery === 'system-event' ? 'device-events' : undefined,
        conditions,
        savedConditions,
        schedule: undefined,
        taxonomy: undefined,
        onConditionsChange: () => undefined,
        onScheduleChange: () => undefined,
      }),
      { hub: fleetHub(CAMERAS) },
    )
  }

  it('rule devices: saved with devices, empty now → warns on a fresh mount', async () => {
    mountForm(DEVICES, 'immediate', {}, { devices: [42] })
    expect(await dom.findByText(WIDENS)).toBeTruthy()
  })

  it('rule devices: saved empty, empty now → no warning', async () => {
    mountForm(DEVICES, 'immediate', {}, {})
    await dom.findByText('Every device — no restriction')
    expect(dom.queryByText(WIDENS)).toBeNull()
  })

  it('system-event device filter: saved with devices, empty now → warns on a fresh mount', async () => {
    mountForm(
      SYSTEM,
      'system-event',
      { systemEvent: { kinds: ['device-offline'] } },
      { systemEvent: { kinds: ['device-offline'], deviceIds: [42] } },
    )
    expect(await dom.findByText(WIDENS)).toBeTruthy()
  })
})

/** The system-event kinds and the battery warning; the device pickers are in `device-value-field-mount.spec.ts`. */
describe('SystemEventField — kinds and the battery warning', () => {
  const SYSTEM: NcConditionDescriptor = {
    id: 'systemEvent',
    group: 'system',
    label: 'System event',
    valueType: 'systemEvent',
    operator: 'in',
    appliesTo: ['system-event'],
    phase: 'P1',
  }
  const THERMO = { id: 3615, name: 'Termometro sala server', type: 'sensor', isCamera: false, online: true }

  function mountSystem(conditions: NcConditions, onChange = vi.fn<(next: NcConditions) => void>()) {
    // Every rule here is a DEVICE-EVENTS rule (D637): batteries are device events.
    mountScreen(
      React.createElement(ConditionForm, {
        catalog: [SYSTEM],
        delivery: 'system-event',
        kind: 'device-events',
        systemFamily: 'device-events',
        conditions,
        savedConditions: conditions,
        schedule: undefined,
        taxonomy: undefined,
        onConditionsChange: onChange,
        onScheduleChange: () => undefined,
      }),
      { hub: fleetHub(CAMERAS, [THERMO]) },
    )
    return onChange
  }

  it('warns when battery kinds meet a device-type filter', async () => {
    mountSystem({ systemEvent: { kinds: ['device-battery-low', 'device-offline'], deviceTypes: ['camera'] } })
    expect(await dom.findByTestId('battery-device-types-warning')).toBeTruthy()
  })

  it('the FAMILY is the rule\'s, never the value\'s: unticking a kind keeps the family\'s kinds offered (review M1)', async () => {
    function Stateful() {
      const [conditions, setConditions] = useState<NcConditions>({
        systemEvent: { kinds: ['device-offline', 'device-online', 'device-battery-low'] },
      })
      return React.createElement(ConditionForm, {
        catalog: [SYSTEM],
        delivery: 'system-event',
        kind: 'device-events',
        systemFamily: 'device-events',
        conditions,
        savedConditions: undefined,
        schedule: undefined,
        taxonomy: undefined,
        onConditionsChange: setConditions,
        onScheduleChange: () => undefined,
      })
    }
    mountScreen(React.createElement(Stateful), { hub: fleetHub(CAMERAS, [THERMO]) })
    await act(async () => {
      fireEvent.click(await dom.findByText('Device connectivity (offline / back online)'))
    })
    // All that is left is a battery kind — the field is still the device-events
    // one, so the tick can be undone; another family's kinds are never offered.
    expect(dom.getByText('Device connectivity (offline / back online)')).toBeTruthy()
    expect(dom.queryByText('Node connectivity (offline / back online)')).toBeNull()
    expect(dom.queryByText('Node restarting')).toBeNull()
  })

  it('a device-events rule is offered its family — liveness AND batteries — and nothing else', async () => {
    mountSystem({ systemEvent: { kinds: ['device-battery-low'] } })
    await dom.findByTestId('system-event-exclude')
    expect(dom.getByText('Device connectivity (offline / back online)')).toBeTruthy()
    expect(dom.getByText('Battery (low / back to normal)')).toBeTruthy()
    expect(dom.getByText('Consumables (low / replaced)')).toBeTruthy()
    expect(dom.queryByText('Node connectivity (offline / back online)')).toBeNull()
  })

  it('the last kind of a family rule cannot be unticked — an empty system rule would be `mixed`', async () => {
    const onChange = mountSystem({ systemEvent: { kinds: ['device-battery-low', 'device-battery-normal'] } })
    // The only ticked chip is the battery class: unticking it would clear both
    // edges and leave no kind at all.
    await act(async () => {
      fireEvent.click(await dom.findByText('Battery (low / back to normal)'))
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})

/**
 * `DeviceScopeField`'s "All" mode line (`everyLabel`) has a wording trap: it used to pick the sentence from
 * `source.kind === 'caps'` alone, which was fine while sensor was the only
 * `'caps'` rule — and wrong the moment `detection` / `occupancy` / `sound`
 * started fetching by capability too (operator ruling, 2026-10-01).
 */
describe('DeviceScopeField — the "All" line reads the SUBJECT, not the fetch kind', () => {
  const ALL_DRAFT = { mode: 'all' as const, include: [], exclude: [], legacyBoth: false }

  it('a camera-subject caps source (detection/occupancy/sound) says "Every camera"', async () => {
    const source: RuleDeviceSource = { kind: 'caps', capNames: ['detection-pipeline'], subject: 'camera' }
    mountScreen(
      React.createElement(DeviceScopeField, {
        draft: ALL_DRAFT,
        onChange: () => undefined,
        exceptOffered: false,
        source,
      }),
      { hub: {} },
    )
    expect(await dom.findByText('Every camera — no restriction.')).toBeTruthy()
    expect(dom.queryByText('Every sensor — no restriction.')).toBeNull()
  })

  it('a sensor-subject caps source still says "Every sensor"', async () => {
    const source: RuleDeviceSource = { kind: 'caps', capNames: ['contact'], subject: 'sensor' }
    mountScreen(
      React.createElement(DeviceScopeField, {
        draft: ALL_DRAFT,
        onChange: () => undefined,
        exceptOffered: false,
        source,
      }),
      { hub: {} },
    )
    expect(await dom.findByText('Every sensor — no restriction.')).toBeTruthy()
    expect(dom.queryByText('Every camera — no restriction.')).toBeNull()
  })

  it('the plain cameras source (no change here) still says "Every camera"', async () => {
    mountScreen(
      React.createElement(DeviceScopeField, {
        draft: ALL_DRAFT,
        onChange: () => undefined,
        exceptOffered: false,
      }),
      { hub: {} },
    )
    expect(await dom.findByText('Every camera — no restriction.')).toBeTruthy()
  })
})

/**
 * The generic picker over STRING ids (D637): the system family's node and
 * package pickers are `ItemPicker<string>`, and a stored id the answered list
 * lacks is still a removable chip (D49).
 */
describe('ItemPicker — every selected chip is drawn', () => {
  it('ten selections draw ten chips, and no "show more" / "show fewer" toggle', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => i + 1)
    mountScreen(
      React.createElement(ItemPicker<number>, {
        items: ids.map((id) => ({ id, name: `Sensor ${String(id)}`, type: 'sensor', location: null })),
        state: 'answered',
        judged: [],
        value: ids,
        onChange: () => undefined,
        removedLabel: (id: number) => `Gone ${String(id)}`,
        unknownLabel: (id: number) => `Unknown ${String(id)}`,
      }),
      { hub: {} },
    )
    expect(await dom.findByText('Sensor 10')).toBeTruthy()
    expect(dom.queryAllByTestId(/^picker-chip-/)).toHaveLength(10)
    expect(dom.queryByText(/more$/)).toBeNull()
    expect(dom.queryByText('Show fewer')).toBeNull()
  })
})

describe('ItemPicker — string ids', () => {
  it('draws a removed string id by removedLabel, and pressing it empties the value', async () => {
    const onChange = vi.fn<(next: string[]) => void>()
    mountScreen(
      React.createElement(ItemPicker<string>, {
        items: [],
        state: 'answered',
        judged: [{ id: 'agent-x', removed: true }],
        value: ['agent-x'],
        onChange,
        removedLabel: (id: string) => `Gone ${id}`,
        unknownLabel: (id: string) => `Unknown ${id}`,
      }),
      { hub: {} },
    )
    const chip = await dom.findByText('Gone agent-x')
    await act(async () => {
      fireEvent.click(chip)
    })
    expect(onChange).toHaveBeenLastCalledWith([])
  })
})

describe('NodePicker / PackagePicker (D637)', () => {
  const HUB_NODE = { id: 'hub', name: 'Hub', isHub: true, isOnline: true }
  const AGENT = { id: 'mac-mini', name: 'Mac mini', isHub: false, isOnline: false }

  function directoryCalls(): number {
    return hubCalls().filter((call) => call.path === 'nodes.directory').length
  }

  it('reads nothing while closed with nothing to name', async () => {
    mountScreen(
      React.createElement(NodePicker, { value: [], onChange: () => undefined }),
      { hub: { 'nodes.directory': { nodes: [HUB_NODE], complete: true } } },
    )
    expect(await dom.findByText('Every node — no restriction')).toBeTruthy()
    expect(directoryCalls()).toBe(0)
  })

  it('names a stored node, calls a missing one removed from a COMPLETE directory', async () => {
    mountScreen(
      React.createElement(NodePicker, { value: ['mac-mini', 'agent-x'], onChange: () => undefined }),
      { hub: { 'nodes.directory': { nodes: [HUB_NODE, AGENT], complete: true } } },
    )
    expect(await dom.findByText('Mac mini')).toBeTruthy()
    expect(await dom.findByText('Node agent-x — removed')).toBeTruthy()
  })

  it('an INCOMPLETE directory never calls a stored node removed, and says so', async () => {
    mountScreen(
      React.createElement(NodePicker, { value: ['agent-x'], onChange: () => undefined }),
      { hub: { 'nodes.directory': { nodes: [HUB_NODE], complete: false } } },
    )
    expect(await dom.findByTestId('node-directory-incomplete')).toBeTruthy()
    expect(dom.getByText('agent-x')).toBeTruthy()
    expect(dom.queryByText('Node agent-x — removed')).toBeNull()
  })

  it('a FAILED directory never calls a stored node removed', async () => {
    mountScreen(
      React.createElement(NodePicker, { value: ['agent-x'], onChange: () => undefined }),
      { hub: {} },
    )
    expect(await dom.findByText('agent-x')).toBeTruthy()
    expect(dom.queryByText('Node agent-x — removed')).toBeNull()
  })

  it('the node sheet groups by role and liveness, and a tap selects the node id', async () => {
    const onChange = vi.fn<(next: string[]) => void>()
    mountScreen(
      React.createElement(NodePicker, { value: [], onChange }),
      { hub: { 'nodes.directory': { nodes: [HUB_NODE, AGENT], complete: true } } },
    )
    await act(async () => {
      fireEvent.click(dom.getByTestId('device-picker-add'))
    })
    const row = await dom.findByTestId('device-picker-row-mac-mini')
    const headers = dom
      .queryAllByTestId(/^device-picker-group-/)
      .map((header) => header.textContent ?? '')
    expect(headers).toHaveLength(2)
    expect(headers[0]).toContain('Agents · offline')
    expect(headers[1]).toContain('Hub')
    await act(async () => {
      fireEvent.click(row)
    })
    expect(onChange).toHaveBeenLastCalledWith(['mac-mini'])
  })

  it('the node sheet speaks of NODES — its search and its no-match line, never "device"', async () => {
    mountScreen(
      React.createElement(NodePicker, { value: [], onChange: () => undefined }),
      { hub: { 'nodes.directory': { nodes: [HUB_NODE, AGENT], complete: true } } },
    )
    await act(async () => {
      fireEvent.click(dom.getByTestId('device-picker-add'))
    })
    await dom.findByTestId('device-picker-row-mac-mini')
    expect(dom.getByText('Choose nodes')).toBeTruthy()
    expect(dom.queryByLabelText('Search by name, room or type')).toBeNull()
    const search = dom.getByLabelText('Search by node name or id')
    await act(async () => {
      fireEvent.change(search, { target: { value: 'nothing-is-called-this' } })
      await new Promise<void>((resolve) => setTimeout(resolve, PICKER_SEARCH_DEBOUNCE_MS + 50))
    })
    expect(dom.getByText('No node matches.')).toBeTruthy()
    expect(dom.queryByText('No device matches.')).toBeNull()
  })

  it('the package sheet offers the wrapper even when listPackages does not list it', async () => {
    const onChange = vi.fn<(next: string[]) => void>()
    mountScreen(
      React.createElement(PackagePicker, { value: [], onChange }),
      {
        hub: {
          'addons.listPackages': [{ name: '@camstack/addon-x', version: '1.2.3', dir: '/data/x' }],
        },
      },
    )
    await act(async () => {
      fireEvent.click(dom.getByTestId('device-picker-add'))
    })
    const wrapper = await dom.findByTestId('device-picker-row-camstack-wrapper')
    expect(dom.getByTestId('device-picker-row-@camstack/addon-x')).toBeTruthy()
    await act(async () => {
      fireEvent.click(wrapper)
    })
    expect(onChange).toHaveBeenLastCalledWith(['camstack-wrapper'])
  })

  it('a stored package the answered list lacks is "not installed"', async () => {
    mountScreen(
      React.createElement(PackagePicker, { value: ['@camstack/gone'], onChange: () => undefined }),
      { hub: { 'addons.listPackages': [] } },
    )
    expect(await dom.findByText('@camstack/gone — not installed')).toBeTruthy()
  })
})
