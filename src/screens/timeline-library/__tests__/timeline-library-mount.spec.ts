/**
 * @vitest-environment jsdom
 *
 * The Library timeline, mounted whole over a stand-in hub: the real screen, the
 * real `TheaterTimeline` host and the real data hooks. It proves the page reads
 * ALL the cameras (the batched per-camera calls name every id), shows a still
 * per camera at the cursor, and that an empty fleet is said, not drawn.
 */
import React from 'react'
import { cleanup, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mountScreen } from '../../../testing/mount.js'
import { hubCalls } from '../../../testing/hub-stub.js'
import { TimelineLibraryScreen } from '../../TimelineLibraryScreen.js'
import { IPAD_LANDSCAPE, IPHONE_PORTRAIT, setTestViewport } from '../../../testing/viewport-control.js'
import { CURSOR_FRAME_TILE_TEST_ID } from '../CursorFramesGrid.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERAS = [
  { id: 11, name: 'Front door', isCamera: true, online: true, disabled: false, type: 'camera', features: [] },
  { id: 12, name: 'Garage', isCamera: true, online: true, disabled: false, type: 'camera', features: [] },
  { id: 13, name: 'Garden', isCamera: true, online: true, disabled: false, type: 'camera', features: [] },
]

afterEach(() => {
  cleanup()
  setTestViewport(IPHONE_PORTRAIT)
})

describe('TimelineLibraryScreen', () => {
  it('draws one frame tile per camera in the fleet', async () => {
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
})
