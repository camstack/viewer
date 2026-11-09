/**
 * @vitest-environment jsdom
 *
 * A cover on a HERO row (the hub's row model is in) still shows its three
 * icon-only shortcuts, up / stop / down, with UP lit while it is open and DOWN
 * lit while it is closed; a light on the same path keeps the model's primary.
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

const action = (id: string) => ({
  id,
  label: { en: id, it: id },
  icon: 'power' as const,
  call: { cap: 'cover', method: id, args: {} },
  emphasis: 'normal' as const,
  confirm: null,
})

const model = (type: string, primary: HeroRowModel['primary']): HeroRowModel => ({
  deviceId: 9,
  name: 'Shutter',
  type,
  state: 'on',
  stateAssumed: false,
  look: { icon: 'blinds', tone: 'muted', background: 'plain', animation: 'none' },
  scene: { id: 'cover', mode: null, level: null },
  statusLine: [{ en: 'Open', it: 'Aperta' }],
  primary,
  trailing: null,
})

const row = (type: string): AccessoryPanelRow => ({
  device: { id: 9, name: 'Shutter', type, online: true, features: [], location: null, role: null, displayIcon: null },
  origin: 'server',
  label: 'Shutter',
  iconKey: 'blinds',
  hidden: false,
})

function mountRow(type: string, primary: HeroRowModel['primary'], hub: Record<string, unknown>) {
  mountScreen(
    React.createElement(AccessoryRow, {
      row: row(type),
      editing: false,
      first: true,
      last: true,
      onRename: () => undefined,
      onPickIcon: () => undefined,
      onMove: () => undefined,
      onToggleHidden: () => undefined,
      onRemove: () => undefined,
      model: model(type, primary),
    }),
    { hub },
  )
}

describe('a hero row keeps the cover shortcuts', () => {
  it('draws up / stop / down, not the single model pill', async () => {
    mountRow('cover', { kind: 'action', action: action('open') }, { 'cover.getStatus': { state: 'open', position: 40 } })
    expect(screen.getByTestId('hero-row-9')).toBeTruthy()
    await waitFor(() => expect(screen.getByLabelText('Open')).toBeTruthy())
    expect(screen.getByLabelText('Stop')).toBeTruthy()
    expect(screen.getByLabelText('Close')).toBeTruthy()
    expect(screen.queryByTestId('hero-action-open')).toBeNull()
    expect(screen.getByTestId('hero-row-shortcuts-9')).toBeTruthy()
  })

  it('a light on a hero row has no shortcut cluster', () => {
    mountRow('light', null, {})
    expect(screen.queryByTestId('hero-row-shortcuts-9')).toBeNull()
  })
})
