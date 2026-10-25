/**
 * @vitest-environment jsdom
 *
 * The rule summary SCREEN, on a hub older than D647: a new summary rule the hub
 * stored as instant makes the screen REPLACE itself with that rule's edit
 * route — never stay a "new" screen whose next Save would create a second rule,
 * and never ask "discard unsaved changes?" on the way (the draft moved with it).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../../testing/mount.js'
import { resetRuleDrafts } from '../../../../testing/rule-draft-harness.js'
import { routerCalls } from '../../../../testing/native-stubs/expo-router.js'
import { useNcRuleDraftStore } from '../../../../store/nc-rule-draft-store.js'
import { defaultSummaryDelivery } from '../../../../components/notifications/system-event-delivery.js'
import { ruleHref } from '../../../../navigation/rule-routes.js'
import { RuleSummaryScreen } from '../RuleSummaryScreen.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)
vi.mock('expo-router/react-navigation', () => ({ usePreventRemove: (): void => undefined }))

function field(input: unknown, key: string): unknown {
  return input !== null && typeof input === 'object' ? Reflect.get(input, key) : undefined
}

const creates: unknown[] = []

/** A hub older than D647: it stores the rule and drops `systemEventDelivery`. */
const OLD_HUB = {
  'auth.me': () => ({ id: 'u1', username: 'operator', isAdmin: true }),
  'addons.custom': (input?: unknown): unknown => {
    const action = field(input, 'action')
    if (action === 'nc.listRules') return { rules: [] }
    if (action === 'nc.listMyTargets') {
      return { targets: [{ id: 'tgt-a', name: 'Phone', kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} }] }
    }
    if (action === 'nc.getConditionCatalog') return { catalog: [] }
    if (action === 'nc.getRuleAi') return { sections: [] }
    if (action === 'nc.createRule') {
      const rule = field(field(input, 'input'), 'rule')
      creates.push(rule)
      const kept = Object.fromEntries(
        Object.entries(rule !== null && typeof rule === 'object' ? rule : {}).filter(([k]) => k !== 'systemEventDelivery'),
      )
      return {
        rule: { ...kept, id: 'created-1', createdBy: 'u1', createdAt: 1, updatedAt: 2, disabledTargetIds: [] },
      }
    }
    throw new Error(`NOT_FOUND: ${String(action)}`)
  },
}

afterEach(() => {
  cleanup()
  resetRuleDrafts()
  creates.length = 0
})

describe('RuleSummaryScreen — a create the hub kept without its summary', () => {
  it('replaces the "new" route with the stored rule\'s edit route', async () => {
    mountScreen(React.createElement(RuleSummaryScreen, { id: 'new', kind: 'device-events' }), { hub: OLD_HUB })
    const key = 'new:device-events'
    await vi.waitFor(() => expect(useNcRuleDraftStore.getState().drafts[key]).toBeDefined())
    await act(async () => {
      useNcRuleDraftStore.getState().patch(key, {
        name: 'Morning state',
        targetIds: ['tgt-a'],
        conditions: { systemEvent: { kinds: ['device-battery-low'] } },
        systemEventDelivery: defaultSummaryDelivery(),
      })
    })
    const create = await dom.findByText('Create rule')
    await vi.waitFor(() => expect(create.closest('[aria-disabled="true"]')).toBeNull())
    await act(async () => {
      fireEvent.click(create)
    })
    await vi.waitFor(() => expect(creates).toHaveLength(1))
    await vi.waitFor(() => expect(routerCalls()).toContainEqual({ kind: 'replace', target: ruleHref('created-1') }))
    expect(routerCalls().filter((call) => call.kind === 'back')).toEqual([])
    expect(useNcRuleDraftStore.getState().drafts['created-1']?.adopted?.id).toBe('created-1')
  })
})
