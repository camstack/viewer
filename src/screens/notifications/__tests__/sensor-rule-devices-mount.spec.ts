/**
 * @vitest-environment jsdom
 *
 * A SENSOR rule's Devices section offers sensors (operator, 2026-09-26: "for
 * sensor rules we don't show the sensors but the cameras").
 *
 * "Allagamento" is a device-event rule over three flood sensors. The Devices
 * section used to open the CAMERA list for every kind, so the stored sensors
 * were chips the picker could never list, and nothing else could be added. A
 * sensor rule reads the devices bound to its sensor kinds' caps
 * (`deviceManager.listDeviceIdsByCaps`, narrowed by `sensorKinds`).
 *
 * Changed 2026-10-01 (operator ruling): a detection rule now asks the SAME
 * `listDeviceIdsByCaps` method for the `detection-pipeline` cap
 * (`ruleDeviceCompatCapNames`, `@camstack/types`) instead of reading the
 * camera-TYPE list unconditionally — a camera with no detection-pipeline
 * binding is no longer offered for a rule that could never match it. The
 * picker still reads as a CAMERA scope ("Every camera", not "Every sensor")
 * — see `DeviceScopeField`'s `subject` tests in `device-picker-mount.spec.ts`.
 *
 * Changed 2026-10-01 (fix round 1, review): a sensor rule's picker ALSO
 * offers cameras — the engine matches a sensor rule scoped to a camera
 * (`rowCameraIds`, D630 §6) — via `camera-streams` (`extraCapNames`,
 * `rule-device-source.ts`), unioned with the sensor/control one.
 *
 * Changed 2026-11-11 (issue #496): the field is the device → value picker,
 * so both lists are ONE `deviceManager.search` asking for a device bound to
 * ANY of those caps; picked ids are resolved by the same method (`ids`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { resetRuleDrafts } from '../../../testing/rule-draft-harness.js'
import { RuleSectionScreen } from '../rule-editor/RuleSectionScreen.js'
import { SEARCH_DEBOUNCE_MS } from '../../../components/device-value-picker/use-device-search.js'
import { deviceSearchHub, type FleetDevice } from '../../../testing/device-search-hub.js'
import { instanceRows } from '../../../testing/nc-target-rows.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const FLOOD_IDS = [3223, 3229, 3235]
const SENSORS = [
  { id: 3223, name: 'Allagamento cantina', type: 'sensor', isCamera: false, online: true },
  { id: 3229, name: 'Allagamento bathroom', type: 'sensor', isCamera: false, online: true },
  { id: 3235, name: 'Allagamento kitchen', type: 'sensor', isCamera: false, online: true },
  { id: 3300, name: 'Allagamento laundry', type: 'sensor', isCamera: false, online: true },
]
const CAMERA = { id: 1, name: 'Front door', type: 'camera', isCamera: true, online: true }
const FLEET: readonly FleetDevice[] = [
  { ...CAMERA, caps: ['detection-pipeline', 'camera-streams'] },
  ...SENSORS.map((sensor) => ({ ...sensor, caps: ['flood'] })),
]

const DEVICES_DESCRIPTOR = {
  id: 'devices',
  group: 'scope',
  label: 'Devices',
  valueType: 'deviceIdList',
  operator: 'in',
  appliesTo: ['immediate', 'track-end', 'device-event'],
  phase: 'ga',
}

function ruleOf(delivery: string, conditions: Record<string, unknown>) {
  return {
    id: 'rule-1',
    name: 'Allagamento',
    enabled: true,
    delivery,
    conditions,
    targets: [{ targetId: 't1' }],
    media: { attach: 'best' },
    priority: 3,
    createdBy: 'me',
    createdAt: 10,
    updatedAt: 20,
    disabledTargetIds: [],
    readOnly: false,
  }
}

function field(input: unknown, key: string): unknown {
  if (input === null || typeof input !== 'object' || !(key in input)) return undefined
  const record: Record<string, unknown> = { ...input }
  return record[key]
}

function askedIds(input: unknown): readonly number[] | null {
  const ids = field(input, 'deviceIds')
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : null
}

function hub(rule: ReturnType<typeof ruleOf>) {
  return {
    'auth.me': { id: 'u1', username: 'admin', isAdmin: true },
    'deviceManager.listAll': (input?: unknown) => {
      if (field(input, 'isCamera') === true) return [CAMERA]
      const ids = askedIds(input)
      const all = [CAMERA, ...SENSORS]
      return ids === null ? all : all.filter((device) => ids.includes(device.id))
    },
    ...deviceSearchHub(FLEET),
    'integrationInstances.listInstances': (): unknown => instanceRows([]),
    'addons.custom': (input?: unknown): unknown => {
      const action = field(input, 'action')
      if (action === 'nc.listRules') return { rules: [rule] }
      if (action === 'nc.getConditionCatalog') return { catalog: [DEVICES_DESCRIPTOR] }
      if (action === 'nc.getRuleAi') return { sections: [] }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

/** Every cap a `deviceManager.search` asked a device to be bound to. */
function capsAsked(): readonly string[] {
  return hubCalls()
    .filter((call) => call.path === 'deviceManager.search')
    .flatMap((call) => {
      const caps = field(field(call.input, 'requires'), 'caps')
      return Array.isArray(caps) ? caps.filter((c): c is string => typeof c === 'string') : []
    })
}

/** The `requires.mode` of every `deviceManager.search` call. */
function modesAsked(): readonly unknown[] {
  return hubCalls()
    .filter((call) => call.path === 'deviceManager.search')
    .map((call) => field(field(call.input, 'requires'), 'mode'))
}

const SEARCH_LABEL = 'Search name, room, type or id'

afterEach(() => {
  cleanup()
  resetRuleDrafts()
})

describe('the Devices section of a SENSOR rule', () => {
  it('names the stored flood sensors and never calls one removed', async () => {
    const rule = ruleOf('device-event', { devices: FLOOD_IDS, sensorKinds: ['flood'] })
    mountScreen(React.createElement(RuleSectionScreen, { id: rule.id, section: 'devices' }), { hub: hub(rule) })
    expect(await dom.findByText('Allagamento cantina')).toBeTruthy()
    expect(dom.getByText('Allagamento bathroom')).toBeTruthy()
    expect(dom.getByText('Allagamento kitchen')).toBeTruthy()
    expect(dom.queryByText(/removed|not found/)).toBeNull()
    // Asked by the rule's sensor kind — the flood cap.
    expect(capsAsked()).toContain('flood')
  })

  it('offers the sensors — not the cameras — to pick from', async () => {
    const rule = ruleOf('device-event', { devices: FLOOD_IDS, sensorKinds: ['flood'] })
    mountScreen(React.createElement(RuleSectionScreen, { id: rule.id, section: 'devices' }), { hub: hub(rule) })
    await dom.findByText('Allagamento cantina')
    await act(async () => {
      fireEvent.click(dom.getByTestId('dvp-add'))
    })
    const search = await dom.findByLabelText(SEARCH_LABEL)
    await act(async () => {
      fireEvent.change(search, { target: { value: 'allagamento' } })
      await new Promise<void>((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50))
    })
    expect(await dom.findByTestId('dvp-row-3300')).toBeTruthy()
    expect(dom.queryByTestId('dvp-row-1')).toBeNull()
  })

  it('a detection rule now asks the detection-pipeline cap, and still names the camera', async () => {
    const rule = ruleOf('track-end', { devices: [1] })
    mountScreen(React.createElement(RuleSectionScreen, { id: rule.id, section: 'devices' }), { hub: hub(rule) })
    expect(await dom.findByText('Front door')).toBeTruthy()
    expect(capsAsked()).toContain('detection-pipeline')
    // The wording stays a CAMERA scope — not "Every sensor" or "no sensors".
    expect(dom.queryByText(/sensor/i)).toBeNull()
  })

  it('a sensor rule also offers cameras — a camera-scoped sensor rule is legitimate (D630 §6)', async () => {
    const rule = ruleOf('device-event', { devices: FLOOD_IDS, sensorKinds: ['flood'] })
    mountScreen(React.createElement(RuleSectionScreen, { id: rule.id, section: 'devices' }), { hub: hub(rule) })
    await dom.findByText('Allagamento cantina')
    // The picker asks BOTH caps: the narrowed sensor one and camera-streams.
    expect(capsAsked()).toContain('flood')
    expect(capsAsked()).toContain('camera-streams')
    // EITHER cap qualifies a device: a flood sensor has no camera-streams.
    expect(modesAsked().length).toBeGreaterThan(0)
    expect(modesAsked().every((mode) => mode === 'any')).toBe(true)
    await act(async () => {
      fireEvent.click(dom.getByTestId('dvp-add'))
    })
    const search = await dom.findByLabelText(SEARCH_LABEL)
    await act(async () => {
      fireEvent.change(search, { target: { value: 'front door' } })
      await new Promise<void>((resolve) => setTimeout(resolve, SEARCH_DEBOUNCE_MS + 50))
    })
    expect(await dom.findByTestId('dvp-row-1')).toBeTruthy()
  })
})
