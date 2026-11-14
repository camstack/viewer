// @vitest-environment jsdom
/**
 * Details on a device row REPLACE the list inside the Devices panel (operator
 * decision 2026-11-13): no route, the panel stays open, and Back returns to the
 * list exactly as it was left.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'

import { mountScreen } from '../../../../testing/mount.js'
import { routerCalls } from '../../../../testing/native-stubs/expo-router.js'
import { CameraAccessoryPanel } from '../CameraAccessoryPanel.js'

vi.mock('react-native-webview', async () => {
  const { View } = await import('react-native')
  const ReactMod = await import('react')
  const WebView = () => ReactMod.createElement(View, { testID: 'card-webview' })
  return { __esModule: true, WebView, default: WebView }
})
vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

const HUB = {
  'deviceManager.listAll': (input?: unknown) =>
    typeof input === 'object' && input !== null && (input as { isCamera?: boolean }).isCamera === true
      ? [{ id: 101, name: 'Front door', type: 'camera', online: true, isCamera: true, features: [] }]
      : [{ id: 900, name: 'Faretto', type: 'light', online: true }],
  'deviceManager.getLinkedDevices': {
    mode: 'manual',
    devices: [{ deviceId: 900, name: 'Faretto', location: null, features: ['on'] }],
  },
}

afterEach(() => cleanup())

describe('Devices panel: list -> detail -> back', () => {
  it('shows the detail in place, keeps the list mounted, and Back returns to it', async () => {
    mountScreen(React.createElement(CameraAccessoryPanel, { deviceId: 101, cameraName: 'Front door' }), {
      hub: HUB,
    })
    const details = await screen.findByLabelText('Details of Faretto')
    expect(screen.queryByTestId('card-webview')).toBeNull()

    fireEvent.click(details)
    await waitFor(() => expect(screen.getByTestId('card-webview')).toBeTruthy())
    expect(routerCalls().some((c) => c.kind === 'push')).toBe(false)
    // The list is still mounted (hidden), not rebuilt.
    expect(screen.getByLabelText('Details of Faretto')).toBe(details)

    const card = screen.getByTestId('card-webview')
    fireEvent.click(screen.getByLabelText('Back'))
    // The list is back. The document stays mounted, hidden, for the next device.
    await waitFor(() => expect(screen.getByTestId('card-webview')).toBe(card))
    expect(screen.getByLabelText('Details of Faretto')).toBe(details)
  })
})
