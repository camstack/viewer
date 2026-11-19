// @vitest-environment jsdom
/**
 * A linked device's detail REPLACES the controls sheet's whole body (PTZ pad
 * included) while it is open, and Back returns to the pad as it was. It used
 * to render nested under the PTZ section, in a half-empty card.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'

import { mountScreen } from '../../../testing/mount.js'
import { CameraControlsOverlay } from '../CameraControlsOverlay.js'
import { FEATURE, type CameraInfo } from '../../../data/use-cameras.js'

vi.mock('react-native-webview', async () => {
  const { View } = await import('react-native')
  const ReactMod = await import('react')
  const WebView = () => ReactMod.createElement(View, { testID: 'card-webview' })
  return { __esModule: true, WebView, default: WebView }
})
vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const CAMERA: CameraInfo = {
  id: 701,
  name: 'Garden',
  type: 'camera',
  online: true,
  disabled: false,
  features: [FEATURE.ptz],
  originalName: 'Garden',
  hidden: false,
  location: null,
}

const HUB = {
  'auth.me': { id: 'u1', username: 'operator', isAdmin: true },
  'ptz.getOptions': { hasPan: true, hasTilt: true, hasZoom: true, supportsPresets: false, hasAutofocus: false },
  'deviceManager.getLinkedDevices': {
    mode: 'manual',
    devices: [{ deviceId: 900, name: 'Faretto', location: null, features: ['on'] }],
  },
  'deviceManager.listAll': [{ id: 900, name: 'Faretto', type: 'light', online: true }],
  'pipelineOrchestrator.getCameraSwitches': { deviceId: 701, switches: [] },
}

function pads(): HTMLElement {
  return screen.getByTestId('camera-controls-pads')
}

describe('controls sheet: linked device detail', () => {
  it('hides the PTZ pad while the detail is open and restores it on Back', async () => {
    mountScreen(
      React.createElement(CameraControlsOverlay, { visible: true, camera: CAMERA, onClose: () => undefined }),
      { hub: HUB },
    )
    const details = (await screen.findAllByLabelText('Details of Faretto'))[0]!
    expect(getComputedStyle(pads()).display).not.toBe('none')

    fireEvent.click(details)
    await waitFor(() => expect(screen.getByTestId('card-webview')).toBeTruthy())
    expect(getComputedStyle(pads()).display).toBe('none')

    fireEvent.click(screen.getByLabelText('Back'))
    await waitFor(() => expect(getComputedStyle(pads()).display).not.toBe('none'))
  })
})
