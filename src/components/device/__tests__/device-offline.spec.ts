/**
 * @vitest-environment jsdom
 *
 * An OFFLINE device (the hub answered `online: false`) is drawn differently
 * from a switched-OFF one, and an unknown online state claims nothing (D62, D315).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import React from 'react'
import type { HeroRowModel } from '@camstack/types'
import { mountScreen } from '../../../testing/mount.js'
import { AccessoryRow } from '../../camera/accessory-panel/AccessoryRow.js'
import type { AccessoryPanelRow } from '../../../accessories/accessory-panel-rows.js'
import { OfflineBadge } from '../OfflineBadge.js'
import { isDeviceOffline } from '../device-reachability.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => cleanup())

const offModel: HeroRowModel = {
  deviceId: 9,
  name: 'Lamp',
  type: 'plug',
  state: 'off',
  stateAssumed: false,
  look: { icon: 'power', tone: 'muted', background: 'plain', animation: 'none' },
  scene: { id: 'generic', mode: null, level: null },
  statusLine: [{ en: 'Off', it: 'Spento' }],
  primary: null,
  timedRun: null,
  trailing: null,
}

const row = (online: boolean): AccessoryPanelRow => ({
  device: { id: 9, name: 'Lamp', type: 'switch', online, features: ['switch'], location: null, role: null, displayIcon: null },
  origin: 'server',
  label: 'Lamp',
  iconKey: 'power',
  hidden: false,
})

function mountRow(online: boolean, withModel: boolean): void {
  mountScreen(
    React.createElement(AccessoryRow, {
      row: row(online),
      editing: false,
      first: true,
      last: true,
      onRename: () => undefined,
      onPickIcon: () => undefined,
      onMove: () => undefined,
      onToggleHidden: () => undefined,
      onRemove: () => undefined,
      model: withModel ? offModel : undefined,
    }),
    { hub: { 'switch.getStatus': { on: false } } },
  )
}

describe('isDeviceOffline', () => {
  it('claims offline only for an answered false', () => {
    expect(isDeviceOffline(false)).toBe(true)
    expect(isDeviceOffline(true)).toBe(false)
    expect(isDeviceOffline(undefined)).toBe(false)
    expect(isDeviceOffline(null)).toBe(false)
  })
})

describe('OfflineBadge', () => {
  it('draws for offline, not for online or unknown', () => {
    mountScreen(React.createElement(OfflineBadge, { online: undefined, testID: 'b' }), { hub: {} })
    expect(screen.queryByTestId('b')).toBeNull()
    cleanup()
    mountScreen(React.createElement(OfflineBadge, { online: false, testID: 'b' }), { hub: {} })
    expect(screen.getByTestId('b')).toBeTruthy()
    expect(screen.getByText('Offline')).toBeTruthy()
  })
})

describe.each([
  ['hero row', true],
  ['legacy row', false],
])('%s', (_name, withModel) => {
  it('an offline device wears the Offline badge', () => {
    mountRow(false, withModel)
    expect(screen.getByTestId('device-offline-9')).toBeTruthy()
  })

  it('an online device that is OFF does not', () => {
    mountRow(true, withModel)
    expect(screen.queryByTestId('device-offline-9')).toBeNull()
  })
})

describe('hero row status', () => {
  it('offline is the one state the row names; online-off shows no badge', () => {
    mountRow(false, true)
    expect(screen.getByTestId('device-offline-9')).toBeTruthy()
    cleanup()
    mountRow(true, true)
    expect(screen.queryByTestId('device-offline-9')).toBeNull()
  })
})
