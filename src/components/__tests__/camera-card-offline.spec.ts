/**
 * @vitest-environment jsdom
 *
 * A camera the hub reports OFFLINE, on the Cameras page — after D190.
 *
 * ## What changed under this file
 *
 * The 2026-08-19 version of these tests asserted the app's own offline
 * handling: do not ASK for an offline camera, keep painting the file on disk,
 * draw a `WifiOff` chip over it, and say "Offline" instead of "Unavailable"
 * when there was no file. Every one of those sentences was the app deciding
 * what an offline tile looks like, from registry flags, next to a hub that was
 * already deciding it from the pixels.
 *
 * D190 gave the whole job to the snapshot service: `offline` is a state reason
 * like `sleeping`, painted INTO the frame and named in
 * `getSnapshotLinks.stateReason` with the frame's `ageMs` beside it. So what
 * these tests assert now is the opposite — that the tile is a dumb surface:
 *
 *   • it ASKS for every camera it is showing, offline included;
 *   • it paints whatever came back, without inspecting `camera.online`;
 *   • the only thing it draws over the frame is the age the hub reported, and
 *     only when the hub says the frame is not a live one.
 *
 * The discriminating pair is the last two tests: the SAME camera flags with a
 * different served row must produce a different tile, and the same served row
 * with different camera flags must produce the same one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { EXPO_IMAGE_TESTID_PREFIX } from '../../testing/native-stubs/expo-image.js'
import { SnapshotOverviewProvider } from '../../data/SnapshotOverviewProvider.js'
import { CameraCard } from '../CameraCard.js'
import type { CameraInfo } from '../../data/use-cameras.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const DEVICE_ID = 102

function camera(online: boolean): CameraInfo {
  return {
    id: DEVICE_ID,
    name: 'Garden',
    type: 'camera',
    online,
    disabled: false,
    features: [],
    originalName: 'Garden',
    hidden: false, location: null,
  }
}

interface LinkTargetInput {
  readonly deviceId: number
  readonly width?: number
}

/** What the hub says about the frame it is serving. */
interface ServedState {
  readonly stateReason: string | null
  readonly ageMs: number
}

/** Device ids the app actually asked the hub for a link to. */
const asked: number[] = []

function hub(state: ServedState) {
  return {
    'snapshot.getSnapshotLinks': (input?: unknown): unknown => {
      const targets = (input as { targets?: readonly LinkTargetInput[] } | undefined)?.targets ?? []
      const now = Date.now()
      for (const target of targets) asked.push(target.deviceId)
      return targets.map((target) => ({
        deviceId: target.deviceId,
        url: `/addon/snapshot/media/${String(target.deviceId)}.jpg?sig=stub`,
        capturedAt: now - state.ageMs,
        ageMs: state.ageMs,
        width: target.width ?? null,
        neverCaptured: false,
        sleeping: false,
        stateReason: state.stateReason,
        battery: false,
        expiresAt: now + 120_000,
      }))
    },
    'snapshot.getSnapshotOverview': (input?: unknown): unknown => {
      const ids = (input as { deviceIds?: readonly number[] } | undefined)?.deviceIds ?? []
      const now = Date.now()
      return ids.map((deviceId) => ({
        deviceId,
        lastCapturedAt: now - state.ageMs,
        cacheAgeMs: state.ageMs,
        etag: 'e1',
      }))
    },
  }
}

function tile(online: boolean): React.ReactElement {
  return React.createElement(SnapshotOverviewProvider, {
    deviceIds: [DEVICE_ID],
    enabled: true,
    children: React.createElement(CameraCard, {
      camera: camera(online),
      onPress: (): void => undefined,
      onOpenControls: (): void => undefined,
      onOpenOverlay: (): void => undefined,
      isFavourite: false,
      onToggleFavourite: () => {},
    }),
  })
}

/** Every image source currently on screen, as the stubbed `expo-image` saw it. */
function paintedSources(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll(`[data-testid^="${EXPO_IMAGE_TESTID_PREFIX}"]`)]
    .map((el) => el.getAttribute('data-testid') ?? '')
    .map((id) => id.slice(EXPO_IMAGE_TESTID_PREFIX.length))
    .filter((uri) => uri.length > 0)
}

function labels(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll('[aria-label]')].map(
    (el) => el.getAttribute('aria-label') ?? '',
  )
}

const LIVE: ServedState = { stateReason: null, ageMs: 400 }
const OFFLINE: ServedState = { stateReason: 'offline', ageMs: 8 * 60_000 }

describe('an offline camera tile is served, not composed', () => {
  it('asks the hub for a frame even though the camera is offline', async () => {
    asked.length = 0
    mountScreen(tile(false), { hub: hub(OFFLINE) })
    // The old gate skipped this request entirely, which is what left the tile
    // with nothing to paint and the app with a hole to fill.
    await waitFor(() => {
      expect(asked).toContain(DEVICE_ID)
    })
  })

  it('paints the frame the hub served for it', async () => {
    const { container } = mountScreen(tile(false), { hub: hub(OFFLINE) })
    await waitFor(() => {
      expect(paintedSources(container).length).toBeGreaterThan(0)
    })
    // Never the generic failure: the hub answered, so there is a tile.
    expect(container.textContent).not.toContain('Unavailable')
  })

  it('reports the frame’s age over it — the one thing a picture cannot say', async () => {
    const { container } = mountScreen(tile(false), { hub: hub(OFFLINE) })
    await waitFor(() => {
      expect(labels(container).some((l) => l.includes('8m'))).toBe(true)
    })
  })

  it('draws nothing extra when the SAME camera is served as live', async () => {
    // Same `online: false` flags, different served row. If the tile still had
    // an opinion of its own, this would look like the offline one.
    const { container } = mountScreen(tile(false), { hub: hub(LIVE) })
    await waitFor(() => {
      expect(paintedSources(container).length).toBeGreaterThan(0)
    })
    expect(labels(container).some((l) => l.includes('Snapshot'))).toBe(false)
  })

  it('draws the same tile for an ONLINE camera the hub reports offline', async () => {
    // The mirror case: the flags say up, the served frame says otherwise. The
    // frame wins, because the frame is what is on screen.
    const { container } = mountScreen(tile(true), { hub: hub(OFFLINE) })
    await waitFor(() => {
      expect(labels(container).some((l) => l.includes('8m'))).toBe(true)
    })
  })
})
