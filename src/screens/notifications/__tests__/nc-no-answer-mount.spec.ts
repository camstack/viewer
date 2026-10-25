/**
 * @vitest-environment jsdom
 *
 * A read that never happened is not an empty answer (final review I3, D315).
 *
 * `useNcRules`, `useNcTimelapseRules` and `useNcTargets` used to return `[]`
 * when there was no system handle. The save gate read that as "answered: owns
 * no targets" (a save then drops every stored target), and the editor routes
 * called an existing rule "missing". Every consumer must say connecting or
 * failed — never "no longer exists", "no targets yet" or "doesn't deliver to
 * any of your targets" — until the hub has answered.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, screen as dom } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { resetStubConnection, setStubConnection } from '../../../testing/connection-stub.js'
import { TimelapseEditorScreen } from '../rule-editor/TimelapseEditorScreen.js'
import { RuleSummaryScreen } from '../rule-editor/RuleSummaryScreen.js'
import { RulesTab } from '../RulesTab.js'
import { resetRulesStripKeyForTests } from '../use-rules-strip-key.js'

// The strip tab is session memory: every test is a fresh session.
beforeEach(() => resetRulesStripKeyForTests())

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

vi.mock('expo-router/react-navigation', () => ({ usePreventRemove: (): void => undefined }))

const ADMIN_RULE = {
  id: 'rule-1',
  name: 'Front door',
  enabled: true,
  delivery: 'immediate',
  conditions: { classes: ['person'] },
  targets: [{ targetId: 't1' }],
  media: { attach: 'best' },
  priority: 3,
  createdBy: 'admin',
  createdAt: 10,
  updatedAt: 20,
  disabledTargetIds: [],
  readOnly: true,
}

function actionOf(input: unknown): unknown {
  return input !== null && typeof input === 'object' && 'action' in input ? input.action : undefined
}

/** Rules answer; the caller's own targets do not. */
function targetsFailHub(): Readonly<Record<string, unknown>> {
  return {
    'auth.me': { id: 'u1', username: 'user', isAdmin: false },
    'addons.custom': (input?: unknown): unknown => {
      const action = actionOf(input)
      if (action === 'nc.listRules') return { rules: [ADMIN_RULE] }
      if (action === 'nc.listTimelapseRules') return { rules: [] }
      if (action === 'nc.listSummaryRules') return { rules: [], canAuthor: true }
      if (action === 'nc.listMyTargets') throw new Error('targets unreachable')
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

const NO_TARGETS = /no targets yet/i
const MISSING = /no longer exists/i
const NOT_MINE = /doesn't deliver to any of your targets/i
/** The picker's own line — the Save notice says something similar. */
const PICKER_FAILED = "Couldn't load your targets. Go back and open this again."

afterEach(() => {
  cleanup()
  resetStubConnection()
})

describe('no system handle: the editor routes say "couldn\'t load", never "missing"', () => {
  it('timelapse editor', async () => {
    setStubConnection({ hasSystem: false })
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), { hub: {} })
    await dom.findByText(/Couldn't load the timelapse rules/)
    expect(dom.queryByText(MISSING)).toBeNull()
  })

  it('rule editor', async () => {
    setStubConnection({ hasSystem: false })
    mountScreen(React.createElement(RuleSummaryScreen, { id: 'rule-1' }), { hub: {} })
    await dom.findByText(/Couldn't load this rule/)
    expect(dom.queryByText(MISSING)).toBeNull()
  })
})

describe('an unanswered targets list is never "you have none"', () => {
  it('no system: the target picker says it could not load them', async () => {
    setStubConnection({ hasSystem: false })
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'new' }), { hub: {} })
    await dom.findByText(PICKER_FAILED)
    expect(dom.queryByText(NO_TARGETS)).toBeNull()
  })

  it('the targets read FAILED: the picker says so', async () => {
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'new' }), { hub: targetsFailHub() })
    await dom.findByText(PICKER_FAILED)
    expect(dom.queryByText(NO_TARGETS)).toBeNull()
  })

  it('DISCONNECTED: the picker waits, it does not say "none"', async () => {
    setStubConnection({ state: 'offline' })
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'new' }), { hub: targetsFailHub() })
    await dom.findByText('New timelapse')
    expect(dom.queryByText(NO_TARGETS)).toBeNull()
  })

  it('rules list: an admin rule is not "not delivering to you" while your targets are unknown', async () => {
    mountScreen(React.createElement(RulesTab), { hub: targetsFailHub() })
    await dom.findByText('Front door')
    await dom.findByText(/Couldn't load your targets/)
    expect(dom.queryByText(NOT_MINE)).toBeNull()
  })
})
