/**
 * @vitest-environment jsdom
 *
 * Right side of a row: multi-action controls are icon-only groups.
 * The lock's Open door exists only with the feature; a pet fountain keeps its
 * pump toggle beside its timer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen as dom, within } from '@testing-library/react'
import React from 'react'
import type { HeroControl } from '@dominevo/types'
import { mountScreen } from '../../../../testing/mount.js'
import { hubCalls } from '../../../../testing/hub-stub.js'
import { AccessoryControl } from '../AccessoryControl.js'
import { HeroToggleSegments } from '../../../../hero/HeroToggleSegments.js'
import type { AccessoryDevice } from '../../../../data/use-accessories.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const HUB = {
  'auth.me': { id: 'u1', username: 'operator', isAdmin: true },
  'lockControl.getStatus': { state: 'locked' },
  'cover.getStatus': { state: 'open', position: 40 },
  'brightness.getStatus': { on: true, brightness: 50 },
  'switch.getStatus': { on: false },
  'timedRun.getStatus': { activeUntil: null, requestedBy: null, quickRun: { duration: 30, unit: 'min' }, lastFetchedAt: 1 },
}

const device = (type: string, features: readonly string[]): AccessoryDevice =>
  ({ id: 7, name: 'd', type, online: true, features }) as AccessoryDevice

describe('lock group', () => {
  it('has Lock and Unlock only when the lock cannot release its latch', async () => {
    mountScreen(React.createElement(AccessoryControl, { device: device('lock', ['lock']) }), { hub: HUB })
    const group = await dom.findByRole('toolbar')
    expect(within(group).getAllByRole('button')).toHaveLength(2)
    expect(dom.queryByRole('button', { name: 'Open door' })).toBeNull()
  })
  it('adds Open door with the lock-open feature', async () => {
    mountScreen(React.createElement(AccessoryControl, { device: device('lock', ['lock', 'lock-open']) }), { hub: HUB })
    const group = await dom.findByRole('toolbar')
    expect(await within(group).findByRole('button', { name: 'Open door' })).toBeTruthy()
    expect(within(group).getAllByRole('button')).toHaveLength(3)
  })
  it('Open door needs a second tap: the first only arms', async () => {
    mountScreen(React.createElement(AccessoryControl, { device: device('lock', ['lock', 'lock-open']) }), { hub: HUB })
    const open = await dom.findByRole('button', { name: 'Open door' })
    const opens = (): number => hubCalls().filter((c) => c.path === 'lockControl.open').length
    fireEvent.click(open)
    await new Promise((r) => setTimeout(r, 30))
    expect(opens()).toBe(0)
    fireEvent.click(dom.getByRole('button', { name: 'Open door' }))
    await new Promise((r) => setTimeout(r, 30))
    expect(opens()).toBe(1)
  })
})

describe('icon groups', () => {
  it('a cover is one group: up, stop, down', async () => {
    mountScreen(React.createElement(AccessoryControl, { device: device('cover', ['cover']) }), { hub: HUB })
    const group = await dom.findByRole('toolbar')
    expect(within(group).getAllByRole('button')).toHaveLength(3)
  })
  it('a dimmable light is one group: on/off, down, up', async () => {
    mountScreen(React.createElement(AccessoryControl, { device: device('light', ['switch', 'brightness']) }), { hub: HUB })
    const group = await dom.findByRole('toolbar')
    expect(within(group).getAllByRole('button')).toHaveLength(3)
  })
  it('a plain switch stays a single control, no group', async () => {
    mountScreen(React.createElement(AccessoryControl, { device: device('switch', ['switch']) }), { hub: HUB })
    await dom.findByRole('button', { name: 'Off' })
    expect(dom.queryByRole('toolbar')).toBeNull()
  })
  it('a switch with a timed run is one group: power and timer', async () => {
    mountScreen(React.createElement(AccessoryControl, { device: device('switch', ['switch', 'timed-run']) }), { hub: HUB })
    const group = await dom.findByRole('toolbar')
    await within(group).findByRole('button', { name: 'Run 30 min' })
    expect(within(group).getAllByRole('button')).toHaveLength(2)
  })
})

describe('pet fountain', () => {
  const pump: HeroControl = {
    kind: 'toggle',
    id: 'fountain.pump',
    label: { en: 'Pump', it: 'Pompa' },
    on: true,
    turnOn: { id: 'fountain.pump.on', label: { en: 'Pump on', it: 'Pompa on' }, icon: 'power', call: { cap: 'fountain', method: 'on', args: {} }, emphasis: 'normal', confirm: null },
    turnOff: { id: 'fountain.pump.off', label: { en: 'Pump off', it: 'Pompa off' }, icon: 'power', call: { cap: 'fountain', method: 'off', args: {} }, emphasis: 'normal', confirm: null },
  }
  it('shows the pump toggle AND the timer in one group', async () => {
    const leading = React.createElement(HeroToggleSegments, { deviceId: 7, online: true, controls: [pump] })
    mountScreen(React.createElement(AccessoryControl, { device: device('pet-fountain', ['timed-run']), leading }), { hub: HUB })
    const group = await dom.findByRole('toolbar')
    await within(group).findByRole('button', { name: 'Run 30 min' })
    expect(within(group).getByRole('button', { name: 'Pump off' })).toBeTruthy()
    fireEvent.click(within(group).getByRole('button', { name: 'Pump off' }))
  })
})
