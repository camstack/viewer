/**
 * @vitest-environment jsdom
 *
 * The two rule tests, mounted over the real hooks with only the wire faked.
 *
 * What only a mount can say:
 *  - the dry-run sends the CURRENT draft through the save conversion, with the
 *    admin's 60-minute window, and draws the per-record verdicts;
 *  - it is absent for a non-admin and for a system rule, once `auth.me` HAS
 *    answered (never judged while it is pending);
 *  - Test now really delivers only after the confirm, and says what came back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
import React, { useState } from 'react'
import type { NcRuleKind } from '@camstack/types'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import { ConditionsSection } from '../rule-editor/sections/ConditionsSection.js'
import { RuleTestNowCard } from '../rule-editor/RuleTestNowCard.js'
import { ruleDryRunInput } from '../rule-editor/rule-draft-source.js'
import { emptyRuleForm, type NcRuleFormState } from '../../../components/notifications/rule-editor.js'
import { NcViewerRuleSchema } from '../../../data/notification-center.js'
import type { NcRuleDraft } from '../../../store/nc-rule-draft-store.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const FORM: NcRuleFormState = {
  ...emptyRuleForm(),
  name: 'Unsaved name',
  // A target that is not the caller's: the save conversion drops it, and so
  // must the dry-run.
  targetIds: ['t1', 'foreign'],
  conditions: { classes: ['person'] },
}

const DRY_RUN_ANSWER = {
  results: [
    { recordId: 'a', recordKind: 'object-event', deviceId: 7, timestamp: 1_000, wouldFire: true, label: 'person' },
    { recordId: 'b', recordKind: 'track', deviceId: 7, timestamp: 2_000, wouldFire: false, failedCondition: 'zones' },
  ],
}

function inputOf(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || !('input' in input)) return undefined
  return { ...input }['input']
}

function actionOf(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || !('action' in input)) return undefined
  return { ...input }['action']
}

function hub(isAdmin: boolean): Readonly<Record<string, unknown>> {
  return {
    'auth.me': { id: 'u1', username: 'operator', isAdmin },
    'notificationRules.testRule': DRY_RUN_ANSWER,
    'addons.custom': (input?: unknown): unknown => {
      const action = actionOf(input)
      if (action === 'nc.listMyTargets') {
        return { targets: [{ id: 't1', name: 'Phone', kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} }] }
      }
      if (action === 'nc.getConditionCatalog') return { catalog: [] }
      if (action === 'nc.testRule') {
        return {
          recordId: 'synthetic:1',
          origin: 'synthetic',
          delivery: 'immediate',
          candidates: 1,
          outcomes: [
            { ruleId: 'r1', ruleName: 'Door', matched: true, cooldown: 'bypassed', enqueued: 1, targetIds: ['t1'] },
          ],
          still: 'none',
          notes: [],
          trigger: 'immediate',
          planNotes: [{ conditionId: 'devices', note: 'This rule names no camera.' }],
        }
      }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

interface HarnessProps {
  readonly kind: NcRuleKind
}

function Harness({ kind }: HarnessProps): React.ReactElement {
  const [draft, setDraft] = useState<NcRuleDraft>({
    key: 'k',
    kind,
    ruleId: null,
    baseline: FORM,
    form: FORM,
    ai: null,
    saveAttempted: false,
  })
  return React.createElement(ConditionsSection, {
    draft,
    patch: (p: Partial<NcRuleFormState>) => setDraft((d) => ({ ...d, form: { ...d.form, ...p } })),
    kind,
    catalog: [],
    rule: null,
  })
}

/** Wait until `auth.me` has ANSWERED and the render has caught up with it. */
async function settleVerdict(): Promise<void> {
  await vi.waitFor(() => expect(hubCalls().some((call) => call.path === 'auth.me')).toBe(true))
  await act(async () => {
    await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
})

describe('the section blurb (review M3)', () => {
  it('a device-events rule reads the DEVICE line, not the System one (D637)', async () => {
    mountScreen(React.createElement(Harness, { kind: 'device-events' }), { hub: hub(true) })
    expect(await dom.findByText(/a battery or consumable running low/)).toBeTruthy()
    expect(dom.queryByText(/The installation itself/)).toBeNull()
  })
})

describe('dry-run (mounted)', () => {
  it('sends the CURRENT draft through the save conversion and draws each record', async () => {
    mountScreen(React.createElement(Harness, { kind: 'detection' }), { hub: hub(true) })
    const button = await dom.findByText('Dry-run (last 60 min)')
    await vi.waitFor(() =>
      expect(hubCalls().some((call) => actionOf(call.input) === 'nc.listMyTargets')).toBe(true),
    )
    await act(async () => {
      await Promise.resolve()
    })
    fireEvent.click(button)

    await dom.findByText('1 of 2 evaluated records would fire')
    expect(dom.getByText('Would fire')).toBeTruthy()
    expect(dom.getByText('Did not match — the “zones” condition refused it')).toBeTruthy()

    const sent = hubCalls().find((call) => call.path === 'notificationRules.testRule')
    expect(sent?.kind).toBe('mutate')
    expect(sent?.input).toEqual({
      rule: ruleDryRunInput(FORM, null, { ownTargetIds: ['t1'], catalog: [], isAdmin: true }),
      lookbackMinutes: 60,
    })
  })

  it('says WHY it is disabled when the targets list failed to load (final review m5)', async () => {
    const base = hub(true)
    const failing = {
      ...base,
      'addons.custom': (input?: unknown): unknown => {
        if (actionOf(input) === 'nc.listMyTargets') throw new Error('targets unreachable')
        const inner = base['addons.custom']
        return typeof inner === 'function' ? inner(input) : undefined
      },
    }
    mountScreen(React.createElement(Harness, { kind: 'detection' }), { hub: failing })
    await dom.findByText('Dry-run (last 60 min)')
    await dom.findByText(/the dry-run can't build this rule/)
  })

  it('is absent for a non-admin, once auth.me has answered', async () => {
    mountScreen(React.createElement(Harness, { kind: 'detection' }), { hub: hub(false) })
    await dom.findByTestId('rule-conditions-section')
    await settleVerdict()
    expect(dom.queryByText('Dry-run (last 60 min)')).toBeNull()
  })

  it('is absent for a system rule, even for an admin', async () => {
    mountScreen(React.createElement(Harness, { kind: 'system' }), { hub: hub(true) })
    await dom.findByTestId('rule-conditions-section')
    await settleVerdict()
    expect(dom.queryByText('Dry-run (last 60 min)')).toBeNull()
  })
})

describe('Test now (mounted)', () => {
  const rule = NcViewerRuleSchema.parse({
    id: 'r1',
    name: 'Door',
    enabled: true,
    delivery: 'immediate',
    conditions: {},
    targets: [{ targetId: 't1' }],
    media: { attach: 'none' },
    priority: 3,
    createdBy: 'me',
    createdAt: 1,
    updatedAt: 1,
    readOnly: false,
  })
  const testCalls = (): number => hubCalls().filter((call) => actionOf(call.input) === 'nc.testRule').length
  // The drawn confirmation is the WEB rendering (the browser has no system
  // alert); the harness default is iOS.
  beforeEach(() => setTestPlatform('web'))
  afterEach(() => setTestPlatform('ios'))

  it('asks first, and a refusal sends nothing', async () => {
    mountScreen(React.createElement(RuleTestNowCard, { rule }), { hub: hub(true) })
    fireEvent.click(await dom.findByText('Test now'))
    await dom.findByText('Send a test notification?')
    fireEvent.click(dom.getByText('Cancel'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(testCalls()).toBe(0)
  })

  it('confirmed, it fires the saved rule and says what was queued', async () => {
    mountScreen(React.createElement(RuleTestNowCard, { rule }), { hub: hub(true) })
    fireEvent.click(await dom.findByText('Test now'))
    fireEvent.click(await dom.findByText('Send test'))
    await dom.findByText('Matched — notifications queued: 1, targets: 1. Marked [TEST] in the body.')
    expect(dom.getByText('devices: This rule names no camera.')).toBeTruthy()
    const sent = hubCalls().find((call) => actionOf(call.input) === 'nc.testRule')
    expect(inputOf(sent?.input)).toEqual({ ruleId: 'r1' })
  })
})
