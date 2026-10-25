/**
 * @vitest-environment jsdom
 *
 * The prune banner, mounted in the timelapse editor over the real hooks with
 * only the wire faked. A timelapse whose last camera was deleted is KEPT with
 * that camera and switched off by the hub; the editor must say why — and must
 * say nothing it was not told (D315): not for a non-admin (the action is
 * admin-only), not for a rule that is back on, not on a refused read.
 *
 * No test sleeps. A "nothing was asked / nothing is shown" assertion is made
 * only once the thing that gates it has SETTLED, read off a probe mounted
 * beside the screen over the same query cache: the admin verdict for the
 * non-admin and back-on cases, the prunes read itself for the refused one.
 * A wall-clock pause there proved nothing on a fast run and flaked on a
 * loaded one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen as dom } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { TimelapseEditorScreen } from '../rule-editor/TimelapseEditorScreen.js'
import { useAdminVerdict } from '../../../data/use-me.js'
import { useNcPrunes } from '../../../data/use-notification-center.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

vi.mock('expo-router/react-navigation', () => ({
  usePreventRemove: (): void => undefined,
}))

const DISABLED_RULE = {
  id: 'tl1',
  name: 'Notte',
  enabled: false,
  deviceIds: [102],
  schedule: { windows: [{ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 1320, endMinute: 360 }] },
  cadenceSec: 15,
  framerate: 10,
  previewMode: 'image',
  targets: [{ targetId: 't-admin' }],
  priority: 3,
  createdBy: 'admin',
  createdAt: 1,
  updatedAt: 2,
  readOnly: false,
}

const PRUNE = {
  kind: 'timelapse',
  ruleId: 'tl1',
  subjectKind: 'device',
  subject: '102',
  field: 'deviceIds',
  outcome: 'kept-disabled',
  at: Date.UTC(2026, 8, 25, 12),
  source: 'event',
}

function field(input: unknown, key: 'action'): unknown {
  if (input === null || typeof input !== 'object') return undefined
  return key in input ? Reflect.get(input, key) : undefined
}

interface HubOptions {
  readonly me?: 'admin' | 'user'
  readonly enabled?: boolean
  readonly prunesFail?: boolean
}

function hub(options: HubOptions = {}): Readonly<Record<string, unknown>> {
  return {
    'auth.me': (): unknown => ({
      id: 'u1',
      username: 'operator',
      isAdmin: (options.me ?? 'admin') === 'admin',
    }),
    'addons.custom': (input?: unknown): unknown => {
      const action = field(input, 'action')
      if (action === 'nc.listTimelapseRules') {
        return { rules: [{ ...DISABLED_RULE, enabled: options.enabled ?? false }] }
      }
      if (action === 'nc.listMyTargets') return { targets: [] }
      if (action === 'nc.listPrunes') {
        if (options.prunesFail) throw new Error('forbidden: admin required')
        return { prunes: [PRUNE] }
      }
      throw new Error(`NOT_FOUND: ${String(action)}`)
    },
  }
}

function asked(): boolean {
  return hubCalls().some((call) => field(call.input, 'action') === 'nc.listPrunes')
}

/** Generous: a loaded CI box is slow to first render, and a wait ends on the answer anyway. */
const SETTLE = { timeout: 5_000 }

/** Draws the admin verdict the banner's gate reads, over the same cache. */
function VerdictProbe(): React.ReactElement {
  return React.createElement('span', { 'data-testid': 'probe-verdict' }, useAdminVerdict())
}

/** Draws the prunes read's status (asks it: use only where asking is expected). */
function PrunesProbe(): React.ReactElement {
  return React.createElement('span', { 'data-testid': 'probe-prunes' }, useNcPrunes(true).status)
}

function mountEditor(options: HubOptions, probe: () => React.ReactElement): void {
  mountScreen(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(TimelapseEditorScreen, { id: 'tl1' }),
      React.createElement(probe),
    ),
    { hub: hub(options) },
  )
}

/** Let every effect the last answer scheduled run — a query it enabled starts here. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
})

describe('prune banner (mounted in the timelapse editor)', () => {
  it('says why a disabled timelapse was switched off', async () => {
    mountScreen(React.createElement(TimelapseEditorScreen, { id: 'tl1' }), { hub: hub() })
    const banner = await dom.findByTestId('nc-prune-banner', {}, SETTLE)
    expect(banner.textContent).toMatch(/\(#102\)/)
  })

  it('a non-admin is never asked about, and sees nothing', async () => {
    mountEditor({ me: 'user' }, VerdictProbe)
    await dom.findByDisplayValue('Notte', {}, SETTLE)
    await vi.waitFor(() => expect(dom.getByTestId('probe-verdict').textContent).toBe('not-admin'), SETTLE)
    await flush()
    expect(asked()).toBe(false)
    expect(dom.queryByTestId('nc-prune-banner')).toBeNull()
  })

  it('a rule that is back on shows nothing and asks nothing', async () => {
    mountEditor({ enabled: true }, VerdictProbe)
    await dom.findByDisplayValue('Notte', {}, SETTLE)
    // An ADMIN: the only thing keeping the read off is that the rule is on.
    await vi.waitFor(() => expect(dom.getByTestId('probe-verdict').textContent).toBe('admin'), SETTLE)
    await flush()
    expect(asked()).toBe(false)
    expect(dom.queryByTestId('nc-prune-banner')).toBeNull()
  })

  it('a refused read renders nothing', async () => {
    mountEditor({ prunesFail: true }, PrunesProbe)
    await dom.findByDisplayValue('Notte', {}, SETTLE)
    await vi.waitFor(() => expect(dom.getByTestId('probe-prunes').textContent).toBe('error'), SETTLE)
    await flush()
    expect(asked()).toBe(true)
    expect(dom.queryByTestId('nc-prune-banner')).toBeNull()
  })
})
