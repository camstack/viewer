/**
 * @vitest-environment jsdom
 *
 * The system-event field, one FAMILY at a time (D637), mounted through
 * `ConditionForm` over the hub stub.
 *
 * What only a mount can say:
 *  - the family's kinds are drawn under their GROUP headings, and another
 *    family's groups are not drawn at all;
 *  - node and package filters are the NodePicker / PackagePicker — the
 *    free-text boxes are gone;
 *  - device-events names where its thresholds live; alarm links to the alarm
 *    settings, and names the pictures only when `alarm-triggered` is chosen;
 *  - a `mixed` rule (no family, read-only) is a plain line of its kinds, with
 *    nothing to tick.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom, within } from '@testing-library/react'
import React, { useState } from 'react'
import type { NcSystemEventFamily } from '@camstack/types'

import { mountScreen } from '../../../testing/mount.js'
import { routerCalls } from '../../../testing/native-stubs/expo-router.js'
import { ConditionForm } from '../ConditionForm.js'
import type { NcConditionDescriptor, NcConditions } from '../../../data/notification-center.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const SYSTEM: NcConditionDescriptor = {
  id: 'systemEvent',
  group: 'system',
  label: 'System event',
  valueType: 'systemEvent',
  operator: 'in',
  appliesTo: ['system-event'],
  phase: 'P1',
}

const THRESHOLDS_HINT =
  'The battery threshold and reminders are cluster settings (admin UI → post-analysis settings). A consumable’s threshold is this rule’s own.'

const HUB = {
  'deviceManager.listAll': [],
  'nodes.directory': { nodes: [{ id: 'hub', name: 'Hub', isHub: true, isOnline: true }], complete: true },
  'addons.listPackages': [],
}

function mountSystem(family: NcSystemEventFamily | undefined, conditions: NcConditions): void {
  mountScreen(
    React.createElement(ConditionForm, {
      catalog: [SYSTEM],
      delivery: 'system-event',
      kind: family ?? 'mixed',
      systemFamily: family,
      conditions,
      savedConditions: conditions,
      schedule: undefined,
      taxonomy: undefined,
      onConditionsChange: () => undefined,
      onScheduleChange: () => undefined,
    }),
    { hub: HUB },
  )
}

afterEach(() => {
  cleanup()
})

describe('SystemEventField — one family at a time (D637)', () => {
  it('draws the family’s kinds under their group headings, and no other family’s groups', async () => {
    mountSystem('device-events', { systemEvent: { kinds: ['device-offline'] } })
    expect(await dom.findByText('Device state')).toBeTruthy()
    expect(dom.getByText('Battery')).toBeTruthy()
    expect(dom.getByText('Consumables')).toBeTruthy()
    expect(dom.queryByText('Nodes')).toBeNull()
    expect(dom.queryByText('Alarm')).toBeNull()
  })

  it('a system rule filters nodes and packages with the pickers — never a free-text box', async () => {
    mountSystem('system', { systemEvent: { kinds: ['node-offline', 'server-update-available'], nodeIds: ['hub'] } })
    const nodes = await dom.findByTestId('system-event-nodes')
    // The stored node is NAMED from the cluster's directory — a picker, not a string.
    expect(await within(nodes).findByText('Hub')).toBeTruthy()
    expect(dom.getByTestId('system-event-packages')).toBeTruthy()
    expect(dom.queryByPlaceholderText('Add node ID…')).toBeNull()
    expect(dom.queryByPlaceholderText('Add package name…')).toBeNull()
    expect(dom.queryByTestId('system-event-include')).toBeNull()
  })

  it('device-events says where its thresholds live; the other families do not', async () => {
    mountSystem('device-events', { systemEvent: { kinds: ['device-battery-low'] } })
    expect(await dom.findByText(THRESHOLDS_HINT)).toBeTruthy()
    cleanup()
    mountSystem('system', { systemEvent: { kinds: ['node-offline'] } })
    await dom.findByTestId('system-event-nodes')
    expect(dom.queryByText(THRESHOLDS_HINT)).toBeNull()
  })

  it('alarm links to the alarm settings', async () => {
    mountSystem('alarm', { systemEvent: { kinds: ['alarm-armed'] } })
    const link = await dom.findByTestId('system-event-alarm-settings')
    await act(async () => {
      fireEvent.click(link)
    })
    expect(routerCalls()).toContainEqual({ kind: 'push', target: '/settings/alarm' })
  })

  it('alarm names the pictures and offers the camera filter only with alarm-triggered', async () => {
    mountSystem('alarm', { systemEvent: { kinds: ['alarm-armed'] } })
    await dom.findByTestId('system-event-alarm-settings')
    expect(dom.queryByTestId('system-event-alarm-triggered-media')).toBeNull()
    expect(dom.queryByTestId('system-event-include')).toBeNull()
    cleanup()
    mountSystem('alarm', { systemEvent: { kinds: ['alarm-triggered'] } })
    expect(await dom.findByTestId('system-event-alarm-triggered-media')).toBeTruthy()
    expect(await dom.findByTestId('system-event-include')).toBeTruthy()
    expect(dom.queryByTestId('system-event-exclude')).toBeNull()
  })

  it('unticking and re-ticking a chip keeps the authoring order — the admin saves the same `kinds`', async () => {
    const seen = vi.fn<(next: NcConditions) => void>()
    function Stateful() {
      const [conditions, setConditions] = useState<NcConditions>({
        systemEvent: { kinds: ['device-offline', 'device-online', 'device-battery-low', 'device-battery-normal'] },
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
        onConditionsChange: (next: NcConditions) => {
          seen(next)
          setConditions(next)
        },
        onScheduleChange: () => undefined,
      })
    }
    mountScreen(React.createElement(Stateful), { hub: HUB })
    const chip = await dom.findByText('Device connectivity (offline / back online)')
    await act(async () => {
      fireEvent.click(chip)
    })
    // Unticking a class clears BOTH its edges (D906).
    expect(seen).toHaveBeenLastCalledWith({
      systemEvent: { kinds: ['device-battery-low', 'device-battery-normal'] },
    })
    await act(async () => {
      fireEvent.click(dom.getByText('Device connectivity (offline / back online)'))
    })
    expect(seen).toHaveBeenLastCalledWith({
      systemEvent: { kinds: ['device-offline', 'device-online', 'device-battery-low', 'device-battery-normal'] },
    })
  })

  /** A device-events rule whose every change is recorded; `summary` is the delivery mode. */
  function mountRecorded(summary: boolean, kinds: NcConditions['systemEvent']): ReturnType<typeof vi.fn<(next: NcConditions) => void>> {
    const seen = vi.fn<(next: NcConditions) => void>()
    mountScreen(
      React.createElement(ConditionForm, {
        catalog: [SYSTEM],
        delivery: 'system-event',
        kind: 'device-events',
        systemFamily: 'device-events',
        conditions: { systemEvent: kinds },
        savedConditions: undefined,
        schedule: undefined,
        taxonomy: undefined,
        onConditionsChange: seen,
        onScheduleChange: () => undefined,
        summary,
      }),
      { hub: HUB },
    )
    return seen
  }

  it('on an INSTANT rule a paired class is one chip and saves BOTH edges (D906)', async () => {
    const seen = mountRecorded(false, { kinds: ['device-battery-low'] })
    // The battery class already shows ticked from its one stored edge.
    const battery = await dom.findByText('Battery (low / back to normal)')
    expect(dom.queryByText('Battery low')).toBeNull()
    expect(dom.queryByText('Battery back to normal')).toBeNull()
    expect(dom.getByTestId('system-event-class-hint').textContent).toBe(
      'A paired event tells you both when it goes wrong and when it comes back.',
    )
    expect(battery).toBeTruthy()
    await act(async () => {
      fireEvent.click(dom.getByText('Consumables (low / replaced)'))
    })
    expect(seen).toHaveBeenLastCalledWith({
      systemEvent: {
        kinds: ['device-battery-low', 'device-consumable-low', 'device-consumable-normal'],
      },
    })
  })

  it('on a SCHEDULED summary a class saves only the bad edges, reads as a snapshot, and says so (D906)', async () => {
    const seen = mountRecorded(true, { kinds: ['device-battery-low'] })
    expect(await dom.findByText('Batteries low now')).toBeTruthy()
    expect(dom.queryByText('Battery (low / back to normal)')).toBeNull()
    expect(dom.getByTestId('system-event-class-hint').textContent).toBe(
      'At the scheduled time you get the list of what is in the bad state, not each change.',
    )
    // A class the summary has no state source for says it reports nothing.
    expect(dom.getByText('Recordings stalled now — no state snapshot, reports nothing')).toBeTruthy()
    await act(async () => {
      fireEvent.click(dom.getByText('Consumables low now'))
    })
    expect(seen).toHaveBeenLastCalledWith({
      systemEvent: { kinds: ['device-battery-low', 'device-consumable-low'] },
    })
  })

  it('the consumable threshold box appears only with a consumable kind (D642)', async () => {
    mountSystem('device-events', { systemEvent: { kinds: ['device-offline'] } })
    expect(dom.queryByTestId('system-event-consumable-threshold')).toBeNull()
    cleanup()
    mountSystem('device-events', { systemEvent: { kinds: ['device-consumable-low'], consumableLowPercent: 25 } })
    const box = await dom.findByTestId('system-event-consumable-threshold')
    expect(box.getAttribute('value')).toBe('25')
    expect(box.getAttribute('placeholder')).toBe('15')
  })

  it('writes a threshold in range, clears on empty, and never writes 96 (D642)', async () => {
    const seen = vi.fn<(next: NcConditions) => void>()
    function Stateful() {
      const [conditions, setConditions] = useState<NcConditions>({
        systemEvent: { kinds: ['device-consumable-low'] },
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
        onConditionsChange: (next: NcConditions) => {
          seen(next)
          setConditions(next)
        },
        onScheduleChange: () => undefined,
      })
    }
    mountScreen(React.createElement(Stateful), { hub: HUB })
    const box = await dom.findByTestId('system-event-consumable-threshold')
    await act(async () => {
      fireEvent.change(box, { target: { value: '30' } })
    })
    expect(seen).toHaveBeenLastCalledWith({ systemEvent: { kinds: ['device-consumable-low'], consumableLowPercent: 30 } })
    const calls = seen.mock.calls.length
    await act(async () => {
      fireEvent.change(box, { target: { value: '96' } })
    })
    // Not written — and SAID, not silently ignored.
    expect(seen.mock.calls.length).toBe(calls)
    expect(dom.getByTestId('system-event-consumable-threshold-invalid')).toBeTruthy()
    await act(async () => {
      fireEvent.change(box, { target: { value: '' } })
    })
    expect(seen).toHaveBeenLastCalledWith({ systemEvent: { kinds: ['device-consumable-low'] } })
    expect(dom.queryByTestId('system-event-consumable-threshold-invalid')).toBeNull()
  })

  it('an invalid threshold REVERTS to the stored value on blur — the box never shows what is not saved (D642)', async () => {
    const seen = vi.fn<(next: NcConditions) => void>()
    function Stateful() {
      const [conditions, setConditions] = useState<NcConditions>({
        systemEvent: { kinds: ['device-consumable-low'], consumableLowPercent: 30 },
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
        onConditionsChange: (next: NcConditions) => {
          seen(next)
          setConditions(next)
        },
        onScheduleChange: () => undefined,
      })
    }
    mountScreen(React.createElement(Stateful), { hub: HUB })
    const box = await dom.findByTestId('system-event-consumable-threshold')
    await act(async () => {
      fireEvent.change(box, { target: { value: '96' } })
    })
    expect(box.getAttribute('value')).toBe('96')
    expect(dom.getByTestId('system-event-consumable-threshold-invalid')).toBeTruthy()
    await act(async () => {
      fireEvent.blur(box)
    })
    expect(box.getAttribute('value')).toBe('30')
    expect(dom.queryByTestId('system-event-consumable-threshold-invalid')).toBeNull()
    expect(seen).not.toHaveBeenCalled()
  })

  it('a MIXED rule is a plain line of its kinds — nothing to tick, no filter', async () => {
    mountSystem(undefined, { systemEvent: { kinds: ['device-offline', 'node-offline'], nodeIds: ['hub'] } })
    const line = await dom.findByTestId('system-event-mixed-summary')
    expect(line.textContent).toContain('Device offline')
    expect(line.textContent).toContain('Node offline')
    expect(dom.queryAllByRole('checkbox')).toHaveLength(0)
    expect(dom.queryByTestId('system-event-nodes')).toBeNull()
  })
})
