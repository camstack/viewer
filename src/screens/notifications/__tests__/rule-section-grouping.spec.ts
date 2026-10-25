/**
 * @vitest-environment jsdom
 *
 * "Immediate, grouped" in the phone's Rule section (D692 §10), through the REAL
 * sub-screens over the real draft hook. Only the wire is faked.
 *
 * Every absence is asserted beside a positive control reached by the same wait
 * (the Trigger control itself, or the grouped segment on the sibling rule).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, within, type RenderResult } from '@testing-library/react'
import React, { useEffect } from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { resetRuleDrafts } from '../../../testing/rule-draft-harness.js'
import { NcViewerRuleSchema, type NcViewerRule } from '../../../data/notification-center.js'
import { useRuleDraft, type UseRuleDraft } from '../rule-editor/use-rule-draft.js'
import { RuleSection } from '../rule-editor/sections/RuleSection.js'
import { AdvancedSection } from '../rule-editor/sections/AdvancedSection.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const TARGET_NAME = 'Phone (pushover)'
const GROUPED = 'Immediate, grouped'
const SECONDS = 'Group for (seconds)'
const MIN_NOTE = 'At least 5 s: subjects arriving together share one message.'
const PLAIN_HINT = /Fires only if the name is already known/
const SCOPED_HINT = /not recognised within \d+ s is not notified/

function makeRule(overrides: Record<string, unknown> = {}): NcViewerRule {
  return NcViewerRuleSchema.parse({
    id: 'rule-1',
    name: 'Front door',
    enabled: true,
    delivery: 'immediate',
    conditions: { classes: ['person'] },
    targets: [{ targetId: 'tgt-a' }],
    media: { attach: 'best' },
    priority: 3,
    createdBy: 'me',
    createdAt: 10,
    updatedAt: 20,
    disabledTargetIds: [],
    readOnly: false,
    ...overrides,
  })
}

function actionOf(input: unknown): string {
  if (input === null || typeof input !== 'object' || !('action' in input)) return ''
  const action: unknown = { ...input }['action']
  return typeof action === 'string' ? action : ''
}

function hub(rule: NcViewerRule) {
  return {
    'auth.me': (): unknown => ({ id: 'u1', username: 'operator', isAdmin: false }),
    'addons.custom': (input?: unknown): unknown => {
      const action = actionOf(input)
      if (action === 'nc.listRules') return { rules: [rule] }
      if (action === 'nc.listMyTargets') {
        return { targets: [{ id: 'tgt-a', name: TARGET_NAME, kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} }] }
      }
      if (action === 'nc.getConditionCatalog') return { catalog: [] }
      if (action === 'nc.getRuleAi') return { sections: [] }
      throw new Error(`NOT_FOUND: ${action}`)
    },
  }
}

let latest: UseRuleDraft | null = null

function Editor({ ruleId }: { readonly ruleId: string }): React.ReactElement | null {
  const editor = useRuleDraft({ id: ruleId })
  useEffect(() => {
    latest = editor
  })
  if (editor.status !== 'ready' || !editor.draft || !editor.kind) return null
  const props = { draft: editor.draft, patch: editor.patch, kind: editor.kind, catalog: [], rule: editor.rule }
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(RuleSection, props),
    React.createElement(AdvancedSection, props),
  )
}

async function open(rule: NcViewerRule): Promise<RenderResult> {
  const screen = mountScreen(React.createElement(Editor, { ruleId: rule.id }), { hub: hub(rule) })
  await screen.findByText(TARGET_NAME)
  return screen
}

async function press(el: Element): Promise<void> {
  await act(async () => {
    fireEvent.click(el)
  })
}

/** The segment button labelled `label` (the control is a row of buttons). */
function segment(screen: RenderResult, label: string): HTMLElement {
  return screen.getByRole('button', { name: label })
}

/** The `+` / `−` of the stepper row labelled `label` (second / first button). */
function stepperButton(screen: RenderResult, label: string, which: 0 | 1): HTMLElement {
  let row: HTMLElement | null = screen.getByText(label)
  while (row !== null && within(row).queryAllByRole('button').length < 2) row = row.parentElement
  if (row === null) throw new Error(`no stepper for ${label}`)
  return within(row).getAllByRole('button')[which]
}

afterEach(() => {
  cleanup()
  resetRuleDrafts()
  latest = null
})

describe('the Trigger choice of a detection rule', () => {
  it('offers Immediate · Immediate, grouped · Track end', async () => {
    const screen = await open(makeRule())
    expect(screen.queryByText('Trigger')).not.toBeNull()
    expect(segment(screen, 'Immediate')).toBeTruthy()
    expect(segment(screen, GROUPED)).toBeTruthy()
    expect(segment(screen, 'Track end')).toBeTruthy()
  })

  it('choosing grouped shows the stepper at 20, the hint naming 20 s and the minimum note', async () => {
    const screen = await open(makeRule())
    expect(screen.queryByText(SECONDS)).toBeNull()
    await press(segment(screen, GROUPED))
    expect(screen.queryByText(SECONDS)).not.toBeNull()
    expect(latest?.draft?.form.groupingSec).toBe(20)
    expect(latest?.draft?.form.delivery).toBe('immediate')
    expect(within(stepperButton(screen, SECONDS, 0).parentElement ?? document.body).getByText('20')).toBeTruthy()
    expect(screen.queryByText(/waits up to 20 s for subjects to be recognised/)).not.toBeNull()
    expect(screen.queryByText(MIN_NOTE)).not.toBeNull()
  })

  it('the stepper walks 5..60 and stops at the bounds', async () => {
    const screen = await open(makeRule({ groupingSec: 60 }))
    expect(stepperButton(screen, SECONDS, 1).hasAttribute('disabled')).toBe(true)
    for (let i = 0; i < 20; i += 1) await press(stepperButton(screen, SECONDS, 0))
    expect(latest?.draft?.form.groupingSec).toBe(5)
    expect(stepperButton(screen, SECONDS, 0).hasAttribute('disabled')).toBe(true)
  })

  it('a stored grouped rule opens on the grouped segment', async () => {
    const screen = await open(makeRule({ groupingSec: 30 }))
    expect(screen.queryByText(SECONDS)).not.toBeNull()
    expect(latest?.draft?.form.delivery).toBe('immediate')
    expect(latest?.draft?.form.groupingSec).toBe(30)
  })

  it('moving back to Immediate or Track end forgets the window and hides the stepper', async () => {
    const screen = await open(makeRule({ groupingSec: 30 }))
    await press(segment(screen, 'Track end'))
    expect(latest?.draft?.form.delivery).toBe('track-end')
    expect(latest?.draft?.form.groupingSec).toBeUndefined()
    expect(screen.queryByText(SECONDS)).toBeNull()
    await press(segment(screen, GROUPED))
    expect(latest?.draft?.form.groupingSec).toBe(20)
    await press(segment(screen, 'Immediate'))
    expect(latest?.draft?.form.groupingSec).toBeUndefined()
  })
})

describe('the hints that depend on recognition', () => {
  const FACES = { conditions: { classes: ['person'], identities: [] } }

  it('plain Immediate with a name scope says it fires only if the name is already known', async () => {
    const screen = await open(makeRule(FACES))
    expect(screen.queryByText(PLAIN_HINT)).not.toBeNull()
    expect(screen.queryByText(SCOPED_HINT)).toBeNull()
  })

  it('grouped with a name scope says a subject not recognised in time is not notified', async () => {
    const screen = await open(makeRule({ ...FACES, groupingSec: 20 }))
    expect(screen.queryByText(SCOPED_HINT)).not.toBeNull()
    expect(screen.queryByText(PLAIN_HINT)).toBeNull()
  })

  it('no name scope, no recognition hint (positive control: the grouped hint is drawn)', async () => {
    const screen = await open(makeRule({ groupingSec: 20 }))
    expect(screen.queryByText(/waits up to 20 s/)).not.toBeNull()
    expect(screen.queryByText(SCOPED_HINT)).toBeNull()
    expect(screen.queryByText(PLAIN_HINT)).toBeNull()
  })
})

describe('where the choice is NOT offered', () => {
  it('a SOUND rule has no grouped choice and no stepper', async () => {
    const screen = await open(
      makeRule({ conditions: { audio: { hitPercent: 50, samplingSeconds: 5, dbThreshold: -40 } } }),
    )
    // Positive control: the same Rule section is drawn.
    expect(screen.queryByText('Cooldown (s)')).not.toBeNull()
    expect(screen.queryByRole('button', { name: GROUPED })).toBeNull()
    expect(screen.queryByText(SECONDS)).toBeNull()
  })

  it('a SENSOR rule has none either', async () => {
    const screen = await open(makeRule({ delivery: 'device-event', conditions: {} }))
    expect(screen.queryByRole('button', { name: GROUPED })).toBeNull()
    expect(screen.queryByText(SECONDS)).toBeNull()
  })
})

describe('Advanced no longer carries the two retired controls', () => {
  it('has no burst-grouping stepper and no wait-for-recognition switch (positive control: Cooldown)', async () => {
    const screen = await open(makeRule({ conditions: { classes: ['person'], identities: [] } }))
    expect(screen.queryByText('Cooldown (s)')).not.toBeNull()
    expect(screen.queryByText('Group bursts (s)')).toBeNull()
    expect(screen.queryByText('Wait for recognition')).toBeNull()
  })
})
