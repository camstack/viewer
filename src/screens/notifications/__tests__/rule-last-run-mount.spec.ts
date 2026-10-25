/**
 * @vitest-environment jsdom
 *
 * The "last run" line on every rule card, mounted in the Rules tab over the
 * real hooks with only the wire faked.
 *
 * What only a mount can say:
 *  - the whole list is served by ONE `notificationRules.getRuleLastRuns` call,
 *    never one per card;
 *  - a non-admin viewer never asks (the method is admin) and never shows
 *    "Not in the last …" — a FORBIDDEN must not read as an absence (D315);
 *  - pending claims nothing, failed says "—" plus a hint;
 *  - the timelapse / digest cards carry the same line (shared `RuleTitle`);
 *  - the line opens the rule's history route.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, cleanup, fireEvent, screen as dom, within } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { resetStubConnection, setStubConnection } from '../../../testing/connection-stub.js'
import { routerCalls } from '../../../testing/native-stubs/expo-router.js'
import { RulesTab } from '../RulesTab.js'
import { resetRulesStripKeyForTests } from '../use-rules-strip-key.js'

// The strip tab is session memory: every test is a fresh session.
beforeEach(() => resetRulesStripKeyForTests())

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const DAY = 24 * 60 * 60_000
const LAST_RUNS_PATH = 'notificationRules.getRuleLastRuns'

const BASE_RULE = {
  enabled: true,
  delivery: 'immediate',
  conditions: { classes: ['person'] },
  targets: [{ targetId: 't1' }],
  media: { attach: 'best' },
  priority: 3,
  createdAt: 10,
  updatedAt: 20,
  disabledTargetIds: [],
  createdBy: 'u1',
  ownerUserId: 'u1',
  readOnly: false,
}

const RULES = [
  { ...BASE_RULE, id: 'ran', name: 'Front door' },
  { ...BASE_RULE, id: 'quiet', name: 'Back yard' },
  { ...BASE_RULE, id: 'failed-one', name: 'Garage' },
]

const TIMELAPSE = {
  id: 'tl-1',
  name: 'Daily garden',
  enabled: true,
  deviceIds: [1],
  schedule: { windows: [{ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 1320, endMinute: 360 }] },
  cadenceSec: 15,
  framerate: 10,
  previewMode: 'image',
  targets: [{ targetId: 't1' }],
  priority: 3,
  createdBy: 'admin',
  createdAt: 1,
  updatedAt: 2,
  readOnly: false,
}

function field(input: unknown, key: string): unknown {
  return input !== null && typeof input === 'object' && key in input ? Reflect.get(input, key) : undefined
}

type LastRunsAnswer = (() => unknown) | { readonly runs: readonly unknown[]; readonly horizonMs: number | null }

function hub(isAdmin: boolean, lastRuns: LastRunsAnswer) {
  return {
    'auth.me': { id: 'u1', username: isAdmin ? 'admin' : 'user', isAdmin },
    [LAST_RUNS_PATH]: lastRuns,
    'addons.custom': (input?: unknown): unknown => {
      const action = field(input, 'action')
      if (action === 'nc.listRules') return { rules: RULES }
      if (action === 'nc.listTimelapseRules') return { rules: [TIMELAPSE] }
      if (action === 'nc.listSummaryRules') return { rules: [], canAuthor: true }
      if (action === 'nc.listMyTargets') return { targets: [] }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

const ANSWER = {
  horizonMs: 7 * DAY,
  runs: [
    { ruleId: 'ran', lastAt: Date.now() - 5 * 60_000, status: 'sent', deviceId: 3 },
    { ruleId: 'failed-one', lastAt: Date.now() - 2 * 60 * 60_000, status: 'dead', deviceId: 4 },
  ],
}

function lastRunCalls(): number {
  return hubCalls().filter((call) => call.path === LAST_RUNS_PATH).length
}

function line(ruleId: string): HTMLElement {
  return dom.getByTestId(`rule-last-run-${ruleId}`)
}

// The strip tab is remembered across mounts; every test starts on All.
beforeEach(async () => {
  await AsyncStorage.clear()
})

afterEach(() => {
  cleanup()
  resetStubConnection()
})

/** The tab under a parent that can be made to re-render (a reconnect is only
 *  seen by the next render of the connection stub). */
function BumpableTab() {
  const [, setTick] = React.useState(0)
  return React.createElement(
    React.Fragment,
    null,
    React.createElement('button', { 'data-testid': 'bump', onClick: () => setTick((n) => n + 1) }),
    React.createElement(RulesTab),
  )
}

describe('last run on the rule card', () => {
  it('one call serves the whole list, and each card says what the hub answered', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub(true, ANSWER) })
    await dom.findByText('Not in the last 7 days')
    expect(within(line('ran')).getByText(/Sent/)).toBeTruthy()
    expect(within(line('ran')).getByText(/5m ago|5 min/)).toBeTruthy()
    expect(within(line('failed-one')).getByText(/Failed/)).toBeTruthy()
    expect(within(line('quiet')).getByText('Not in the last 7 days')).toBeTruthy()
    expect(lastRunCalls()).toBe(1)
  })

  it('a keep-forever answer calls an absent rule never recorded', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub(true, { runs: [], horizonMs: null }) })
    await dom.findAllByText('No delivery on record')
    expect(within(line('quiet')).getByText('No delivery on record')).toBeTruthy()
    expect(dom.queryByText(/Not in the last/)).toBeNull()
  })

  it('a non-admin viewer never asks, and never reads a refusal as an absence', async () => {
    const refuse = (): unknown => {
      throw new Error('FORBIDDEN')
    }
    mountScreen(React.createElement(RulesTab), { hub: hub(false, refuse) })
    await dom.findByTestId('rule-row-name-quiet')
    // Give any stray query a chance to fire before judging.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(lastRunCalls()).toBe(0)
    expect(dom.queryByText(/Not in the last/)).toBeNull()
    expect(dom.queryByTestId('rule-last-run-quiet')).toBeNull()
    expect(dom.queryByTestId('rule-history-open-quiet')).toBeNull()
  })

  it('a failed read says "—" and why, never "not in the last …"', async () => {
    const fail = (): unknown => {
      throw new Error('store unavailable')
    }
    mountScreen(React.createElement(RulesTab), { hub: hub(true, fail) })
    await dom.findAllByText('Last run could not be read')
    expect(within(line('quiet')).getByText('—')).toBeTruthy()
    expect(dom.queryByText(/Not in the last/)).toBeNull()
  })

  it('a read in flight claims nothing', async () => {
    const never = (): unknown => new Promise(() => undefined)
    mountScreen(React.createElement(RulesTab), { hub: hub(true, never) })
    await dom.findByTestId('rule-last-run-quiet')
    expect(line('quiet').textContent ?? '').not.toMatch(/Not in the last|—|No delivery/)
    expect(lastRunCalls()).toBe(1)
  })

  it('a timelapse card carries the same line, from the same one call', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub(true, ANSWER) })
    await dom.findByText('Not in the last 7 days')
    fireEvent.click(dom.getByRole('tab', { name: /Timelapse/ }))
    await dom.findByTestId('rule-last-run-tl-1')
    expect(within(line('tl-1')).getByText('Not in the last 7 days')).toBeTruthy()
    expect(lastRunCalls()).toBe(1)
  })

  it('a reconnect keeps an admin\'s answered lines — they never blink away', async () => {
    mountScreen(React.createElement(BumpableTab), { hub: hub(true, ANSWER) })
    await dom.findByText('Not in the last 7 days')
    setStubConnection({ state: 'disconnected' })
    await act(async () => {
      fireEvent.click(dom.getByTestId('bump'))
    })
    expect(within(line('quiet')).getByText('Not in the last 7 days')).toBeTruthy()
    expect(within(line('ran')).getByText(/Sent/)).toBeTruthy()
    expect(lastRunCalls()).toBe(1)
  })

  it('the line opens the rule history route', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub(true, ANSWER) })
    await dom.findByText('Not in the last 7 days')
    fireEvent.click(dom.getByTestId('rule-history-open-ran'))
    const pushed = routerCalls().filter((call) => call.kind === 'push')
    expect(pushed.at(-1)?.target).toEqual({
      pathname: '/notifications/rule/[id]/history',
      params: { id: 'ran', name: 'Front door' },
    })
  })
})
