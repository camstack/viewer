// @vitest-environment jsdom
/** The detail button on a device row opens the full-screen device detail. */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'

import { mountScreen } from '../../../../testing/mount.js'
import { routerCalls } from '../../../../testing/native-stubs/expo-router.js'
import { AccessoryDeviceList } from '../AccessoryDeviceList.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

const HUB = {
  'deviceManager.listAll': (input?: unknown) =>
    typeof input === 'object' && input !== null && (input as { isCamera?: boolean }).isCamera === true
      ? [{ id: 101, name: 'Front door', type: 'camera', online: true, isCamera: true, features: [] }]
      : [{ id: 900, type: 'light', online: true }],
  'deviceManager.getLinkedDevices': {
    mode: 'manual',
    devices: [{ deviceId: 900, name: 'Faretto', location: null, features: ['on'] }],
  },
}

afterEach(() => cleanup())

describe('the row opens the device detail', () => {
  it('pushes /device/<id> with the name and type', async () => {
    mountScreen(
      React.createElement(AccessoryDeviceList, { deviceId: 101, cameraName: 'Front door', editing: false }),
      { hub: HUB },
    )
    fireEvent.click(await screen.findByLabelText('Details of Faretto'))
    await waitFor(() => expect(routerCalls().some((c) => c.kind === 'push')).toBe(true))
    expect(routerCalls().find((c) => c.kind === 'push')?.target).toBe('/device/900?name=Faretto&type=light')
  })

  it('is not offered while editing the list', async () => {
    mountScreen(
      React.createElement(AccessoryDeviceList, { deviceId: 101, cameraName: 'Front door', editing: true }),
      { hub: HUB },
    )
    await screen.findByLabelText('Rename Faretto')
    expect(screen.queryByLabelText('Details of Faretto')).toBeNull()
  })
})
