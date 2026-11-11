/**
 * @vitest-environment jsdom
 *
 * The device → value picker on the phone (issue #496, "Flow · Phone"),
 * mounted over a hub that answers `deviceManager.search`.
 *
 * What only a mount can say:
 *  - a picked device is named by the hub's resolve; "not found" only when the
 *    ANSWERED resolve lists it as missing, never while it is pending (D315);
 *  - every chip is removable, a gone one included (D49);
 *  - emptying an all-meaning field that held devices warns of the widening;
 *  - the sheet's states are four different screens: loading, failed (with
 *    Retry), nothing compatible, search miss (D315);
 *  - suggestions come first; the facets are collapsed until asked;
 *  - a device with several values pushes its value page, and Back returns;
 *  - the system-event pickers ask the hub only once their sheet is open.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom, within } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { deviceSearchAnswer, deviceSearchHub, type FleetDevice } from '../../../testing/device-search-hub.js'
import { ConditionForm } from '../../notifications/ConditionForm.js'
import type { NcConditionDescriptor, NcConditions } from '../../../data/notification-center.js'
import { DeviceValueField, type DeviceValueFieldProps } from '../DeviceValueField.js'
import type { PickedValue } from '../device-value-picker-model.js'
import { SEARCH_DEBOUNCE_MS } from '../use-device-search.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => {
  cleanup()
})

const FLEET: readonly FleetDevice[] = [
  { id: 1, name: 'Front door', type: 'camera', location: 'Hall', caps: ['camera-streams'] },
  { id: 5, name: 'Garden', type: 'camera', location: 'Garden', caps: ['camera-streams'] },
  { id: 6, name: 'Hall cam', type: 'camera', location: 'Hall', caps: ['camera-streams'], online: false },
  {
    id: 20,
    name: 'Climate hall',
    type: 'sensor',
    location: 'Hall',
    caps: ['temperature'],
    values: [
      { cap: 'temperature', path: 'indoor', label: 'Indoor', reading: '21.5 °C' },
      { cap: 'temperature', path: 'outdoor', label: 'Outdoor', reading: '9 °C' },
    ],
  },
  {
    id: 21,
    name: 'Bath thermo',
    type: 'sensor',
    location: 'Bath',
    caps: ['temperature'],
    values: [{ cap: 'temperature', path: 'value', label: 'Temperature', reading: '23 °C' }],
  },
  { id: 30, name: 'Kitchen plug', type: 'switch', location: 'Kitchen', caps: ['switch'] },
]

const CAMERAS = { caps: ['camera-streams'] } as const
const WIDENS = 'No camera selected: the rule will apply to ALL cameras.'

type FieldOverrides = Partial<Omit<DeviceValueFieldProps, 'value' | 'onChange'>>

function mountField(
  value: readonly PickedValue[],
  hub: Record<string, unknown>,
  props: FieldOverrides = {},
): ReturnType<typeof vi.fn<(next: readonly PickedValue[]) => void>> {
  const onChange = vi.fn<(next: readonly PickedValue[]) => void>()
  mountScreen(
    React.createElement(DeviceValueField, {
      kind: 'device',
      requires: CAMERAS,
      value,
      onChange,
      ...props,
    }),
    { hub },
  )
  return onChange
}

async function openSheet(): Promise<void> {
  await act(async () => {
    fireEvent.click(await dom.findByTestId('dvp-add'))
  })
}

async function type(text: string): Promise<void> {
  const search = await dom.findByTestId('dvp-search')
  await act(async () => {
    fireEvent.change(search, { target: { value: text } })
    await new Promise<void>((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50))
  })
}

function searchCalls(): readonly unknown[] {
  return hubCalls()
    .filter((call) => call.path === 'deviceManager.search')
    .map((call) => call.input)
}

describe('DeviceValueField — the picked devices', () => {
  it('names a picked device by the resolve, and calls a missing one "not found" as a removable chip', async () => {
    const onChange = mountField([{ deviceId: 5 }, { deviceId: 42 }], deviceSearchHub(FLEET))
    expect(await dom.findByText('Garden')).toBeTruthy()
    expect(await dom.findByText('Device #42 not found')).toBeTruthy()
    await act(async () => {
      fireEvent.click(dom.getByTestId('dvp-chip-42'))
    })
    expect(onChange).toHaveBeenLastCalledWith([{ deviceId: 5 }])
  })

  it('while the resolve is pending a chip reads "Device #id", never "not found"', async () => {
    mountField([{ deviceId: 42 }], { 'deviceManager.search': () => new Promise(() => undefined) })
    expect(await dom.findByText('Device #42')).toBeTruthy()
    expect(dom.queryByText(/not found/)).toBeNull()
  })

  it('a FAILED resolve says so and never calls a device gone', async () => {
    mountField([{ deviceId: 42 }], {
      'deviceManager.search': () => {
        throw new Error('down')
      },
    })
    expect(await dom.findByText('Could not check the chosen devices.')).toBeTruthy()
    expect(dom.getByText('Device #42')).toBeTruthy()
    expect(dom.queryByText(/not found/)).toBeNull()
  })

  it('an offline device says so on its chip', async () => {
    mountField([{ deviceId: 6 }], deviceSearchHub(FLEET))
    expect(await dom.findByText('Hall cam (offline)')).toBeTruthy()
  })

  it('more than five chips fold into "+N", which unfolds them', async () => {
    const ids = [1, 5, 6, 20, 21, 30, 77]
    mountField(
      ids.map((deviceId) => ({ deviceId })),
      deviceSearchHub(FLEET),
      { requires: undefined },
    )
    await dom.findByText('Garden')
    expect(dom.queryAllByTestId(/^dvp-chip-/)).toHaveLength(5)
    await act(async () => {
      fireEvent.click(dom.getByText('+2'))
    })
    expect(dom.queryAllByTestId(/^dvp-chip-/)).toHaveLength(7)
  })

  it('emptying an all-meaning field that held devices warns of the widening; a saved empty one does not', async () => {
    mountField([], deviceSearchHub(FLEET), { emptyMeansAll: true, savedHadValues: true })
    expect(await dom.findByText(WIDENS)).toBeTruthy()
    cleanup()
    mountField([], deviceSearchHub(FLEET), { emptyMeansAll: true })
    await dom.findByTestId('dvp-add')
    expect(dom.queryByText(WIDENS)).toBeNull()
  })

  it('asks the hub nothing while closed with nothing picked', async () => {
    mountField([], deviceSearchHub(FLEET))
    await dom.findByTestId('dvp-add')
    expect(searchCalls()).toHaveLength(0)
  })
})

describe('DeviceValueSheet — the four states (D315)', () => {
  it('a pending list is the loading skeleton, never "no device"', async () => {
    mountField([], { 'deviceManager.search': () => new Promise(() => undefined) })
    await openSheet()
    expect(await dom.findByTestId('dvp-loading')).toBeTruthy()
    expect(dom.queryByTestId('dvp-empty')).toBeNull()
  })

  it('a failed list offers Retry, which asks again', async () => {
    let fail = true
    mountField([], {
      'deviceManager.search': (input?: unknown) => {
        if (fail) throw new Error('down')
        return deviceSearchAnswer(FLEET, input)
      },
    })
    await openSheet()
    const failed = await dom.findByTestId('dvp-failed')
    expect(within(failed).getByText('Could not load the devices.')).toBeTruthy()
    fail = false
    await act(async () => {
      fireEvent.click(within(failed).getByText('Retry'))
    })
    expect(await dom.findByTestId('dvp-row-1')).toBeTruthy()
  })

  it('nothing compatible is its own screen, naming the capability', async () => {
    mountField([], deviceSearchHub(FLEET), { requires: { caps: ['doorbell'] } })
    await openSheet()
    expect(await dom.findByTestId('dvp-empty')).toBeTruthy()
    expect(dom.getByText('No device provides Doorbell')).toBeTruthy()
  })

  it('a search that matches nothing is a search miss with a way back', async () => {
    mountField([], deviceSearchHub(FLEET))
    await openSheet()
    await dom.findByTestId('dvp-row-1')
    await type('zzz')
    expect(await dom.findByTestId('dvp-search-miss')).toBeTruthy()
    expect(dom.queryByTestId('dvp-empty')).toBeNull()
    await act(async () => {
      fireEvent.click(dom.getByText('Clear search and filters'))
    })
    expect(await dom.findByTestId('dvp-row-1')).toBeTruthy()
  })
})

describe('DeviceValueSheet — the list', () => {
  it('suggests the context device\'s room first', async () => {
    mountField([], deviceSearchHub(FLEET), { contextDeviceId: 1 })
    await openSheet()
    const suggested = await dom.findByTestId('dvp-section-suggested')
    const order = dom.queryAllByTestId(/^dvp-(section|row)-/).map((el) => el.getAttribute('data-testid'))
    expect(order.indexOf('dvp-section-suggested')).toBe(0)
    expect(order.indexOf('dvp-row-6')).toBe(1)
    expect(suggested.textContent).toBe('SUGGESTED')
  })

  it('the facets are collapsed until a chip is tapped, and a tapped option narrows the ask', async () => {
    mountField([], deviceSearchHub(FLEET), { requires: undefined })
    await openSheet()
    await dom.findByTestId('dvp-row-30')
    expect(dom.queryByTestId(/^dvp-facet-/)).toBeNull()
    await act(async () => {
      fireEvent.click(dom.getByLabelText('Type'))
    })
    const options = await dom.findByTestId('dvp-facet-types')
    await act(async () => {
      fireEvent.click(within(options).getByText(/^Switch/))
    })
    await vi.waitFor(() => expect(dom.queryByTestId('dvp-row-1')).toBeNull())
    expect(dom.getByTestId('dvp-row-30')).toBeTruthy()
  })

  it('a multi pick edits a draft: ✓ toggles, Done saves', async () => {
    const onChange = mountField([{ deviceId: 1 }], deviceSearchHub(FLEET))
    await openSheet()
    await act(async () => {
      fireEvent.click(await dom.findByTestId('dvp-row-5'))
    })
    expect(onChange).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(dom.getByLabelText('Done (2)'))
    })
    expect(onChange).toHaveBeenLastCalledWith([{ deviceId: 1 }, { deviceId: 5 }])
  })
})

describe('DeviceValueSheet — a device with several values (Flow · Phone)', () => {
  const TEMPERATURE = { caps: ['temperature'] } as const

  it('drills into the value page, and Back returns to the list as it was', async () => {
    mountField([], deviceSearchHub(FLEET), { kind: 'value', requires: TEMPERATURE, multiple: false })
    await openSheet()
    await type('hall')
    await act(async () => {
      fireEvent.click(await dom.findByTestId('dvp-row-20'))
    })
    expect(await dom.findByTestId('dvp-values-page')).toBeTruthy()
    expect(dom.getByText('Climate hall')).toBeTruthy()
    await act(async () => {
      fireEvent.click(dom.getByLabelText('Back'))
    })
    expect(await dom.findByTestId('dvp-row-20')).toBeTruthy()
    expect((dom.getByTestId('dvp-search') as HTMLInputElement).value).toBe('hall')
  })

  it('picking a value closes a single field with that value; a one-value device is picked from its row', async () => {
    const onChange = mountField([], deviceSearchHub(FLEET), {
      kind: 'value',
      requires: TEMPERATURE,
      multiple: false,
    })
    await openSheet()
    await act(async () => {
      fireEvent.click(await dom.findByTestId('dvp-row-20'))
    })
    await act(async () => {
      fireEvent.click(await dom.findByTestId('dvp-value-temperature-outdoor'))
    })
    expect(onChange).toHaveBeenLastCalledWith([{ deviceId: 20, cap: 'temperature', path: 'outdoor' }])
    expect(dom.queryByTestId('dvp-sheet')).toBeNull()
    await openSheet()
    await act(async () => {
      fireEvent.click(await dom.findByTestId('dvp-row-21'))
    })
    expect(onChange).toHaveBeenLastCalledWith([{ deviceId: 21, cap: 'temperature', path: 'value' }])
  })
})

describe('SystemEventField — the device pickers (D637)', () => {
  const SYSTEM: NcConditionDescriptor = {
    id: 'systemEvent',
    group: 'system',
    label: 'System event',
    valueType: 'systemEvent',
    operator: 'in',
    appliesTo: ['system-event'],
    phase: 'P1',
  }

  function mountSystem(conditions: NcConditions): ReturnType<typeof vi.fn<(next: NcConditions) => void>> {
    const onChange = vi.fn<(next: NcConditions) => void>()
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
      { hub: deviceSearchHub(FLEET) },
    )
    return onChange
  }

  it('offer EVERY device, asked of the hub only once the sheet is open', async () => {
    const onChange = mountSystem({ systemEvent: { kinds: ['device-battery-low'] } })
    const exclude = await dom.findByTestId('system-event-exclude')
    expect(searchCalls()).toHaveLength(0)
    await act(async () => {
      fireEvent.click(within(exclude).getByTestId('dvp-add'))
    })
    // No capability asked: a plug and a camera are both devices here.
    expect(await dom.findByTestId('dvp-row-30')).toBeTruthy()
    expect(dom.getByTestId('dvp-row-1')).toBeTruthy()
    await act(async () => {
      fireEvent.click(dom.getByTestId('dvp-row-30'))
    })
    await act(async () => {
      fireEvent.click(dom.getByLabelText('Done (1)'))
    })
    expect(onChange).toHaveBeenLastCalledWith({
      systemEvent: { kinds: ['device-battery-low'], excludeDeviceIds: [30] },
    })
  })

  it('names a stored exclusion by a TARGETED resolve, and calls a deleted one not found', async () => {
    mountSystem({ systemEvent: { kinds: ['device-battery-low'], excludeDeviceIds: [30, 42] } })
    expect(await dom.findByText('Kitchen plug')).toBeTruthy()
    expect(await dom.findByText('Device #42 not found')).toBeTruthy()
    expect(searchCalls().every((input) => typeof input === 'object' && input !== null && 'ids' in input)).toBe(
      true,
    )
  })
})
