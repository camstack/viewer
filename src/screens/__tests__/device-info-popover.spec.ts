/**
 * @vitest-environment jsdom
 *
 * The device detail header's info button: a tap opens an anchored popover of
 * read-only facts. The provider line is the addon's name alone. A reachability
 * the row did not answer is Unknown, never Offline.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { DeviceDetailScreen } from '../DeviceDetailScreen.js'

vi.mock('react-native-webview', async () => {
  const { View } = await import('react-native')
  const ReactMod = await import('react')
  const WebView = () => ReactMod.createElement(View, { testID: 'card-webview' })
  return { __esModule: true, WebView, default: WebView }
})

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const NOW = 1_700_000_000_000

const HUB = {
  'deviceManager.listAll': [
    {
      id: 22,
      name: 'Washer plug',
      type: 'switch',
      role: 'switch-heater',
      features: ['switch'],
      addonId: 'provider-homematic',
      integrationId: 'int-1',
      parentDeviceId: 9,
      lastSeen: NOW - 3 * 3_600_000,
    },
    { id: 9, name: 'Laundry', type: 'camera', online: true, features: [] },
  ],
  'addons.list': [{ manifest: { id: 'provider-homematic', name: 'Homematic' } }],
  'integrations.get': { id: 'int-1', addonId: 'provider-homematic', name: 'Casa' },
}

afterEach(() => {
  cleanup()
})

async function openInfo(): Promise<HTMLElement> {
  fireEvent.click(screen.getByLabelText('Device info'))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return screen.findByTestId('device-info-popover')
}

describe('device info popover', () => {
  it('sits before Close and lists the addon, the id, the type, and Unknown reachability', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    mountScreen(React.createElement(DeviceDetailScreen, { deviceId: 22, deviceName: 'Washer plug', deviceType: 'switch' }), {
      hub: HUB,
    })
    const header = screen.getByTestId('device-sheet-header')
    expect(within(header).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual([
      'Device info',
      'Close',
    ])
    await openInfo()
    await screen.findByText('Homematic')
    await screen.findByText('Laundry')
    const popover = screen.getByTestId('device-info-popover')
    expect(within(popover).getByText('Provider').parentElement?.textContent).toContain('Homematic')
    expect(popover.textContent).not.toContain('Casa')
    expect(within(popover).getByText('Device id').parentElement?.textContent).toContain('22')
    expect(within(popover).getByText('Type').parentElement?.textContent).toContain('Switch')
    expect(within(popover).getByText('Role').parentElement?.textContent).toContain('switch-heater')
    expect(within(popover).getByText('Parent').parentElement?.textContent).toContain('Laundry')
    expect(within(popover).getByText('Reachability').parentElement?.textContent).toContain('Unknown')
    expect(within(popover).queryByText('Offline')).toBeNull()
    expect(within(popover).getByText('Last seen').parentElement?.textContent).toContain('3h ago')
    vi.restoreAllMocks()
  })
})
