/**
 * @vitest-environment jsdom
 *
 * The digest editor ROUTE (`/summary-rule/[id]`), mounted over the real hooks
 * with only the wire faked (and `usePreventRemove`, mocked so the guard's
 * arming and its let-through-after-save are observable).
 *
 * Carried over from the in-place screen (Task 12 fix round 3): Save waits
 * until it KNOWS who is saving and which targets are his (`save-gate.ts`), and
 * says why while it waits. Added with the route (Task 13):
 *  - an untouched save sends nothing; a rename sends the name alone;
 *  - an emptied caption travels as `clear`, never in the patch;
 *  - a rule still loading is titled "Summary", never "New summary";
 *  - "new" on a hub that refuses the write says so instead of offering a form;
 *  - a read-only rule has no Save;
 *  - the back guard arms on a change and lets the save's own exit through.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { routerCalls } from '../../../testing/native-stubs/expo-router.js'
import { resetStubConnection, setStubConnection } from '../../../testing/connection-stub.js'
import { SummaryEditorScreen } from '../rule-editor/SummaryEditorScreen.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

/** The latest `usePreventRemove` arming and its callback. */
interface GuardState {
  enabled: boolean
  callback: ((event: { readonly data: { readonly action: string } }) => void) | null
}
const guard: GuardState = { enabled: false, callback: null }

vi.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (
    enabled: boolean,
    callback: (event: { readonly data: { readonly action: string } }) => void,
  ): void => {
    guard.enabled = enabled
    guard.callback = callback
  },
}))

const RULE = {
  id: 'sum1',
  name: 'Notte',
  enabled: true,
  deviceIds: [101],
  window: { kind: 'motion', quietSeconds: 120, maxWindowSeconds: 3600 },
  targets: [{ targetId: 't-own' }, { targetId: 't-other' }],
  priority: 3,
  maxTiles: 9,
  maxAiImages: 6,
  rank: 'importance',
  subject: 'tracks',
  barrierSeconds: 120,
  captions: 'all',
  captionText: 'Notte {{from}}',
  deliverEmpty: false,
  createdBy: 'admin',
  createdAt: 1,
  updatedAt: 2,
  readOnly: false,
}

interface HubOptions {
  readonly me?: 'admin' | 'pending' | 'error'
  readonly targetsFail?: boolean
  readonly rule?: Readonly<Record<string, unknown>>
  readonly rulesPending?: boolean
  /** `undefined` = an older hub that says nothing. */
  readonly canAuthor?: boolean
}

function field(input: unknown, key: 'action' | 'input'): unknown {
  if (input === null || typeof input !== 'object') return undefined
  if (key === 'action') return 'action' in input ? input.action : undefined
  return 'input' in input ? input.input : undefined
}

function hub(options: HubOptions = {}): Readonly<Record<string, unknown>> {
  const rule = options.rule ?? RULE
  const canAuthor = 'canAuthor' in options ? options.canAuthor : true
  return {
    'auth.me': (): unknown => {
      if (options.me === 'error') throw new Error('auth.me unreachable')
      if (options.me === 'pending') return new Promise(() => undefined)
      return { id: 'admin', username: 'admin', isAdmin: true }
    },
    'addons.custom': (input?: unknown): unknown => {
      const action = field(input, 'action')
      if (action === 'nc.listSummaryRules') {
        if (options.rulesPending === true) return new Promise(() => undefined)
        return { rules: [rule], ...(canAuthor !== undefined ? { canAuthor } : {}) }
      }
      if (action === 'nc.listMyTargets') {
        if (options.targetsFail === true) throw new Error('targets unreachable')
        return { targets: [{ id: 't-own', name: 'Phone', kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} }] }
      }
      if (action === 'nc.upsertSummaryRule') return { rule }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

function upserts(): readonly unknown[] {
  return hubCalls()
    .filter((call) => field(call.input, 'action') === 'nc.upsertSummaryRule')
    .map((call) => field(call.input, 'input'))
}

async function settle(): Promise<void> {
  await vi.waitFor(() =>
    expect(hubCalls().some((call) => field(call.input, 'action') === 'nc.listMyTargets')).toBe(true),
  )
  await act(async () => {
    await Promise.resolve()
  })
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

async function renameAndSave(options: HubOptions): Promise<void> {
  mountScreen(React.createElement(SummaryEditorScreen, { id: 'sum1' }), { hub: hub(options) })
  const name = await dom.findByDisplayValue('Notte')
  await settle()
  fireEvent.change(name, { target: { value: 'Notte 2' } })
  fireEvent.click(dom.getByText('Save changes'))
  await flush()
}

afterEach(() => {
  cleanup()
  resetStubConnection()
  guard.enabled = false
  guard.callback = null
})

describe('digest editor Save gate (mounted)', () => {
  it('a confirmed admin with an answered list saves — and keeps the other user’s target', async () => {
    await renameAndSave({ me: 'admin' })
    await vi.waitFor(() => expect(upserts()).toHaveLength(1))
    expect(upserts()[0]).toEqual({ ruleId: 'sum1', patch: { name: 'Notte 2' } })
  })

  it('while the ROLE is pending, Save sends nothing and says so', async () => {
    await renameAndSave({ me: 'pending' })
    expect(dom.getByText('Checking your account before saving…')).toBeTruthy()
    expect(upserts()).toEqual([])
  })

  it('when the ROLE read failed, Save sends nothing and says why', async () => {
    await renameAndSave({ me: 'error' })
    await dom.findByText(/Couldn't confirm your account's role/)
    expect(upserts()).toEqual([])
  })

  it('when the TARGETS read failed, Save sends nothing and says why', async () => {
    await renameAndSave({ me: 'admin', targetsFail: true })
    await dom.findByText(/Couldn't load your targets, so this rule can't be saved yet/)
    expect(upserts()).toEqual([])
  })
})

describe('digest editor route (mounted)', () => {
  it('an untouched save sends nothing and leaves', async () => {
    mountScreen(React.createElement(SummaryEditorScreen, { id: 'sum1' }), { hub: hub() })
    await dom.findByDisplayValue('Notte')
    await settle()
    fireEvent.click(dom.getByText('Save changes'))
    await flush()
    expect(upserts()).toEqual([])
    expect(routerCalls().some((call) => call.kind === 'back')).toBe(true)
  })

  it('an emptied caption travels as CLEAR, never in the patch', async () => {
    mountScreen(React.createElement(SummaryEditorScreen, { id: 'sum1' }), { hub: hub() })
    const caption = await dom.findByDisplayValue('Notte {{from}}')
    await settle()
    fireEvent.change(caption, { target: { value: '' } })
    fireEvent.click(dom.getByText('Save changes'))
    await vi.waitFor(() => expect(upserts()).toHaveLength(1))
    expect(upserts()[0]).toEqual({ ruleId: 'sum1', patch: {}, clear: ['captionText'] })
  })

  it('arms the back guard on a change, and lets the save’s own exit through', async () => {
    mountScreen(React.createElement(SummaryEditorScreen, { id: 'sum1' }), { hub: hub() })
    const name = await dom.findByDisplayValue('Notte')
    await settle()
    expect(guard.enabled).toBe(false)
    fireEvent.change(name, { target: { value: 'Notte 2' } })
    expect(guard.enabled).toBe(true)
    fireEvent.click(dom.getByText('Save changes'))
    await vi.waitFor(() => expect(routerCalls().some((call) => call.kind === 'back')).toBe(true))
    act(() => guard.callback?.({ data: { action: 'GO_BACK' } }))
    expect(routerCalls().some((call) => call.kind === 'dispatch' && call.target === 'GO_BACK')).toBe(true)
  })

  it('a rule still loading is titled "Summary", never "New summary"', async () => {
    mountScreen(React.createElement(SummaryEditorScreen, { id: 'sum1' }), { hub: hub({ rulesPending: true }) })
    await dom.findByText('Summary')
    expect(dom.queryByText('New summary')).toBeNull()
  })

  it('"new" on a hub that refuses the write says so — no form, no Save', async () => {
    mountScreen(React.createElement(SummaryEditorScreen, { id: 'new' }), { hub: hub({ canAuthor: undefined }) })
    await dom.findByText(/only lets an administrator create summaries/)
    expect(dom.queryByText('Create')).toBeNull()
  })

  it('a read-only rule has no Save', async () => {
    mountScreen(React.createElement(SummaryEditorScreen, { id: 'sum1' }), {
      hub: hub({ rule: { ...RULE, readOnly: true } }),
    })
    await dom.findByText(/managed by an admin/)
    expect(dom.queryByText('Save changes')).toBeNull()
  })

  it('a rule stored with NO caption says so, instead of promising the default', async () => {
    mountScreen(React.createElement(SummaryEditorScreen, { id: 'sum1' }), {
      hub: hub({ rule: { ...RULE, captionText: '' } }),
    })
    await dom.findByText(/set to show no caption at all/)
  })
})

describe('digest editor with no hub answer (review m1/m6, D315)', () => {
  it('DISCONNECTED: waits with a spinner — never "not found" or "hub too old", and no connection words of its own', async () => {
    setStubConnection({ state: 'offline' })
    mountScreen(React.createElement(SummaryEditorScreen, { id: 'sum1' }), { hub: hub() })
    await dom.findByRole('progressbar')
    // The hub connection is stated once, by the root overlay — not by a page.
    expect(dom.queryByText('Connecting…')).toBeNull()
    expect(dom.queryByText(/not found|no longer exists/i)).toBeNull()
    expect(dom.queryByText(/only lets an administrator/)).toBeNull()
  })

  it('"new" while disconnected is not refused as an old hub', async () => {
    setStubConnection({ state: 'offline' })
    mountScreen(React.createElement(SummaryEditorScreen, { id: 'new' }), { hub: hub() })
    await dom.findByRole('progressbar')
    expect(dom.queryByText(/only lets an administrator/)).toBeNull()
  })

  it('connected but with NO system: a failure, not an answered empty list', async () => {
    setStubConnection({ hasSystem: false })
    mountScreen(React.createElement(SummaryEditorScreen, { id: 'new' }), { hub: hub() })
    await dom.findByText(/Couldn't load this summary/)
    expect(dom.queryByText(/only lets an administrator/)).toBeNull()
  })
})
