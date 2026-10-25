/**
 * @vitest-environment jsdom
 *
 * The theater cluster detail's operator flags — the twin of
 * `data/__tests__/track-flags-reopen.spec.ts`, on the other surface that opens
 * the shared `TrackDetailView`.
 *
 * The embed surfaces at least had a stale COPY of the flags. This one had none
 * at all: `ClusterDetailBody` builds its summary with
 * `timelineEventToTrackSummary`, and a timeline `ObjectEvent` carries no flag
 * fields whatsoever — so `markForTrain` / `debug` / `favourited` arrived
 * `undefined`, `TrackFlagButtons` rendered `flag === true` as false, and all
 * three toggles were off on every open, forever, on a surface that can set
 * them. Nothing decayed; the value was never fetched.
 *
 * The fix reads the row through `useTrackById` and overlays the three flags
 * onto the timeline-built summary. The last test is the one that keeps the fix
 * honest: it must overlay the FLAGS and nothing else, because this body's hero
 * is contractually the same shot the timeline card shows (same `bestEventId`),
 * and adopting the authoritative row wholesale would let the two diverge.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { mountScreen } from '../../../../testing/mount.js'
import { THEME } from '../../../../theme/tokens.js'
import { ClusterDetailBody } from '../detail/ClusterDetailBody.js'
import type { PositionedCluster, ObjectEvent } from '../event-cluster.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const DEVICE_ID = 104
const TRACK_ID = 'dd56bd07-e3f4-4abf-9022-fb9834aa1f71'
/** The timeline's chosen best shot. The detail must keep resolving media
 *  against THIS id, not against whatever the track row reports. */
const TIMELINE_BEST_EVENT_ID = 'evt-timeline-anchor'

function event(): ObjectEvent {
  return {
    id: TIMELINE_BEST_EVENT_ID,
    deviceId: DEVICE_ID,
    timestamp: 1_787_000_000_000,
    className: 'person',
    trackId: TRACK_ID,
  }
}

function cluster(): PositionedCluster {
  const ev = event()
  return {
    id: 'cluster-1',
    events: [ev],
    carouselEvents: [ev],
    representative: ev,
    anchorEvent: ev,
    anchorMs: ev.timestamp,
    importantEvent: ev,
    classes: ['person'],
    labels: [],
    startMs: ev.timestamp,
    endMs: ev.timestamp + 5_000,
    topPx: 0,
    heightPx: 40,
  }
}

/** `getTrack` as the hub answers it for a track the operator HAS flagged —
 *  the shape confirmed against the live hub, where 13 of 71 recent tracks
 *  carried exactly this. */
function hub(flags: Readonly<Record<string, boolean>>): Record<string, unknown> {
  return {
    'auth.me': { id: 'u1', username: 'admin', isAdmin: true },
    'pipelineAnalytics.getTrack': {
      trackId: TRACK_ID,
      deviceId: DEVICE_ID,
      className: 'person',
      firstSeen: 1_787_000_000_000,
      lastSeen: 1_787_000_005_000,
      // Deliberately DIFFERENT from the timeline's anchor — see the last test.
      bestEventId: 'evt-track-row-best',
      ...flags,
    },
  }
}

function body(): React.ReactElement {
  return React.createElement(ClusterDetailBody, {
    deviceId: DEVICE_ID,
    cluster: cluster(),
    onSeek: (): void => undefined,
  })
}

/** The flag toggles render as `accessibilityRole="switch"` → `role="switch"`. */
function switches(container: HTMLElement): readonly Element[] {
  return [...container.querySelectorAll('[role="switch"]')]
}

/** `#e67e22` → `rgb(230, 126, 34)`, the form jsdom reports back. */
function rgb(hex: string): string {
  const n = Number.parseInt(hex.replace('#', ''), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

/**
 * Which flags are LIT.
 *
 * Not `aria-checked`: react-native-web does not forward
 * `accessibilityState.checked` to it (the device does, via
 * `accessibilityState`), so on this renderer the only honest signal is the one
 * the operator actually goes by — an ON button is filled with the theme accent,
 * an OFF one wears the same neutral surface as the info/close buttons beside
 * it. Asserting the fill also happens to cover the rule that the state must
 * never be colour ALONE at a glance: if the fills stop differing, this breaks.
 */
function litLabels(container: HTMLElement): readonly string[] {
  const lit = rgb(THEME.light.primary)
  return switches(container)
    .filter((el) => (el.getAttribute('style') ?? '').includes(`background-color: ${lit}`))
    .map((el) => el.getAttribute('aria-label') ?? '')
}

describe('the cluster detail shows the flags the hub actually holds', () => {
  it('lights a flag the track carries — it used to render all three off, always', async () => {
    const { container } = mountScreen(body(), { hub: hub({ debug: true }) })

    await waitFor(() => expect(switches(container).length).toBeGreaterThanOrEqual(3))
    await waitFor(() => expect(litLabels(container)).toEqual(['Debug']))
  })

  it('lights each of the three independently', async () => {
    const { container } = mountScreen(body(), {
      hub: hub({ markForTrain: true, debug: false, favourited: true }),
    })

    await waitFor(() => expect(litLabels(container)).toContain('Mark for training'))
    expect(litLabels(container)).toContain('Favourited')
    expect(litLabels(container)).not.toContain('Debug')
  })

  it('leaves an untouched track OFF — absent is not false, and not on either', async () => {
    const { container } = mountScreen(body(), { hub: hub({}) })

    await waitFor(() => expect(switches(container).length).toBeGreaterThanOrEqual(3))
    expect(litLabels(container)).toEqual([])
  })

  it('keeps the TIMELINE best shot — the row is read for flags, not adopted', () => {
    // HTTP EventThumb no longer paints the event id into jsdom innerHTML.
    // The contract lives in the overlay: three flag keys, never the hub
    // row's `bestEventId`.
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../detail/ClusterDetailBody.tsx'),
      'utf8',
    )
    // The literal moved when the call started preferring the EVENT's own
    // deviceId (`selectedEvent.deviceId ?? deviceId`) — a better call, and the
    // guard's intent is unchanged: the summary is BUILT from the timeline
    // event, never adopted from the hub row.
    expect(src).toContain('timelineEventToTrackSummary(selectedEvent, selectedEvent.deviceId ?? deviceId)')
    expect(src).toContain('...selectedTrack')
    expect(src).toContain('authoritative.markForTrain')
    expect(src).toContain('authoritative.debug')
    expect(src).toContain('authoritative.favourited')
    expect(src).not.toContain('...authoritative')
    expect(src).not.toContain('bestEventId: authoritative')
  })

  it('switching the picker drops the previous track\'s flag overlay', async () => {
    const TRACK_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const person = event()
    const vehicle: ObjectEvent = {
      id: 'evt-vehicle-anchor',
      deviceId: DEVICE_ID,
      timestamp: 1_787_000_001_000,
      className: 'vehicle',
      trackId: TRACK_B,
    }
    const two: PositionedCluster = {
      ...cluster(),
      events: [person, vehicle],
      carouselEvents: [person, vehicle],
      classes: ['person', 'vehicle'],
    }
    const { container } = mountScreen(
      React.createElement(ClusterDetailBody, {
        deviceId: DEVICE_ID,
        cluster: two,
        onSeek: (): void => undefined,
      }),
      {
        hub: {
          'auth.me': { id: 'u1', username: 'admin', isAdmin: true },
          'pipelineAnalytics.getTrack': (input?: unknown) => {
            const trackId =
              typeof input === 'object' && input !== null && 'trackId' in input
                ? String((input as { readonly trackId: unknown }).trackId)
                : TRACK_ID
            const isB = trackId === TRACK_B
            return {
              trackId,
              deviceId: DEVICE_ID,
              className: isB ? 'vehicle' : 'person',
              firstSeen: 1_787_000_000_000,
              lastSeen: 1_787_000_005_000,
              bestEventId: isB ? 'evt-vehicle-anchor' : TIMELINE_BEST_EVENT_ID,
            }
          },
          'pipelineAnalytics.setTrackFlags': {
            trackId: TRACK_ID,
            markForTrain: false,
            debug: true,
            favourited: false,
            retrainStatus: 'none',
          },
        },
      },
    )

    await waitFor(() => expect(switches(container).length).toBeGreaterThanOrEqual(3))
    const debugBtn = switches(container).find((el) => el.getAttribute('aria-label') === 'Debug')
    if (debugBtn === undefined) throw new Error('no Debug switch')
    fireEvent.click(debugBtn)
    await waitFor(() => expect(litLabels(container)).toContain('Debug'))

    // `Vehicle`, not `vehicle`: the chip used to print the raw class id
    // whenever the taxonomy descriptors were not loaded — which is the stub
    // here, and was an Italian operator's events page in production. It now
    // resolves through `eventKind.vehicle` (see `event-label-vocabulary`).
    const vehicleChip = [...container.querySelectorAll('p, span, div')].find(
      (el) => el.textContent === 'Vehicle',
    )
    if (vehicleChip === undefined) throw new Error('no vehicle chip')
    fireEvent.click(vehicleChip)
    await waitFor(() => expect(litLabels(container)).not.toContain('Debug'))
  })
})
