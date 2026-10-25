/**
 * @vitest-environment jsdom
 *
 * The Actions sub-screen, mounted over a draft the way the editor holds it.
 *
 * What only a mount can say:
 *  - an argument typed half-way stays EXACTLY as typed in the field and in the
 *    draft (the admin's JSON field drops that keystroke), names its error under
 *    the row, and the save is refused until it parses;
 *  - the Do step labels its device from the hub's fleet listing and offers the
 *    device's own bound capabilities;
 *  - a bindings read that FAILED is said, and the cap becomes free text —
 *    never "this device exposes nothing" (D315);
 *  - a sequence binding and a button name the SHARED sequence they run, by
 *    the name the hub lists; one the hub no longer lists is shown missing and
 *    warned about — never silently re-pointed;
 *  - a sequences read that FAILED is said, and nothing is added pointing at
 *    a sequence nobody could see.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom, within } from '@testing-library/react'
import React, { useState } from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { ActionsSection } from '../rule-editor/sections/ActionsSection.js'
import { emptyRuleForm, ruleFormProblems, type NcRuleFormState } from '../../../components/notifications/rule-editor.js'
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
  onTrigger: [
    {
      editId: 'b1',
      kind: 'do',
      step: {
        editId: 't1',
        kind: 'cap',
        seconds: 0,
        deviceId: 7,
        cap: 'switch',
        method: 'setState',
        args: [{ editId: 'a1', key: 'payload', type: 'json', text: '{"on":true}' }],
      },
    },
    { editId: 'b2', kind: 'sequence', sequenceId: 'seq-siren' },
  ],
  buttons: [{ id: 'b1', label: 'Sound', sequenceId: 'seq-siren' }],
}

const SEQUENCES = {
  sequences: [
    { id: 'seq-siren', name: 'Siren 30s', actions: [{ kind: 'wait', seconds: 30 }] },
    { id: 'seq-lights', name: 'Night lights', actions: [{ kind: 'wait', seconds: 1 }] },
  ],
}

const DEVICES = [{ id: 7, name: 'Garden siren', type: 'siren', location: null }]

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
      // Recorded at the patch, not during render: what the store would now hold.
      latest = { ...draft.form, ...p }
      setDraft((d) => ({ ...d, form: { ...d.form, ...p } }))
    },
    kind: 'detection',
    catalog: [],
    rule: null,
  })
}

const BINDINGS_OK = {
  'deviceManager.getBindings': { entries: [{ capName: 'switch' }, { capName: 'battery' }] },
  'notificationRules.listSequences': SEQUENCES,
}

function mount(hub: Readonly<Record<string, unknown>>): void {
  mountScreen(React.createElement(Harness), {
    hub: { 'deviceManager.listAll': DEVICES, ...hub },
  })
}

function valueField(): HTMLInputElement | HTMLTextAreaElement {
  const node = dom.getByLabelText('Arguments 1: value')
  if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) return node
  throw new Error('not a text control')
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
    mount(BINDINGS_OK)
    expect(await dom.findByText(/run on your devices when the rule is switched on or off, when it fires/)).not.toBeNull()
  })

  it('half-typed JSON stays as typed, names its error, and blocks the save until it parses', async () => {
    mount(BINDINGS_OK)
    await dom.findByText('Garden siren')
    await act(async () => {
      fireEvent.change(valueField(), { target: { value: '{"on":' } })
    })
    expect(valueField().value).toBe('{"on":')
    expect(doStep(latest)?.args[0]?.text).toBe('{"on":')
    // Under the row AND in the problems list.
    expect(dom.getAllByText(/Not valid JSON/).length).toBeGreaterThanOrEqual(2)
    expect(ruleFormProblems(latest, { isAdmin: true })).toContain('actions')

    await act(async () => {
      fireEvent.change(valueField(), { target: { value: '{"on":false}' } })
    })
    expect(dom.queryByText(/Not valid JSON/)).toBeNull()
    expect(ruleFormProblems(latest, { isAdmin: true })).not.toContain('actions')
  })

  it('labels the device from the fleet and offers its bound capabilities', async () => {
    mount(BINDINGS_OK)
    expect(await dom.findByText('Garden siren')).not.toBeNull()
    expect(await dom.findByText('switch')).not.toBeNull()
  })

  it('a step device the fleet no longer has is NAMED removed, kept, and replaceable', async () => {
    mount({ ...BINDINGS_OK, 'deviceManager.listAll': [{ id: 8, name: 'Porch light', type: 'light', location: null }] })
    expect(await dom.findByText('Device #7 — removed')).not.toBeNull()
    await act(async () => {
      fireEvent.click(dom.getByText('Change'))
    })
    await act(async () => {
      fireEvent.click(await dom.findByText('Porch light'))
    })
    expect(doStep(latest)?.deviceId).toBe(8)
    expect(dom.queryByText('Device #7 — removed')).toBeNull()
  })

  it('a fleet listing that FAILED never calls the step device removed', async () => {
    mountScreen(React.createElement(Harness), { hub: BINDINGS_OK })
    expect(await dom.findByText('Device #7')).not.toBeNull()
    expect(dom.queryByText('Device #7 — removed')).toBeNull()
  })

  it('a bindings read that FAILED is said, and the cap is typed instead', async () => {
    mount({})
    expect(await dom.findByText(/capabilities could not be read/)).not.toBeNull()
    expect(dom.queryByText('This device exposes no capability.')).toBeNull()
    expect(dom.getByLabelText('Capability')).not.toBeNull()
  })

  it('a sequence binding and a button name the shared sequence they run', async () => {
    mount(BINDINGS_OK)
    // The binding's picker and the button's picker.
    expect((await dom.findAllByText('Siren 30s')).length).toBe(2)
    expect(dom.queryByText(/no longer exist on the hub/)).toBeNull()
  })

  it('a sequence the hub no longer lists is shown missing and warned — never re-pointed', async () => {
    initial = { ...ACTIONS, buttons: [{ id: 'b1', label: 'Sound', sequenceId: 'seq-gone' }] }
    mount(BINDINGS_OK)
    expect(await dom.findByText('seq-gone (missing)')).not.toBeNull()
    expect(dom.getByText(/no longer exist on the hub: 1/)).not.toBeNull()
    // The save still carries it as stored: the hub decides, the phone does not drop it.
    expect(formToActions(initial).actions?.buttons?.[0]?.sequenceId).toBe('seq-gone')
  })

  it('adding a sequence on an edge binds the first shared sequence, in the hub shape', async () => {
    initial = NC_ACTIONS_EMPTY_FORM
    mount(BINDINGS_OK)
    await dom.findByText(/Sequences are created in the admin console/)
    await act(async () => {
      fireEvent.click(within(hook('onActivation')).getByText('Add sequence'))
    })
    expect(formToActions(latest.actions).actions).toEqual({
      onActivation: [{ kind: 'sequence', sequenceId: 'seq-siren' }],
    })
  })

  it('a sequences read that FAILED is said, and no sequence binding or button can be added', async () => {
    initial = NC_ACTIONS_EMPTY_FORM
    mount({ 'deviceManager.getBindings': BINDINGS_OK['deviceManager.getBindings'] })
    expect(await dom.findByText(/sequences could not be read/)).not.toBeNull()
    await act(async () => {
      fireEvent.click(within(hook('onTrigger')).getByText('Add sequence'))
      fireEvent.click(dom.getByText('Add button'))
    })
    expect(latest.actions.onTrigger).toEqual([])
    expect(latest.actions.buttons).toEqual([])
    // A single action needs no shared sequence.
    await act(async () => {
      fireEvent.click(within(hook('onTrigger')).getByText('Add single action'))
    })
    expect(latest.actions.onTrigger.map((binding) => binding.kind)).toEqual(['do'])
  })
})

function doStep(form: NcRuleFormState) {
  const binding = form.actions.onTrigger[0]
  return binding?.kind === 'do' ? binding.step : undefined
}
