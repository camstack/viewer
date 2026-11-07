/**
 * @vitest-environment jsdom
 *
 * AccessoryControl with the timed-run pill: a row WITHOUT the cap renders as it
 * always did (no timedRun read), a heater advertising it shows the pill.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen as dom } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../../testing/mount.js'
import { hubCalls } from '../../../../testing/hub-stub.js'
import { AccessoryControl } from '../AccessoryControl.js'
import type { AccessoryDevice } from '../../../../data/use-accessories.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const HUB = {
  'auth.me': { id: 'u1', username: 'operator', isAdmin: true },
  'switch.getStatus': { on: false },
  'motionTrigger.getStatus': { enabled: false },
  'timedRun.getStatus': { activeUntil: null, requestedBy: null, quickRun: { duration: 30, unit: 'min' }, lastFetchedAt: 1 },
}

function device(type: string, features: readonly string[]): AccessoryDevice {
  return { id: 7, name: 'd', type, online: true, features } as AccessoryDevice
}

function timedRunCalls(): number {
  return hubCalls().filter((c) => c.path.startsWith('timedRun.')).length
}

async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 30))
}

describe('AccessoryControl — timed-run pill', () => {
  it('a switch row without the cap: its pill, no timedRun call', async () => {
    mountScreen(React.createElement(AccessoryControl, { device: device('switch', ['switch']) }), { hub: HUB })
    await dom.findByRole('button', { name: 'Off' })
    await settle()
    expect(dom.queryByRole('button', { name: /^Run / })).toBeNull()
    expect(timedRunCalls()).toBe(0)
  })

  it('a motion-only row without the cap: just the toggle, no timedRun call', async () => {
    mountScreen(React.createElement(AccessoryControl, { device: device('generic', ['motion-trigger']) }), { hub: HUB })
    await dom.findByRole('button', { name: 'On motion' })
    await settle()
    expect(dom.getAllByRole('button')).toHaveLength(1)
    expect(timedRunCalls()).toBe(0)
  })

  it('a heater advertising timed-run shows the quick-run pill', async () => {
    mountScreen(React.createElement(AccessoryControl, { device: device('heater', ['timed-run']) }), { hub: HUB })
    await dom.findByRole('button', { name: 'Run 30 min' })
  })
})
