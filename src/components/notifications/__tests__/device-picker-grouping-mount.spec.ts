/**
 * @vitest-environment jsdom
 *
 * "Group by" on the device picker's sheet — Zone (default) / Location / None —
 * mounted over the real zone read (`deviceManager.listSiteZones`) and the real
 * persisted choice.
 *
 * What only a mount can say:
 *  - the control is on the DEVICE picker's sheet and not on the node picker's;
 *  - the zones are read only once the sheet is open — in every mode, since the
 *    Zone filter needs them (D697);
 *  - switching modes regroups the list, and the choice survives a restart;
 *  - a zone read that FAILED groups by location and says so — never "No zone"
 *    from a read that did not answer (D315).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
import React, { useState } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { mountScreen, TEST_SERVER_ID } from '../../../testing/mount.js'
import { scopedStorageKey } from '../../../store/server-scope.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { capsSourceHub } from '../../../testing/picker-caps-hub.js'
import { DevicePicker } from '../DevicePicker.js'
import { NodePicker } from '../ScopePickers.js'
import type { PickerDevice } from '../device-picker-model.js'
import {
  DEVICE_PICKER_GROUP_KEY,
  useDevicePickerGroupStore,
} from '../../../store/device-picker-group-store.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const HOUSE: readonly PickerDevice[] = [
  { id: 1, name: 'Bedroom cam', type: 'camera', location: 'Camera Carol' },
  { id: 2, name: 'Kitchen cam', type: 'camera', location: 'Kitchen' },
  { id: 4, name: 'Cantina cam', type: 'camera', location: 'Cantina' },
  { id: 5, name: 'Garden cam', type: 'camera', location: null },
]

const ZONES = [
  { zoneKey: 'night zone', label: 'Night zone', icon: null, locationKeys: ['camera carol'] },
  { zoneKey: 'zona giorno', label: 'Zona giorno', icon: null, locationKeys: ['kitchen'] },
]

const ZONES_HUB = { ...capsSourceHub(HOUSE), 'deviceManager.listSiteZones': ZONES }

function Harness(): React.ReactElement {
  const [value, setValue] = useState<readonly number[]>([])
  return React.createElement(DevicePicker, {
    source: { kind: 'caps', capNames: ['contact'] },
    value,
    onChange: (next: number[]) => setValue(next),
  })
}

function zoneReads(): number {
  return hubCalls().filter((call) => call.path === 'deviceManager.listSiteZones').length
}

function headers(): readonly string[] {
  return dom.queryAllByTestId(/^device-picker-group-/).map((header) => header.textContent ?? '')
}

async function openSheet(): Promise<void> {
  await act(async () => {
    fireEvent.click(dom.getByTestId('device-picker-add'))
  })
}

/** The caps source answers over the wire: wait for its headers or rows. */
async function listAnswered(): Promise<void> {
  await vi.waitFor(() =>
    expect(dom.queryAllByTestId(/^device-picker-(group|row)-/).length).toBeGreaterThan(0),
  )
}

async function mountAndOpen(hub: Record<string, unknown>): Promise<void> {
  mountScreen(React.createElement(Harness), { hub: { ...capsSourceHub(HOUSE), ...hub } })
  await openSheet()
  await listAnswered()
}

async function pick(label: string): Promise<void> {
  await act(async () => {
    fireEvent.click(dom.getByText(label))
  })
}

/** The group-by is an ACCOUNT setting: one cached copy per hub. */
const GROUP_KEY = scopedStorageKey(DEVICE_PICKER_GROUP_KEY, TEST_SERVER_ID)

beforeEach(async () => {
  await AsyncStorage.removeItem(GROUP_KEY)
  useDevicePickerGroupStore.setState({ groupBy: 'zone', hydrated: false, serverId: null })
})

afterEach(() => {
  cleanup()
})

describe('DevicePicker — Group by', () => {
  it('reads the zones only once the sheet is open, and groups by ZONE by default', async () => {
    mountScreen(React.createElement(Harness), { hub: ZONES_HUB })
    expect(zoneReads()).toBe(0)
    await openSheet()
    await listAnswered()
    expect(dom.getByText('Group by')).toBeTruthy()
    await dom.findByText(/Zona giorno/)
    expect(zoneReads()).toBe(1)
    const shown = headers()
    expect(shown).toHaveLength(4)
    expect(shown[0]).toContain('Night zone')
    expect(shown[1]).toContain('Zona giorno')
    expect(shown[2]).toContain('No zone')
    expect(shown[3]).toContain('No location')
  })

  it('Location regroups by room; None is one list with no headers', async () => {
    await mountAndOpen(ZONES_HUB)
    await dom.findByText(/Zona giorno/)
    await pick('Location')
    const rooms = headers()
    expect(rooms).toHaveLength(4)
    expect(rooms[0]).toContain('Camera Carol')
    expect(rooms[3]).toContain('No location')
    expect(dom.queryByText(/Zona giorno/)).toBeNull()
    await pick('None')
    expect(headers()).toHaveLength(0)
    expect(dom.queryAllByTestId(/^device-picker-row-/)).toHaveLength(4)
  })

  it('the row\'s second line carries the device type, which left the group key', async () => {
    await mountAndOpen(ZONES_HUB)
    await dom.findByText(/Zona giorno/)
    expect(dom.getByText('Camera Carol · camera')).toBeTruthy()
  })

  it('the choice persists: a restart opens the sheet in the mode last picked', async () => {
    await mountAndOpen(ZONES_HUB)
    await pick('Location')
    expect(await AsyncStorage.getItem(GROUP_KEY)).toBe('location')
    cleanup()
    useDevicePickerGroupStore.setState({ groupBy: 'zone', hydrated: false, serverId: null })
    await mountAndOpen(ZONES_HUB)
    await act(async () => {
      await Promise.resolve()
    })
    expect(headers()[0]).toContain('Camera Carol')
    expect(dom.queryByText(/No zone/)).toBeNull()
  })

  it.each(['location', 'none'] as const)(
    'opened in %s mode, the sheet still reads the zones — the Zone filter needs them (D697)',
    async (mode) => {
      useDevicePickerGroupStore.setState({ groupBy: mode, hydrated: true })
      await mountAndOpen(ZONES_HUB)
      await act(async () => {
        await Promise.resolve()
      })
      expect(dom.queryAllByTestId(/^device-picker-row-/)).toHaveLength(4)
      expect(zoneReads()).toBe(1)
    },
  )

  it('a FAILED zone read groups by location and says so — never "No zone"', async () => {
    await mountAndOpen({})
    expect(await dom.findByText('Zones unavailable — grouped by location')).toBeTruthy()
    expect(dom.queryByText(/No zone/)).toBeNull()
    expect(headers()[0]).toContain('Camera Carol')
  })

  it('a PENDING zone read groups by location and says it is loading', async () => {
    await mountAndOpen({
      'deviceManager.listSiteZones': () => new Promise<never>(() => undefined),
    })
    expect(dom.getByText('Loading zones — grouped by location for now')).toBeTruthy()
    expect(dom.queryByText(/No zone/)).toBeNull()
  })
})

describe('NodePicker — no Group by', () => {
  it('the node sheet has no "Group by" control and reads no zones', async () => {
    mountScreen(React.createElement(NodePicker, { value: [], onChange: () => undefined }), {
      hub: {
        'nodes.directory': {
          nodes: [{ id: 'hub', name: 'Hub', isHub: true, isOnline: true }],
          complete: true,
        },
        ...ZONES_HUB,
      },
    })
    await openSheet()
    await dom.findByTestId('device-picker-row-hub')
    expect(dom.queryByText('Group by')).toBeNull()
    expect(zoneReads()).toBe(0)
  })
})
