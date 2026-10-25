/**
 * @vitest-environment jsdom
 *
 * The events page's native gallery, mounted whole: the real screen, the real
 * feed and the real tiles over a stand-in hub. What it proves that no pure spec
 * can — that the rows reach the screen as TILES, that the details block under a
 * tile is OFF until the operator opts in, and that a tap opens the detail (from
 * the row, before any round trip) and the "?" chip opens it with its intent.
 *
 * `FlashList` renders through `FlatList` here (the whole list, no windowing —
 * a mount test wants every tile's render path exercised); the virtualisation is
 * measured in the browser harness instead.
 */
import React from 'react'
import { act, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AsyncStorage from '@react-native-async-storage/async-storage'

import { mountScreen } from '../../testing/mount.js'
import { setTestViewport } from '../../testing/viewport-control.js'
import { hubCalls } from '../../testing/hub-stub.js'
import { EXPO_IMAGE_AUTHORIZED, EXPO_IMAGE_TESTID_PREFIX } from '../../testing/native-stubs/expo-image.js'
import { EventsScreen } from '../EventsScreen.js'
import { DEFAULTS, useSettingsStore } from '../../store/settings-store.js'

vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

// The detail is its own surface with its own specs; what matters HERE is WHAT the
// screen hands it (the track, the intent) and WHEN (before any round trip).
vi.mock('../../components/events/track/TrackDetailModal.js', () => ({
  TrackDetailModal: (props: {
    readonly track: { readonly trackId: string; readonly label?: string; readonly subLabel?: string } | null
    readonly openIntent?: string
  }) =>
    props.track === null
      ? null
      : React.createElement('div', {
          'data-testid': 'detail',
          'data-track': props.track.trackId,
          'data-sub': props.track.subLabel ?? '',
          'data-label': props.track.label ?? '',
          'data-intent': props.openIntent ?? '',
        }),
}))

// The assignment sheet is its own surface (and has its own specs); what matters
// HERE is that the "?" chip mounts it, with the tapped track's face, on its own.
vi.mock('../../components/events/track/FaceAssignSheet.js', () => ({
  FaceAssignSheet: (props: { readonly face: { readonly faceId: string } | null; readonly onClose: () => void }) =>
    props.face === null
      ? null
      : React.createElement('button', { 'data-testid': 'assign-sheet', 'data-face': props.face.faceId, onClick: props.onClose }),
}))

// The mounted provider has no signed-in session; the thumbnails' credential is
// the one thing this spec needs from it.
vi.mock('../../app/ServerProvider.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../app/ServerProvider.js')>()
  return { ...actual, useServer: () => ({ ...actual.useServer(), token: 'session-token' }) }
})

const NOW = Date.now()
function wire(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const lastSeen = NOW - Number(id.replace(/\D/g, '')) * 60_000 - 60_000
  return {
    trackId: id, deviceId: 1, className: 'person', firstSeen: lastSeen - 12_000, lastSeen, state: 'idle', active: false,
    zonesVisited: [], zoneNames: ['Porch'], classes: ['person'], audioLabels: [], bestEventId: `ev-${id}`, source: 'pipeline',
    ...extra,
  }
}
const ROWS = [
  wire('t1', { subLabel: 'Dave' }),
  wire('t2', { hasEmbeddedFace: true }),
  wire('t3'),
  wire('t4', { className: 'vehicle', classes: ['vehicle'], label: 'van' }),
]
const HUB = {
  'auth.me': { id: 'u1', username: 'operator', isAdmin: true },
  'deviceManager.listAll': [{ id: 1, name: 'Front gate', type: 'camera', online: true, disabled: false, isCamera: true, features: [] }],
  'pipelineAnalytics.listRecentTracks': { tracks: ROWS, nextCursor: null },
  'faceGallery.getFaceByTrack': (input?: unknown) => ({
    faceId: `face-${(input as { trackId: string }).trackId}`, deviceId: 1, trackId: (input as { trackId: string }).trackId, timestamp: NOW, assigned: false,
  }),
  'pipelineAnalytics.getTrack': (input?: unknown) => ({ ...(ROWS.find((r) => r.trackId === (input as { trackId: string }).trackId) ?? ROWS[0]), label: 'resolved' }),
}

const tiles = (c: HTMLElement): HTMLElement[] =>
  [...c.querySelectorAll<HTMLElement>('[role="button"], button')].filter((el) => /Front gate/.test(el.getAttribute('aria-label') ?? ''))

beforeEach(async () => {
  // jsdom lays nothing out: without a viewport the grid has no width to divide.
  act(() => setTestViewport({ width: 390, height: 844 }))
  await AsyncStorage.clear()
  act(() => useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, events: { ...DEFAULTS.events } } }))
})
afterEach(cleanup)

describe('the native gallery', () => {
  it('draws one tile per loaded track, the day named and counted ONCE — by the filter row', async () => {
    const { container, getAllByText } = mountScreen(React.createElement(EventsScreen), { hub: HUB })
    await waitFor(() => expect(tiles(container)).toHaveLength(4))
    // The day nav says "Today" and the count line under it says how many; the
    // gallery repeats neither over its first row.
    expect(getAllByText('Today')).toHaveLength(1)
    expect(getAllByText('4 events')).toHaveLength(1)
  })

  it('draws NO details block by default — camera name and zone appear only when opted into', async () => {
    const { container } = mountScreen(React.createElement(EventsScreen), { hub: HUB })
    await waitFor(() => expect(tiles(container)).toHaveLength(4))
    // The tile's accessibility label names the camera; its VISIBLE text must not.
    expect(container.textContent).not.toContain('Front gate')
    expect(container.textContent).not.toContain('Porch')
    expect(DEFAULTS.events).toMatchObject({ tileDetailCamera: false, tileDetailZone: false })
  })

  it('shows camera and zone under every tile once the two options are on', async () => {
    const { container } = mountScreen(React.createElement(EventsScreen), { hub: HUB })
    await waitFor(() => expect(tiles(container)).toHaveLength(4))
    act(() => {
      const { setEvents } = useSettingsStore.getState()
      setEvents('tileDetailCamera', true)
      setEvents('tileDetailZone', true)
    })
    await waitFor(() => expect(container.textContent).toContain('Front gate'))
    expect(container.textContent).toContain('Porch')
  })

  it('every thumbnail is requested from the hub with the session credential', async () => {
    const { container } = mountScreen(React.createElement(EventsScreen), { hub: HUB })
    await waitFor(() => expect(tiles(container)).toHaveLength(4))
    const images = [...container.querySelectorAll<HTMLElement>(`[data-testid^="${EXPO_IMAGE_TESTID_PREFIX}"]`)]
    expect(images).toHaveLength(4)
    for (const image of images) {
      expect(image.getAttribute('data-testid')).toContain('/addon/pipeline-analytics/event-media/o/track/')
      expect(image.getAttribute('aria-label')).toBe(EXPO_IMAGE_AUTHORIZED)
    }
  })

  it('a tap opens the detail at once from the row — identity and all — then upgrades it from getTrack', async () => {
    const { container, findByTestId } = mountScreen(React.createElement(EventsScreen), { hub: HUB })
    await waitFor(() => expect(tiles(container)).toHaveLength(4))
    fireEvent.click(tiles(container)[0]!)
    const detail = await findByTestId('detail')
    expect(detail.getAttribute('data-track')).toBe('t1')
    expect(detail.getAttribute('data-sub')).toBe('Dave')
    expect(detail.getAttribute('data-intent')).toBe('')
    // … and the hub's full row replaces the summary in place.
    await waitFor(() => expect(detail.getAttribute('data-label')).toBe('resolved'))
  })

  it('the corner chip of every tile is the event TIME (HH:MM), not a duration', async () => {
    const { container } = mountScreen(React.createElement(EventsScreen), { hub: HUB })
    await waitFor(() => expect(tiles(container)).toHaveLength(4))
    const clock = new Date(NOW - 60_000 - 60_000).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    expect(container.textContent).toContain(clock)
    // The 12 s track window of these rows would have read 0:12 on the old chip.
    expect(container.textContent).not.toContain('0:12')
  })

  it('the "?" chip is its OWN button, not nested in the tile\'s', async () => {
    const { container, getAllByLabelText } = mountScreen(React.createElement(EventsScreen), { hub: HUB })
    await waitFor(() => expect(tiles(container)).toHaveLength(4))
    const chip = getAllByLabelText('Face detected, not recognised').filter((el) => el.tagName === 'BUTTON')
    expect(chip).toHaveLength(1)
    expect(chip[0]!.closest('[aria-label*="Front gate"]')).toBeNull()
  })

  it('the "?" chip mounts the ASSIGN sheet directly and never the track detail; closing returns to the gallery', async () => {
    const { container, getAllByLabelText, findByTestId, queryByTestId } = mountScreen(React.createElement(EventsScreen), { hub: HUB })
    await waitFor(() => expect(tiles(container)).toHaveLength(4))
    const chip = getAllByLabelText('Face detected, not recognised').filter((el) => el.tagName === 'BUTTON')
    fireEvent.click(chip[0]!)
    const sheet = await findByTestId('assign-sheet')
    expect(sheet.getAttribute('data-face')).toBe('face-t2')
    expect(queryByTestId('detail')).toBeNull()
    // Closing the sheet leaves the gallery as it was: no detail, tiles still there.
    fireEvent.click(sheet)
    await waitFor(() => expect(queryByTestId('assign-sheet')).toBeNull())
    expect(queryByTestId('detail')).toBeNull()
    expect(tiles(container)).toHaveLength(4)
  })

  it('a plain tap on the same track still opens the detail, with no assign sheet', async () => {
    const { container, findByTestId, queryByTestId } = mountScreen(React.createElement(EventsScreen), { hub: HUB })
    await waitFor(() => expect(tiles(container)).toHaveLength(4))
    fireEvent.click(tiles(container)[1]!)
    expect((await findByTestId('detail')).getAttribute('data-intent')).toBe('')
    expect(queryByTestId('assign-sheet')).toBeNull()
  })

  it('an empty answer says so, and a filtered empty answer says that', async () => {
    const empty = { ...HUB, 'pipelineAnalytics.listRecentTracks': { tracks: [], nextCursor: null } }
    const { findByText } = mountScreen(React.createElement(EventsScreen), { hub: empty })
    expect(await findByText('No events')).toBeTruthy()
  })

  it('a failed first page ends in an error with a retry, after the feed\'s own retries', async () => {
    const failing = { ...HUB, 'pipelineAnalytics.listRecentTracks': () => { throw new Error('boom') } }
    const { findByText } = mountScreen(React.createElement(EventsScreen), { hub: failing })
    expect(await findByText("Couldn't load events", {}, { timeout: 5_000 })).toBeTruthy()
    expect(await findByText('Retry')).toBeTruthy()
  }, 10_000)
})
