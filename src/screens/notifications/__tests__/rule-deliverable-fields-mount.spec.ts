/**
 * @vitest-environment jsdom
 *
 * The Notification sub-screen shows only the message fields its targets can
 * deliver (#483), read from each target kind's declaration over
 * `nc.listTargetKinds` — the same declaration the hub drops fields by at send.
 *
 *  - every target a speaker that declares "title only": the Title field, and
 *    nothing else of the message (no body, no priority, no media);
 *  - a phone beside it: the union, with a line under Body naming the target
 *    that drops it.
 *
 * The speaker kind is NOT named after any service: the editor must decide from
 * `caps`, never from a kind string. Only `addons.custom` and the instance list
 * are faked; the hooks, query client, i18n and theme are real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, type RenderResult } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { NcViewerRuleSchema, type NcViewerRule } from '../../../data/notification-center.js'
import { RuleDraftHarness, resetRuleDrafts, withRuleList } from '../../../testing/rule-draft-harness.js'
import { instanceRows } from '../../../testing/nc-target-rows.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const PHONE = 'Phone (push)'
const SPEAKER = 'Kitchen speaker'

const TARGETS = [
  { id: 'tgt-phone', name: PHONE, kind: 'phone-push', addonId: 'notifiers', enabled: true, config: {} },
  { id: 'tgt-speaker', name: SPEAKER, kind: 'house-voice', addonId: 'notifiers', enabled: true, config: {} },
]

const TARGET_KINDS = [
  {
    kind: 'phone-push',
    label: 'Push',
    icon: 'bell',
    addonId: 'notifiers',
    configSchema: {},
    supportsDiscovery: false,
    caps: {
      attachments: { mediaTypes: ['image'], mode: 'url', max: 1 },
      actions: 2,
      levels: [
        { id: 'low', label: 'Low', ordinal: 1 },
        { id: 'high', label: 'High', ordinal: 5 },
      ],
      format: ['text'],
      clickUrl: true,
      sound: true,
      ttl: false,
      bodyMaxLen: 1024,
    },
  },
  {
    kind: 'house-voice',
    label: 'Voice',
    icon: 'speaker',
    addonId: 'notifiers',
    configSchema: {},
    supportsDiscovery: false,
    caps: {
      text: { title: true, body: false },
      attachments: { mediaTypes: [], mode: 'url', max: 0 },
      actions: 0,
      levels: [{ id: 'normal', label: 'Normal', ordinal: 3 }],
      format: ['text'],
      clickUrl: false,
      sound: false,
      ttl: false,
      bodyMaxLen: 200,
    },
  },
]

const NC_RESPONSES: Readonly<Record<string, unknown>> = {
  'nc.getConditionCatalog': { catalog: [] },
  'nc.listTargetKinds': { kinds: TARGET_KINDS },
  'nc.getRuleAi': { sections: [] },
  'nc.listAiProfiles': { profiles: [] },
}

function actionOf(input: unknown): string {
  if (input === null || typeof input !== 'object' || !('action' in input)) return ''
  const action: unknown = { ...input }['action']
  return typeof action === 'string' ? action : ''
}

const HUB = {
  'auth.me': { id: 'u1', username: 'user', isAdmin: false },
  'integrationInstances.listInstances': (): unknown => instanceRows(TARGETS),
  'addons.custom': (input?: unknown): unknown => {
    const action = actionOf(input)
    if (!Object.prototype.hasOwnProperty.call(NC_RESPONSES, action)) {
      throw new Error(`NOT_FOUND: no nc action "${action}" on this hub`)
    }
    return NC_RESPONSES[action]
  },
}

function makeRule(targetIds: readonly string[]): NcViewerRule {
  return NcViewerRuleSchema.parse({
    id: 'rule-1',
    name: 'Front door',
    enabled: true,
    delivery: 'immediate',
    conditions: { classes: ['person'] },
    targets: targetIds.map((targetId) => ({ targetId })),
    media: { attach: 'best' },
    priority: 3,
    createdBy: 'me',
    createdAt: 10,
    updatedAt: 20,
    disabledTargetIds: [],
    readOnly: false,
  })
}

/** Mount and wait for the target list AND the kind catalog to have answered. */
async function openEditor(targetIds: readonly string[], readyName: string): Promise<RenderResult> {
  const rule = makeRule(targetIds)
  const screen = mountScreen(React.createElement(RuleDraftHarness, { ruleId: rule.id }), {
    hub: { ...HUB, ...withRuleList(rule, actionOf, HUB['addons.custom']) },
  })
  await screen.findByText(readyName)
  // The title field is always there: it is the readiness node for the
  // kind-dependent assertions (the catalog lands with the targets list).
  await screen.findByTestId('rule-template-title-input')
  return screen
}

afterEach(() => {
  cleanup()
  resetRuleDrafts()
})

describe('every target delivers only a title', () => {
  it('shows the Title field only — no body, no priority, no media', async () => {
    const screen = await openEditor(['tgt-speaker'], SPEAKER)
    await vi.waitFor(() => {
      expect(screen.queryByTestId('rule-template-body-input')).toBeNull()
    })
    expect(screen.queryByTestId('rule-template-title-input')).not.toBeNull()
    expect(screen.queryByText('Priority')).toBeNull()
    expect(screen.queryByText('Media')).toBeNull()
  })
})

describe('mixed targets', () => {
  it('shows the union, with a line naming the target that drops each field', async () => {
    const screen = await openEditor(['tgt-phone', 'tgt-speaker'], PHONE)
    // The speaker drops the body, the priority and the media: one line under each.
    await vi.waitFor(() => {
      expect(screen.queryAllByText(`Not delivered to: ${SPEAKER}`)).toHaveLength(3)
    })
    expect(screen.queryByTestId('rule-template-title-input')).not.toBeNull()
    expect(screen.queryByTestId('rule-template-body-input')).not.toBeNull()
    expect(screen.queryByText('Priority')).not.toBeNull()
    expect(screen.queryByText('Media')).not.toBeNull()
  })

  it('a phone alone: every field, and no drop line (positive control)', async () => {
    const screen = await openEditor(['tgt-phone'], PHONE)
    expect(screen.queryByTestId('rule-template-body-input')).not.toBeNull()
    expect(screen.queryByText('Priority')).not.toBeNull()
    expect(screen.queryByText(/Not delivered to/)).toBeNull()
  })
})
