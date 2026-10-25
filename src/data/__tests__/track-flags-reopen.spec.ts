/**
 * @vitest-environment jsdom
 *
 * "I set a flag, I leave, I come back, and it is off."
 *
 * The mark was never lost. A read-only check against the live hub found
 * `debug: true` sitting on the tracks the operator had flagged, and `getTrack`
 * returning it. What was stale was the viewer's COPY: every embed surface opens
 * its detail from `trackSummaryFromEventsClick` (flag-less by design, so a tap
 * never waits on a round trip) and upgrades it with `useTrackById`'s cached
 * row. `useSetTrackFlags` wrote to the hub and touched nothing else, so that
 * row kept the pre-write flags for its whole 60 s `staleTime` — and a close +
 * reopen, which takes seconds, read the stale copy and rendered the toggle off.
 *
 * This mounts the real hooks over a stubbed wire and reproduces that exact
 * loop: read → write → UNMOUNT the reader → mount it again, inside ONE query
 * client, because a fresh client per open is precisely what the app does not
 * do.
 *
 * Deleting the `onSuccess` publication in `use-track-flags.ts` must turn the
 * first test red. Verified by doing it — that is the only reason this file is
 * worth its runtime.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'
import React, { useState } from 'react'

import { mountScreen } from '../../testing/mount.js'
import { useTrackById } from '../use-track-by-id.js'
import { useSetTrackFlags } from '../use-track-flags.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

afterEach(cleanup)

const DEVICE_ID = 102
const TRACK_ID = 'b8427bc7-cd58-4b9b-bb88-1a2c7dff9dde'

/** The detail's flag toggle, reduced to the one thing it renders from: the
 *  upgraded `TrackSummary`'s `debug === true`. */
function FlagReader(): React.ReactElement {
  const { track } = useTrackById(DEVICE_ID, TRACK_ID, '')
  return React.createElement(
    'span',
    { 'data-testid': 'flag' },
    track?.debug === true ? 'on' : 'off',
  )
}

/**
 * The reel / events-page shape: one long-lived surface that mounts and
 * unmounts the detail. Closing is an unmount; reopening is a fresh mount over
 * the SAME query cache.
 */
function Harness(): React.ReactElement {
  const [open, setOpen] = useState(true)
  const setFlags = useSetTrackFlags()
  return React.createElement(
    'div',
    null,
    open
      ? React.createElement(FlagReader, { key: 'reader' })
      : React.createElement('span', { key: 'reader', 'data-testid': 'flag' }, 'closed'),
    React.createElement('button', {
      key: 'set',
      'data-testid': 'set',
      onClick: () =>
        setFlags.mutate({ deviceId: DEVICE_ID, trackId: TRACK_ID, flags: { debug: true } }),
    }),
    React.createElement('button', {
      key: 'close',
      'data-testid': 'close',
      onClick: () => setOpen(false),
    }),
    React.createElement('button', {
      key: 'open',
      'data-testid': 'open',
      onClick: () => setOpen(true),
    }),
  )
}

function flagText(container: HTMLElement): string {
  return container.querySelector('[data-testid="flag"]')?.textContent ?? ''
}

function click(container: HTMLElement, testId: string): void {
  const el = container.querySelector(`[data-testid="${testId}"]`)
  if (el === null) throw new Error(`no [data-testid="${testId}"]`)
  fireEvent.click(el)
}

/** A hub that actually STORES the flag. A stub that simply echoes `true` back
 *  would pass whether or not the write reached the hub — this repo has shipped
 *  that mistake before. */
function hubWithFlagStore(): Record<string, unknown> {
  let debug = false
  return {
    'pipelineAnalytics.getTrack': () => ({
      trackId: TRACK_ID,
      deviceId: DEVICE_ID,
      className: 'person',
      firstSeen: 1_787_000_000_000,
      lastSeen: 1_787_000_005_000,
      bestEventId: 'evt-1',
      debug,
    }),
    'pipelineAnalytics.setTrackFlags': (input?: unknown) => {
      const flags =
        typeof input === 'object' && input !== null && 'flags' in input
          ? (input as { readonly flags: { readonly debug?: boolean } }).flags
          : {}
      if (typeof flags.debug === 'boolean') debug = flags.debug
      return {
        trackId: TRACK_ID,
        markForTrain: false,
        debug,
        favourited: false,
        retrainStatus: 'none',
      }
    },
  }
}

describe('a flag set in the track detail survives closing and reopening it', () => {
  it('reopens ON, without waiting out the 60 s staleTime', async () => {
    const { container } = mountScreen(React.createElement(Harness), { hub: hubWithFlagStore() })

    // 1. The track opens with the flag off, as the hub reports it.
    await waitFor(() => expect(flagText(container)).toBe('off'))

    // 2. The operator sets it; the hub now holds `debug: true`.
    click(container, 'set')
    await waitFor(() => expect(flagText(container)).toBe('on'))

    // 3. They close the detail…
    click(container, 'close')
    await waitFor(() => expect(flagText(container)).toBe('closed'))

    // 4. …and reopen it seconds later — well inside `staleTime`, so nothing
    //    refetches and the cached row is all the toggle has to go on.
    click(container, 'open')
    await waitFor(() => expect(flagText(container)).toBe('on'))
  })

  it('publishes the hub ANSWER, never the requested patch', async () => {
    // A hub that REFUSES (the per-camera pin budget) answers with the flag
    // still false. The cache must end up holding that refusal — an optimistic
    // `true` here would make a refused mark reappear as set on the next open,
    // which is worse than the bug this fix removes.
    const { container } = mountScreen(React.createElement(Harness), {
      hub: {
        'pipelineAnalytics.getTrack': {
          trackId: TRACK_ID,
          deviceId: DEVICE_ID,
          className: 'person',
          firstSeen: 1,
          lastSeen: 2,
          bestEventId: 'evt-1',
          debug: false,
        },
        'pipelineAnalytics.setTrackFlags': {
          trackId: TRACK_ID,
          markForTrain: false,
          debug: false,
          favourited: false,
          retrainStatus: 'none',
        },
      },
    })

    await waitFor(() => expect(flagText(container)).toBe('off'))
    click(container, 'set')
    click(container, 'close')
    click(container, 'open')

    await waitFor(() => expect(flagText(container)).toBe('off'))
    expect(flagText(container)).toBe('off')
  })
})
