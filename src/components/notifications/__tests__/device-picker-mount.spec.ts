/**
 * @vitest-environment jsdom
 *
 * The device picker (`DevicePicker`, D636), mounted over the real `useCameras`
 * and `useDeviceCatalogue` (the hub stub answers `deviceManager.listAll`).
 *
 * What only a mount can say:
 *  - a selected camera the hub no longer has is DRAWN, as a warning chip, and
 *    tapping it removes it from the value (never auto-dropped — D49);
 *  - a pending list shows a loading line and never the "applies to all" hint,
 *    which would be a claim of absence from a query that has not answered
 *    (D315);
 *  - a failed list still lists the selected ids so they can be removed;
 *  - emptying an all-meaning selection that held devices warns that the rule
 *    now widens to every camera.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom, within } from '@testing-library/react'
import React, { useState } from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { capsSourceHub } from '../../../testing/picker-caps-hub.js'
import { DevicePicker, type DevicePickerSource } from '../DevicePicker.js'
import { ItemPicker } from '../ItemPicker.js'
import { NodePicker, PackagePicker } from '../ScopePickers.js'
import { PICKER_SEARCH_DEBOUNCE_MS, PICKER_WINDOW, type PickerDevice } from '../device-picker-model.js'
import { ConditionForm, type ConditionFormScopes } from '../ConditionForm.js'
import { DeviceScopeField } from '../ScopeFields.js'
import { ruleScopeDraftOf } from '../rule-scope-model.js'
import type { RuleDeviceSource } from '../rule-device-source.js'
import type { NcConditionDescriptor, NcConditions } from '../../../data/notification-center.js'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { cameraListCacheKey } from '../../../data/camera-list-cache.js'
import {
  DEVICE_PICKER_GROUP_KEY,
  useDevicePickerGroupStore,
} from '../../../store/device-picker-group-store.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERAS = [
  { id: 1, name: 'Front door', type: 'camera', isCamera: true, online: true },
  { id: 5, name: 'Garden', type: 'camera', isCamera: true, online: true },
]
const SENSOR = { id: 70, name: 'Door sensor', type: 'sensor', isCamera: false, online: true }

interface HubDevice {
  readonly id: number
}

/** The ids a `listAll` input asks for, or `null` for an unfiltered listing. */
function askedIds(input: unknown): readonly number[] | null {
  if (typeof input !== 'object' || input === null || !('deviceIds' in input)) return null
  const ids: unknown = input.deviceIds
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : null
}

/** Every `listAll` call that was NOT the camera list — the by-id lookups. */
function lookupCalls(): readonly (readonly number[] | null)[] {
  return hubCalls()
    .filter((call) => call.path === 'deviceManager.listAll')
    .filter((call) => !(typeof call.input === 'object' && call.input !== null && 'isCamera' in call.input))
    .map((call) => askedIds(call.input))
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

const CAMERAS_SOURCE: DevicePickerSource = { kind: 'cameras' }

const NO_CAMERAS_HINT = 'No cameras available — the rule applies to all devices.'
const WIDENS = 'No camera selected: the rule will apply to ALL cameras.'

interface HarnessProps {
  readonly initial: readonly number[]
  readonly emptyMeansAll: boolean
  readonly savedHadDevices: boolean
  readonly seen: (next: readonly number[]) => void
}

function Harness({ initial, emptyMeansAll, savedHadDevices, seen }: HarnessProps): React.ReactElement {
  const [value, setValue] = useState<readonly number[]>(initial)
  return React.createElement(DevicePicker, {
    source: CAMERAS_SOURCE,
    value,
    emptyMeansAll,
    savedHadDevices,
    onChange: (next: number[]) => {
      seen(next)
      setValue(next)
    },
  })
}

function mount(
  initial: readonly number[],
  hub: Record<string, unknown>,
  emptyMeansAll = true,
  savedHadDevices = false,
) {
  const seen = vi.fn<(next: readonly number[]) => void>()
  mountScreen(React.createElement(Harness, { initial, emptyMeansAll, savedHadDevices, seen }), { hub })
  return seen
}

/** `use-cameras` paints the last list it saw from a per-hub AsyncStorage copy,
 *  one map for the whole file: without this a later test's pending or failed
 *  query would be answered by an earlier test's cameras. */
beforeEach(async () => {
  await AsyncStorage.removeItem(cameraListCacheKey('http://hub.test:8080'))
})

afterEach(() => {
  cleanup()
})

describe('DevicePicker — a selected device the hub no longer has', () => {
  it('draws the removed id as a row and deselecting it takes it out of the value', async () => {
    const seen = mount([5, 42], fleetHub(CAMERAS))
    const row = await dom.findByText('Device #42 — removed')
    expect(dom.getByText('Garden')).toBeTruthy()
    await act(async () => {
      fireEvent.click(row)
    })
    expect(seen).toHaveBeenLastCalledWith([5])
    expect(dom.queryByText('Device #42 — removed')).toBeNull()
  })

  it('the ONLY selected id removed: shows it (not "all devices"), and removing it warns of the widening', async () => {
    const seen = mount([42], fleetHub([]))
    const row = await dom.findByText('Device #42 — removed')
    expect(dom.queryByText(NO_CAMERAS_HINT)).toBeNull()
    expect(dom.queryByText(WIDENS)).toBeNull()
    await act(async () => {
      fireEvent.click(row)
    })
    expect(seen).toHaveBeenLastCalledWith([])
    expect(dom.getByText(WIDENS)).toBeTruthy()
  })

  it('never warns of widening where empty is not "all" (timelapse / digest)', async () => {
    mount([42], fleetHub(CAMERAS), false)
    const row = await dom.findByText('Device #42 — removed')
    await act(async () => {
      fireEvent.click(row)
    })
    expect(dom.queryByText(WIDENS)).toBeNull()
  })

  it('a selected device the camera list does not draw but the FLEET has is named, not removed', async () => {
    const seen = mount([1, 70], fleetHub(CAMERAS, [SENSOR]))
    const row = await dom.findByText('Door sensor')
    expect(dom.queryByText('Device #70 — removed')).toBeNull()
    // Asked by id — only the one the camera list lacks, never the whole fleet.
    expect(lookupCalls()).toEqual([[70]])
    await act(async () => {
      fireEvent.click(row)
    })
    expect(seen).toHaveBeenLastCalledWith([1])
  })

  it('a pending list shows a loading line, never the "applies to all" hint', async () => {
    mount([], { 'deviceManager.listAll': () => new Promise<never>(() => undefined) })
    expect(await dom.findByText('Loading cameras…')).toBeTruthy()
    expect(dom.queryByText(NO_CAMERAS_HINT)).toBeNull()
  })

  it('an answered EMPTY list with nothing selected is the "applies to all" hint', async () => {
    mount([], fleetHub([]))
    expect(await dom.findByText(NO_CAMERAS_HINT)).toBeTruthy()
  })

  it('a FAILED camera list asks nothing more of the hub, and lists every selected id by number', async () => {
    const seen = mount([1, 42], {})
    const row = await dom.findByText('Device #42')
    expect(dom.getByText('Device #1')).toBeTruthy()
    expect(dom.queryByText('Device #42 — removed')).toBeNull()
    expect(dom.queryByText(NO_CAMERAS_HINT)).toBeNull()
    expect(lookupCalls()).toEqual([])
    await act(async () => {
      fireEvent.click(row)
    })
    expect(seen).toHaveBeenLastCalledWith([1])
  })

  it('a FAILED camera list while the device lookup WOULD answer: still no lookup, no removal claim', async () => {
    const hub = {
      'deviceManager.listAll': (input?: unknown) => {
        if (typeof input === 'object' && input !== null && 'isCamera' in input) {
          throw new Error('camera list down')
        }
        return [SENSOR]
      },
    }
    mount([70, 42], hub)
    expect(await dom.findByText('Device #70')).toBeTruthy()
    expect(dom.getByText('Device #42')).toBeTruthy()
    expect(dom.queryByText('Door sensor')).toBeNull()
    expect(dom.queryByText('Device #42 — removed')).toBeNull()
    expect(lookupCalls()).toEqual([])
  })

  it('the widening warning is seeded from the SAVED rule, so a fresh mount keeps it', async () => {
    mount([], fleetHub(CAMERAS), true, true)
    expect(await dom.findByText(WIDENS)).toBeTruthy()
  })

  it('where empty is not "all", an empty hub never says the rule applies to all', async () => {
    mount([], fleetHub([]), false)
    expect(await dom.findByText('No cameras available.')).toBeTruthy()
    expect(dom.queryByText(NO_CAMERAS_HINT)).toBeNull()
  })
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

/** The caps source answers over the wire: wait for its headers or rows. */
async function listAnswered(): Promise<void> {
  await vi.waitFor(() =>
    expect(dom.queryAllByTestId(/^device-picker-(group|row)-/).length).toBeGreaterThan(0),
  )
}

/**
 * The size it has to survive: 500 devices of ONE type. The sheet renders a
 * bounded window, never 500 rows; the search is debounced; "All" on a group
 * picks exactly that group.
 */
describe('DevicePicker — 500 devices of one type', () => {
  const ROOMS = ['Hall', 'Kitchen', 'Camera', 'Bathroom', 'Studio']
  const SENSORS: readonly PickerDevice[] = Array.from({ length: 500 }, (_, i) => ({
    id: 1000 + i,
    name: `Temperatura ${String(i)}`,
    type: 'sensor',
    location: ROOMS[i % ROOMS.length] ?? null,
  }))

  function CapsListHarness({ seen }: { readonly seen: (next: readonly number[]) => void }) {
    const [value, setValue] = useState<readonly number[]>([7])
    return React.createElement(DevicePicker, {
      source: { kind: 'caps', capNames: ['contact'] },
      value,
      onChange: (next: number[]) => {
        seen(next)
        setValue(next)
      },
    })
  }

  function renderedRows(): number {
    return dom.queryAllByTestId(/^device-picker-row-/).length
  }

  async function openSheet(seen = vi.fn<(next: readonly number[]) => void>()) {
    mountScreen(React.createElement(CapsListHarness, { seen }), { hub: capsSourceHub(SENSORS) })
    await act(async () => {
      fireEvent.click(dom.getByTestId('device-picker-add'))
    })
    await listAnswered()
    return seen
  }

  it('opens on five collapsed groups and ZERO device rows', async () => {
    await openSheet()
    expect(dom.queryAllByTestId(/^device-picker-group-/)).toHaveLength(5)
    expect(renderedRows()).toBe(0)
  })

  it('a search that matches all 500 renders a bounded window, never 500 rows', async () => {
    await openSheet()
    const search = dom.getByLabelText('Search by name, room or type')
    await act(async () => {
      fireEvent.change(search, { target: { value: 'temperatura' } })
    })
    // Debounced: nothing has moved yet.
    expect(renderedRows()).toBe(0)
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, PICKER_SEARCH_DEBOUNCE_MS + 50))
    })
    const rows = renderedRows()
    expect(rows).toBeGreaterThan(0)
    expect(rows).toBeLessThanOrEqual(PICKER_WINDOW)
  })

  it('"All" on one room picks its 100 devices and keeps what was there', async () => {
    const seen = await openSheet()
    const hall = dom
      .queryAllByTestId(/^device-picker-group-/)
      .find((header) => header.textContent?.includes('Hall'))
    expect(hall).toBeDefined()
    if (hall === undefined) return
    await act(async () => {
      fireEvent.click(within(hall).getByText('All'))
    })
    const picked = seen.mock.lastCall?.[0] ?? []
    expect(picked).toHaveLength(101)
    expect(picked[0]).toBe(7)
    // Every chip is drawn — no "+N more" (operator, 2026-09-26: "always show
    // them all, there is enough space").
    expect(dom.queryAllByTestId(/^picker-chip-/)).toHaveLength(101)
    expect(dom.queryByText('+95 more')).toBeNull()
  })
})

/**
 * The system rule's pickers list EVERY device (a battery belongs to a sensor),
 * and read the fleet only while the sheet is open.
 */
describe('SystemEventField — include/exclude and the battery warning', () => {
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

  function unfilteredFleetReads(): number {
    return lookupCalls().filter((ids) => ids === null).length
  }

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

  it('the device-events pickers offer EVERY device, read from the fleet only on open (D637)', async () => {
    const onChange = mountSystem({ systemEvent: { kinds: ['device-battery-low'] } })
    const exclude = await dom.findByTestId('system-event-exclude')
    expect(unfilteredFleetReads()).toBe(0)
    await act(async () => {
      fireEvent.click(within(exclude).getByTestId('device-picker-add'))
    })
    const row = await dom.findByTestId('device-picker-row-3615')
    expect(unfilteredFleetReads()).toBeGreaterThan(0)
    // A camera is a device too: liveness and batteries share one family now.
    expect(dom.getByTestId('device-picker-row-1')).toBeTruthy()
    await act(async () => {
      fireEvent.click(row)
    })
    expect(onChange).toHaveBeenLastCalledWith({
      systemEvent: { kinds: ['device-battery-low'], excludeDeviceIds: [3615] },
    })
  })

  it('names a stored exclusion by a TARGETED read, and calls a deleted one removed', async () => {
    mountSystem({ systemEvent: { kinds: ['device-battery-low'], excludeDeviceIds: [3615, 42] } })
    expect(await dom.findByText('Termometro sala server')).toBeTruthy()
    expect(await dom.findByText('Device #42 — removed')).toBeTruthy()
    expect(unfilteredFleetReads()).toBe(0)
  })
})

/**
 * A `'caps'` source wears the wording of its SUBJECT, not its fetch
 * mechanism (operator ruling, 2026-10-01): `detection` / `occupancy` /
 * `sound` now fetch their device list by capability
 * (`ruleDeviceCompatCapNames`, `rule-device-source.ts`) exactly like a
 * sensor rule always has, but to the operator they are still a CAMERA
 * scope — "no cameras", not "no sensors". Before the `subject` field
 * existed, EVERY `'caps'` source read as a sensor scope, which is the bug a
 * second kind of `'caps'` rule would have shipped silently.
 */
describe('DevicePicker — a caps source worded as a camera scope', () => {
  const CAMERA_CAPS_SOURCE: DevicePickerSource = {
    kind: 'caps',
    capNames: ['detection-pipeline'],
    subject: 'camera',
  }

  function capsHub(ids: readonly number[], cameras: readonly HubDevice[]) {
    return {
      'deviceManager.listDeviceIdsByCaps': () => ids,
      ...fleetHub(cameras),
    }
  }

  function CapsHarness({
    initial,
    seen,
  }: {
    readonly initial: readonly number[]
    readonly seen: (next: readonly number[]) => void
  }): React.ReactElement {
    const [value, setValue] = useState<readonly number[]>(initial)
    return React.createElement(DevicePicker, {
      source: CAMERA_CAPS_SOURCE,
      value,
      emptyMeansAll: true,
      onChange: (next: number[]) => {
        seen(next)
        setValue(next)
      },
    })
  }

  function mountCaps(initial: readonly number[], hub: Record<string, unknown>) {
    const seen = vi.fn<(next: readonly number[]) => void>()
    mountScreen(React.createElement(CapsHarness, { initial, seen }), { hub })
    return seen
  }

  it('a pending caps read shows the CAMERA loading line, never "No sensor"/"applies to all"', async () => {
    mountCaps([], { 'deviceManager.listDeviceIdsByCaps': () => new Promise<never>(() => undefined) })
    expect(await dom.findByText('Loading cameras…')).toBeTruthy()
    expect(dom.queryByText(NO_CAMERAS_HINT)).toBeNull()
  })

  it('an answered EMPTY caps list with nothing selected is the CAMERA "applies to all" hint', async () => {
    mountCaps([], capsHub([], CAMERAS))
    expect(await dom.findByText(NO_CAMERAS_HINT)).toBeTruthy()
  })

  it('names a device the caps read found, by a TARGETED listAll', async () => {
    mountCaps([1], capsHub([1], CAMERAS))
    expect(await dom.findByText('Front door')).toBeTruthy()
  })

  it('a FAILED caps read is the CAMERA unavailable notice, never the sensor one', async () => {
    mountCaps([1], { 'deviceManager.listDeviceIdsByCaps': () => { throw new Error('down') } })
    expect(await dom.findByText(/did not return its cameras/)).toBeTruthy()
    expect(dom.queryByText(/did not return its sensors/)).toBeNull()
  })

  it('emptying it warns of widening to every CAMERA, not every sensor', async () => {
    const seen = mountCaps([1], capsHub([1], CAMERAS))
    const chip = await dom.findByTestId('picker-chip-1')
    await act(async () => {
      fireEvent.click(chip)
    })
    expect(seen).toHaveBeenLastCalledWith([])
    expect(await dom.findByText('No camera selected: the rule will apply to ALL cameras.')).toBeTruthy()
    expect(dom.queryByText(/apply to ALL sensors/)).toBeNull()
  })

  it('control: a sensor-subject caps source keeps the SENSOR unavailable notice on a failed read', async () => {
    const SENSOR_CAPS_SOURCE: DevicePickerSource = {
      kind: 'caps',
      capNames: ['contact'],
      subject: 'sensor',
    }
    mountScreen(
      React.createElement(DevicePicker, {
        source: SENSOR_CAPS_SOURCE,
        value: [1],
        emptyMeansAll: true,
        onChange: () => undefined,
      }),
      { hub: { 'deviceManager.listDeviceIdsByCaps': () => { throw new Error('down') } } },
    )
    expect(await dom.findByText(/did not return its sensors/)).toBeTruthy()
    expect(dom.queryByText(/did not return its cameras/)).toBeNull()
  })
})

/**
 * `DeviceScopeField`'s "All" mode line (`everyLabel`) has the same wording
 * trap as `DevicePicker` itself: it used to pick the sentence from
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

/**
 * The filter bar on the device picker's sheet (D697): Type / Zone / Location
 * dropdowns and "Reset filters", over the real zone read. Group by is set to
 * None so the list is flat and a row count is a filter result.
 */
describe('DevicePicker — filters (D697)', () => {
  const ZONES = [
    { zoneKey: 'night zone', label: 'Night zone', icon: null, locationKeys: ['camera carol'] },
    { zoneKey: 'zona giorno', label: 'Zona giorno', icon: null, locationKeys: ['kitchen'] },
  ]
  const MIXED: readonly PickerDevice[] = [
    { id: 1, name: 'Bedroom cam', type: 'camera', location: 'Camera Carol' },
    { id: 2, name: 'Kitchen cam', type: 'camera', location: 'Kitchen' },
    { id: 3, name: 'Door sensor', type: 'sensor', location: 'Kitchen' },
    { id: 4, name: 'Motion sensor', type: 'sensor', location: 'Camera Carol' },
  ]
  const CAMERAS_ONLY: readonly PickerDevice[] = MIXED.filter((device) => device.type === 'camera')

  function FilterHarness({ initial }: { readonly initial: readonly number[] }) {
    const [value, setValue] = useState<readonly number[]>(initial)
    return React.createElement(DevicePicker, {
      source: { kind: 'caps', capNames: ['contact'] },
      value,
      onChange: (next: number[]) => setValue(next),
    })
  }

  async function openFilterSheet(
    devices: readonly PickerDevice[],
    hub: Record<string, unknown>,
    initial: readonly number[] = [],
  ): Promise<void> {
    await AsyncStorage.removeItem(DEVICE_PICKER_GROUP_KEY)
    useDevicePickerGroupStore.setState({ groupBy: 'none', hydrated: true })
    mountScreen(React.createElement(FilterHarness, { initial }), { hub: { ...capsSourceHub(devices), ...hub } })
    await act(async () => {
      fireEvent.click(dom.getByTestId('device-picker-add'))
    })
    await listAnswered()
  }

  function rowIds(): readonly string[] {
    return dom
      .queryAllByTestId(/^device-picker-row-/)
      .map((row) => row.getAttribute('data-testid') ?? '')
      .sort()
  }

  async function openChip(facet: 'type' | 'zone' | 'location'): Promise<void> {
    await act(async () => {
      fireEvent.click(within(dom.getByTestId(`picker-filter-${facet}`)).getByRole('button'))
    })
    // `measureInWindow` answers on the next tick.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 20))
    })
  }

  async function tick(facet: 'type' | 'zone' | 'location', key: string): Promise<void> {
    await act(async () => {
      fireEvent.click(await dom.findByTestId(`picker-filter-${facet}-option-${key}`))
    })
  }

  afterEach(() => {
    cleanup()
  })

  it('ticking a Type narrows the list to that type', async () => {
    await openFilterSheet(MIXED, { 'deviceManager.listSiteZones': ZONES })
    expect(rowIds()).toHaveLength(4)
    await openChip('type')
    await tick('type', 'sensor')
    expect(rowIds()).toEqual(['device-picker-row-3', 'device-picker-row-4'])
  })

  it('ticking a Location narrows the list to that room', async () => {
    await openFilterSheet(MIXED, { 'deviceManager.listSiteZones': ZONES })
    await openChip('location')
    await tick('location', 'kitchen')
    expect(rowIds()).toEqual(['device-picker-row-2', 'device-picker-row-3'])
  })

  it('a selected device the filters hide is counted, not dropped', async () => {
    await openFilterSheet(MIXED, { 'deviceManager.listSiteZones': ZONES }, [1])
    expect(dom.queryByTestId('picker-hidden-selected')).toBeNull()
    await openChip('type')
    await tick('type', 'sensor')
    expect(dom.getByTestId('picker-hidden-selected').textContent).toBe('1 selected hidden by filters')
  })

  it('Reset clears the search and every facet and leaves Group by alone', async () => {
    await openFilterSheet(MIXED, { 'deviceManager.listSiteZones': ZONES })
    expect(dom.queryByTestId('picker-reset-filters')).toBeNull()
    await openChip('type')
    await tick('type', 'sensor')
    expect(rowIds()).toHaveLength(2)
    await act(async () => {
      fireEvent.click(within(dom.getByTestId('picker-reset-filters')).getByRole('button'))
    })
    expect(rowIds()).toHaveLength(4)
    expect(dom.queryByTestId('picker-reset-filters')).toBeNull()
    expect(useDevicePickerGroupStore.getState().groupBy).toBe('none')
  })

  it('a pending zone read draws the Zone chip disabled, saying why (D315)', async () => {
    await openFilterSheet(MIXED, {
      'deviceManager.listSiteZones': () => new Promise<never>(() => undefined),
    })
    const chip = within(dom.getByTestId('picker-filter-zone')).getByRole('button')
    expect(chip.getAttribute('aria-disabled')).toBe('true')
    expect(dom.getByText(/Loading zones…/)).toBeTruthy()
  })

  it('a list with one type draws no Type chip', async () => {
    await openFilterSheet(CAMERAS_ONLY, { 'deviceManager.listSiteZones': ZONES })
    expect(dom.queryByTestId('picker-filter-type')).toBeNull()
    expect(dom.getByTestId('picker-filter-location')).toBeTruthy()
  })

  it('reads the zones whenever the sheet is open, whatever the Group by mode', async () => {
    await openFilterSheet(MIXED, { 'deviceManager.listSiteZones': ZONES })
    await act(async () => {
      await Promise.resolve()
    })
    expect(
      hubCalls().filter((call) => call.path === 'deviceManager.listSiteZones').length,
    ).toBeGreaterThan(0)
  })
})
