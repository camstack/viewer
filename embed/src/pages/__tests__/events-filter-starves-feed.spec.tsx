/**
 * A client-side filter must not starve the pager that would find its matches.
 *
 * ## The defect
 *
 * Every filter on this page runs over rows already fetched — classes,
 * attributes, text, operator flags. Both paging mechanisms were gated on the
 * FILTERED row count:
 *
 *   const hasRows = rows.length > 0          // → the IntersectionObserver
 *   if (rows.length === 0) return            // → the auto-fill effect
 *
 * So a filter narrow enough to keep nothing from the first page switched OFF
 * the only two things that would have asked for the second. The surface showed
 * "No events" while holding a live `nextCursor`, and — because the tail was
 * gated the same way — there was not even a "load older" button to press.
 *
 * ## Why it read as "faces and plates do not work ON THEIR OWN"
 *
 * Measured against the live hub (devices 101/104/102, one day, newest-first,
 * 600 rows): 331 rows carry a face and the FIRST is at index 4, while 10 rows
 * carry a plate and the first is at index **205** — four pages in at the
 * default page size of 60. Faces therefore appeared to work and plates did
 * not, from one defect. Nothing was wrong with the predicate: both attributes
 * key off fields the slim projection carries (`hasEmbeddedFace`,
 * `subLabelMeta.stepId`), and both classes involved (`person`, `vehicle`) are
 * ticked by the default kind selection, so the AND is not empty by
 * construction.
 *
 * ## What the fixtures below reproduce
 *
 * Page one is plateless, page two carries the plate. jsdom has no layout, so
 * the scroller is stubbed with a real height and a zero content height — which
 * is exactly the state the auto-fill effect exists for, and exactly what an
 * empty filtered list looks like.
 */
import { createElement } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '../EmbedEventsPage'
import { parseEventsConfig, type EventsConfig } from '../../embed/events-config'
import type { EventsDataClient, RecentTracksInput } from '../../embed/events-client'
import { resetAuthedImageCache } from '../../embed/use-authed-image'
import { filterRows, toEventsTrackRows } from '../../../../shared/events/events-track-row'

let requests: RecentTracksInput[] = []

function track(
  trackId: string,
  className: string,
  lastSeen: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    trackId,
    deviceId: 101,
    className,
    firstSeen: lastSeen - 5_000,
    lastSeen,
    state: 'idle',
    active: false,
    positions: [],
    snapshots: [],
    zonesVisited: [],
    classes: [className],
    bestEventId: `evt-${trackId}`,
    ...extra,
  }
}

/** The shape the hub actually returns for a track a plate was read on. */
const PLATE = { subLabelMeta: { stepId: 'plate-detection' }, subLabel: 'AB123CD' }

function config(patch?: Partial<EventsConfig>): EventsConfig {
  const result = parseEventsConfig({
    serverUrl: 'https://hub.test',
    token: 'jwt',
    refreshMs: 0,
    deviceIds: [101],
    // The events PAGE is the gallery; the schema default is the reel, whose
    // extent is measured on the horizontal axis.
    view: 'gallery',
    ...patch,
  })
  if (!result.ok) throw new Error(result.error)
  return result.config
}

function fakeClient(
  pages: Map<string | null, { tracks: unknown[]; nextCursor: string | null }>,
): EventsDataClient {
  return {
    listRecentTracks: (input) => {
      requests.push(input)
      return Promise.resolve(pages.get(input.cursor ?? null) ?? { tracks: [], nextCursor: null })
    },
    listDevices: () => Promise.resolve([{ id: 101, name: 'Front Door' }]),
    searchObjectEvents: () => Promise.resolve([]),
    listEventKinds: () => Promise.resolve([]),
  }
}

/** A scroller with a real height and no content — jsdom reports 0 for both,
 *  and a box of unknown size is deliberately never paged against. */
function stubLayout(clientHeight: number, scrollHeight: number): () => void {
  const proto = window.Element.prototype
  const client = Object.getOwnPropertyDescriptor(proto, 'clientHeight')
  const scroll = Object.getOwnPropertyDescriptor(proto, 'scrollHeight')
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => clientHeight })
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => scrollHeight })
  return () => {
    if (client) Object.defineProperty(proto, 'clientHeight', client)
    else Reflect.deleteProperty(proto, 'clientHeight')
    if (scroll) Object.defineProperty(proto, 'scrollHeight', scroll)
    else Reflect.deleteProperty(proto, 'scrollHeight')
  }
}

let restoreLayout: () => void = () => {}

beforeEach(() => {
  requests = []
  resetAuthedImageCache()
  ;(
    window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } }
  ).ReactNativeWebView = { postMessage: () => {} }
  ;(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    observe(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: false })),
  )
  if (typeof URL.createObjectURL !== 'function') {
    URL.createObjectURL = () => 'blob:stub'
    URL.revokeObjectURL = () => {}
  }
  // 500px of scroller, nothing in it — the auto-fill case.
  restoreLayout = stubLayout(500, 0)
})

afterEach(() => {
  restoreLayout()
  cleanup()
  vi.unstubAllGlobals()
})

describe('a narrow attribute filter keeps paging', () => {
  const pages = new Map<string | null, { tracks: unknown[]; nextCursor: string | null }>([
    [
      null,
      {
        tracks: [track('p1', 'person', 9_000), track('p2', 'person', 8_000)],
        nextCursor: 'c1',
      },
    ],
    [
      'c1',
      { tracks: [track('v1', 'vehicle', 7_000, PLATE)], nextCursor: null },
    ],
  ])

  it('reaches a plate that is not on the first page', async () => {
    // The whole report: "Targhe da soli non funzionano". Page one keeps
    // nothing, and before the fix nothing asked for page two.
    render(
      createElement(Events, { client: fakeClient(pages), initialConfig: config({ attrs: ['plate'] }) }),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))
    expect(document.querySelector('[data-track-id]')?.getAttribute('data-track-id')).toBe('v1')
  })

  it('follows the cursor rather than re-asking for page one', async () => {
    render(
      createElement(Events, { client: fakeClient(pages), initialConfig: config({ attrs: ['plate'] }) }),
    )
    await waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(2))
    expect(requests[1]?.cursor).toBe('c1')
  })

  it('does the same for a KIND selection that keeps nothing early', async () => {
    // Not an attribute quirk — every filter on this page runs client-side, so
    // the starvation was the same for classes, text and the flag chips.
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ classes: ['vehicle'] }),
      }),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(1))
  })

  it('still refuses to page while the FIRST page is in flight', async () => {
    // The gate's original reason: the sentinel reports "intersecting" once at
    // observe(), about 3 ms into the mount, and every open used to fetch two
    // pages nobody scrolled to. An empty FEED must still not page.
    // Held open on purpose: the assertion is that NOTHING is asked for while
    // the first page is still in flight.
    const held: Array<(p: { tracks: unknown[]; nextCursor: string | null }) => void> = []
    const client: EventsDataClient = {
      listRecentTracks: (input) => {
        requests.push(input)
        return new Promise((r) => {
          held.push(r)
        })
      },
      listDevices: () => Promise.resolve([{ id: 101, name: 'Front Door' }]),
      searchObjectEvents: () => Promise.resolve([]),
      listEventKinds: () => Promise.resolve([]),
    }
    render(createElement(Events, { client, initialConfig: config({ attrs: ['plate'] }) }))
    await waitFor(() => expect(requests.length).toBe(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(requests.length).toBe(1)
    held[0]?.({ tracks: [], nextCursor: null })
  })
})

describe('an empty view says WHY it is empty', () => {
  it('reports a filtered-out feed differently from a quiet camera', async () => {
    // "This camera was quiet" sends the operator looking for a fault; "nothing
    // matches this filter" sends them to the control they just used.
    const pages = new Map<string | null, { tracks: unknown[]; nextCursor: string | null }>([
      [null, { tracks: [track('p1', 'person', 9_000)], nextCursor: null }],
    ])
    render(
      createElement(Events, { client: fakeClient(pages), initialConfig: config({ attrs: ['plate'] }) }),
    )
    await waitFor(() => expect(document.querySelector('[data-testid="state-empty-filtered"]')).not.toBeNull())
    expect(document.querySelector('[data-testid="state-empty"]')).toBeNull()
  })

  it('keeps the plain empty state when the hub really answered with nothing', async () => {
    const pages = new Map<string | null, { tracks: unknown[]; nextCursor: string | null }>([
      [null, { tracks: [], nextCursor: null }],
    ])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelector('[data-testid="state-empty"]')).not.toBeNull())
    expect(document.querySelector('[data-testid="state-empty-filtered"]')).toBeNull()
  })
})

/**
 * The attribute predicate itself — which was never the defect, and this pins
 * why, so the next report about Volti/Targhe starts somewhere new.
 *
 * `face` and `plate` are a SECOND AXIS, not members of `classes`: a track
 * CARRIES a face or a plate alongside whatever class it is. They key off
 * fields the slim projection returns — `hasEmbeddedFace`, and a tier-2
 * attribution whose `stepId` names a face or plate step — both measured
 * present on the live hub (331 face rows, 10 plate rows in one day over three
 * cameras).
 */
const NAMES = new Map<number, string>([[101, 'Front Door']])

describe('the attribute axis', () => {
  const rows = toEventsTrackRows(
    [
      track('face-embedded', 'person', 9_000, { hasEmbeddedFace: true }),
      track('face-named', 'person', 8_000, {
        subLabelMeta: { stepId: 'face-recognizer' },
        subLabel: 'Alice',
      }),
      track('plated', 'vehicle', 7_000, PLATE),
      track('plain', 'person', 6_000),
    ],
    NAMES,
  )
  /** The events page's default: every advertised kind except the audio ones. */
  const DEFAULT_KINDS = ['motion', 'person', 'vehicle', 'animal', 'package']
  const ids = (list: readonly { trackId: string }[]): string[] =>
    list.map((r) => r.trackId).toSorted()

  it('keeps a face row whether the face is EMBEDDED or NAMED', () => {
    expect(ids(filterRows(rows, [], '', undefined, ['face']))).toEqual([
      'face-embedded',
      'face-named',
    ])
  })

  it('keeps a plate row by its tier-2 attribution, not by its class', () => {
    expect(ids(filterRows(rows, [], '', undefined, ['plate']))).toEqual(['plated'])
  })

  it('ORs the two and ANDs the axis with the kinds — the documented rule', () => {
    expect(ids(filterRows(rows, [], '', undefined, ['face', 'plate']))).toEqual([
      'face-embedded',
      'face-named',
      'plated',
    ])
  })

  it('"Volti alone" is not empty by construction under the DEFAULT kinds', () => {
    // This is the shape worth ruling out: an attribute ANDed with a class list
    // that cannot contain it. Measured on the live hub, every face row is a
    // `person` and every plate row a `vehicle`, and the default ticks both.
    expect(ids(filterRows(rows, DEFAULT_KINDS, '', undefined, ['face']))).toEqual([
      'face-embedded',
      'face-named',
    ])
    expect(ids(filterRows(rows, DEFAULT_KINDS, '', undefined, ['plate']))).toEqual(['plated'])
  })

  it('but IS a further narrowing of the ticked kinds, deliberately', () => {
    // "Vehicles, with a plate" is the point of a second axis. Ticking Faces
    // while Persona is unticked answers nothing, and both controls sit in the
    // same menu where the operator can see it.
    expect(filterRows(rows, ['vehicle'], '', undefined, ['face'])).toHaveLength(0)
    expect(ids(filterRows(rows, ['vehicle'], '', undefined, ['plate']))).toEqual(['plated'])
  })

  it('an EMPTY attribute selection matches everything', () => {
    expect(filterRows(rows, [], '', undefined, [])).toHaveLength(4)
  })
})
