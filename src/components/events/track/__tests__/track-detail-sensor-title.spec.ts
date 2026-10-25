/**
 * @vitest-environment jsdom
 *
 * The event DETAIL of a sensor event names the sensor, IN FULL.
 *
 * This is the other half of a rule the operator asked for on Libreria → Eventi:
 * the tile over the thumbnail shows only the sensor's TYPE (`Contatto`),
 * because a whole device name covered the picture — so the detail is the one
 * surface that must still answer "which sensor was it?", and it must answer
 * with `Contatto porta front door`, not with the type again.
 *
 * The taxonomy stub below is deliberately CAPABLE of resolving `contact` to
 * `Contact`: that is what the header would say if the title precedence ever
 * lost its synthetic branch (`trackTitle` in `data/track-events.ts`), so a run
 * with that branch removed fails here instead of quietly showing the type on
 * both surfaces.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../../../testing/mount.js'
import { TrackDetailView } from '../TrackDetailView.js'
import type { TrackSummary } from '../../../../data/track-events.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const DEVICE_ID = 101
const TRACK_ID = 'trk-sensor-1'
const CAMERA_NAME = 'Front door'
const SENSOR_NAME = 'Contatto porta front door'
/** What the header would read if the synthetic branch were lost. */
const SENSOR_TYPE = 'Contact'

const CAMERAS = [
  { id: DEVICE_ID, name: CAMERA_NAME, type: 'Camera', isCamera: true, online: true, features: [] },
]

/** The camera's kinds, including the one its LINKED contact sensor contributes
 *  (`composeEventKinds`) — which is where the tile's type comes from. */
const KINDS = [
  {
    deviceId: DEVICE_ID,
    kinds: [
      {
        kind: 'contact',
        labelKey: 'eventKind.contact',
        label: SENSOR_TYPE,
        color: '#64748b',
        iconId: 'contact',
        category: 'sensor',
        parentKind: null,
        level: 'macro',
      },
    ],
  },
]

function hub(): Record<string, unknown> {
  return {
    'auth.me': { id: 'u1', username: 'admin', isAdmin: true },
    'deviceManager.listAll': CAMERAS,
    'pipelineAnalytics.listEventKindsBatch': KINDS,
    'pipelineAnalytics.listTrackMedia': [],
    'pipelineAnalytics.getTrackMedia': [],
  }
}

/** The row as `getTrack` returns it for a synthetic (sensor-linked) track. */
function sensorTrack(): TrackSummary {
  return {
    trackId: TRACK_ID,
    deviceId: DEVICE_ID,
    cameraName: CAMERA_NAME,
    className: 'contact',
    firstSeen: 1_787_000_001_000,
    lastSeen: 1_787_000_002_000,
    state: 'closed',
    active: false,
    zonesVisited: [],
    zoneNames: [],
    audioLabels: [],
    bestEventId: 'evt-1',
    producingDeviceName: SENSOR_NAME,
  }
}

/** Leaf elements whose whole text is exactly `label`. */
function leaves(container: HTMLElement, label: string): readonly Element[] {
  return [...container.querySelectorAll('div')].filter(
    (el) => el.children.length === 0 && el.textContent === label,
  )
}

function mount(): HTMLElement {
  return mountScreen(React.createElement(TrackDetailView, { track: sensorTrack() }), {
    hub: hub(),
  }).container
}

describe('the detail of a sensor event names the sensor in full', () => {
  it('renders `Contatto porta front door` as the header title', async () => {
    const container = mount()
    await waitFor(() => expect(leaves(container, SENSOR_NAME).length).toBeGreaterThan(0))
  })

  it('does NOT title the detail with the bare type the tile already showed', async () => {
    // The taxonomy IS loaded here — the resolver could answer `Contact` — so
    // this asserts a precedence, not a missing dictionary.
    const container = mount()
    await waitFor(() => expect(leaves(container, SENSOR_NAME).length).toBeGreaterThan(0))
    expect(leaves(container, SENSOR_TYPE)).toHaveLength(0)
  })

  it('keeps the CAMERA on the subtitle, so both facts are on screen', async () => {
    const container = mount()
    await waitFor(() =>
      expect(container.textContent ?? '').toContain(CAMERA_NAME),
    )
  })
})
