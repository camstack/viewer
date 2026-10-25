/**
 * @vitest-environment jsdom
 *
 * The ONE state a camera tile still owns: the hub did not answer.
 *
 * D190 moved every camera state to the server — a disabled, sleeping, waking,
 * unreachable or offline camera all come back as a frame with the state painted
 * into it. What no server-provisioned tile can cover is the server itself being
 * unreachable or overloaded, and the operator named it as the single exception:
 * *"the only case to show is a long timeout when the backend is overloaded."*
 *
 * Long is the load-bearing word. The tile used to decide within one failed
 * request that a camera was "Unavailable", which on a cold start, a slow hub, or
 * a fleet all capturing at once was a grid of failure messages over frames that
 * were seconds away. So this waits {@link SNAPSHOT_HUB_TIMEOUT_MS} with the
 * skeleton up, and only then says something — and what it says is about the
 * HUB, not about the camera, because a camera that never answered is not a fact
 * this app has.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { SnapshotOverviewProvider } from '../../data/SnapshotOverviewProvider.js'
import { SNAPSHOT_HUB_TIMEOUT_MS } from '../../data/use-snapshot.js'
import { CameraCard } from '../CameraCard.js'
import type { CameraInfo } from '../../data/use-cameras.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const DEVICE_ID = 102

const CAMERA: CameraInfo = {
  id: DEVICE_ID,
  name: 'Garden',
  type: 'camera',
  online: true,
  disabled: false,
  features: [],
  originalName: 'Garden',
  hidden: false, location: null,
}

/** A hub that accepted the call and never came back. */
const SILENT_HUB = {
  'snapshot.getSnapshotLinks': (): unknown => new Promise(() => undefined),
  'snapshot.getSnapshotOverview': (): unknown => new Promise(() => undefined),
}

function tile(): React.ReactElement {
  return React.createElement(SnapshotOverviewProvider, {
    deviceIds: [DEVICE_ID],
    enabled: true,
    children: React.createElement(CameraCard, {
      camera: CAMERA,
      onPress: (): void => undefined,
      onOpenControls: (): void => undefined,
      onOpenOverlay: (): void => undefined,
      isFavourite: false,
      onToggleFavourite: () => {},
    }),
  })
}

describe('a tile whose hub never answers', () => {
  it('waits with the skeleton up, then says the HUB is not answering', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { container } = mountScreen(tile(), { hub: SILENT_HUB })

    // Well into the window a real first paint takes: still no verdict.
    await act(async () => {
      vi.advanceTimersByTime(SNAPSHOT_HUB_TIMEOUT_MS / 2)
    })
    expect(container.textContent).not.toContain('hub')
    expect(container.textContent).not.toContain('Hub')

    await act(async () => {
      vi.advanceTimersByTime(SNAPSHOT_HUB_TIMEOUT_MS)
    })
    await waitFor(() => {
      expect(container.textContent?.toLowerCase()).toContain('hub')
    })
    // Never phrased as a fault of the camera — nothing here knows anything
    // about the camera.
    expect(container.textContent).not.toContain('Unavailable')
  })
})
