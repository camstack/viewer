/**
 * @vitest-environment jsdom
 *
 * A rule-editor SECTION reached cold — a deep link, a web reload — has no
 * summary under it (final review m7, parked T5).
 *
 *  - Back cannot `back()`: there is nothing to go back to. It replaces the
 *    section with the rule's summary.
 *  - The draft is kept while that summary loads. On web the summary route is a
 *    lazy chunk, so it can mount well after the section is gone; a one-tick
 *    orphan check discarded the operator's edits in that window, and the
 *    summary then opened on the stored rule as if nothing had been typed.
 *  - A section that simply goes away with no summary holding its draft still
 *    drops it — a draft that outlives every screen would come back as
 *    "unsaved changes" on the next open.
 *
 * Untested until now because the router stub's `canGoBack` always said yes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { resetRuleDrafts } from '../../../testing/rule-draft-harness.js'
import { routerCalls, setTestCanGoBack } from '../../../testing/native-stubs/expo-router.js'
import { useNcRuleDraftStore } from '../../../store/nc-rule-draft-store.js'
import { RuleSectionScreen } from '../rule-editor/RuleSectionScreen.js'
import { DRAFT_HANDOFF_GRACE_MS } from '../rule-editor/use-rule-draft.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const RULE = {
  id: 'rule-1',
  name: 'Front door',
  enabled: true,
  delivery: 'immediate',
  conditions: { classes: ['person'] },
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

const HUB = {
  'auth.me': { id: 'u1', username: 'admin', isAdmin: true },
  'addons.custom': (input?: unknown): unknown => {
    const action = actionOf(input)
    if (action === 'nc.listRules') return { rules: [RULE] }
    if (action === 'nc.listMyTargets') {
      return { targets: [{ id: 't1', name: 'Phone', kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} }] }
    }
    if (action === 'nc.getConditionCatalog') return { catalog: [] }
    if (action === 'nc.getRuleAi') return { sections: [] }
    throw new Error(`NOT_FOUND: ${String(action)}`)
  },
}

function storedName(): string | undefined {
  return useNcRuleDraftStore.getState().drafts[RULE.id]?.form.name
}

async function openColdAndEdit(): Promise<void> {
  mountScreen(React.createElement(RuleSectionScreen, { id: RULE.id, section: 'rule' }), { hub: HUB })
  const name = await dom.findByDisplayValue('Front door')
  setTestCanGoBack(false)
  fireEvent.change(name, { target: { value: 'Edited' } })
  expect(storedName()).toBe('Edited')
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  resetRuleDrafts()
})

describe('a rule section opened cold (m7)', () => {
  it('back replaces it with the rule summary instead of popping nothing', async () => {
    await openColdAndEdit()
    fireEvent.click(dom.getByLabelText('Back'))
    const calls = routerCalls()
    expect(calls.some((call) => call.kind === 'back')).toBe(false)
    expect(calls).toContainEqual({ kind: 'replace', target: { pathname: '/rule/[id]', params: { id: RULE.id, kind: 'detection' } } })
  })

  it('keeps the draft while the summary it handed off to is still loading (the web lazy-route window)', async () => {
    await openColdAndEdit()
    fireEvent.click(dom.getByLabelText('Back'))
    // The section is replaced; the summary's chunk has not arrived yet.
    cleanup()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    expect(storedName()).toBe('Edited')
  })

  it('a handed-off draft no summary ever claims is dropped after the grace', async () => {
    await openColdAndEdit()
    fireEvent.click(dom.getByLabelText('Back'))
    vi.useFakeTimers()
    cleanup()
    vi.advanceTimersByTime(DRAFT_HANDOFF_GRACE_MS + 1)
    expect(storedName()).toBeUndefined()
  })

  it('a cold section that just goes away drops its draft', async () => {
    await openColdAndEdit()
    cleanup()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })
    expect(storedName()).toBeUndefined()
  })
})
