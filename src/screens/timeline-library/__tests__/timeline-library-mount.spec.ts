/**
 * @vitest-environment jsdom
 *
 * The Library timeline, mounted whole over a stand-in hub: the real screen, the
 * real `TheaterTimeline` host and the real data hooks. It proves the page reads
 * ALL the cameras (the batched per-camera calls name every id), shows a still
 * per camera at the cursor, and that an empty fleet is said, not drawn.
 */
import React from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mountScreen, TEST_SERVER_ID } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { scopedStorageKey } from '../../../store/server-scope.js'
import { useLibraryFilterStore } from '../../../store/library-filter-store.js'
import { TIMELINE_FILTER_STORAGE_KEY } from '../../../store/library-filters.js'
import { TimelineLibraryScreen } from '../../TimelineLibraryScreen.js'
import { IPAD_LANDSCAPE, IPHONE_PORTRAIT, setTestViewport } from '../../../testing/viewport-control.js'
import { CURSOR_FRAME_TILE_TEST_ID } from '../CursorFramesGrid.js'
import { CAMERA_SCOPE_ALL_TEST_ID } from '../../../components/camera/CameraSwitcherPanel.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERAS = [
  { id: 11, name: 'Front door', isCamera: true, online: true, disabled: false, type: 'camera', features: [] },
  { id: 12, name: 'Garage', isCamera: true, online: true, disabled: false, type: 'camera', features: [] },
  { id: 13, name: 'Garden', isCamera: true, online: true, disabled: false, type: 'camera', features: [] },
]

beforeEach(async () => {
  await AsyncStorage.clear()
  useLibraryFilterStore.setState({ values: {}, hydrated: false, serverId: null })
})

afterEach(() => {
  cleanup()
  setTestViewport(IPHONE_PORTRAIT)
})

async function rememberCameras(deviceIds: readonly number[]): Promise<void> {
  await AsyncStorage.setItem(
    scopedStorageKey(TIMELINE_FILTER_STORAGE_KEY, TEST_SERVER_ID),
    JSON.stringify({ deviceIds }),
  )
}

/** A fleet of `count` online cameras, ids from 101. */
function fleet(count: number): readonly (typeof CAMERAS)[number][] {
  return Array.from({ length: count }, (_, i) => ({ ...CAMERAS[0], id: 101 + i, name: `Cam ${String(i + 1)}` }))
}

describe('TimelineLibraryScreen', () => {
  it('opens with no camera selected, and does not ask the hub about the fleet', async () => {
    const view = mountScreen(React.createElement(TimelineLibraryScreen), {
      hub: { 'deviceManager.listAll': CAMERAS },
    })
    await waitFor(() => expect(view.queryByTestId('timeline-library-host')).not.toBeNull())
    for (const c of CAMERAS) {
      expect(view.queryByTestId(`${CURSOR_FRAME_TILE_TEST_ID}-${c.id}`)).toBeNull()
    }
    expect(hubCalls().filter((c) => c.path === 'recordingArchive.getAvailabilityBatch')).toEqual([])
  })

  it('restores the cameras remembered on this device, and drops one the hub no longer has', async () => {
    await rememberCameras([12, 99])
    const view = mountScreen(React.createElement(TimelineLibraryScreen), {
      hub: { 'deviceManager.listAll': CAMERAS },
    })
    await waitFor(() => expect(view.queryByTestId(`${CURSOR_FRAME_TILE_TEST_ID}-12`)).not.toBeNull())
    expect(view.queryByTestId(`${CURSOR_FRAME_TILE_TEST_ID}-11`)).toBeNull()
    expect(view.queryByTestId(`${CURSOR_FRAME_TILE_TEST_ID}-99`)).toBeNull()
    await waitFor(() => {
      const asked = hubCalls().filter((c) => c.path === 'recording.getAvailability')
      expect(asked.length).toBeGreaterThan(0)
      for (const call of asked) {
        expect((call.input as { deviceId: number }).deviceId).toBe(12)
      }
    })
  })

  it('select all ticks every camera, and pressing it again clears them', async () => {
    const view = mountScreen(React.createElement(TimelineLibraryScreen), {
      hub: { 'deviceManager.listAll': CAMERAS },
    })
    await waitFor(() => expect(view.queryByTestId('timeline-nav-camera')).not.toBeNull())
    fireEvent.click(view.getByTestId('timeline-nav-camera'))
    await waitFor(() => expect(view.getByTestId(CAMERA_SCOPE_ALL_TEST_ID).textContent).toContain('All cameras'))
    fireEvent.click(view.getByTestId(CAMERA_SCOPE_ALL_TEST_ID))
    await waitFor(() => {
      for (const c of CAMERAS) expect(view.queryByTestId(`${CURSOR_FRAME_TILE_TEST_ID}-${c.id}`)).not.toBeNull()
    })
    expect(view.getByTestId(CAMERA_SCOPE_ALL_TEST_ID).textContent).toContain('Deselect all')
    fireEvent.click(view.getByTestId(CAMERA_SCOPE_ALL_TEST_ID))
    await waitFor(() => {
      for (const c of CAMERAS) expect(view.queryByTestId(`${CURSOR_FRAME_TILE_TEST_ID}-${c.id}`)).toBeNull()
    })
    expect(view.getByTestId(CAMERA_SCOPE_ALL_TEST_ID).textContent).toContain('All cameras')
  })

  it('lays out every camera but reads stills for the first 12 only, and says so on the rest', async () => {
    const many = fleet(14)
    await rememberCameras(many.map((c) => c.id))
    const view = mountScreen(React.createElement(TimelineLibraryScreen), {
      hub: { 'deviceManager.listAll': many },
    })
    await waitFor(() => {
      for (const c of many) expect(view.queryByTestId(`${CURSOR_FRAME_TILE_TEST_ID}-${c.id}`)).not.toBeNull()
    })
    const tile = (id: number): HTMLElement => view.getByTestId(`${CURSOR_FRAME_TILE_TEST_ID}-${id}`)
    for (const c of many.slice(12)) {
      expect(tile(c.id).textContent).toContain('No preview above 12 cameras')
      expect(tile(c.id).textContent).toContain(c.name)
      expect(tile(c.id).querySelector('[data-testid*="/addon/recorder/still/"]')).toBeNull()
    }
    for (const c of many.slice(0, 12)) {
      expect(tile(c.id).textContent).not.toContain('No preview above')
      expect(tile(c.id).querySelector('[data-testid*="/addon/recorder/still/"]')).not.toBeNull()
    }
  })

  it('draws one frame tile per remembered camera, and the batch names exactly those', async () => {
    await rememberCameras(CAMERAS.map((c) => c.id))
    const view = mountScreen(React.createElement(TimelineLibraryScreen), {
      hub: { 'deviceManager.listAll': CAMERAS },
    })
    await waitFor(() => {
      for (const c of CAMERAS) {
        expect(view.queryByTestId(`${CURSOR_FRAME_TILE_TEST_ID}-${c.id}`)).not.toBeNull()
      }
    })
    // The timeline's data is the EXISTING batched hub reads, each naming every
    // camera in one call — never one call per camera, never a new procedure.
    const ids = CAMERAS.map((c) => c.id)
    await waitFor(() => {
      for (const path of [
        'recordingArchive.getAvailabilityBatch',
        'pipelineAnalytics.listRecentTracks',
        'pipelineAnalytics.getEventDensityBatch',
      ]) {
        const asked = hubCalls().filter((c) => c.path === path)
        expect(asked.length, path).toBeGreaterThan(0)
        for (const call of asked) {
          expect((call.input as { deviceIds: number[] }).deviceIds, path).toEqual(ids)
        }
      }
    })
  })

  it('says so when there are no cameras, instead of drawing an empty timeline', async () => {
    const view = mountScreen(React.createElement(TimelineLibraryScreen), {
      hub: { 'deviceManager.listAll': [] },
    })
    await waitFor(() => expect(view.getByText('No cameras to show')).toBeTruthy())
  })

  it('on a phone the timeline is full page under a collapsed strip with a drag handle', async () => {
    setTestViewport(IPHONE_PORTRAIT)
    const view = mountScreen(React.createElement(TimelineLibraryScreen), {
      hub: { 'deviceManager.listAll': CAMERAS },
    })
    await waitFor(() => expect(view.queryByTestId('timeline-library-strip')).not.toBeNull())
    expect(view.queryByTestId('timeline-library-strip-handle')).not.toBeNull()
    expect(view.queryByTestId('timeline-library-column')).toBeNull()
  })

  it('on a tablet or desktop the stills are a right column with a resize handle', async () => {
    setTestViewport(IPAD_LANDSCAPE)
    const view = mountScreen(React.createElement(TimelineLibraryScreen), {
      hub: { 'deviceManager.listAll': CAMERAS },
    })
    await waitFor(() => expect(view.queryByTestId('timeline-library-column')).not.toBeNull())
    expect(view.queryByTestId('timeline-library-column-handle')).not.toBeNull()
    expect(view.queryByTestId('timeline-library-strip')).toBeNull()
  })
  it('the camera chip opens the scope picker, and unticking a camera drops its still', async () => {
    await rememberCameras(CAMERAS.map((c) => c.id))
    const view = mountScreen(React.createElement(TimelineLibraryScreen), {
      hub: { 'deviceManager.listAll': CAMERAS },
    })
    await waitFor(() => expect(view.queryByTestId(`${CURSOR_FRAME_TILE_TEST_ID}-12`)).not.toBeNull())
    fireEvent.click(view.getByTestId('timeline-nav-camera'))
    // The panel used to open EMPTY: the scope binding was not forwarded to it.
    await waitFor(() => expect(view.queryByTestId(CAMERA_SCOPE_ALL_TEST_ID)).not.toBeNull())
    fireEvent.click(view.getByLabelText('Select Garage'))
    await waitFor(() => expect(view.queryByTestId(`${CURSOR_FRAME_TILE_TEST_ID}-12`)).toBeNull())
    expect(view.queryByTestId(`${CURSOR_FRAME_TILE_TEST_ID}-11`)).not.toBeNull()
  })
})
