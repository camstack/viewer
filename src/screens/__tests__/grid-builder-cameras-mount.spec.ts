/**
 * @vitest-environment jsdom
 *
 * The grid builder's camera list (issue #496): the device → value list over
 * `deviceManager.search`, asked for cameras.
 *
 * What only a mount can say:
 *  - a camera hidden from the app's lists is not offered here either;
 *  - a tap adds a camera to the grid, a second tap takes it out.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen as dom } from '@testing-library/react'
import React from 'react'

import { mountScreen, TEST_SERVER_ID } from '../../testing/mount.js'
import { deviceSearchHub, type FleetDevice } from '../../testing/device-search-hub.js'
import { useGridStore, type Grid } from '../../store/grid-store.js'
import { DEFAULTS, useCameraPrefsStore } from '../../store/camera-prefs-store.js'
import { GridBuilderScreen } from '../GridBuilderScreen.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const GRID_ID = 'g1'
const CAM = ['camera-streams']

/** 9 is a camera the operator hid from the app. */
const FLEET: readonly FleetDevice[] = [
  { id: 1, name: 'Front door', type: 'camera', location: 'Hall', caps: CAM },
  { id: 5, name: 'Garden', type: 'camera', location: 'Garden', caps: CAM },
  { id: 9, name: 'Bedroom', type: 'camera', location: 'Bedroom', caps: CAM },
]

const LIST_ALL = FLEET.map((d) => ({ id: d.id, name: d.name, isCamera: true, online: true }))

function seed(): void {
  useGridStore.setState({
    grids: [{ id: GRID_ID, name: 'Piano terra', serverId: TEST_SERVER_ID, cameraIds: [1] } satisfies Grid],
    hydrated: true,
  })
  useCameraPrefsStore.setState({ prefs: { ...DEFAULTS, byId: { 9: { hidden: true } } }, hydrated: true })
}

function gridCameras(): readonly number[] {
  return useGridStore.getState().grids.find((g) => g.id === GRID_ID)?.cameraIds ?? []
}

afterEach(() => {
  cleanup()
  useCameraPrefsStore.setState({ prefs: DEFAULTS })
})

describe('grid builder — the camera list', () => {
  it('does not offer a camera hidden from the app', async () => {
    seed()
    mountScreen(React.createElement(GridBuilderScreen, { gridId: GRID_ID }), {
      hub: { 'deviceManager.listAll': LIST_ALL, ...deviceSearchHub(FLEET) },
    })
    expect(await dom.findByTestId('dvp-row-5')).toBeTruthy()
    expect(dom.getByTestId('dvp-row-1')).toBeTruthy()
    expect(dom.queryByTestId('dvp-row-9')).toBeNull()
  })

  it('a tap adds a camera to the grid, and a second tap takes it out', async () => {
    seed()
    mountScreen(React.createElement(GridBuilderScreen, { gridId: GRID_ID }), {
      hub: { 'deviceManager.listAll': LIST_ALL, ...deviceSearchHub(FLEET) },
    })
    await act(async () => {
      fireEvent.click(await dom.findByTestId('dvp-row-5'))
    })
    expect(gridCameras()).toEqual([1, 5])
    await act(async () => {
      fireEvent.click(dom.getByTestId('dvp-row-5'))
    })
    expect(gridCameras()).toEqual([1])
  })
})
