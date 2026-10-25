/**
 * @vitest-environment jsdom
 *
 * The camera grid, across an `AppState` transition that is NOT a backgrounding.
 *
 * ## The two reports this file closes (operator, 2026-08-18)
 *
 *  1. "Snapshots seem to no longer have update priority on screen as soon as
 *     the app opens."
 *  2. "If I'm on the Cameras page and I pull down the system shade, the
 *     snapshots blink to 'not available' until I close it."
 *
 * They are ONE cause. `RCTAppState` maps
 * `UIApplicationWillResignActiveNotification` to `inactive` — the shade, the
 * Control Centre and the app switcher all emit it — and reads its
 * `initialAppState` straight off `UIApplication.applicationState`, which during
 * launch is `inactive`/`unknown` because `applicationDidBecomeActive:` has not
 * run yet. A tile gated on `currentState === 'active'` therefore (2) drops its
 * image source for as long as the shade is down and (1) starts every cold
 * launch disabled, so the demand that mints its link is registered late.
 *
 * Only `background` means nobody is looking. Everything else does.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, waitFor } from '@testing-library/react'
import React from 'react'

import { mountScreen } from '../../testing/mount.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { emitAppState } from '../../testing/app-state-control.js'
import { EXPO_IMAGE_TESTID_PREFIX } from '../../testing/native-stubs/expo-image.js'
import { SnapshotOverviewProvider } from '../../data/SnapshotOverviewProvider.js'
import { CameraCard } from '../CameraCard.js'
import type { CameraInfo } from '../../data/use-cameras.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const DEVICE_ID = 102

const CAMERA: CameraInfo = {
  id: DEVICE_ID,
  name: 'Garage',
  type: 'camera',
  online: true,
  disabled: false,
  features: [],
  originalName: 'Garage',
  hidden: false, location: null,
}

/** The signed path the hub mints for a watched tile. */
const LINK_PATH = `/addon/snapshot/media/${String(DEVICE_ID)}.jpg`

interface LinkTargetInput {
  readonly deviceId: number
  readonly width?: number
}

/**
 * A hub that has the links cap and a current frame for this camera — the
 * ordinary state of the Cameras page with the operator looking at it.
 *
 * `getSnapshotLinks` answers POSITIONALLY, so the response is built from the
 * input: the client keys the rows by `(deviceId, width)` and the width is
 * whatever the card measured.
 */
const HUB = {
  'snapshot.getSnapshotLinks': (input?: unknown): unknown => {
    const targets = (input as { targets?: readonly LinkTargetInput[] } | undefined)?.targets ?? []
    const now = Date.now()
    return targets.map((target) => ({
      deviceId: target.deviceId,
      url: `${LINK_PATH}?sig=stub`,
      capturedAt: now,
      ageMs: 400,
      width: target.width ?? null,
      neverCaptured: false,
      sleeping: false,
      stateReason: null,
      battery: false,
      expiresAt: now + 120_000,
    }))
  },
  'snapshot.getSnapshotOverview': (input?: unknown): unknown => {
    const ids = (input as { deviceIds?: readonly number[] } | undefined)?.deviceIds ?? []
    const now = Date.now()
    return ids.map((deviceId) => ({ deviceId, lastCapturedAt: now, cacheAgeMs: 400, etag: 'e1' }))
  },
}

function grid(): React.ReactElement {
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

/**
 * Is the tile pointing at a frame for this camera?
 *
 * Two shapes are legitimate, and which one appears is a PLATFORM fact, not a
 * behavioural one: on native the painted source is the snapshot file cache's
 * `file://…/snapshots/<deviceId>_<width>_<etag>.jpg` (see
 * `src/data/snapshot-file-cache.ts`), on web it is the hub media URL. This
 * harness runs as `Platform.OS = 'ios'`, so it exercises the first — while the
 * contract these tests defend is the same for both: a tile that HAS a frame
 * keeps it while the shade is down, and gives it up when nobody is looking.
 */
function paintsFrame(container: HTMLElement): boolean {
  const id = String(DEVICE_ID)
  return paintedSources(container).some(
    (uri) => uri.includes(`${id}.jpg`) || uri.includes(`/snapshots/${id}_`),
  )
}

/** Every image source currently on screen, as the stubbed `expo-image` saw it. */
function paintedSources(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll(`[data-testid^="${EXPO_IMAGE_TESTID_PREFIX}"]`)]
    .map((el) => el.getAttribute('data-testid') ?? '')
    .map((id) => id.slice(EXPO_IMAGE_TESTID_PREFIX.length))
    .filter((uri) => uri.length > 0)
}

function mintedLinks(): number {
  return hubCalls().filter((call) => call.path === 'snapshot.getSnapshotLinks').length
}

describe('a camera tile across a non-backgrounding AppState transition', () => {
  it('never flashes "unavailable" in the gap before its first frame lands', async () => {
    // On native the tile paints a FILE, and a file that has not been downloaded
    // yet is `null` for a beat. If that beat is reported as neither loading nor
    // failed, the card paints its empty state over a frame that is milliseconds
    // away — a blink on every cold launch, on every tile.
    const view = mountScreen(grid(), { hub: HUB })
    expect(view.container.textContent).not.toContain('Unavailable')
    expect(view.container.textContent).not.toContain('No snapshot yet')
    await waitFor(() => {
      expect(paintsFrame(view.container)).toBe(true)
    })
    expect(view.container.textContent).not.toContain('Unavailable')
  })

  it('keeps its frame while the notification shade is down', async () => {
    const view = mountScreen(grid(), { hub: HUB })

    // Precondition: the hub minted a link and the tile is pointing at a frame.
    await waitFor(() => {
      expect(paintsFrame(view.container)).toBe(true)
    })
    // …and on native that frame is a file this app downloaded and named, not a
    // URL handed to `expo-image`'s own (URL-keyed, never-revalidating) cache.
    expect(paintedSources(view.container).some((uri) => uri.startsWith('file://'))).toBe(true)

    // The shade / Control Centre / app switcher. NOT a backgrounding.
    await act(async () => {
      emitAppState('inactive')
      await Promise.resolve()
    })

    expect(
      paintsFrame(view.container),
      'the tile must still point at its frame while the shade is down',
    ).toBe(true)
    expect(
      view.container.textContent,
      'the tile must not report the camera unavailable while the shade is down',
    ).not.toContain('Unavailable')
  })

  it('still blanks when the app genuinely goes to the background', async () => {
    const view = mountScreen(grid(), { hub: HUB })
    await waitFor(() => {
      expect(paintsFrame(view.container)).toBe(true)
    })

    await act(async () => {
      emitAppState('background')
      await Promise.resolve()
    })

    // Nobody is looking: the tile stops asking, and with nothing current to
    // paint it must not keep an old photograph on screen either. The file cache
    // does NOT change this — it holds a frame for the next time the surface is
    // enabled, it is not a licence to keep painting one that is switched off.
    expect(paintsFrame(view.container)).toBe(false)
  })

  it('mints its link at launch, when iOS still reports the launch window', async () => {
    // `RCTAppState.initialAppState` is `UIApplication.applicationState` at
    // bridge setup — `inactive` until `applicationDidBecomeActive:`. The demand
    // that mints the link must not wait for a state CHANGE that has already
    // happened before the listener was attached.
    mountScreen(grid(), { hub: HUB, appState: 'inactive' })

    await waitFor(() => {
      expect(mintedLinks(), 'no snapshot link was minted during the launch window').toBeGreaterThan(
        0,
      )
    })
  })
})
