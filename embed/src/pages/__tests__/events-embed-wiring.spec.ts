/**
 * Render-level wiring of the events embed: a fake {@link EventsDataClient}
 * drives the real `Events` surface, and the assertions are on what the HOST
 * sees — the postMessage protocol — plus what is on screen.
 *
 * `.spec.ts` with `createElement`, not `.spec.tsx`: the bundle's root vitest
 * config routes `embed/**\/*.spec.ts` to jsdom and `widgets/**\/*.spec.tsx` to
 * jsdom, so a `.tsx` under `embed/` would run in the node environment and fail
 * on `document`. The layout is asserted from the DOM, so no JSX is needed.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventsDataClient, RecentTracksInput } from '../../embed/events-client'
import { type EventsConfig, parseEventsConfig } from '../../embed/events-config'
import { MEDIA_FETCH_CONCURRENCY, resetAuthedImageCache } from '../../embed/use-authed-image'
import { Events } from '../EmbedEventsPage'

interface HostMessage {
  readonly v?: number
  readonly type?: string
  readonly [key: string]: unknown
}

function track(trackId: string, deviceId: number, lastSeen: number): Record<string, unknown> {
  return {
    trackId,
    deviceId,
    className: 'person',
    firstSeen: lastSeen - 5_000,
    lastSeen,
    state: 'idle',
    active: false,
    positions: [],
    snapshots: [],
    zonesVisited: [],
    bestEventId: `evt-${trackId}`,
  }
}

function config(patch?: Partial<EventsConfig>): EventsConfig {
  const result = parseEventsConfig({
    serverUrl: 'https://hub.test',
    token: 'jwt',
    refreshMs: 0,
    ...patch,
  })
  if (!result.ok) throw new Error(result.error)
  return result.config
}

let posted: HostMessage[] = []
let requests: RecentTracksInput[] = []
let searches: unknown[] = []
let semanticHits: unknown[] = []
let taxonomy: unknown[] = []

/** Pages keyed by the cursor that produced them; `null` key = the first page. */
function fakeClient(pages: Map<string | null, { tracks: unknown[]; nextCursor: string | null }>) {
  const client: EventsDataClient = {
    listRecentTracks: (input) => {
      requests.push(input)
      const page = pages.get(input.cursor ?? null) ?? { tracks: [], nextCursor: null }
      return Promise.resolve(page)
    },
    listDevices: () =>
      Promise.resolve([
        { id: 101, name: 'Front Door' },
        { id: 102, name: 'Driveway' },
      ]),
    searchObjectEvents: (input) => {
      searches.push(input)
      return Promise.resolve(semanticHits)
    },
    listEventKinds: () => Promise.resolve(taxonomy),
  }
  return client
}

beforeEach(() => {
  posted = []
  requests = []
  searches = []
  semanticHits = []
  taxonomy = []
  resetAuthedImageCache()
  // The host bridge: a native-style bridge is the simplest to observe.
  ;(
    window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } }
  ).ReactNativeWebView = {
    postMessage: (s) => posted.push(JSON.parse(s) as HostMessage),
  }
  // jsdom has no IntersectionObserver; the sentinel must not throw.
  ;(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe(): void {}
    disconnect(): void {}
  }
  // Media bytes are irrelevant here — the cards must render without them.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false })),
  )
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:stub'
    URL.revokeObjectURL = () => {}
  }
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView
})

function messagesOfType(type: string): HostMessage[] {
  return posted.filter((m) => m.type === type)
}

describe('events embed wiring', () => {
  it('resolves ALL cameras when deviceIds is empty, then pages them merged', async () => {
    const pages = new Map([
      [null, { tracks: [track('a', 101, 3_000), track('b', 102, 2_000)], nextCursor: null }],
    ])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))

    await waitFor(() => expect(requests.length).toBeGreaterThan(0))
    // The device list was RESOLVED — an empty deviceIds would have returned [].
    expect(requests[0]?.deviceIds).toEqual([101, 102])
    expect(requests[0]?.projection).toBe('slim')
    expect(requests[0]?.cursor).toBeUndefined()
  })

  it('renders a card per track, titled, in the GALLERY layout', async () => {
    const pages = new Map([
      [null, { tracks: [track('a', 101, 3_000), track('b', 102, 2_000)], nextCursor: null }],
    ])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )

    await waitFor(() => {
      expect(document.querySelectorAll('[data-track-id]')).toHaveLength(2)
    })
    // Native parity: the CLASS is a glyph, not a text line. A finer label would
    // get its own chip — a bare `person` track has none, so the glyph carries it.
    expect(document.querySelectorAll('[data-testid="card-class-glyph"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-testid="card-title"]')).toHaveLength(0)
    // …and the attribution sits under the hero, camera then time.
    expect(screen.getByText(/Front Door/)).toBeTruthy()
    expect(screen.getByText(/Driveway/)).toBeTruthy()
    expect(document.querySelectorAll('[data-testid="card-time"]')).toHaveLength(2)
  })

  it('shows the FINEST label as its own chip, over the glyph', async () => {
    // The rule is the viewer's `trackTitle`: subLabel ?? label ?? className.
    const pages = new Map([
      [
        null,
        {
          tracks: [
            { ...track('a', 101, 3_000), label: 'dog', subLabel: 'Rex' },
            { ...track('b', 102, 2_000), label: 'truck' },
          ],
          nextCursor: null,
        },
      ],
    ])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(2))
    const titles = [...document.querySelectorAll('[data-testid="card-title"]')].map(
      (e) => e.textContent,
    )
    // `Rex` beats `dog` beats `person`; `truck` beats `person`.
    expect(titles).toEqual(['Rex', 'truck'])
    // …and the pill REPLACES the class glyph: `Rex` implies the animal, `truck`
    // IS the class said more precisely. A glyph beside either restates it.
    expect(document.querySelectorAll('[data-testid="card-class-glyph"]')).toHaveLength(0)
  })

  it('a FACE identity pill drops the person glyph', async () => {
    // Reported: a person icon next to a person's name is pure noise — the name
    // already says who, and therefore what.
    const pages = new Map([
      [
        null,
        {
          tracks: [
            { ...track('face', 101, 3_000), subLabel: 'Dave' },
            { ...track('bare', 102, 2_000) },
          ],
          nextCursor: null,
        },
      ],
    ])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(2))
    // The identified card: pill only.
    const faceCard = document.querySelector('[data-track-id="face"]')
    expect(faceCard?.querySelector('[data-testid="card-title"]')?.textContent).toBe('Dave')
    expect(faceCard?.querySelector('[data-testid="card-class-glyph"]')).toBeNull()
    // The bare `person` card KEEPS its glyph — it is the only thing said, and
    // it is what makes the feed scannable.
    const bareCard = document.querySelector('[data-track-id="bare"]')
    expect(bareCard?.querySelector('[data-testid="card-class-glyph"]')).toBeTruthy()
    expect(bareCard?.querySelector('[data-testid="card-title"]')).toBeNull()
  })

  it('the gallery tile carries camera AND time, both visible', async () => {
    // The operator reported the gallery clock "missing, or maybe below". It is
    // now its own fixed-height line under a 2-line-clamped camera name, so a
    // long name cannot push it out of the tile.
    const pages = new Map([
      [
        null,
        {
          tracks: [{ ...track('a', 101, 3_000) }],
          nextCursor: null,
        },
      ],
    ])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    const camera = document.querySelector('[data-testid="card-camera"]')
    const time = document.querySelector('[data-testid="card-time"]')
    expect(camera?.textContent).toBe('Front Door')
    expect(time?.textContent).toMatch(/\d{1,2}[:.]\d{2}/)
    // The clock must not be inside a clamped/hidden box.
    expect((time as HTMLElement).style.overflow).not.toBe('hidden')
  })

  it('respects the field toggles on every element', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({
          view: 'gallery',
          fields: {
            label: false,
            sublabel: false,
            camera: false,
            time: false,
            badges: false,
            importance: false,
          },
        }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    for (const id of ['card-class-glyph', 'card-title', 'card-camera', 'card-time']) {
      expect(document.querySelector(`[data-testid="${id}"]`)).toBeNull()
    }
  })

  it('shows the TIME on a reel card by default — native parity', async () => {
    // The operator reported the embed reel had no time. It was rendered, at a y
    // the host had already cut: the card was 96 px in a strip sized for 80.
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())

    const time = document.querySelector('[data-testid="card-time"]')
    expect(time).toBeTruthy()
    expect(time?.textContent).toMatch(/\d{1,2}[:.]\d{2}/)
  })

  it('shows the time on a GALLERY card too', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    expect(document.querySelector('[data-testid="card-time"]')?.textContent).toMatch(/\d/)
  })

  it('hides the time only when the host asks it to', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({
          fields: {
            label: true,
            sublabel: true,
            camera: true,
            time: false,
            badges: true,
            importance: false,
          },
        }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    expect(document.querySelector('[data-testid="card-time"]')).toBeNull()
  })

  it('sizes a reel card to the NATIVE scale, and fits the reserved strip', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ thumbSize: 'small' }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    const card = document.querySelector('[data-track-id]')
    // 60 px is `REEL_THUMB_SIZE_PX.small` / `cardEdgePx('small')` — the edge the
    // host reserved its strip from. Below the fit width the card stays square.
    expect((card as HTMLElement | null)?.style.width).toBe('60px')
    expect((card as HTMLElement | null)?.style.height).toBe('60px')
    expect((card as HTMLElement | null)?.style.minHeight).toBe('60px')
  })

  it('reports ready, then a countChanged reflecting loaded vs shown', async () => {
    const pages = new Map([
      [null, { tracks: [track('a', 101, 3_000), track('b', 102, 2_000)], nextCursor: null }],
    ])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))

    await waitFor(() => expect(messagesOfType('ready').length).toBe(1))
    expect(messagesOfType('ready')[0]).toMatchObject({
      v: 1,
      type: 'ready',
      view: 'reel',
      features: ['window', 'semantic-search', 'macro-classes', 'device-names', 'kind-labels', 'heartbeat', 'track-list', 'attr-filters', 'flag-filters', 'debug-status', 'native-pull-refresh', 'track-list-delta'],
    })

    await waitFor(() => {
      const last = messagesOfType('countChanged').at(-1)
      expect(last).toEqual({
        v: 1,
        type: 'countChanged',
        loaded: 2,
        shown: 2,
        hasMore: false,
        mode: 'feed',
      })
    })
    await waitFor(() => {
      expect(messagesOfType('state').at(-1)).toEqual({ v: 1, type: 'state', state: 'ready' })
    })
  })

  it('emits a versioned trackClick carrying the media id the host needs', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))

    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    const card = document.querySelector('[data-track-id="a"]')
    expect(card).toBeTruthy()
    act(() => {
      card?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(messagesOfType('trackClick')[0]).toEqual({
      v: 1,
      type: 'trackClick',
      trackId: 'a',
      deviceId: 101,
      bestEventId: 'evt-a',
      className: 'person',
      firstSeen: -2_000,
      lastSeen: 3_000,
    })
  })

  it('a host flag write lights the D pill on a card already on screen', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery', showAdminFlags: true }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id="a"]')).toBeTruthy())
    expect(document.querySelector('[title="debug"]')).toBeNull()

    act(() => {
      window.__camstackEvents?.setTrackFlagPatches({
        a: { debug: true, markForTrain: false, favourited: false },
      })
    })

    await waitFor(() =>
      expect(document.querySelector('[data-track-id="a"] [title="debug"]')).toBeTruthy(),
    )
  })

  it('a live flag patch makes the debug chip keep that already-loaded row', async () => {
    const pages = new Map([
      [null, { tracks: [track('a', 101, 3_000), track('b', 102, 2_000)], nextCursor: null }],
    ])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery', showAdminFlags: true }),
      }),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(2))

    act(() => {
      window.__camstackEvents?.setConfig({ filterDebug: true })
    })
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(0))

    act(() => {
      window.__camstackEvents?.setTrackFlagPatches({
        a: { debug: true, markForTrain: false, favourited: false },
      })
    })
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))
    expect(document.querySelector('[data-track-id="a"]')).toBeTruthy()
  })

  it('a host setConfig narrows the feed WITHOUT refetching it', async () => {
    const pages = new Map([
      [null, { tracks: [track('a', 101, 3_000), track('b', 102, 2_000)], nextCursor: null }],
    ])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(2))
    const requestsBefore = requests.length

    act(() => {
      // The camera name is a search TOKEN even where it is not rendered.
      window.__camstackEvents?.setConfig({ search: 'Driveway' })
    })

    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))
    // Client-side filter: instant, and no new server round-trip.
    expect(requests.length).toBe(requestsBefore)
    await waitFor(() => {
      expect(messagesOfType('countChanged').at(-1)).toMatchObject({ loaded: 2, shown: 1 })
    })
  })

  it('a host loadMore follows the CURSOR and appends without re-reading page 1', async () => {
    const pages = new Map<string | null, { tracks: unknown[]; nextCursor: string | null }>([
      [null, { tracks: [track('a', 101, 3_000)], nextCursor: 'cur-1' }],
      ['cur-1', { tracks: [track('b', 102, 2_000)], nextCursor: null }],
    ])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))

    act(() => {
      window.__camstackEvents?.loadMore()
    })

    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(2))
    expect(requests.map((r) => r.cursor)).toEqual([undefined, 'cur-1'])
  })

  it('a loadMore that lands MID-REQUEST is replayed, not dropped', async () => {
    // The sentinel is an IntersectionObserver: it fires on a transition, so an
    // ask ignored while the first page is in flight would never come again and
    // the feed would stall with pages still available.
    let releaseFirst: (() => void) | undefined
    const pages = new Map<string | null, { tracks: unknown[]; nextCursor: string | null }>([
      [null, { tracks: [track('a', 101, 3_000)], nextCursor: 'cur-1' }],
      ['cur-1', { tracks: [track('b', 102, 2_000)], nextCursor: null }],
    ])
    const client: EventsDataClient = {
      listRecentTracks: async (input) => {
        requests.push(input)
        if (input.cursor === undefined) {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
        }
        return pages.get(input.cursor ?? null) ?? { tracks: [], nextCursor: null }
      },
      listDevices: () => Promise.resolve([{ id: 101, name: 'Front Door' }]),
      searchObjectEvents: () => Promise.resolve([]),
      listEventKinds: () => Promise.resolve([]),
    }
    render(createElement(Events, { client, initialConfig: config() }))

    await waitFor(() => expect(requests.length).toBe(1))
    act(() => {
      window.__camstackEvents?.loadMore()
    })
    expect(requests.length).toBe(1) // still in flight — correctly not re-entered

    await act(async () => {
      releaseFirst?.()
      await Promise.resolve()
    })

    await waitFor(() => expect(requests.length).toBe(2))
    expect(requests[1]?.cursor).toBe('cur-1')
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(2))
  })

  it('a refresh asks only for what is newer than the head', async () => {
    const pages = new Map<string | null, { tracks: unknown[]; nextCursor: string | null }>([
      [null, { tracks: [track('a', 101, 3_000)], nextCursor: null }],
    ])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))

    act(() => {
      window.__camstackEvents?.refresh()
    })

    await waitFor(() => expect(requests.length).toBe(2))
    // Inclusive head — a `head + 1` floor would skip every same-millisecond tie.
    expect(requests[1]?.since).toBe(3_000)
    expect(requests[1]?.cursor).toBeUndefined()
  })

  it('a day WINDOW rides the request — the server never sends the other days', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ sinceMs: 1_000, untilMs: 2_000 }),
      }),
    )
    await waitFor(() => expect(requests.length).toBeGreaterThan(0))
    // Both bounds on the REQUEST: a day view that filtered client-side would
    // spend the fan-out budget on rows it then hides.
    expect(requests[0]?.since).toBe(1_000)
    expect(requests[0]?.until).toBe(2_000)
  })

  it('omits includeStationary by default — the hub already hides parked promotions', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(requests.length).toBeGreaterThan(0))
    expect(requests[0]?.includeStationary).toBeUndefined()
  })

  it('a showStationary setConfig refetches WITH includeStationary: true', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(requests.length).toBe(1))

    act(() => {
      window.__camstackEvents?.setConfig({ showStationary: true })
    })

    await waitFor(() => expect(requests.length).toBe(2))
    expect(requests[1]?.includeStationary).toBe(true)
  })

  /**
   * Track SOURCES — the axis `classes` could not express.
   *
   * A synthetic row carries no accumulated `classes[]`, and the hub's class
   * filter is a deliberate SUPERSET that keeps a row whose column it cannot
   * read. So on the live hub every class selection returned every synthetic
   * row and none selected one: `classes: ['contact']` and a class that exists
   * nowhere answered the identical 116 rows, all of them synthetic.
   * Provenance is `source`, and this is the filter that speaks it.
   */
  it('omits excludeSources when nothing is hidden — the embed narrows nothing on its own', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(requests.length).toBeGreaterThan(0))
    expect(requests[0]?.excludeSources).toBeUndefined()
  })

  it('hidden sources ride the REQUEST, so paging counts what is shown', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ excludeSources: ['audio'] }),
      }),
    )
    await waitFor(() => expect(requests.length).toBeGreaterThan(0))
    expect(requests[0]?.excludeSources).toEqual(['audio'])
  })

  it('a setConfig refetches with the new exclusion instead of narrowing what is loaded', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(requests.length).toBe(1))

    act(() => {
      window.__camstackEvents?.setConfig({ excludeSources: ['audio', 'sensor'] })
    })

    await waitFor(() => expect(requests.length).toBe(2))
    expect(requests[1]?.excludeSources).toEqual(['audio', 'sensor'])
  })

  it('still hides the rows when the HUB ignores the parameter', async () => {
    // An older hub drops a key it does not declare (Zod strips it) and answers
    // with everything. A control that says "audio hidden" over a list of audio
    // events is a worse failure than no control, so the page applies the same
    // rule to the rows it holds. The fake below IS that hub: it returns an
    // audio row whatever it was asked for.
    const audio = { ...track('a', 101, 3_000), source: 'audio', className: 'audio' }
    const pipeline = track('p', 101, 2_000)
    const pages = new Map([[null, { tracks: [audio, pipeline], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ excludeSources: ['audio'] }),
      }),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))
    expect(document.querySelector('[data-track-id]')?.getAttribute('data-track-id')).toBe('p')
  })

  it('a setWindow command re-anchors the feed and refetches', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(requests.length).toBe(1))
    expect(requests[0]?.until).toBeUndefined()

    act(() => {
      window.__camstackEvents?.setWindow({ sinceMs: 500, untilMs: 900 })
    })

    await waitFor(() => expect(requests.length).toBe(2))
    expect(requests[1]?.since).toBe(500)
    expect(requests[1]?.until).toBe(900)
  })

  it('clearing the window goes back to the rolling feed', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ sinceMs: 500, untilMs: 900 }),
      }),
    )
    await waitFor(() => expect(requests.length).toBe(1))

    act(() => {
      window.__camstackEvents?.setWindow({ sinceMs: null, untilMs: null })
    })

    await waitFor(() => expect(requests.length).toBe(2))
    expect(requests[1]?.until).toBeUndefined()
  })

  it('an importance order from an older host is ignored: newest first, always', async () => {
    const pages = new Map([
      [
        null,
        {
          tracks: [
            { ...track('newest', 101, 3_000), importance: 0.1 },
            { ...track('best', 102, 1_000), importance: 0.9 },
          ],
          nextCursor: null,
        },
      ],
    ])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(2))
    const ids = () =>
      [...document.querySelectorAll('[data-track-id]')].map((e) => e.getAttribute('data-track-id'))
    expect(ids()).toEqual(['newest', 'best'])

    // A host built while the order existed still sends it; it is not a knob.
    const legacy = { sort: 'importance' }
    act(() => {
      window.__camstackEvents?.setConfig(legacy)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(ids()).toEqual(['newest', 'best'])
    expect(requests.length).toBe(1)
  })

  it('semantic search REPLACES the feed with CLIP hits, in one request, newest first', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    semanticHits = [
      {
        id: 'e1',
        trackId: 'clip-1',
        deviceId: 101,
        timestamp: 9_000,
        className: 'person',
        score: 0.7,
      },
      {
        id: 'e2',
        trackId: 'clip-2',
        deviceId: 102,
        timestamp: 8_000,
        className: 'vehicle',
        score: 0.9,
      },
    ]
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))

    act(() => {
      window.__camstackEvents?.setConfig({ searchMode: 'semantic', search: 'red car' })
    })

    await waitFor(() => {
      const ids = [...document.querySelectorAll('[data-track-id]')].map((e) =>
        e.getAttribute('data-track-id'),
      )
      // NEWEST FIRST, not the hub's score order — `clip-2` scored higher
      // (0.9 vs 0.7) and is still second because it is older. The card shows a
      // time and no score, so a relevance ranking is invisible on screen and
      // reads as a scrambled list; the page's own `sort` governs every list it
      // draws. See `mergeSearchRows`.
      expect(ids).toEqual(['clip-1', 'clip-2'])
    })
    // ONE call, all cameras — `searchObjectEvents` takes a single optional
    // deviceId and omitting it searches everything.
    expect(searches).toHaveLength(1)
    expect(searches[0]).toMatchObject({ text: 'red car' })
    expect((searches[0] as Record<string, unknown>).deviceId).toBeUndefined()

    await waitFor(() => {
      expect(messagesOfType('countChanged').at(-1)).toMatchObject({
        mode: 'semantic',
        hasMore: false,
      })
    })
  })

  it('a TEXT search stays client-side — no CLIP request at all', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))

    act(() => {
      window.__camstackEvents?.setConfig({ search: 'person' })
    })

    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))
    expect(searches).toHaveLength(0)
  })

  it('a macro class selection keeps the SUBS, using the server taxonomy', async () => {
    taxonomy = [
      {
        deviceId: 101,
        kinds: [
          { kind: 'vehicle', parentKind: null },
          { kind: 'truck', parentKind: 'vehicle' },
        ],
      },
    ]
    const pages = new Map([
      [
        null,
        {
          tracks: [
            { ...track('truck', 101, 3_000), className: 'truck', classes: ['truck'] },
            { ...track('person', 102, 2_000) },
          ],
          nextCursor: null,
        },
      ],
    ])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(2))

    act(() => {
      window.__camstackEvents?.setConfig({ classes: ['vehicle'] })
    })

    // Selecting the family keeps the truck — the reported gap.
    await waitFor(() => {
      const ids = [...document.querySelectorAll('[data-track-id]')].map((e) =>
        e.getAttribute('data-track-id'),
      )
      expect(ids).toEqual(['truck'])
    })
  })

  it('renders the HOST rename over the server name, with fallback', async () => {
    const pages = new Map([
      [null, { tracks: [track('a', 101, 3_000), track('b', 102, 2_000)], nextCursor: null }],
    ])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery', deviceNames: { '101': 'Front door' } }),
      }),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(2))
    const names = [...document.querySelectorAll('[data-testid="card-camera"]')].map(
      (e) => e.textContent,
    )
    // 101 renamed by the host; 102 falls back to the server's name.
    expect(names).toEqual(['Front door', 'Driveway'])
  })

  it('a runtime setConfig applies a rename without refetching', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() =>
      expect(document.querySelector('[data-testid="card-camera"]')?.textContent).toBe('Front Door'),
    )
    const before = requests.length

    act(() => {
      window.__camstackEvents?.setConfig({ deviceNames: { '101': 'Cortile' } })
    })

    await waitFor(() =>
      expect(document.querySelector('[data-testid="card-camera"]')?.textContent).toBe('Cortile'),
    )
    expect(requests.length).toBe(before)
  })

  it('a rename is searchable — the haystack uses the SAME name', async () => {
    const pages = new Map([
      [null, { tracks: [track('a', 101, 3_000), track('b', 102, 2_000)], nextCursor: null }],
    ])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery', deviceNames: { '101': 'Front door' } }),
      }),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(2))

    act(() => {
      window.__camstackEvents?.setConfig({ search: 'Front door' })
    })

    await waitFor(() => {
      const ids = [...document.querySelectorAll('[data-track-id]')].map((e) =>
        e.getAttribute('data-track-id'),
      )
      expect(ids).toEqual(['a'])
    })
  })

  it('shows a LOADING state before the first page, never "No events"', async () => {
    // The reported flash: `deviceIds` is empty while the camera list is in
    // flight, and the feed used to report itself not-loading with nothing to
    // fetch — so the empty state rendered for a beat on every boot.
    // ONE gate for every call: the camera-set reset issues a second request,
    // and a per-call promise would leave that one hanging forever.
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    const client: EventsDataClient = {
      listRecentTracks: async (input) => {
        requests.push(input)
        await gate
        return { tracks: [], nextCursor: null }
      },
      listDevices: () => Promise.resolve([{ id: 101, name: 'Front Door' }]),
      searchObjectEvents: () => Promise.resolve([]),
      listEventKinds: () => Promise.resolve([]),
    }
    render(createElement(Events, { client, initialConfig: config() }))

    await waitFor(() =>
      expect(document.querySelector('[data-testid="state-loading"]')).toBeTruthy(),
    )
    // THE assertion: no empty state while the first fetch is pending.
    expect(document.querySelector('[data-testid="state-empty"]')).toBeNull()

    await act(async () => {
      release()
      await Promise.resolve()
    })

    // Resolved with zero rows ⇒ NOW the empty state is the truth.
    await waitFor(() => expect(document.querySelector('[data-testid="state-empty"]')).toBeTruthy())
    expect(document.querySelector('[data-testid="state-loading"]')).toBeNull()
  })

  it('stays LOADING while the camera list itself is still in flight', async () => {
    // The precise shape of the reported flash, isolated: `deviceIds` is empty
    // because `listDevices` has not answered yet — NOT because there is
    // nothing to fetch. Settling here is what put "No events" on screen before
    // a single request had been made.
    const client: EventsDataClient = {
      listRecentTracks: () => Promise.resolve({ tracks: [], nextCursor: null }),
      // Never resolves — a slow hub, or one that is still booting.
      listDevices: () => new Promise(() => {}),
      searchObjectEvents: () => Promise.resolve([]),
      listEventKinds: () => Promise.resolve([]),
    }
    render(createElement(Events, { client, initialConfig: config() }))

    await waitFor(() =>
      expect(document.querySelector('[data-testid="state-loading"]')).toBeTruthy(),
    )
    expect(document.querySelector('[data-testid="state-empty"]')).toBeNull()
    // …and it must still be loading a tick later, not settle on its own.
    await act(async () => {
      await Promise.resolve()
    })
    expect(document.querySelector('[data-testid="state-empty"]')).toBeNull()
  })

  it('a token that genuinely sees NO cameras settles to empty', async () => {
    // The other side of the same coin: an empty device list that has RESOLVED
    // is a real answer, and must not spin forever.
    const client: EventsDataClient = {
      listRecentTracks: () => Promise.resolve({ tracks: [], nextCursor: null }),
      listDevices: () => Promise.resolve([]),
      searchObjectEvents: () => Promise.resolve([]),
      listEventKinds: () => Promise.resolve([]),
    }
    render(createElement(Events, { client, initialConfig: config() }))
    await waitFor(() => expect(document.querySelector('[data-testid="state-empty"]')).toBeTruthy())
    expect(document.querySelector('[data-testid="state-loading"]')).toBeNull()
  })

  it('renders a real class GLYPH, not an empty chip', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    const chip = document.querySelector('[data-testid="card-class-glyph"]')
    // An <svg> from the bundled lucide set — the same icon module the viewer's
    // native card resolves through, so the same class gets the same glyph.
    expect(chip?.querySelector('svg')).toBeTruthy()
  })

  it('picks the taxonomy-declared glyph over the raw class id', async () => {
    // `iconId` is declared per kind by the server, so a class the hub learns
    // tomorrow gets the right glyph with no embed redeploy.
    taxonomy = [
      { deviceId: 101, kinds: [{ kind: 'lorry', parentKind: 'vehicle', iconId: 'truck' }] },
    ]
    const pages = new Map([
      [
        null,
        {
          tracks: [{ ...track('a', 101, 3_000), className: 'lorry', classes: ['lorry'] }],
          nextCursor: null,
        },
      ],
    ])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    await waitFor(() => {
      const chip = document.querySelector('[data-testid="card-class-glyph"]')
      // lucide stamps the icon name as a class — `truck`, resolved from the
      // descriptor, NOT the unknown `lorry` (which would fall back to `tag`).
      expect(chip?.querySelector('svg')?.getAttribute('class')).toContain('truck')
    })
  })

  it('never repeats the glyphs as a caption — the audio card', async () => {
    // Live gallery, reported: glyphs speech+music AND the text "speech, music".
    const pages = new Map([
      [
        null,
        {
          tracks: [
            {
              ...track('a', 101, 3_000),
              className: 'motion',
              classes: ['motion'],
              audioLabels: [
                { label: 'speech', peakScore: 0.9, count: 1 },
                { label: 'music', peakScore: 0.8, count: 1 },
              ],
            },
          ],
          nextCursor: null,
        },
      ],
    ])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    // The glyphs carry it: the class glyph plus one per audio label.
    expect(document.querySelectorAll('[data-testid="card-class-glyph"]')).toHaveLength(1)
    // …and NOTHING transcribes them underneath.
    expect(screen.queryByText(/speech/)).toBeNull()
    expect(screen.queryByText(/music/)).toBeNull()
  })

  it('never says the class BELOW a pill that already says something finer', async () => {
    // Reported: `car` glyph + `Car` pill + the caption `vehicle` — three
    // sayings of one fact, and the caption was the coarsest of them.
    const pages = new Map([
      [
        null,
        {
          tracks: [
            { ...track('a', 101, 3_000), className: 'vehicle', classes: ['vehicle'], label: 'Car' },
          ],
          nextCursor: null,
        },
      ],
    ])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    expect(document.querySelector('[data-testid="card-title"]')?.textContent).toBe('Car')
    expect(screen.queryByText('vehicle')).toBeNull()
  })

  it('the caption CARRIES the labels when the thumbnail does not', async () => {
    const pages = new Map([
      [null, { tracks: [{ ...track('a', 101, 3_000), subLabel: 'Dave' }], nextCursor: null }],
    ])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({
          view: 'gallery',
          fields: {
            label: false,
            sublabel: true,
            camera: true,
            time: true,
            badges: true,
            importance: false,
          },
        }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    expect(document.querySelector('[data-testid="card-class-glyph"]')).toBeNull()
    expect(screen.getByText('Dave')).toBeTruthy()
  })

  it('shows a TAIL loader while the next block is in flight', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => {
      release = r
    })
    let call = 0
    const client: EventsDataClient = {
      listRecentTracks: async (input) => {
        requests.push(input)
        call += 1
        // Page 1 lands immediately; page 2 hangs on the gate.
        if (call > 1) await gate
        return call === 1
          ? { tracks: [track('a', 101, 3_000)], nextCursor: 'cur-1' }
          : { tracks: [track('b', 102, 2_000)], nextCursor: null }
      },
      listDevices: () => Promise.resolve([{ id: 101, name: 'Front Door' }]),
      searchObjectEvents: () => Promise.resolve([]),
      listEventKinds: () => Promise.resolve([]),
    }
    render(createElement(Events, { client, initialConfig: config() }))
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))
    // Page 1 is on screen and more exists — no tail spinner until one is asked for.
    expect(document.querySelector('[data-testid="tail-loading"]')).toBeNull()

    act(() => {
      window.__camstackEvents?.loadMore()
    })

    // In flight ⇒ the user can see that more is coming.
    await waitFor(() => expect(document.querySelector('[data-testid="tail-loading"]')).toBeTruthy())
    // …and the full-surface skeleton is NOT also showing (one request, one
    // affordance).
    expect(document.querySelector('[data-testid="state-loading"]')).toBeNull()

    await act(async () => {
      release()
      await Promise.resolve()
    })

    // Resolved ⇒ the spinner goes, and the feed is exhausted so the discreet
    // end marker takes its place.
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(2))
    expect(document.querySelector('[data-testid="tail-loading"]')).toBeNull()
    await waitFor(() => expect(document.querySelector('[data-testid="tail-end"]')).toBeTruthy())
  })

  it('fetches ONE page on boot, not two', async () => {
    // The camera list resolving used to look like a window change: it reset a
    // feed that had never loaded, and the reset's `generation` bump replayed as
    // page TWO. Every mount paid for two pages and rendered one.
    const pages = new Map<string | null, { tracks: unknown[]; nextCursor: string | null }>([
      [null, { tracks: [track('a', 101, 3_000)], nextCursor: 'cur-1' }],
      ['cur-1', { tracks: [track('b', 102, 2_000)], nextCursor: null }],
    ])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))
    await act(async () => {
      await Promise.resolve()
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.cursor).toBeUndefined()
  })

  it('shows the END marker, never a loader, once the feed is exhausted', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelector('[data-testid="tail-end"]')).toBeTruthy())
    expect(document.querySelector('[data-testid="tail-loading"]')).toBeNull()
  })

  it('shows NO tail affordance in semantic mode — results are not a page', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: 'cur-1' }]])
    semanticHits = [
      {
        id: 'e1',
        trackId: 'clip-1',
        deviceId: 101,
        timestamp: 9_000,
        className: 'person',
        score: 0.7,
      },
    ]
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())

    act(() => {
      window.__camstackEvents?.setConfig({ searchMode: 'semantic', search: 'car' })
    })

    await waitFor(() => {
      const ids = [...document.querySelectorAll('[data-track-id]')].map((e) =>
        e.getAttribute('data-track-id'),
      )
      expect(ids).toEqual(['clip-1'])
    })
    expect(document.querySelector('[data-testid="tail-loading"]')).toBeNull()
    expect(document.querySelector('[data-testid="tail-end"]')).toBeNull()
  })

  it('resolved WITH rows shows neither empty nor loading', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    expect(document.querySelector('[data-testid="state-empty"]')).toBeNull()
    expect(document.querySelector('[data-testid="state-loading"]')).toBeNull()
    expect(document.querySelector('[data-testid="state-error"]')).toBeNull()
  })

  it('an ERROR is its own state, not the empty one — after the retries', async () => {
    const client: EventsDataClient = {
      listRecentTracks: () => Promise.reject(new Error('node not answering')),
      listDevices: () => Promise.resolve([{ id: 101, name: 'Front Door' }]),
      searchObjectEvents: () => Promise.resolve([]),
      listEventKinds: () => Promise.resolve([]),
    }
    render(createElement(Events, { client, initialConfig: config() }))
    await waitFor(
      () => expect(document.querySelector('[data-testid="state-error"]')).toBeTruthy(),
      { timeout: 4_000 },
    )
    expect(document.querySelector('[data-testid="state-empty"]')).toBeNull()
    // The raw server message is NOT the copy — it goes to the host log.
    expect(screen.queryByText('node not answering')).toBeNull()
    expect(screen.getByTestId('state-retry')).toBeTruthy()
  })

  it('a SINGLE failure never reaches the screen — it heals', async () => {
    // The resume-from-background case: the WebView wakes, the in-flight fetch
    // is already dead, the next one works. An error banner for a condition that
    // has already healed is the bug.
    let call = 0
    const client: EventsDataClient = {
      listRecentTracks: (input) => {
        requests.push(input)
        call += 1
        if (call === 1) return Promise.reject(new Error('Network request failed'))
        return Promise.resolve({ tracks: [track('a', 101, 3_000)], nextCursor: null })
      },
      listDevices: () => Promise.resolve([{ id: 101, name: 'Front Door' }]),
      searchObjectEvents: () => Promise.resolve([]),
      listEventKinds: () => Promise.resolve([]),
    }
    render(createElement(Events, { client, initialConfig: config() }))

    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy(), {
      timeout: 4_000,
    })
    // At no point did the surface admit an error.
    expect(document.querySelector('[data-testid="state-error"]')).toBeNull()
    expect(requests.length).toBeGreaterThanOrEqual(2)
  })

  it('the retry BUTTON clears the error and reloads', async () => {
    let failing = true
    const client: EventsDataClient = {
      listRecentTracks: (input) => {
        requests.push(input)
        if (failing) return Promise.reject(new Error('node not answering'))
        return Promise.resolve({ tracks: [track('a', 101, 3_000)], nextCursor: null })
      },
      listDevices: () => Promise.resolve([{ id: 101, name: 'Front Door' }]),
      searchObjectEvents: () => Promise.resolve([]),
      listEventKinds: () => Promise.resolve([]),
    }
    render(createElement(Events, { client, initialConfig: config() }))
    await waitFor(
      () => expect(document.querySelector('[data-testid="state-error"]')).toBeTruthy(),
      { timeout: 4_000 },
    )

    failing = false
    act(() => {
      screen.getByTestId('state-retry').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    expect(document.querySelector('[data-testid="state-error"]')).toBeNull()
  })

  it('a host `refresh` clears the error — the foreground hook', async () => {
    // The viewer sends `refresh` on AppState → active. Arriving at an errored
    // surface it must HEAL it, not poll around it.
    let failing = true
    const client: EventsDataClient = {
      listRecentTracks: (input) => {
        requests.push(input)
        if (failing) return Promise.reject(new Error('node not answering'))
        return Promise.resolve({ tracks: [track('a', 101, 3_000)], nextCursor: null })
      },
      listDevices: () => Promise.resolve([{ id: 101, name: 'Front Door' }]),
      searchObjectEvents: () => Promise.resolve([]),
      listEventKinds: () => Promise.resolve([]),
    }
    render(createElement(Events, { client, initialConfig: config() }))
    await waitFor(
      () => expect(document.querySelector('[data-testid="state-error"]')).toBeTruthy(),
      { timeout: 4_000 },
    )

    failing = false
    act(() => {
      window.__camstackEvents?.refresh()
    })

    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    expect(document.querySelector('[data-testid="state-error"]')).toBeNull()
  })

  it('keeps loading until the content FILLS the viewport', async () => {
    // The regression: an IntersectionObserver reports once at observe() and
    // then only on TRANSITIONS. A first page too short to fill the scroller
    // leaves the sentinel visible-and-never-transitioning, so nothing ever
    // asks for page two and the screen sits half empty with rows available.
    //
    // jsdom has no layout, so the viewport is supplied here: a 500px-tall
    // scroller whose content never exceeds 100px — i.e. never filled.
    const clientH = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
    const scrollH = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(100)
    try {
      const pages = new Map<string | null, { tracks: unknown[]; nextCursor: string | null }>([
        [null, { tracks: [track('a', 101, 5_000)], nextCursor: 'c1' }],
        ['c1', { tracks: [track('b', 101, 4_000)], nextCursor: 'c2' }],
        ['c2', { tracks: [track('c', 101, 3_000)], nextCursor: null }],
      ])
      render(
        createElement(Events, {
          client: fakeClient(pages),
          initialConfig: config({ view: 'gallery' }),
        }),
      )
      // It must not stop at page one: it keeps going until the feed is
      // exhausted (nextCursor null), because the viewport is never satisfied.
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(3))
      expect(requests.map((r) => r.cursor)).toEqual([undefined, 'c1', 'c2'])
    } finally {
      clientH.mockRestore()
      scrollH.mockRestore()
    }
  })

  it('does NOT page on the sentinel that is visible only because the feed is empty', async () => {
    // Measured on the live hub (2026-08-25, 7 Events opens): 7/7 fetched TWO
    // pages, `feed-2.waitMs ~= feed-1.ms`, nobody scrolled. The sentinel lives
    // inside the grid, which renders unconditionally, so on an empty feed it
    // sits at the top of an empty scroller; `IntersectionObserver` reports its
    // state once at `observe()` and that report is `isIntersecting: true`
    // while page one is still in flight. `loadMore` parks the ask and replays
    // it — 120 rows where ~12 are visible, and double the cards feeding the
    // 6-wide thumbnail gate.
    //
    // The suite's global stub NEVER fires, which is exactly why 591 green
    // tests could not see this. This one is faithful: it delivers the initial
    // report, like the real thing.
    const reports: (() => void)[] = []
    ;(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
      constructor(private readonly cb: (e: { isIntersecting: boolean }[]) => void) {}
      observe(): void {
        reports.push(() => this.cb([{ isIntersecting: true }]))
      }
      disconnect(): void {}
    }
    // Filled scroller: the auto-fill effect must stay out of this, so the only
    // thing that could ask for page two is the sentinel.
    const clientH = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)
    const scrollH = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900)
    // Page one must be IN FLIGHT when the report lands — that is the whole
    // bug. A page that has already resolved makes `loadMore` take its normal
    // path and the parked-ask replay never happens.
    let releasePageOne: () => void = () => {}
    const pageOne = new Promise<{ tracks: unknown[]; nextCursor: string | null }>((resolve) => {
      releasePageOne = () => resolve({ tracks: [track('a', 101, 5_000)], nextCursor: 'c1' })
    })
    const client: EventsDataClient = {
      listRecentTracks: (input) => {
        requests.push(input)
        if ((input.cursor ?? null) === null) return pageOne
        return Promise.resolve({ tracks: [track('b', 101, 4_000)], nextCursor: null })
      },
      listDevices: () => Promise.resolve([{ id: 101, name: 'Front Door' }]),
      searchObjectEvents: () => Promise.resolve([]),
      listEventKinds: () => Promise.resolve(taxonomy),
    }
    try {
      render(createElement(Events, { client, initialConfig: config({ view: 'gallery' }) }))
      // Let `listDevices` settle so page one is actually asked for.
      await waitFor(() => expect(requests).toHaveLength(1))
      // Page one is still pending. Deliver the sentinel's initial report — the
      // real observer does this ~3 ms after mount.
      await act(async () => {
        for (const fire of reports) fire()
        await Promise.resolve()
      })
      releasePageOne()
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))
      await act(async () => {
        await Promise.resolve()
      })
      // Exactly one page. A parked-and-replayed ask would show `'c1'` here.
      expect(requests.map((r) => r.cursor)).toEqual([undefined])
    } finally {
      clientH.mockRestore()
      scrollH.mockRestore()
    }
  })

  it('stops auto-filling once the content DOES fill the viewport', async () => {
    const clientH = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(100)
    const scrollH = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900)
    try {
      const pages = new Map<string | null, { tracks: unknown[]; nextCursor: string | null }>([
        [null, { tracks: [track('a', 101, 5_000)], nextCursor: 'c1' }],
        ['c1', { tracks: [track('b', 101, 4_000)], nextCursor: null }],
      ])
      render(
        createElement(Events, {
          client: fakeClient(pages),
          initialConfig: config({ view: 'gallery' }),
        }),
      )
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))
      await act(async () => {
        await Promise.resolve()
      })
      // Filled ⇒ the sentinel owns the rest. Exactly one page.
      expect(requests).toHaveLength(1)
    } finally {
      clientH.mockRestore()
      scrollH.mockRestore()
    }
  })

  it('does NOT auto-fill an unmeasured scroller', async () => {
    // A hidden WebView, or a container the host has not sized. Paging against a
    // box of unknown extent is how an off-screen surface walks the history.
    const pages = new Map<string | null, { tracks: unknown[]; nextCursor: string | null }>([
      [null, { tracks: [track('a', 101, 5_000)], nextCursor: 'c1' }],
      ['c1', { tracks: [track('b', 101, 4_000)], nextCursor: null }],
    ])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))
    await act(async () => {
      await Promise.resolve()
    })
    expect(requests).toHaveLength(1)
  })

  it('never issues more than the bounded number of concurrent thumbnails', async () => {
    // The measured bottleneck: 60 concurrent thumbnails took 13.6 s against
    // 659 ms for the first twelve — same bytes, twenty times slower, because
    // each one is server-rendered and they queue.
    //
    // The global IntersectionObserver stub in this suite never fires, so no
    // card is ever "seen". With a MEASURED scroller (so the eager fallback is
    // off) that must mean zero image requests.
    const clientH = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
    const clientW = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400)
    const scrollH = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(2_000)
    try {
      // THIRTY rows. Track ACTIVE requests rather than total calls: the image
      // loader aborts timed-out fetches and legitimately starts the next wave,
      // so total calls can exceed four without concurrency ever exceeding it.
      let active = 0
      let peak = 0
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_input: RequestInfo | URL, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              active += 1
              peak = Math.max(peak, active)
              init?.signal?.addEventListener(
                'abort',
                () => {
                  active -= 1
                  reject(new DOMException('aborted', 'AbortError'))
                },
                { once: true },
              )
            }),
        ),
      )
      const many = Array.from({ length: 30 }, (_, i) => track(`t${i}`, 101, 9_000 - i))
      const pages = new Map([[null, { tracks: many, nextCursor: null }]])
      render(
        createElement(Events, {
          client: fakeClient(pages),
          initialConfig: config({ view: 'gallery' }),
        }),
      )
      // Thirty rows are HELD; the gallery is virtualized, so the mounted cards
      // are the window near the viewport. Waiting for all thirty would be
      // waiting for a DOM the surface deliberately no longer builds — and the
      // thing under test is the fetch gate, which every card passes through
      // whether it is mounted or preloaded.
      await waitFor(() =>
        expect(document.querySelectorAll('[data-track-id]').length).toBeGreaterThan(0),
      )
      await act(async () => {
        await Promise.resolve()
      })
      // The card itself must not fetch on mount — its observer never fired.
      // What DOES arrive is the background preloader, whose active work must
      // stay bounded even after one timeout frees a slot for the next URL.
      //
      // Bounded by the SHARED gate, which is the only number this page-level
      // test can honestly attribute — see the sibling 0x0 test for why, and
      // `image-preloader.spec.ts` for the preload queue's own cap.
      expect(peak).toBeLessThanOrEqual(MEDIA_FETCH_CONCURRENCY)
      expect(peak).toBeLessThan(many.length)
    } finally {
      clientH.mockRestore()
      clientW.mockRestore()
      scrollH.mockRestore()
    }
  })

  it('keeps thumbnail concurrency bounded while the scroller is still 0x0', async () => {
    // OTA-local HTML runs before the native WebView receives its final size.
    // Treating that transient 0x0 as "no layout" used to disable every card's
    // observer and launch all 60 media requests at once.
    let active = 0
    let peak = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            active += 1
            peak = Math.max(peak, active)
            init?.signal?.addEventListener(
              'abort',
              () => {
                active -= 1
                reject(new DOMException('aborted', 'AbortError'))
              },
              { once: true },
            )
          }),
      ),
    )
    const many = Array.from({ length: 30 }, (_, i) => track(`zero-${i}`, 101, 9_000 - i))
    const pages = new Map([[null, { tracks: many, nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(30))
    await act(async () => {
      await Promise.resolve()
    })
    // The SURFACE bound, which is what this page-level test can honestly see:
    // `peak` counts every media fetch on the page, the cards' included, so the
    // number it measures is the shared gate — not the preload queue's own 3.
    // Asserting 3 here held only while the timing kept the cards out of it, and
    // an unrelated change to the row normaliser was enough to tip it to 6 (the
    // gate, exactly) with nothing actually broken. The preload queue's own cap
    // is asserted hermetically in `image-preloader.spec.ts`, over one hook with
    // no page around it.
    //
    // What THIS test guards is the regression in the comment above: a 0x0
    // scroller read as "no layout" disabled every card's observer and launched
    // all 30 at once. Six is the gate doing its job; thirty is the stampede.
    expect(peak).toBeLessThanOrEqual(MEDIA_FETCH_CONCURRENCY)
    expect(peak).toBeLessThan(many.length)
  })

  it('pull-to-refresh: a qualifying gesture triggers the INCREMENTAL refresh', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    const before = requests.length
    const scroller = document.querySelector('[data-testid="events-scroller"]') as HTMLElement
    expect(scroller).toBeTruthy()

    const touch = (type: string, clientY: number): void => {
      const e = new Event(type, { bubbles: true }) as TouchEvent & { touches: unknown }
      Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientY }] })
      scroller.dispatchEvent(e)
    }

    act(() => {
      touch('touchstart', 0)
      touch('touchmove', 140) // 140 * 0.5 = 70px, past the 56px threshold
    })
    // The indicator follows the finger and reads as armed.
    expect(
      document.querySelector('[data-testid="pull-indicator"]')?.getAttribute('data-armed'),
    ).toBe('true')
    act(() => {
      touch('touchend', 140)
    })

    // A DELTA, not a reload: it asks for what is newer than the head.
    await waitFor(() => expect(requests.length).toBe(before + 1))
    expect(requests[before]?.since).toBe(3_000)
    // …and the indicator is gone.
    expect(document.querySelector('[data-testid="pull-indicator"]')).toBeNull()
  })

  it('pull-to-refresh: a SHORT pull does nothing', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    const before = requests.length
    const scroller = document.querySelector('[data-testid="events-scroller"]') as HTMLElement
    const touch = (type: string, clientY: number): void => {
      const e = new Event(type, { bubbles: true }) as TouchEvent & { touches: unknown }
      Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientY }] })
      scroller.dispatchEvent(e)
    }
    act(() => {
      touch('touchstart', 0)
      touch('touchmove', 30) // 15px — not armed
      touch('touchend', 30)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(requests.length).toBe(before)
  })

  it('pull-to-refresh: a gesture that does not start AT THE TOP is a scroll', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'gallery' }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    const before = requests.length
    const scroller = document.querySelector('[data-testid="events-scroller"]') as HTMLElement
    // Mid-list.
    Object.defineProperty(scroller, 'scrollTop', { value: 400, configurable: true })
    const touch = (type: string, clientY: number): void => {
      const e = new Event(type, { bubbles: true }) as TouchEvent & { touches: unknown }
      Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientY }] })
      scroller.dispatchEvent(e)
    }
    act(() => {
      touch('touchstart', 0)
      touch('touchmove', 300)
      touch('touchend', 300)
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(document.querySelector('[data-testid="pull-indicator"]')).toBeNull()
    expect(requests.length).toBe(before)
  })

  it('asks only for CAMERAS, not every device in the deployment', async () => {
    // The regression that capped the gallery at six rows: `listAll` returns
    // every device, and the server's page size is floor(2000 / deviceCount) —
    // 318 devices bought a page of SIX.
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    const client: EventsDataClient = {
      ...fakeClient(pages),
      listDevices: () =>
        Promise.resolve([
          { id: 101, name: 'Front Door', isCamera: true },
          { id: 102, name: 'Driveway', isCamera: true },
          { id: 900, name: 'Kitchen Light', isCamera: false },
          { id: 901, name: 'Door Sensor', isCamera: false },
        ]),
    }
    render(createElement(Events, { client, initialConfig: config() }))
    await waitFor(() => expect(requests.length).toBeGreaterThan(0))
    expect(requests[0]?.deviceIds).toEqual([101, 102])
  })

  it('keeps every device when the hub reports no isCamera at all', async () => {
    // Older hub: the field is absent everywhere. Narrower would risk asking
    // for nothing.
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    const client: EventsDataClient = {
      ...fakeClient(pages),
      listDevices: () =>
        Promise.resolve([
          { id: 101, name: 'Front Door' },
          { id: 900, name: 'Kitchen Light' },
        ]),
    }
    render(createElement(Events, { client, initialConfig: config() }))
    await waitFor(() => expect(requests.length).toBeGreaterThan(0))
    expect(requests[0]?.deviceIds).toEqual([101, 900])
  })

  it('a failed page says so instead of reading as "no events"', async () => {
    const client: EventsDataClient = {
      listRecentTracks: () => Promise.reject(new Error('node not answering')),
      listDevices: () => Promise.resolve([{ id: 101, name: 'Front Door' }]),
      searchObjectEvents: () => Promise.resolve([]),
      listEventKinds: () => Promise.resolve([]),
    }
    render(createElement(Events, { client, initialConfig: config() }))

    await waitFor(
      () => {
        expect(messagesOfType('state').at(-1)).toEqual({
          v: 1,
          type: 'state',
          state: 'error',
          // The HOST still gets the real reason — it is the copy on SCREEN
          // that must not be a raw transport message.
          message: 'node not answering',
        })
      },
      { timeout: 4_000 },
    )
    // …and the branch is on the shared log channel too, once per attempt.
    expect(posted.some((m) => m.type === 'log' && m.msg === 'listRecentTracks failed')).toBe(true)
    expect(posted.some((m) => m.type === 'log' && m.msg === 'page failed — retrying')).toBe(true)
  })

  it('renders images-only when the host turns every field off', async () => {
    const pages = new Map([[null, { tracks: [track('a', 101, 3_000)], nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({
          fields: {
            label: false,
            sublabel: false,
            camera: false,
            time: false,
            badges: false,
            importance: false,
          },
        }),
      }),
    )
    await waitFor(() => expect(document.querySelector('[data-track-id]')).toBeTruthy())
    expect(screen.queryByText('person')).toBeNull()
    expect(screen.queryByText(/Front Door/)).toBeNull()
  })

  /**
   * The operator's report: "I open an event and when I come out I am back at
   * the first row."
   *
   * Nothing in the HOST unmounts — the detail is a sibling modal over a
   * WebView that stays mounted. What lost the place was `reload`: the registry
   * re-pages every mounted embed when a face is assigned (from inside that very
   * detail) or when the hub announces a face-gallery change while the detail is
   * open. The old reload emptied the feed first, the scroller's content
   * collapsed, and the browser clamped `scrollTop` to zero.
   */
  describe('a reload keeps the operator where they were', () => {
    /** Two pages of four rows, and a second generation that pages the same way. */
    function twoPages(): Map<string | null, { tracks: unknown[]; nextCursor: string | null }> {
      return new Map<string | null, { tracks: unknown[]; nextCursor: string | null }>([
        [null, { tracks: [track('a', 101, 4_000), track('b', 101, 3_000)], nextCursor: 'c1' }],
        ['c1', { tracks: [track('c', 101, 2_000), track('d', 101, 1_000)], nextCursor: null }],
      ])
    }

    it('never empties the grid, and never reports itself loading again', async () => {
      const pages = twoPages()
      render(
        createElement(Events, {
          client: fakeClient(pages),
          initialConfig: config({ view: 'gallery' }),
        }),
      )
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]').length).toBe(2))
      await act(async () => {
        window.__camstackEvents?.loadMore()
      })
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]').length).toBe(4))

      const statesBefore = messagesOfType('state').length
      // Every render pass from here on must still show four rows: a single
      // frame with zero is a collapsed scroller and a lost scroll offset.
      const seen: number[] = []
      const observer = setInterval(
        () => seen.push(document.querySelectorAll('[data-track-id]').length),
        0,
      )
      await act(async () => {
        window.__camstackEvents?.reload()
      })
      await waitFor(() => expect(requests.length).toBeGreaterThan(2))
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]').length).toBe(4))
      clearInterval(observer)

      expect(seen.every((n) => n === 4)).toBe(true)
      expect(document.querySelector('[data-testid="state-loading"]')).toBeNull()
      expect(
        messagesOfType('state')
          .slice(statesBefore)
          .some((m) => m.state === 'loading'),
      ).toBe(false)
    })

    it('pages the replacement back to the height it replaces', async () => {
      const pages = twoPages()
      render(
        createElement(Events, {
          client: fakeClient(pages),
          initialConfig: config({ view: 'gallery' }),
        }),
      )
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]').length).toBe(2))
      await act(async () => {
        window.__camstackEvents?.loadMore()
      })
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]').length).toBe(4))

      requests.length = 0
      await act(async () => {
        window.__camstackEvents?.reload()
      })
      // Page 1 of the new generation is uncursored; the rebuild then follows
      // its own cursor rather than the replaced generation's.
      await waitFor(() => expect(requests.length).toBe(2))
      expect(requests[0]?.cursor).toBeUndefined()
      expect(requests[1]?.cursor).toBe('c1')
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]').length).toBe(4))
    })

    it('shows the rewritten row once the swap lands', async () => {
      const pages = twoPages()
      render(
        createElement(Events, {
          client: fakeClient(pages),
          initialConfig: config({ view: 'gallery' }),
        }),
      )
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]').length).toBe(2))
      await act(async () => {
        window.__camstackEvents?.loadMore()
      })
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]').length).toBe(4))

      // The whole point of a reload: `lastSeen` did not move, the LABEL did.
      pages.set(null, {
        tracks: [
          { ...track('a', 101, 4_000), subLabel: 'Marco' },
          track('b', 101, 3_000),
        ],
        nextCursor: 'c1',
      })
      await act(async () => {
        window.__camstackEvents?.reload()
      })
      await waitFor(() => expect(screen.queryAllByText('Marco').length).toBeGreaterThan(0))
    })

    it('a DIFFERENT question still starts at the top', async () => {
      const pages = twoPages()
      render(
        createElement(Events, {
          client: fakeClient(pages),
          initialConfig: config({ view: 'gallery' }),
        }),
      )
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]').length).toBe(2))
      await act(async () => {
        window.__camstackEvents?.loadMore()
      })
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]').length).toBe(4))

      // A day change is not a re-read of the same feed — the loaded rows are an
      // answer to another question and must go.
      pages.set(null, { tracks: [track('z', 101, 900)], nextCursor: null })
      await act(async () => {
        window.__camstackEvents?.setWindow({ sinceMs: 500, untilMs: 950 })
      })
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]').length).toBe(1))
    })
  })
})
