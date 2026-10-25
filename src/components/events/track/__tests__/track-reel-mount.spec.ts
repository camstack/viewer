/**
 * @vitest-environment jsdom
 *
 * The Recent reel, native: the SAME feed as the gallery (`useEventsGalleryFeed`
 * — shared paging, delta, filters), drawn as a horizontal strip of the gallery's
 * own picture over a one-line time footer.
 *
 * Mounted over a stand-in hub: what the strip asks for (24 h floor, the reel's
 * own source exclusion), what it draws, what a tap hands the detail, and that it
 * keeps its reserved height in every state — the Cameras page is built around a
 * fixed header, so a strip that grows or collapses is the defect.
 */
import React from 'react'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { mountScreen } from '../../../../testing/mount.js'
import { hubCalls } from '../../../../testing/hub-stub.js'
import { emitAppState } from '../../../../testing/app-state-control.js'
import { setTestViewport } from '../../../../testing/viewport-control.js'
import { TrackReel } from '../TrackReel.js'
import { reelRowHeight } from '../reel-layout.js'
import { mountedEventsFeedCount } from '../../../../events/events-feed-registry.js'

vi.mock('../../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../../testing/connection-stub.js')).connectionStubModule(),
)
vi.mock('../TrackDetailModal.js', () => ({
  TrackDetailModal: (props: { readonly track: { readonly trackId: string } | null }) =>
    props.track === null ? null : React.createElement('div', { 'data-testid': 'detail', 'data-track': props.track.trackId }),
}))

const NOW = Date.now()
function wire(id: string, minutesAgo: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const lastSeen = NOW - minutesAgo * 60_000
  return { trackId: id, deviceId: 1, className: 'person', firstSeen: lastSeen - 8_000, lastSeen, state: 'idle', active: false,
    zonesVisited: [], zoneNames: [], classes: ['person'], audioLabels: [], bestEventId: `ev-${id}`, source: 'pipeline', ...extra }
}
const ROWS = [wire('r1', 5, { subLabel: 'Giulia' }), wire('r2', 30), wire('r3', 90)]
const HUB = {
  'auth.me': { id: 'u1', username: 'operator', isAdmin: true },
  'deviceManager.listAll': [{ id: 1, name: 'Front gate', type: 'camera', online: true, disabled: false, isCamera: true, features: [] }],
  'pipelineAnalytics.listRecentTracks': { tracks: ROWS, nextCursor: null },
}

const cards = (c: HTMLElement): HTMLElement[] =>
  [...c.querySelectorAll<HTMLElement>('[role="button"], button')].filter((el) => /Front gate/.test(el.getAttribute('aria-label') ?? ''))
const calls = (): readonly Record<string, unknown>[] =>
  hubCalls().filter((c) => c.path === 'pipelineAnalytics.listRecentTracks').map((c) => c.input as Record<string, unknown>)

beforeEach(async () => {
  act(() => setTestViewport({ width: 390, height: 844 }))
  await AsyncStorage.clear()
})
afterEach(() => {
  cleanup()
  act(() => emitAppState('active'))
})

describe('the native reel', () => {
  it('draws a card per recent track, newest first, from the one shared feed', async () => {
    const { container } = mountScreen(React.createElement(TrackReel, { cardWidth: 80 }), { hub: HUB })
    await waitFor(() => expect(cards(container)).toHaveLength(3))
    // Newest first: the identity-named track is the head of the strip.
    expect(cards(container)[0]!.getAttribute('aria-label')).toMatch(/^Giulia, Front gate/)
  })

  it('asks for the last 24 h only, and for the reel\'s own hidden sources', async () => {
    const { container } = mountScreen(React.createElement(TrackReel, { cardWidth: 80 }), { hub: HUB })
    await waitFor(() => expect(cards(container)).toHaveLength(3))
    const input = calls()[0]!
    expect(Date.now() - (input.since as number)).toBeLessThan(25 * 3_600_000)
    // The reel's default filter (detections) hides audio and sensor markers on the READ.
    expect(input.excludeSources).toEqual(['audio', 'sensor'])
    expect(input.deviceIds).toEqual([1])
  })

  it('one camera scopes the strip to it', async () => {
    const { container } = mountScreen(React.createElement(TrackReel, { cardWidth: 80, deviceId: 1 }), { hub: HUB })
    await waitFor(() => expect(cards(container)).toHaveLength(3))
    expect(calls()[0]!.deviceIds).toEqual([1])
  })

  it('a tap opens the detail from the row it holds', async () => {
    const { container, findByTestId } = mountScreen(React.createElement(TrackReel, { cardWidth: 80 }), { hub: HUB })
    await waitFor(() => expect(cards(container)).toHaveLength(3))
    fireEvent.click(cards(container)[1]!)
    expect((await findByTestId('detail')).getAttribute('data-track')).toBe('r2')
  })

  it('keeps its reserved height when empty, and says why', async () => {
    const hub = { ...HUB, 'pipelineAnalytics.listRecentTracks': { tracks: [], nextCursor: null } }
    const { container, findByText } = mountScreen(React.createElement(TrackReel, { cardWidth: 80 }), { hub })
    expect(await findByText('No events')).toBeTruthy()
    const strip = container.firstElementChild as HTMLElement
    expect(strip.style.height).toBe(`${reelRowHeight(80)}px`)
  })

  it('keeps its reserved height on a failure and offers a retry inside the band', async () => {
    const hub = { ...HUB, 'pipelineAnalytics.listRecentTracks': () => { throw new Error('boom') } }
    const { container, findByText } = mountScreen(React.createElement(TrackReel, { cardWidth: 80 }), { hub })
    expect(await findByText('Retry', {}, { timeout: 5_000 })).toBeTruthy()
    expect((container.firstElementChild as HTMLElement).style.height).toBe(`${reelRowHeight(80)}px`)
  }, 10_000)

  it('is in the live-update registry while the app is in front, and OUT of it when it is not', async () => {
    const { container } = mountScreen(React.createElement(TrackReel, { cardWidth: 80 }), { hub: HUB })
    await waitFor(() => expect(cards(container)).toHaveLength(3))
    expect(mountedEventsFeedCount()).toBe(1)
    act(() => emitAppState('background'))
    expect(mountedEventsFeedCount()).toBe(0)
    act(() => emitAppState('active'))
    expect(mountedEventsFeedCount()).toBe(1)
  })
})
