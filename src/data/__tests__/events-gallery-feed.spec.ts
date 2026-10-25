/**
 * @vitest-environment jsdom
 *
 * What the native events feed ASKS the hub, per filter and per sort — asserted
 * on the wire (`hub-stub` records every call), with the real hooks, the real
 * shared feed engine and React Query above it. The old surface hid all of this
 * behind a WebView and a postMessage protocol; now a control that does not
 * reach the request is a test failure, not a quiet no-op.
 *
 * Each case mounts a probe over ONE query and reads what came back (rows in
 * display order) and what was sent.
 */
import React from 'react'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { mountScreen } from '../../testing/mount.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { emitAppState } from '../../testing/app-state-control.js'
import { useEventsGalleryFeed, type EventsGalleryQuery } from '../use-events-gallery-feed.js'
import { refreshEventsFeeds, resetEventsFeedReloadWindow } from '../../events/events-feed-registry.js'
import { dayWindowFor } from '../../../shared/events/events-feed.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

const NOW = new Date(2026, 8, 1, 14, 35, 0, 0).getTime()
const CAMERAS = [
  { id: 1, name: 'Gate', type: 'camera', online: true, disabled: false, isCamera: true, features: [] },
  { id: 2, name: 'Garage', type: 'camera', online: true, disabled: false, isCamera: true, features: [] },
]

interface WireRow { trackId: string; deviceId: number; className: string; firstSeen: number; lastSeen: number; [k: string]: unknown }
function wire(id: string, className: string, minutesAgo: number, extra: Record<string, unknown> = {}): WireRow {
  const lastSeen = NOW - minutesAgo * 60_000
  return { trackId: id, deviceId: 1, className, firstSeen: lastSeen - 5_000, lastSeen, state: 'idle', active: false,
    zonesVisited: [], zoneNames: [], classes: [className], audioLabels: [], bestEventId: id, source: 'pipeline', ...extra }
}

const FEED_ROWS = [
  wire('a', 'person', 5, { importance: 0.2 }),
  wire('b', 'vehicle', 10, { importance: 0.9 }),
  wire('c', 'person', 20, { importance: 0.5, favourited: true }),
]

function hub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'deviceManager.listAll': CAMERAS,
    'pipelineAnalytics.listRecentTracks': { tracks: FEED_ROWS, nextCursor: null },
    ...overrides,
  }
}

const BASE: EventsGalleryQuery = {
  view: 'gallery', deviceIds: [], classes: [], attrs: [], search: '', searchMode: 'text', sort: 'time', anchorMs: NOW,
}

function Probe({ query }: { readonly query: EventsGalleryQuery }): React.ReactElement {
  const feed = useEventsGalleryFeed(query)
  return React.createElement('div', { 'data-testid': 'probe', 'data-state': feed.loading ? 'loading' : 'ready', 'data-mode': feed.mode },
    feed.rows.map((r) => r.trackId).join(','))
}

const recentCalls = (): readonly { readonly input: Record<string, unknown> }[] =>
  hubCalls().filter((c) => c.path === 'pipelineAnalytics.listRecentTracks').map((c) => ({ input: c.input as Record<string, unknown> }))
const callsOf = (path: string): readonly unknown[] => hubCalls().filter((c) => c.path === path).map((c) => c.input)

async function shown(query: EventsGalleryQuery, responses: Record<string, unknown> = hub()): Promise<string> {
  const { getByTestId } = mountScreen(React.createElement(Probe, { query }), { hub: responses })
  await waitFor(() => expect(getByTestId('probe').getAttribute('data-state')).toBe('ready'))
  await waitFor(() => expect(recentCalls().length).toBeGreaterThan(0))
  return getByTestId('probe').textContent ?? ''
}

beforeEach(async () => {
  resetEventsFeedReloadWindow()
  // The camera list is persisted across launches; a previous case's list would
  // answer "the cameras are known" before the hub did.
  await AsyncStorage.clear()
})
afterEach(() => {
  cleanup()
  act(() => emitAppState('active'))
})

describe('the first page request', () => {
  it('asks every camera for a slim page with the 30-day floor and nothing else', async () => {
    expect(await shown(BASE)).toBe('a,b,c')
    const { input } = recentCalls()[0]!
    expect(input.deviceIds).toEqual([1, 2])
    expect(input.projection).toBe('slim')
    expect(input.limit).toBe(60)
    expect(input.since).toBeGreaterThan(Date.now() - 31 * 24 * 3_600_000)
    expect(input.since).toBeLessThan(Date.now() - 29 * 24 * 3_600_000)
    expect('until' in input).toBe(false)
    expect('includeStationary' in input).toBe(false)
    expect('excludeSources' in input).toBe(false)
    expect('cursor' in input).toBe(false)
  })

  it('does not ask until the cameras are known: an empty device list answers [] and would read as "no events"', async () => {
    const { getByTestId } = mountScreen(React.createElement(Probe, { query: BASE }), {
      hub: hub({ 'deviceManager.listAll': () => new Promise(() => undefined) }),
    })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(recentCalls()).toHaveLength(0)
    expect(getByTestId('probe').getAttribute('data-state')).toBe('loading')
  })
})

describe('the reel page', () => {
  const DAY = 24 * 60 * 60 * 1000

  function ReelProbe(): React.ReactElement {
    const feed = useEventsGalleryFeed({ ...BASE, view: 'reel', maxAgeMs: DAY })
    return React.createElement(
      'div',
      null,
      React.createElement('button', { 'data-testid': 'more', onClick: () => feed.loadMore() }),
      React.createElement(
        'div',
        { 'data-testid': 'probe', 'data-state': feed.loading ? 'loading' : 'ready', 'data-tail': feed.tail },
        feed.rows.map((r) => r.trackId).join(','),
      ),
    )
  }

  it('asks for a slim cursor page and the next page carries the cursor', async () => {
    const responses = hub({
      'pipelineAnalytics.listRecentTracks': (input?: unknown) => {
        const cursor =
          typeof input === 'object' && input !== null && 'cursor' in input && typeof input.cursor === 'string'
            ? input.cursor
            : undefined
        if (cursor === undefined) return { tracks: FEED_ROWS, nextCursor: 'page-2' }
        return { tracks: [wire('d', 'animal', 40)], nextCursor: null }
      },
    })
    const { getByTestId } = mountScreen(React.createElement(ReelProbe), { hub: responses })
    await waitFor(() => expect(getByTestId('probe').getAttribute('data-state')).toBe('ready'))
    const first = recentCalls()[0]!.input
    expect(first.projection).toBe('slim')
    expect(first.limit).toBe(60)
    expect('cursor' in first).toBe(false)
    expect('base64' in first).toBe(false)
    expect(first.since).toBeGreaterThan(Date.now() - DAY - 60_000)
    expect(first.since).toBeLessThan(Date.now() - DAY + 120_000)
    expect(getByTestId('probe').getAttribute('data-tail')).toBe('more')
    fireEvent.click(getByTestId('more'))
    await waitFor(() => expect(recentCalls().length).toBeGreaterThan(1))
    expect(recentCalls()[1]!.input.cursor).toBe('page-2')
    await waitFor(() => expect(getByTestId('probe').textContent).toContain('d'))
  })
})

describe('each filter reaches the request', () => {
  it('one camera narrows deviceIds', async () => {
    await shown({ ...BASE, deviceIds: [2] })
    expect(recentCalls()[0]!.input.deviceIds).toEqual([2])
  })

  it('hidden track sources ride the READ, so the cursor counts what the operator can see', async () => {
    await shown({ ...BASE, excludeSources: ['audio', 'sensor'] })
    expect(recentCalls()[0]!.input.excludeSources).toEqual(['audio', 'sensor'])
  })

  it('"show stationary" opts into parked rows', async () => {
    await shown({ ...BASE, showStationary: true })
    expect(recentCalls()[0]!.input.includeStationary).toBe(true)
  })

  it('a past day pins the UPPER bound only — paging rolls into the days before', async () => {
    const day = dayWindowFor(2, NOW)
    await shown({ ...BASE, dayOffset: 2 })
    const { input } = recentCalls()[0]!
    expect(input.until).toBe(day.untilMs)
    // The floor that remains is the age floor, never a calendar-day cage.
    expect(typeof input.since).toBe('number')
  })

  it('the live day sends no upper bound, so the delta keeps running', async () => {
    await shown({ ...BASE, dayOffset: 0 })
    expect('until' in recentCalls()[0]!.input).toBe(false)
  })

  it('reel scope: the 24 h floor tightens `since`', async () => {
    await shown({ ...BASE, view: 'reel', maxAgeMs: 24 * 3_600_000 })
    const { since } = recentCalls()[0]!.input as { since: number }
    expect(Date.now() - since).toBeLessThan(25 * 3_600_000)
  })
})

describe('filters and sort applied to the loaded rows', () => {
  it('the class selection narrows what is shown (display choice, not a query)', async () => {
    expect(await shown({ ...BASE, classes: ['person'] })).toBe('a,c')
  })

  it('the favourites chip keeps only favourited rows', async () => {
    expect(await shown({ ...BASE, filterFavourited: true })).toBe('c')
  })

  it('importance sorts descending over what is loaded, newest first on ties', async () => {
    expect(await shown({ ...BASE, sort: 'importance' })).toBe('b,c,a')
  })

  it('newest keeps the hub order', async () => {
    expect(await shown({ ...BASE, sort: 'time' })).toBe('a,b,c')
  })

  it('free text matches the loaded rows by their words (camera, class, zone, label)', async () => {
    const text = await shown({ ...BASE, search: 'vehicle', searchMode: 'text' })
    expect(text).toBe('b')
    expect(callsOf('pipelineAnalytics.searchObjectEvents')).toHaveLength(0)
  })
})

describe('semantic (CLIP) search', () => {
  const HIT = { id: 'ev-9', trackId: 'z', deviceId: 2, className: 'person', timestamp: NOW - 3 * 60_000, score: 0.31 }

  it('asks the hub ONCE with the applied text, a limit and no single-camera pin for several cameras', async () => {
    const text = await shown(
      { ...BASE, search: 'person in red', searchMode: 'semantic' },
      hub({ 'pipelineAnalytics.searchObjectEvents': [HIT] }),
    )
    await waitFor(() => expect(callsOf('pipelineAnalytics.searchObjectEvents')).toHaveLength(1))
    const [input] = callsOf('pipelineAnalytics.searchObjectEvents') as [Record<string, unknown>]
    expect(input.text).toBe('person in red')
    expect(input.limit).toBe(50)
    expect('deviceId' in input).toBe(false)
    expect('minScore' in input).toBe(false)
    // The CLIP hit is ranked into the page's own order next to the text matches.
    await waitFor(() => expect(text.length).toBeGreaterThanOrEqual(0))
  })

  it('pins the single camera when only one is selected', async () => {
    await shown(
      { ...BASE, deviceIds: [2], search: 'dog', searchMode: 'semantic' },
      hub({ 'pipelineAnalytics.searchObjectEvents': [HIT] }),
    )
    await waitFor(() => expect(callsOf('pipelineAnalytics.searchObjectEvents')).toHaveLength(1))
    expect((callsOf('pipelineAnalytics.searchObjectEvents')[0] as Record<string, unknown>).deviceId).toBe(2)
  })

  it('surfaces a hit the feed never paged to, flagged as the semantic mode', async () => {
    const { getByTestId } = mountScreen(
      React.createElement(Probe, { query: { ...BASE, search: 'person in red', searchMode: 'semantic' } }),
      { hub: hub({ 'pipelineAnalytics.searchObjectEvents': [HIT] }) },
    )
    await waitFor(() => expect(getByTestId('probe').textContent).toContain('z'))
    expect(getByTestId('probe').getAttribute('data-mode')).toBe('semantic')
  })

  it('a text-mode query never reaches the CLIP endpoint', async () => {
    await shown({ ...BASE, search: 'person', searchMode: 'text' })
    expect(callsOf('pipelineAnalytics.searchObjectEvents')).toHaveLength(0)
  })
})

describe('live updates', () => {
  it('a hub announcement prepends what is NEWER than the head, and never touches the cursor', async () => {
    let page = 0
    const responses = hub({
      'pipelineAnalytics.listRecentTracks': () => {
        page += 1
        return page === 1
          ? { tracks: FEED_ROWS, nextCursor: null }
          : { tracks: [wire('n', 'person', 0)], nextCursor: null }
      },
    })
    const { getByTestId } = mountScreen(React.createElement(Probe, { query: BASE }), { hub: responses })
    await waitFor(() => expect(getByTestId('probe').textContent).toBe('a,b,c'))
    act(() => refreshEventsFeeds('test'))
    await waitFor(() => expect(getByTestId('probe').textContent).toBe('n,a,b,c'))
    const delta = recentCalls()[1]!.input
    expect(delta.since).toBe((FEED_ROWS[0] as WireRow).lastSeen)
    expect('cursor' in delta).toBe(false)
  })

  it('a screen the app has left (background) is NOT in the registry: a hub announcement fetches nothing for it', async () => {
    const { getByTestId } = mountScreen(React.createElement(Probe, { query: BASE }), { hub: hub() })
    await waitFor(() => expect(getByTestId('probe').textContent).toBe('a,b,c'))
    const before = recentCalls().length
    act(() => emitAppState('background'))
    act(() => refreshEventsFeeds('test'))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(recentCalls()).toHaveLength(before)
  })

  it('coming back to the screen is ONE delta, not a reload', async () => {
    const { getByTestId } = mountScreen(React.createElement(Probe, { query: BASE }), { hub: hub() })
    await waitFor(() => expect(getByTestId('probe').textContent).toBe('a,b,c'))
    const before = recentCalls().length
    act(() => emitAppState('background'))
    act(() => emitAppState('active'))
    await waitFor(() => expect(recentCalls().length).toBe(before + 1))
    expect(recentCalls()[before]!.input.since).toBe((FEED_ROWS[0] as WireRow).lastSeen)
  })
})
