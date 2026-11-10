/**
 * @vitest-environment jsdom
 *
 * The Actions sub-screen, mounted over a draft the way the editor holds it.
 *
 * What only a mount can say: the hook editor offers the Actions `actions.list`
 * returned, by name, and saving the draft stores their ids — including one the
 * hub no longer lists, which stays and is warned about rather than dropped.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom, within } from '@testing-library/react'
import React, { useState } from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { ActionsSection } from '../rule-editor/sections/ActionsSection.js'
import { emptyRuleForm, type NcRuleFormState } from '../../../components/notifications/rule-editor.js'
import {
  NC_ACTIONS_EMPTY_FORM,
  formToActions,
  type NcActionsFormState,
} from '../../../components/notifications/rule-action-form.js'
import type { NcRuleDraft } from '../../../store/nc-rule-draft-store.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const ACTIONS: NcActionsFormState = {
  ...NC_ACTIONS_EMPTY_FORM,
  onTrigger: ['act-siren'],
  buttons: [{ id: 'b1', label: 'Sound', actionId: 'act-siren' }],
}

const LISTED = [
  { id: 'act-siren', name: 'Siren 30s', steps: [{ kind: 'wait', seconds: 30 }] },
  { id: 'act-lights', name: 'Night lights', steps: [{ kind: 'wait', seconds: 1 }] },
]

/** The last form the section patched — what the draft store would hold. */
let latest: NcRuleFormState = emptyRuleForm()
let initial: NcActionsFormState = ACTIONS

function Harness(): React.ReactElement {
  const form = { ...emptyRuleForm(), name: 'r', targetIds: ['t'], actions: initial }
  const [draft, setDraft] = useState<NcRuleDraft>({
    key: 'k',
    kind: 'detection',
    ruleId: 'k',
    baseline: form,
    form,
    ai: null,
    saveAttempted: false,
  })
  return React.createElement(ActionsSection, {
    draft,
    patch: (p: Partial<NcRuleFormState>) => {
      latest = { ...draft.form, ...p }
      setDraft((d) => ({ ...d, form: { ...d.form, ...p } }))
    },
    kind: 'detection',
    catalog: [],
    rule: null,
  })
}

function mount(hub: Readonly<Record<string, unknown>>): void {
  mountScreen(React.createElement(Harness), { hub })
}

afterEach(() => {
  cleanup()
  latest = emptyRuleForm()
  initial = ACTIONS
})

function hook(name: string): HTMLElement {
  return dom.getByTestId(`rule-actions-hook-${name}`)
}

describe('ActionsSection (mounted)', () => {
  it('shows the security note', async () => {
    mount({ 'actions.list': LISTED })
    expect(await dom.findByText(/run on your devices when the rule is switched on or off, when it fires/)).not.toBeNull()
  })

  it('a hook and a button name the Action they run, from actions.list', async () => {
    mount({ 'actions.list': LISTED })
    expect((await dom.findAllByText('Siren 30s')).length).toBe(2)
    expect(dom.queryByText(/no longer exist on the hub/)).toBeNull()
  })

  it('adding an Action on an edge saves that id', async () => {
    initial = NC_ACTIONS_EMPTY_FORM
    mount({ 'actions.list': LISTED })
    await dom.findByText(/Actions are created on the hub/)
    await act(async () => {
      fireEvent.click(within(hook('onActivation')).getByText('Add action'))
    })
    await act(async () => {
      fireEvent.click(await dom.findByText('Night lights'))
    })
    expect(formToActions(latest.actions).actions).toEqual({ onActivation: ['act-lights'] })
  })

  it('an Action the hub no longer lists is shown missing and warned — never re-pointed', async () => {
    initial = { ...ACTIONS, buttons: [{ id: 'b1', label: 'Sound', actionId: 'act-gone' }] }
    mount({ 'actions.list': LISTED })
    expect(await dom.findByText('act-gone (missing)')).not.toBeNull()
    expect(dom.getByText(/no longer exist on the hub: 1/)).not.toBeNull()
    expect(formToActions(initial).actions?.buttons?.[0]?.actionId).toBe('act-gone')
  })

  it('an actions.list read that FAILED is said, and nothing can be added', async () => {
    initial = NC_ACTIONS_EMPTY_FORM
    mount({})
    expect(await dom.findByText(/Actions could not be read/)).not.toBeNull()
    await act(async () => {
      fireEvent.click(within(hook('onTrigger')).getByText('Add action'))
      fireEvent.click(dom.getByText('Add button'))
    })
    expect(latest.actions.onTrigger).toEqual([])
    expect(latest.actions.buttons).toEqual([])
  })
})
