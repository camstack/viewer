/**
 * @vitest-environment jsdom
 *
 * The timelapse editor ROUTE, mounted over the real hooks with only the wire
 * faked (and `usePreventRemove`, which the harness does not stub — mocked here
 * so the guard's ARMING and its let-through-after-save are observable).
 *
 * What only a mount can say:
 *  - an admin's untouched save of a GLOBAL rule that delivers to another
 *    user's target sends NOTHING, a rename sends no `targets`, and the picker
 *    says the foreign target is kept (review I1);
 *  - Save is disabled, and SAYS why, when the targets list failed (M2);
 *  - a read-only rule has no Save;
 *  - a loading rule is not titled "New timelapse" (M4);
 *  - a stored "no caption" rule gets the hint that says so (M3);
 *  - the back guard arms on a change and lets the save's own exit through;
 *  - a NON-admin's save drops a target he no longer has (the hub would refuse
 *    it), and says so; while the role is unknown, Save waits (fix round 2).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { routerCalls } from '../../../testing/native-stubs/expo-router.js'
import { TimelapseEditorScreen } from '../rule-editor/TimelapseEditorScreen.js'

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

const SHARED_RULE = {
  id: 'tl1',
  name: 'Notte',
  enabled: true,
  deviceIds: [101],
  schedule: { windows: [{ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 1320, endMinute: 360 }] },
  cadenceSec: 15,
  framerate: 10,
  previewMode: 'image',
  targets: [{ targetId: 't-admin' }, { targetId: 't-user', params: { sound: 'siren' } }],
  priority: 3,
  createdBy: 'admin',
  createdAt: 1,
  updatedAt: 2,
  readOnly: false,
}

const MY_TARGETS = {
  targets: [{ id: 't-admin', name: 'Admin phone', kind: 'pushover', addonId: 'notifiers', enabled: true, config: {} }],
}

function field(input: unknown, key: 'action' | 'input'): unknown {
  if (input === null || typeof input !== 'object') return undefined
  if (key === 'action') return 'action' in input ? input.action : undefined
  return 'input' in input ? input.input : undefined
}

interface HubOptions {
  readonly rule?: Readonly<Record<string, unknown>>
  readonly targetsFail?: boolean
  readonly rulesPending?: boolean
  /** Who `auth.me` says the caller is; `pending` never answers. */
  readonly me?: 'admin' | 'user' | 'pending' | 'error'
}

function hub(options: HubOptions = {}): Readonly<Record<string, unknown>> {
  const rule = options.rule ?? SHARED_RULE
  return {
    'auth.me': (): unknown => {
      if (options.me === 'error') throw new Error('auth.me unreachable')
      return options.me === 'pending'
        ? new Promise(() => undefined)
        : { id: 'u1', username: 'operator', isAdmin: (options.me ?? 'admin') === 'admin' }
    },
    'addons.custom': (input?: unknown): unknown => {
      const action = field(input, 'action')
      if (action === 'nc.listTimelapseRules') {
        return options.rulesPending ? new Promise(() => undefined) : { rules: [rule] }
      }
      if (action === 'nc.listMyTargets') {
        if (options.targetsFail) throw new Error('targets unreachable')
        return MY_TARGETS
      }
      if (action === 'nc.upsertTimelapseRule') return { rule }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

function upserts(): readonly unknown[] {
  return hubCalls()
    .filter((call) => field(call.input, 'action') === 'nc.upsertTimelapseRule')
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

afterEach(() => {
  cleanup()
  guard.enabled = false
  guard.callback = null
})

describe('timelapse editor (mounted)', () => {
  it('an untouched save of a GLOBAL rule with another user’s target sends nothing', async () => {
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), { hub: hub() })
    await dom.findByDisplayValue('Notte')
    await settle()
    // The foreign target is not listed, but it is SAID.
    await dom.findByText(/Targets not in your list, kept on this rule: 1/)
    fireEvent.click(dom.getByText('Save changes'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(upserts()).toEqual([])
    expect(routerCalls().some((call) => call.kind === 'back')).toBe(true)
  })

  it('a rename sends the name and NO targets — the foreign target survives', async () => {
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), { hub: hub() })
    const name = await dom.findByDisplayValue('Notte')
    await settle()
    fireEvent.change(name, { target: { value: 'Notte 2' } })
    fireEvent.click(dom.getByText('Save changes'))
    await vi.waitFor(() => expect(upserts()).toHaveLength(1))
    expect(upserts()[0]).toEqual({ ruleId: 'tl1', patch: { name: 'Notte 2' } })
  })

  it('arms the back guard on a change, and lets the save’s own exit through', async () => {
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), { hub: hub() })
    const name = await dom.findByDisplayValue('Notte')
    await settle()
    expect(guard.enabled).toBe(false)
    fireEvent.change(name, { target: { value: 'Notte 2' } })
    expect(guard.enabled).toBe(true)
    fireEvent.click(dom.getByText('Save changes'))
    await vi.waitFor(() => expect(routerCalls().some((call) => call.kind === 'back')).toBe(true))
    // The removal the save started reaches the guard, which lets it through
    // without asking.
    act(() => guard.callback?.({ data: { action: 'GO_BACK' } }))
    expect(routerCalls().some((call) => call.kind === 'dispatch' && call.target === 'GO_BACK')).toBe(true)
  })

  it('when the targets list FAILS, Save is disabled and the screen says why', async () => {
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), { hub: hub({ targetsFail: true }) })
    await dom.findByText(/Couldn't load your targets, so this rule can't be saved yet/)
    fireEvent.click(dom.getByText('Save changes'))
    expect(upserts()).toEqual([])
  })

  it('a read-only rule has no Save', async () => {
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), {
      hub: hub({ rule: { ...SHARED_RULE, readOnly: true } }),
    })
    await dom.findByText(/managed by an admin/)
    expect(dom.queryByText('Save changes')).toBeNull()
  })

  it('a rule still loading is not titled "New timelapse"', async () => {
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), { hub: hub({ rulesPending: true }) })
    await dom.findByText('Timelapse')
    expect(dom.queryByText('New timelapse')).toBeNull()
  })

  it('a rule stored with NO caption says so, instead of promising the default', async () => {
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), {
      hub: hub({ rule: { ...SHARED_RULE, previewText: '' } }),
    })
    await dom.findByText(/set to show no caption at all/)
    expect(dom.queryByText(/Empty means the default caption/)).toBeNull()
  })

  it('a NON-admin rename drops the target he no longer has, and the picker says so', async () => {
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), {
      hub: hub({ me: 'user', rule: { ...SHARED_RULE, targets: [{ targetId: 't-admin' }, { targetId: 't-gone' }] } }),
    })
    const name = await dom.findByDisplayValue('Notte')
    await settle()
    await dom.findByText(/removed when you save: 1/)
    fireEvent.change(name, { target: { value: 'Notte 2' } })
    fireEvent.click(dom.getByText('Save changes'))
    await vi.waitFor(() => expect(upserts()).toHaveLength(1))
    expect(upserts()[0]).toEqual({
      ruleId: 'tl1',
      patch: { name: 'Notte 2', targets: [{ targetId: 't-admin' }] },
    })
  })

  it('while the caller\'s role is unknown, Save sends nothing', async () => {
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), { hub: hub({ me: 'pending' }) })
    const name = await dom.findByDisplayValue('Notte')
    await settle()
    fireEvent.change(name, { target: { value: 'Notte 2' } })
    fireEvent.click(dom.getByText('Save changes'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(upserts()).toEqual([])
    expect(routerCalls().some((call) => call.kind === 'back')).toBe(false)
  })

  it('when the ROLE read FAILED, Save sends nothing and says why (fix round 3)', async () => {
    // A failed `auth.me` is not "not admin" for a save: a real admin saving as
    // a user would drop other users' targets.
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), { hub: hub({ me: 'error' }) })
    const name = await dom.findByDisplayValue('Notte')
    await settle()
    await dom.findByText(/Couldn't confirm your account's role/)
    fireEvent.change(name, { target: { value: 'Notte 2' } })
    fireEvent.click(dom.getByText('Save changes'))
    await act(async () => {
      await Promise.resolve()
    })
    expect(upserts()).toEqual([])
  })

  it('a NON-admin whose only stored target is gone is told to pick one — nothing is sent (final review m3)', async () => {
    // His save would drop `t-gone` (not his) and send `targets: []`; the hub
    // refuses that in raw English. The form counts what the save SENDS.
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), {
      hub: hub({ me: 'user', rule: { ...SHARED_RULE, targets: [{ targetId: 't-gone' }] } }),
    })
    const name = await dom.findByDisplayValue('Notte')
    await settle()
    fireEvent.change(name, { target: { value: 'Notte 2' } })
    fireEvent.click(dom.getByText('Save changes'))
    await dom.findByText('Pick at least one target.')
    expect(upserts()).toEqual([])
  })
})
