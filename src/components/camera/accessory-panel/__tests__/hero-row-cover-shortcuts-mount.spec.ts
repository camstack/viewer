/**
 * @vitest-environment jsdom
 *
 * A hero row (the hub's row model is in) draws the SAME inline control the
 * legacy row drew: a cover's up / stop / down with the lit rule, a lock's two
 * pills, an update's Install pill, and a switch's timed-run pill. A device whose
 * control is only the model's (a camera, a plain sensor) still draws the model.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import React from 'react'
import type { HeroRowModel } from '@camstack/types'
import { mountScreen } from '../../../../testing/mount.js'
import { AccessoryRow } from '../AccessoryRow.js'
import type { AccessoryPanelRow } from '../../../../accessories/accessory-panel-rows.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => cleanup())

const modelPill = {
  kind: 'action' as const,
  action: {
    id: 'model-pill',
    label: { en: 'Model pill', it: 'Model pill' },
    icon: 'power' as const,
    call: { cap: 'x', method: 'y', args: {} },
    emphasis: 'normal' as const,
    confirm: null,
  },
}

const model = (type: string): HeroRowModel => ({
  deviceId: 9,
  name: 'Device',
  type,
  state: 'on',
  stateAssumed: false,
  look: { icon: 'blinds', tone: 'muted', background: 'plain', animation: 'none' },
  scene: { id: 'cover', mode: null, level: null },
  statusLine: [{ en: 'Status', it: 'Status' }],
  primary: modelPill,
  timedRun: null,
  trailing: null,
})

const row = (type: string, features: readonly string[]): AccessoryPanelRow => ({
  device: { id: 9, name: 'Device', type, online: true, features, location: null, role: null, displayIcon: null },
  origin: 'server',
  label: 'Device',
  iconKey: 'blinds',
  hidden: false,
})

function mountRow(type: string, hub: Record<string, unknown>, features: readonly string[] = []) {
  mountScreen(
    React.createElement(AccessoryRow, {
      row: row(type, features),
      editing: false,
      first: true,
      last: true,
      onRename: () => undefined,
      onPickIcon: () => undefined,
      onMove: () => undefined,
      onToggleHidden: () => undefined,
      onRemove: () => undefined,
      model: model(type),
    }),
    { hub },
  )
}

const bg = (el: HTMLElement): string => getComputedStyle(el).backgroundColor

describe('cover', () => {
  async function buttons(status: Record<string, unknown>) {
    mountRow('cover', { 'cover.getStatus': status })
    const up = await screen.findByLabelText('Open')
    return { up, stop: screen.getByLabelText('Stop'), down: screen.getByLabelText('Close') }
  }

  it('draws up / stop / down, not the model pill', async () => {
    await buttons({ state: 'open', position: 40 })
    expect(screen.queryByText('Model pill')).toBeNull()
    expect(screen.getByTestId('hero-row-shortcuts-9')).toBeTruthy()
  })

  it('an open (partly open) cover lights UP only', async () => {
    const { up, stop, down } = await buttons({ state: 'open', position: 40 })
    await waitFor(() => expect(bg(up)).not.toBe(bg(stop)))
    expect(bg(down)).toBe(bg(stop))
  })

  it('a closed cover lights DOWN only', async () => {
    const { up, stop, down } = await buttons({ state: 'closed', position: 0 })
    await waitFor(() => expect(bg(down)).not.toBe(bg(stop)))
    expect(bg(up)).toBe(bg(stop))
  })
})

describe('lock', () => {
  it('draws Lock and Unlock, not the model pill', async () => {
    mountRow('lock', { 'lockControl.getStatus': { state: 'locked' } })
    expect(await screen.findByRole('button', { name: 'Lock' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeTruthy()
    expect(screen.queryByText('Model pill')).toBeNull()
  })
})

describe('update', () => {
  it('draws the Install pill', async () => {
    mountRow('update', { 'update.getStatus': { currentVersion: '1', availableVersion: '2', updatable: true, inProgress: false } })
    expect(await screen.findByRole('button', { name: 'Install' })).toBeTruthy()
    expect(screen.queryByText('Model pill')).toBeNull()
  })
})

describe('extras', () => {
  it('a switch with timed-run keeps its quick-run pill beside the switch', async () => {
    mountRow(
      'switch',
      {
        'switch.getStatus': { on: false },
        'timedRun.getStatus': { activeUntil: null, requestedBy: null, quickRun: { duration: 30, unit: 'min' }, lastFetchedAt: 1 },
      },
      ['switch', 'timed-run'],
    )
    expect(await screen.findByRole('button', { name: 'Run 30 min' })).toBeTruthy()
    expect(screen.queryByText('Model pill')).toBeNull()
  })
})

describe('a device with no interactive control', () => {
  it('draws the hub model and no shortcut zone', () => {
    mountRow('camera', {})
    expect(screen.queryByTestId('hero-row-shortcuts-9')).toBeNull()
    expect(screen.getByTestId('hero-row-9')).toBeTruthy()
  })
})
