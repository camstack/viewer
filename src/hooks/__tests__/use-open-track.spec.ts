/**
 * @vitest-environment jsdom
 *
 * "I add a flag to a track, I close, I reopen — it is not loaded. But it
 * rehydrates if I toggle ANOTHER flag."
 *
 * The write publishes itself into `useTrackById`'s cache row, and a reopen of the
 * same track inside that row's freshness window changes no id and no cached
 * identity — so any "deliver the upgrade once" effect keyed on them never ran
 * again and the detail reopened on the flag-less summary. `useOpenTrack` derives
 * the upgrade instead, so a reopen simply reads the cache again.
 *
 * RED if the upgrade becomes an effect keyed on the track id: step 4 stays
 * `off:row`.
 */
import React from 'react'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mountScreen } from '../../testing/mount.js'
import { useOpenTrack } from '../use-open-track.js'
import { useSetTrackFlags } from '../../data/use-track-flags.js'
import { trackSummaryFromRow } from '../../data/track-events.js'
import { toEventsTrackRow } from '../../../shared/events/events-track-row.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const DEVICE_ID = 102
const TRACK_ID = 'b8427bc7-cd58-4b9b-bb88-1a2c7dff9dde'
const ROW = toEventsTrackRow(
  { trackId: TRACK_ID, deviceId: DEVICE_ID, className: 'person', label: 'row', firstSeen: 1_787_000_000_000, lastSeen: 1_787_000_005_000, bestEventId: 'evt-1' },
  new Map([[DEVICE_ID, 'Gate']]),
)

function Harness(): React.ReactElement {
  const { selected, intent, open, close, select } = useOpenTrack()
  const setFlags = useSetTrackFlags()
  const [wrote, setWrote] = React.useState(false)
  if (ROW === null) throw new Error('fixture row did not normalise')
  return React.createElement('div', null,
    React.createElement('span', { 'data-testid': 'flag' },
      selected === null ? 'closed' : `${selected.debug === true ? 'on' : 'off'}:${selected.label ?? 'none'}:${selected.cameraName}:${intent ?? '-'}`),
    React.createElement('span', { 'data-testid': 'wrote' }, wrote ? 'yes' : 'no'),
    React.createElement('button', { 'data-testid': 'open', onClick: () => open(ROW) }),
    React.createElement('button', { 'data-testid': 'open-assign', onClick: () => open(ROW, 'assign-face') }),
    React.createElement('button', { 'data-testid': 'close', onClick: close }),
    React.createElement('button', { 'data-testid': 'select', onClick: () => select(trackSummaryFromRow({ ...ROW, trackId: 'other' })) }),
    React.createElement('button', {
      'data-testid': 'set',
      onClick: () => setFlags.mutate({ deviceId: DEVICE_ID, trackId: TRACK_ID, flags: { debug: true } }, { onSuccess: () => setWrote(true) }),
    }))
}

const text = (c: HTMLElement, id: string): string => c.querySelector(`[data-testid="${id}"]`)?.textContent ?? ''
const click = (c: HTMLElement, id: string): void => {
  const el = c.querySelector(`[data-testid="${id}"]`)
  if (el === null) throw new Error(`no ${id}`)
  fireEvent.click(el)
}

/** A hub that actually STORES the flag — an echo stub would pass either way. */
function hubWithFlagStore(): Record<string, unknown> {
  let debug = false
  return {
    'deviceManager.listAll': [],
    'pipelineAnalytics.getTrack': () => ({
      trackId: TRACK_ID, deviceId: DEVICE_ID, className: 'person', label: 'resolved',
      firstSeen: 1_787_000_000_000, lastSeen: 1_787_000_005_000, bestEventId: 'evt-1', debug,
    }),
    'pipelineAnalytics.setTrackFlags': (input?: unknown) => {
      const flags = typeof input === 'object' && input !== null && 'flags' in input ? (input as { flags: { debug?: boolean } }).flags : {}
      if (typeof flags.debug === 'boolean') debug = flags.debug
      return { trackId: TRACK_ID, markForTrain: false, debug, favourited: false, retrainStatus: 'none' }
    },
  }
}

afterEach(cleanup)

describe('useOpenTrack', () => {
  it('opens at once from the row (its own label), then upgrades in place — keeping the camera name', async () => {
    const { container } = mountScreen(React.createElement(Harness), { hub: hubWithFlagStore() })
    click(container, 'open')
    expect(text(container, 'flag')).toBe('off:row:Gate:-')
    await waitFor(() => expect(text(container, 'flag')).toBe('off:resolved:Gate:-'))
  })

  it('mutate → close → reopen the SAME track → the flag is there', async () => {
    const { container } = mountScreen(React.createElement(Harness), { hub: hubWithFlagStore() })
    click(container, 'open')
    await waitFor(() => expect(text(container, 'flag')).toBe('off:resolved:Gate:-'))
    click(container, 'set')
    await waitFor(() => expect(text(container, 'wrote')).toBe('yes'))
    click(container, 'close')
    expect(text(container, 'flag')).toBe('closed')
    // The summary opens flag-less by design; the cached row, published by the
    // write, must reach it without another toggle.
    click(container, 'open')
    await waitFor(() => expect(text(container, 'flag')).toBe('on:resolved:Gate:-'))
  })

  it('the intent belongs to ONE opening: a later plain open and a prev/next move both clear it', async () => {
    const { container } = mountScreen(React.createElement(Harness), { hub: hubWithFlagStore() })
    click(container, 'open-assign')
    expect(text(container, 'flag')).toMatch(/:assign-face$/)
    click(container, 'close')
    click(container, 'open')
    expect(text(container, 'flag')).toMatch(/:-$/)
    click(container, 'open-assign')
    act(() => click(container, 'select'))
    expect(text(container, 'flag')).toMatch(/:-$/)
  })

  it('a late answer about a track that is no longer on screen is ignored', async () => {
    const { container } = mountScreen(React.createElement(Harness), { hub: hubWithFlagStore() })
    click(container, 'open')
    // Move on BEFORE the getTrack for the first track lands.
    click(container, 'select')
    await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
    expect(text(container, 'flag')).not.toContain('resolved')
  })
})
