/**
 * @vitest-environment jsdom
 *
 * The rule card's ONE action row, mounted in the Rules tab over the real hooks
 * with only the wire faked.
 *
 * The operator, 2026-09-26: "Quando una rule è disattivata non si vede il nome.
 * Tieni modifica elimina ed abilitata sulla stessa riga".
 *
 * What only a mount can say:
 *  - Edit, Delete, the Enabled switch and the Snooze switch sit in ONE row,
 *    for a rule the caller can edit — and none of them on an admin rule a
 *    non-admin sees;
 *  - (2026-10-01) the WHOLE card opens the rule, a tap inside the controls —
 *    the owner's row or an admin rule's opt-outs — never does, and Delete asks
 *    through the app's shared confirm dialog (`useConfirm`), the SAME one the
 *    Targets tab uses, replacing an earlier custom popover anchored to the
 *    button;
 *  - the Snooze switch SNOOZES THE RULE (controller ruling on R3): on opens a
 *    30-minute rule-scoped window (`nc.createSnooze`), off cancels the live
 *    ones (`nc.cancelSnooze`), its state is read from `nc.listSnoozes`, and an
 *    alarm rule — which no snooze can silence — has no switch at all;
 *  - a mixed rule its owner can edit drops Edit and keeps the switch + Delete;
 *  - the switch calls the hub, and ends on what the hub HOLDS: a refused write
 *    (or one the hub answered without applying) puts the switch back and says
 *    why. A switch showing a state the hub did not accept is a lie.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom, within } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { routerCalls } from '../../../testing/native-stubs/expo-router.js'
import { setTestPlatform } from '../../../testing/platform-control.js'
import i18n from '../../../app/i18n.js'
import { RulesTab } from '../RulesTab.js'
import { resetRulesStripKeyForTests } from '../use-rules-strip-key.js'

// The strip tab is session memory: every test is a fresh session.
beforeEach(() => resetRulesStripKeyForTests())

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

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
}

const LONG_NAME = 'Allarme porta front door sul retro del garage'

const MINE_OFF = {
  ...BASE_RULE,
  id: 'mine-off',
  name: LONG_NAME,
  enabled: false,
  createdBy: 'u1',
  ownerUserId: 'u1',
  readOnly: false,
}

const ADMIN_RULE = {
  ...BASE_RULE,
  id: 'admin-1',
  name: 'Admin front door',
  createdBy: 'admin',
  readOnly: true,
}

const MINE_MIXED = {
  ...BASE_RULE,
  id: 'mine-mixed',
  name: 'Old mixed system rule',
  delivery: 'system-event',
  conditions: { systemEvent: { kinds: ['device-offline', 'alarm-armed'] } },
  createdBy: 'u1',
  ownerUserId: 'u1',
  readOnly: false,
}

/** An alarm rule its owner can edit: no snooze can silence it. */
const MINE_ALARM = {
  ...BASE_RULE,
  id: 'mine-alarm',
  name: 'Allarme scattato',
  delivery: 'system-event',
  conditions: { systemEvent: { kinds: ['alarm-triggered'] } },
  createdBy: 'u1',
  ownerUserId: 'u1',
  readOnly: false,
}

/**
 * `conflicts`: the hub refuses, and meanwhile the rule was switched ON by
 * someone else — only a list re-read can show that.
 */
type UpdateOutcome = 'applies' | 'refuses' | 'ignores' | 'conflicts'

function field(input: unknown, key: string): unknown {
  return input !== null && typeof input === 'object' && key in input ? Reflect.get(input, key) : undefined
}

/**
 * A hub that holds the rules and answers `nc.updateRule` per `outcome`:
 * `applies` stores the patch, `refuses` throws, `ignores` answers success with
 * the rule unchanged.
 */
/** What `nc.createSnooze` does: `opens` stores a window, `refuses` throws. */
type SnoozeOutcome = 'opens' | 'refuses'

/** A live window of `ruleId`, as the hub lists it. */
function liveWindow(id: string, ruleId: string, startedAt = Date.now() - 60_000): Readonly<Record<string, unknown>> {
  return {
    id,
    userId: 'u1',
    scope: 'rule',
    ruleId,
    startedAt,
    expiresAt: Date.now() + 30 * 60_000,
    global: false,
    summary: true,
  }
}

/** The caller's own target, which the admin rule delivers to. */
const MY_TARGET = { id: 't1', name: 'Il mio telefono', kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} }

function hub(
  outcome: UpdateOutcome,
  snoozeOutcome: SnoozeOutcome = 'opens',
  initialSnoozes: readonly Readonly<Record<string, unknown>>[] = [],
) {
  let rules: readonly Readonly<Record<string, unknown>>[] = [MINE_OFF, ADMIN_RULE, MINE_MIXED, MINE_ALARM]
  let snoozes = initialSnoozes
  return {
    'auth.me': { id: 'u1', username: 'user', isAdmin: false },
    'addons.custom': (input?: unknown): unknown => {
      const action = field(input, 'action')
      const body = field(input, 'input')
      if (action === 'nc.listRules') return { rules }
      if (action === 'nc.listTimelapseRules') return { rules: [] }
      if (action === 'nc.listSummaryRules') return { rules: [], canAuthor: true }
      if (action === 'nc.listMyTargets') return { targets: [MY_TARGET] }
      if (action === 'nc.setRuleTargetEnabled') return { success: true }
      if (action === 'nc.listSnoozes') return { snoozes }
      if (action === 'nc.createSnooze') {
        if (snoozeOutcome === 'refuses') throw new Error('forbidden: snooze refused')
        const ruleId = String(field(field(body, 'snooze'), 'ruleId'))
        // Started NOW, as the hub stamps it — after the list's minute clock
        // last ticked, which is what the switch must still read as live.
        const created = liveWindow(`sn-${String(snoozes.length + 1)}`, ruleId, Date.now())
        snoozes = [...snoozes, created]
        return { snooze: created }
      }
      if (action === 'nc.cancelSnooze') {
        const snoozeId = field(body, 'snoozeId')
        snoozes = snoozes.filter((window) => window.id !== snoozeId)
        return { success: true }
      }
      if (action === 'nc.updateRule') {
        if (outcome === 'refuses') throw new Error('forbidden: rule not owned: mine-off')
        if (outcome === 'conflicts') {
          rules = rules.map((rule) => (rule.id === 'mine-off' ? { ...rule, enabled: true } : rule))
          throw new Error('conflict: rule changed')
        }
        const ruleId = field(body, 'ruleId')
        const patch = field(body, 'patch')
        const clear = field(body, 'clear')
        const stored = rules.find((rule) => rule.id === ruleId)
        if (!stored) throw new Error('rule not found')
        if (outcome === 'ignores') {
          const { readOnly: _ro, ...rule } = stored
          return { rule }
        }
        const merged: Record<string, unknown> = {
          ...stored,
          ...(patch !== null && typeof patch === 'object' ? patch : {}),
        }
        if (Array.isArray(clear)) for (const key of clear) if (typeof key === 'string') delete merged[key]
        const next: Readonly<Record<string, unknown>> = merged
        rules = rules.map((rule) => (rule.id === ruleId ? next : rule))
        const { readOnly: _ro, ...rule } = next
        return { rule }
      }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

function updateCalls(): readonly unknown[] {
  return hubCalls()
    .filter((call) => field(call.input, 'action') === 'nc.updateRule')
    .map((call) => field(call.input, 'input'))
}

function actionRow(ruleId: string): HTMLElement {
  return dom.getByTestId(`rule-row-actions-${ruleId}`)
}

/** The shared confirm dialog's button matching `label` — `useConfirm`'s web
 *  rendering draws `accessibilityRole="alert"` on its card (`confirm.tsx`). */
function dialogButton(label: string): HTMLElement {
  const dialog = document.body.querySelector('[role="alert"]')
  if (dialog === null) throw new Error('no confirmation dialog on screen')
  const button = [...dialog.querySelectorAll('[role="button"]')].find(
    (el) => el.textContent === label,
  )
  if (button === undefined) throw new Error(`the confirmation has no "${label}" button`)
  return button as HTMLElement
}

function switchNamed(ruleId: string, name: 'Enabled' | 'Snooze 30 min'): HTMLInputElement {
  const el = within(actionRow(ruleId)).getByRole('switch', { name })
  if (!(el instanceof HTMLInputElement)) throw new Error(`the ${name} switch is not an input`)
  return el
}

function enabledSwitch(ruleId: string): HTMLInputElement {
  return switchNamed(ruleId, 'Enabled')
}

function snoozeSwitch(ruleId: string): HTMLInputElement {
  return switchNamed(ruleId, 'Snooze 30 min')
}

afterEach(() => {
  cleanup()
})

describe('one action row: Edit, Delete, Enabled and Snooze together', () => {
  it('a rule the caller owns carries all four in the same row, and its name is whole', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('applies') })
    await dom.findByTestId('rule-row-actions-mine-off')
    const row = actionRow('mine-off')
    expect(within(row).getByLabelText('Edit')).toBeTruthy()
    expect(within(row).getByLabelText('Delete')).toBeTruthy()
    expect(within(row).getByText('Enabled')).toBeTruthy()
    expect(within(row).getByText('Snooze 30 min')).toBeTruthy()
    expect(enabledSwitch('mine-off').checked).toBe(false)
    // The name is on its own line, whole.
    const nameLine = dom.getByTestId('rule-row-name-mine-off')
    expect(nameLine.textContent).toBe(LONG_NAME)
    // The switch says it is off; the words would say it a second time
    // (operator, 2026-09-26: "the switch is already there").
    expect(dom.getByTestId('rule-row-meta-mine-off').textContent).not.toContain('Off — it will not run.')
    expect(dom.queryAllByText('Off — it will not run.')).toHaveLength(0)
  })

  it('an admin rule a non-admin sees has none of the owner\'s controls — only its snooze', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('applies') })
    await dom.findByTestId('rule-row-actions-admin-1')
    const row = actionRow('admin-1')
    expect(within(row).queryByLabelText('Edit')).toBeNull()
    expect(within(row).queryByLabelText('Delete')).toBeNull()
    expect(within(row).queryByRole('switch', { name: 'Enabled' })).toBeNull()
  })

  it('a mixed rule its owner can edit: no Edit, but the switch and Delete stay', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('applies') })
    await dom.findByTestId('rule-row-actions-mine-mixed')
    const row = actionRow('mine-mixed')
    expect(within(row).queryByLabelText('Edit')).toBeNull()
    expect(within(row).getByLabelText('Delete')).toBeTruthy()
    expect(within(row).getByRole('switch', { name: 'Enabled' })).toBeTruthy()
    // The recreate notice is still said.
    expect(dom.getByTestId('rule-row-must-recreate')).toBeTruthy()
  })
})

describe('the card opens the rule; its controls never do (operator, 2026-10-01)', () => {
  function pushes(): readonly unknown[] {
    return routerCalls()
      .filter((call) => call.kind === 'push')
      .map((call) => call.target)
  }

  it('a press anywhere on the card opens the rule', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('applies') })
    const card = await dom.findByTestId('rule-row-mine-off')
    await act(async () => {
      fireEvent.click(card)
    })
    expect(pushes()).toHaveLength(1)
    expect(JSON.stringify(pushes()[0])).toContain('mine-off')
  })

  it('a press inside the controls — on the row or on a switch — does not', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('applies') })
    await dom.findByTestId('rule-row-actions-mine-off')
    await act(async () => {
      fireEvent.click(actionRow('mine-off'))
      fireEvent.click(enabledSwitch('mine-off'))
    })
    expect(pushes()).toHaveLength(0)
  })

  it('a press on an admin rule\'s opt-out toggle flips it and does not open the rule (M1)', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('applies') })
    // The toggle row's switch: the one beside its label.
    let row: HTMLElement | null = await dom.findByText('Receive on Il mio telefono')
    while (row !== null && within(row).queryAllByRole('switch').length === 0) row = row.parentElement
    if (row === null) throw new Error('no opt-out switch')
    const optOut = within(row).getAllByRole('switch')[0]
    await act(async () => {
      fireEvent.click(optOut)
    })
    await vi.waitFor(() =>
      expect(
        hubCalls()
          .filter((call) => field(call.input, 'action') === 'nc.setRuleTargetEnabled')
          .map((call) => field(call.input, 'input')),
      ).toEqual([{ ruleId: 'admin-1', targetId: 't1', enabled: false }]),
    )
    expect(pushes()).toHaveLength(0)
  })

  it('the list is sorted by name', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('applies') })
    await dom.findByTestId('rule-row-actions-mine-off')
    const names = dom.getAllByTestId(/^rule-row-name-/).map((el) => el.textContent)
    // Within "My rules": the alarm rule is a system rule, listed under System.
    expect(names.indexOf(LONG_NAME)).toBeLessThan(names.indexOf('Old mixed system rule'))
    expect(names.indexOf('Allarme scattato')).toBeLessThan(names.indexOf('Old mixed system rule'))
  })
})

describe('Delete is confirmed through the shared confirm dialog', () => {
  // `useConfirm` hands off to a system alert on native and draws its own
  // dialog only on the web (`confirm.tsx`) — the default harness platform is
  // `ios` (operator's phone), so these assertions need the web branch.
  beforeEach(() => {
    setTestPlatform('web')
  })
  afterEach(() => {
    setTestPlatform('ios')
  })

  function deletes(): readonly unknown[] {
    return hubCalls()
      .filter((call) => field(call.input, 'action') === 'nc.deleteRule')
      .map((call) => field(call.input, 'input'))
  }

  function withDeleteHub() {
    const base = hub('applies')
    return {
      ...base,
      'addons.custom': (input?: unknown): unknown =>
        field(input, 'action') === 'nc.deleteRule' ? { ok: true } : base['addons.custom'](input),
    }
  }

  it('nothing is deleted until the shared confirm dialog is confirmed', async () => {
    mountScreen(React.createElement(RulesTab), { hub: withDeleteHub() })
    await dom.findByTestId('rule-row-actions-mine-off')
    await act(async () => {
      fireEvent.click(dom.getByTestId('rule-row-delete-mine-off'))
    })
    // The confirm is the app's ONE shared dialog (`useConfirm`), not a
    // bespoke popover anchored to the button — the same one the Targets tab
    // already uses for its own delete.
    const dialog = await vi.waitFor(() => {
      const el = document.body.querySelector('[role="alert"]')
      if (el === null) throw new Error('dialog not open yet')
      return el
    })
    expect(dialog.textContent).toContain(LONG_NAME)
    expect(deletes()).toHaveLength(0)
    await act(async () => {
      fireEvent.click(dialogButton(i18n.t('v2.nc.rules.delete')))
    })
    await vi.waitFor(() => expect(deletes()).toEqual([{ ruleId: 'mine-off' }]))
    // Deleting never opened the rule.
    expect(routerCalls().filter((call) => call.kind === 'push')).toHaveLength(0)
  })

  it('cancelling the shared confirm dialog deletes nothing', async () => {
    mountScreen(React.createElement(RulesTab), { hub: withDeleteHub() })
    await dom.findByTestId('rule-row-actions-mine-off')
    await act(async () => {
      fireEvent.click(dom.getByTestId('rule-row-delete-mine-off'))
    })
    await vi.waitFor(() => expect(document.body.querySelector('[role="alert"]')).not.toBeNull())
    await act(async () => {
      fireEvent.click(dialogButton(i18n.t('v2.common.cancel')))
    })
    await vi.waitFor(() => expect(document.body.querySelector('[role="alert"]')).toBeNull())
    expect(deletes()).toHaveLength(0)
  })

  it('a disarmed delete (no confirm click) never calls nc.deleteRule', async () => {
    mountScreen(React.createElement(RulesTab), { hub: withDeleteHub() })
    await dom.findByTestId('rule-row-actions-mine-off')
    await act(async () => {
      fireEvent.click(dom.getByTestId('rule-row-delete-mine-off'))
    })
    await vi.waitFor(() => expect(document.body.querySelector('[role="alert"]')).not.toBeNull())
    // No click on the dialog's Delete button — only opening the confirm must
    // never be enough to delete.
    expect(deletes()).toHaveLength(0)
  })
})

describe('the snooze switch snoozes THIS RULE (controller ruling, R3)', () => {
  function calls(action: string): readonly unknown[] {
    return hubCalls()
      .filter((call) => field(call.input, 'action') === action)
      .map((call) => field(call.input, 'input'))
  }

  it('on opens a 30-minute rule window; off cancels the live one; the rule is never patched', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('applies') })
    await dom.findByTestId('rule-row-actions-mine-off')
    await vi.waitFor(() => expect(snoozeSwitch('mine-off').disabled).toBe(false))
    expect(snoozeSwitch('mine-off').checked).toBe(false)
    await act(async () => {
      fireEvent.click(snoozeSwitch('mine-off'))
    })
    await vi.waitFor(() => expect(calls('nc.createSnooze')).toHaveLength(1))
    expect(calls('nc.createSnooze')[0]).toEqual({
      snooze: { scope: 'rule', ruleId: 'mine-off', durationMinutes: 30 },
    })
    await vi.waitFor(() => expect(snoozeSwitch('mine-off').checked).toBe(true))
    await act(async () => {
      fireEvent.click(snoozeSwitch('mine-off'))
    })
    await vi.waitFor(() => expect(calls('nc.cancelSnooze')).toEqual([{ snoozeId: 'sn-1' }]))
    await vi.waitFor(() => expect(snoozeSwitch('mine-off').checked).toBe(false))
    // The snooze-button CONFIG is the editor's, and is never touched here.
    expect(updateCalls()).toHaveLength(0)
  })

  it('reads its state from the live windows the hub lists', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('applies', 'opens', [liveWindow('w9', 'mine-off')]) })
    await dom.findByTestId('rule-row-actions-mine-off')
    await vi.waitFor(() => expect(snoozeSwitch('mine-off').checked).toBe(true))
  })

  it('an admin rule a non-admin receives can be snoozed too — a snooze is personal', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('applies') })
    await dom.findByTestId('rule-row-actions-admin-1')
    const row = actionRow('admin-1')
    expect(within(row).queryByLabelText('Edit')).toBeNull()
    expect(within(row).queryByLabelText('Delete')).toBeNull()
    expect(within(row).queryByRole('switch', { name: 'Enabled' })).toBeNull()
    expect(snoozeSwitch('admin-1')).toBeTruthy()
  })

  it('an alarm rule has NO snooze switch, and no prose explains it', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('applies') })
    await dom.findByTestId('rule-row-actions-mine-alarm')
    expect(within(actionRow('mine-alarm')).queryByRole('switch', { name: 'Snooze 30 min' })).toBeNull()
    expect(within(actionRow('mine-alarm')).getByRole('switch', { name: 'Enabled' })).toBeTruthy()
    expect(dom.queryByText(/Snooze disabled/)).toBeNull()
  })

  it('a refused snooze goes back and says why under the row', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('applies', 'refuses') })
    await dom.findByTestId('rule-row-actions-mine-off')
    await vi.waitFor(() => expect(snoozeSwitch('mine-off').disabled).toBe(false))
    await act(async () => {
      fireEvent.click(snoozeSwitch('mine-off'))
    })
    const error = await dom.findByTestId('rule-row-snooze-error-mine-off')
    expect(error.textContent).toContain('forbidden: snooze refused')
    expect(snoozeSwitch('mine-off').checked).toBe(false)
  })
})

describe('the enable switch', () => {
  it('asks the hub for exactly the flip, and shows what the hub now holds', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('applies') })
    await dom.findByTestId('rule-row-actions-mine-off')
    await act(async () => {
      fireEvent.click(enabledSwitch('mine-off'))
    })
    await vi.waitFor(() => expect(updateCalls()).toHaveLength(1))
    expect(updateCalls()[0]).toEqual({ ruleId: 'mine-off', patch: { enabled: true } })
    await vi.waitFor(() => expect(enabledSwitch('mine-off').checked).toBe(true))
    await vi.waitFor(() => expect(dom.queryByTestId('rule-row-meta-mine-off')?.textContent).not.toContain('Off'))
    expect(dom.queryByTestId('rule-row-enable-error-mine-off')).toBeNull()
  })

  it('a refused write puts the switch back and says why', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('refuses') })
    await dom.findByTestId('rule-row-actions-mine-off')
    await act(async () => {
      fireEvent.click(enabledSwitch('mine-off'))
    })
    const error = await dom.findByTestId('rule-row-enable-error-mine-off')
    expect(error.textContent).toContain('forbidden: rule not owned')
    expect(enabledSwitch('mine-off').checked).toBe(false)
  })

  it('a hub that answers success WITHOUT applying it is a failure too', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('ignores') })
    await dom.findByTestId('rule-row-actions-mine-off')
    await act(async () => {
      fireEvent.click(enabledSwitch('mine-off'))
    })
    await dom.findByTestId('rule-row-enable-error-mine-off')
    expect(enabledSwitch('mine-off').checked).toBe(false)
  })
})

describe('a failed switch re-reads the list', () => {
  it('a refusal ends on the rule as the hub NOW holds it, not as the phone last cached it', async () => {
    mountScreen(React.createElement(RulesTab), { hub: hub('conflicts') })
    await dom.findByTestId('rule-row-actions-mine-off')
    const reads = listReads()
    await act(async () => {
      fireEvent.click(enabledSwitch('mine-off'))
    })
    await dom.findByTestId('rule-row-enable-error-mine-off')
    await vi.waitFor(() => expect(listReads()).toBeGreaterThan(reads))
    // Someone else switched it on meanwhile: the re-read shows it.
    await vi.waitFor(() => expect(enabledSwitch('mine-off').checked).toBe(true))
  })
})

function listReads(): number {
  return hubCalls().filter((call) => field(call.input, 'action') === 'nc.listRules').length
}

// ── Timelapse and digest cards: the same card ────────────────────────────────

const TL_BASE = {
  deviceIds: [102],
  schedule: { windows: [{ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 1320, endMinute: 360 }] },
  cadenceSec: 15,
  framerate: 10,
  previewMode: 'image',
  targets: [{ targetId: 't1' }],
  priority: 3,
  createdAt: 1,
  updatedAt: 2,
}
const TL_MINE = { ...TL_BASE, id: 'tl-mine', name: 'Notte garden', enabled: true, createdBy: 'u1', readOnly: false }
const TL_ADMIN = { ...TL_BASE, id: 'tl-admin', name: 'Notte admin', enabled: true, createdBy: 'admin', readOnly: true }
const SUM_MINE = {
  id: 'sum-mine',
  name: 'Riepilogo notte',
  enabled: true,
  deviceIds: [101],
  window: { kind: 'motion', quietSeconds: 120, maxWindowSeconds: 3600 },
  targets: [{ targetId: 't1' }],
  priority: 3,
  maxTiles: 9,
  maxAiImages: 6,
  rank: 'importance',
  subject: 'tracks',
  barrierSeconds: 120,
  captions: 'all',
  captionText: 'Notte {{from}}',
  deliverEmpty: false,
  createdBy: 'u1',
  createdAt: 1,
  updatedAt: 2,
  readOnly: false,
}

interface FamilyHubOptions {
  readonly canAuthor?: boolean
  readonly refuse?: boolean
}

/** A hub holding one timelapse per ownership and one digest; the upserts store `enabled`. */
function familyHub(options: FamilyHubOptions = {}) {
  let timelapses: readonly Readonly<Record<string, unknown>>[] = [TL_MINE, TL_ADMIN]
  let summaries: readonly Readonly<Record<string, unknown>>[] = [SUM_MINE]
  const patchEnabled = (
    list: readonly Readonly<Record<string, unknown>>[],
    body: unknown,
  ): { readonly next: readonly Readonly<Record<string, unknown>>[]; readonly rule: Readonly<Record<string, unknown>> } => {
    if (options.refuse) throw new Error('forbidden: not yours')
    const ruleId = field(body, 'ruleId')
    const enabled = field(field(body, 'patch'), 'enabled')
    const next = list.map((rule) => (rule.id === ruleId ? { ...rule, enabled } : rule))
    const stored = next.find((rule) => rule.id === ruleId)
    if (!stored) throw new Error('rule not found')
    const { readOnly: _ro, ...rule } = stored
    return { next, rule }
  }
  return {
    'auth.me': { id: 'u1', username: 'user', isAdmin: false },
    'addons.custom': (input?: unknown): unknown => {
      const action = field(input, 'action')
      const body = field(input, 'input')
      if (action === 'nc.listRules') return { rules: [] }
      if (action === 'nc.listTimelapseRules') return { rules: timelapses }
      if (action === 'nc.listSummaryRules') return { rules: summaries, canAuthor: options.canAuthor ?? true }
      if (action === 'nc.listMyTargets') return { targets: [] }
      if (action === 'nc.upsertTimelapseRule') {
        const { next, rule } = patchEnabled(timelapses, body)
        timelapses = next
        return { rule }
      }
      if (action === 'nc.upsertSummaryRule') {
        const { next, rule } = patchEnabled(summaries, body)
        summaries = next
        return { rule }
      }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

async function openTab(label: 'Timelapse' | 'Summary'): Promise<void> {
  const tab = await dom.findByRole('tab', { name: new RegExp(`^${label}`) })
  await act(async () => {
    fireEvent.click(tab)
  })
}

function upserts(action: string): readonly unknown[] {
  return hubCalls()
    .filter((call) => field(call.input, 'action') === action)
    .map((call) => field(call.input, 'input'))
}

describe('a timelapse card has the same action row', () => {
  it('its owner gets the switch, Edit and Delete in one row; an admin timelapse gets none', async () => {
    mountScreen(React.createElement(RulesTab), { hub: familyHub() })
    await openTab('Timelapse')
    await dom.findByTestId('rule-row-actions-tl-mine')
    const row = actionRow('tl-mine')
    expect(within(row).getByLabelText('Edit')).toBeTruthy()
    expect(within(row).getByLabelText('Delete')).toBeTruthy()
    expect(within(row).getByText('Enabled')).toBeTruthy()
    // A timelapse sends no notification with snooze buttons.
    expect(within(row).queryByText('Snooze 30 min')).toBeNull()
    expect(dom.getByTestId('rule-row-name-tl-mine').textContent).toBe('Notte garden')
    expect(dom.getByTestId('rule-row-meta-tl-mine').textContent).toContain('Timelapse')
    expect(dom.getByText('Notte admin')).toBeTruthy()
    expect(dom.queryByTestId('rule-row-actions-tl-admin')).toBeNull()
  })

  it('the switch patches ONLY enabled through the timelapse upsert, and shows what the hub holds', async () => {
    mountScreen(React.createElement(RulesTab), { hub: familyHub() })
    await openTab('Timelapse')
    await dom.findByTestId('rule-row-actions-tl-mine')
    await act(async () => {
      fireEvent.click(enabledSwitch('tl-mine'))
    })
    await vi.waitFor(() => expect(upserts('nc.upsertTimelapseRule')).toHaveLength(1))
    expect(upserts('nc.upsertTimelapseRule')[0]).toEqual({ ruleId: 'tl-mine', patch: { enabled: false } })
    await vi.waitFor(() => expect(enabledSwitch('tl-mine').checked).toBe(false))
    // The switch alone says it is off — no second notice in words.
    expect(dom.getByTestId('rule-row-meta-tl-mine').textContent).not.toContain('Off — it will not run.')
  })

  it('a refused switch goes back and says why', async () => {
    mountScreen(React.createElement(RulesTab), { hub: familyHub({ refuse: true }) })
    await openTab('Timelapse')
    await dom.findByTestId('rule-row-actions-tl-mine')
    await act(async () => {
      fireEvent.click(enabledSwitch('tl-mine'))
    })
    const error = await dom.findByTestId('rule-row-enable-error-tl-mine')
    expect(error.textContent).toContain('forbidden: not yours')
    expect(enabledSwitch('tl-mine').checked).toBe(true)
  })
})

describe('a digest card has the same action row', () => {
  it('the switch patches ONLY enabled through the summary upsert', async () => {
    mountScreen(React.createElement(RulesTab), { hub: familyHub() })
    await openTab('Summary')
    await dom.findByTestId('rule-row-actions-sum-mine')
    await act(async () => {
      fireEvent.click(enabledSwitch('sum-mine'))
    })
    await vi.waitFor(() => expect(upserts('nc.upsertSummaryRule')).toHaveLength(1))
    expect(upserts('nc.upsertSummaryRule')[0]).toEqual({ ruleId: 'sum-mine', patch: { enabled: false } })
    await vi.waitFor(() => expect(enabledSwitch('sum-mine').checked).toBe(false))
  })

  it('a hub that still refuses digest writes offers no action row at all', async () => {
    mountScreen(React.createElement(RulesTab), { hub: familyHub({ canAuthor: false }) })
    await openTab('Summary')
    await dom.findByText('Riepilogo notte')
    expect(dom.queryByTestId('rule-row-actions-sum-mine')).toBeNull()
  })
})
