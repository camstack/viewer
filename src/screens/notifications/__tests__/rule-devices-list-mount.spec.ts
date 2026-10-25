/**
 * @vitest-environment jsdom
 *
 * The overview's "active devices" list (operator, 2026-09-26; ALWAYS open
 * since 2026-10-01 — "no show more, always show all devices"). What only a
 * mount can say:
 *  - it is open with no toggle at all;
 *  - each mode lists what it means — Only: those devices; All except:
 *    "All devices except N" and the excluded ones; All: "All devices";
 *  - a name comes from a TARGETED device read, and only an ANSWERED read may
 *    call an id removed (D315): a failed one lists it by number.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen as dom } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { ruleScopeDraftOf, type RuleScopeDraft } from '../../../components/notifications/rule-scope-model.js'
import { RuleDevicesList } from '../rule-editor/RuleDevicesList.js'
import { RuleSummaryScreen } from '../rule-editor/RuleSummaryScreen.js'
import { resetRuleDrafts } from '../../../testing/rule-draft-harness.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

vi.mock('expo-router/react-navigation', () => ({ usePreventRemove: (): void => undefined }))

const FLEET = [
  { id: 3223, name: 'Allagamento cantina', type: 'sensor' },
  { id: 3229, name: 'Allagamento bathroom', type: 'sensor' },
  { id: 7, name: 'Garden', type: 'camera' },
]

function askedIds(input: unknown): readonly number[] {
  if (input === null || typeof input !== 'object' || !('deviceIds' in input)) return []
  const ids: unknown = input.deviceIds
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : []
}

const HUB = {
  'deviceManager.listAll': (input?: unknown) => {
    const ids = askedIds(input)
    return FLEET.filter((device) => ids.includes(device.id))
  },
}

function mount(scope: RuleScopeDraft<number>, hub: Record<string, unknown> = HUB): void {
  mountScreen(React.createElement(RuleDevicesList, { scope }), { hub })
}

function deviceReads(): number {
  return hubCalls().filter((call) => call.path === 'deviceManager.listAll').length
}

afterEach(() => {
  cleanup()
  resetRuleDrafts()
})

describe('RuleDevicesList', () => {
  it('is open with no toggle: the devices are listed straight away', async () => {
    mount(ruleScopeDraftOf([3223, 3229], undefined))
    expect(await dom.findByText('Allagamento cantina')).toBeTruthy()
    expect(dom.queryByTestId('rule-devices-toggle')).toBeNull()
  })

  it('Only these: lists those devices by name, and a deleted one as removed', async () => {
    mount(ruleScopeDraftOf([3223, 3229, 42], undefined))
    expect(dom.getByText('Only these devices (3)')).toBeTruthy()
    expect(await dom.findByText('Allagamento cantina')).toBeTruthy()
    expect(dom.getByText('Allagamento bathroom')).toBeTruthy()
    expect(dom.getByText('Device #42 — removed')).toBeTruthy()
  })

  it('All except these: "All devices except N" and the excluded devices', async () => {
    mount(ruleScopeDraftOf<number>(undefined, [7]))
    expect(dom.getByText('All devices except 1')).toBeTruthy()
    expect(await dom.findByText('Garden')).toBeTruthy()
  })

  it('All: "All devices", and nothing is read', async () => {
    mount(ruleScopeDraftOf<number>(undefined, undefined))
    expect(dom.getByText('All devices')).toBeTruthy()
    expect(deviceReads()).toBe(0)
  })

  it('a FAILED read never calls an id removed — it lists it by number (D315)', async () => {
    mount(ruleScopeDraftOf([3223], undefined), {})
    expect(await dom.findByText('Device #3223')).toBeTruthy()
    expect(dom.queryByText('Device #3223 — removed')).toBeNull()
  })
})

describe('the rule overview carries the list', () => {
  const RULE = {
    id: 'rule-1',
    name: 'Allagamento',
    enabled: true,
    delivery: 'device-event',
    conditions: { devices: [3223, 3229], sensorKinds: ['flood'] },
    targets: [{ targetId: 't1' }],
    media: { attach: 'best' },
    priority: 3,
    createdBy: 'me',
    createdAt: 10,
    updatedAt: 20,
    disabledTargetIds: [],
    readOnly: false,
  }

  function actionOf(input: unknown): unknown {
    return input !== null && typeof input === 'object' && 'action' in input ? input.action : undefined
  }

  it('under the Devices row, open, listing the rule\'s devices', async () => {
    const hub = {
      ...HUB,
      'auth.me': { id: 'u1', username: 'admin', isAdmin: true },
      'addons.custom': (input?: unknown): unknown => {
        const action = actionOf(input)
        if (action === 'nc.listRules') return { rules: [RULE] }
        if (action === 'nc.listMyTargets') return { targets: [] }
        if (action === 'nc.getConditionCatalog') return { catalog: [] }
        throw new Error(`NOT_FOUND: ${String(action)}`)
      },
    }
    mountScreen(React.createElement(RuleSummaryScreen, { id: RULE.id }), { hub })
    expect(await dom.findByTestId('rule-devices-list')).toBeTruthy()
    expect(await dom.findByText('Allagamento cantina')).toBeTruthy()
  })
})
