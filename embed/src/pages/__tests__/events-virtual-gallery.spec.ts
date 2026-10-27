/**
 * The gallery is VIRTUALIZED — the DOM stopped being the bound.
 *
 * `DEFAULT_EVENTS_MAX_ROWS` was 600 because the gallery mounted every card it
 * held. The operator met that as "Events only goes back to 17:30", then — once
 * the tail was honest — as a "load older events" button every ten pages. This
 * spec is the proof the button is no longer the mechanism: the list renders a
 * slice near the viewport, the scroller still measures the whole list, and a
 * page landing at the bottom does not move what is on screen.
 *
 * `.spec.ts` with `createElement`, and `stubLayout`, for the same reasons as
 * `events-tail-paging.spec.ts` — jsdom lays everything out at 0×0, and a
 * zero-extent scroller is exactly the state the page refuses to window.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventsDataClient, RecentTracksInput } from '../../embed/events-client'
import { cardEdgePx, type EventsConfig, parseEventsConfig } from '../../embed/events-config'
import { galleryGeometry } from '../../../../shared/events/events-reel-window'
import { resetAuthedImageCache } from '../../embed/use-authed-image'
import { Events } from '../EmbedEventsPage'

/** The scroller's stubbed extent. Both axes: `stubLayout` gives width and
 *  height the same number, exactly as the sibling spec does. */
const EXTENT_PX = 600
/** Must match `GALLERY_GAP_PX` / `GALLERY_PAD_PX` in the page — the geometry is derived from them. */
const GAP_PX = 3
const PAD_PX = 4

function track(trackId: string, lastSeen: number): Record<string, unknown> {
  return {
    trackId,
    deviceId: 101,
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

function page(n: number, from: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => track(`t${String(from - i)}`, from - i))
}

function config(patch?: Partial<EventsConfig>): EventsConfig {
  const result = parseEventsConfig({
    serverUrl: 'https://hub.test',
    token: 'jwt',
    view: 'gallery',
    deviceIds: [101],
    refreshMs: 0,
    ...patch,
  })
  if (!result.ok) throw new Error(result.error)
  return result.config
}

interface ObservedTarget {
  readonly fire: () => void
  readonly target: Element
}

let requests: RecentTracksInput[] = []
/**
 * Every live `IntersectionObserver`, WITH the element it observes.
 *
 * The page builds two kinds: one on the paging sentinel, and one per card
 * (`useInViewport`, which decides when a thumbnail may fetch). "The last one
 * created" is a card's on any list longer than a screen, so firing that would
 * mark a tile visible and page nothing — the reason this spec identifies the
 * sentinel by its target rather than by creation order.
 */
let observers: ObservedTarget[] = []
let scrollTop = 0

type PageMap = Map<string | null, { tracks: unknown[]; nextCursor: string | null }>

function fakeClient(pages: PageMap): EventsDataClient {
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

function stubLayout(extent: number, scrollHeight: number): void {
  for (const prop of ['clientHeight', 'clientWidth'] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => extent })
  }
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  })
  // jsdom pins `scrollTop` at 0. The row window's only positional input is the
  // scroller's own `scrollTop`, so a spec that cannot move it can only ever
  // assert the top of the list.
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next
    },
  })
}

/** The row geometry the page will resolve for this stubbed layout. Read from
 *  the same function the page reads, never re-derived here. */
function geometry(): { readonly columns: number; readonly rowStridePx: number } {
  const resolved = galleryGeometry({
    viewportWidth: EXTENT_PX - 2 * PAD_PX,
    cardWidth: cardEdgePx('medium'),
    gap: GAP_PX,
    columns: 'auto',
  })
  return { columns: resolved.columns, rowStridePx: resolved.rowStridePx }
}

function padPx(testid: string): number {
  const el = document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)
  return Number.parseFloat(el?.style.height ?? '0')
}

function renderedIds(): string[] {
  return [...document.querySelectorAll('[data-track-id]')].map(
    (el) => el.getAttribute('data-track-id') ?? '',
  )
}

/** The paging sentinel: the 1×1 `aria-hidden` div at the true end of the list.
 *  Nothing else in the surface is observed at that size. */
function sentinelObserver(): ObservedTarget | undefined {
  return observers.findLast(
    (o) => o.target instanceof HTMLElement && o.target.style.width === '1px',
  )
}

/** Ask for one more page the way an operator approaching the end does, and
 *  wait for it to land. */
async function pageIn(expected: number): Promise<void> {
  await waitFor(() => expect(sentinelObserver()).toBeDefined())
  act(() => {
    sentinelObserver()?.fire()
  })
  await waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(expected))
}

beforeEach(() => {
  requests = []
  observers = []
  scrollTop = 0
  resetAuthedImageCache()
  ;(
    window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } }
  ).ReactNativeWebView = { postMessage: () => {} }
  ;(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    private readonly fire: () => void
    constructor(cb: (entries: ReadonlyArray<{ isIntersecting: boolean }>) => void) {
      this.fire = () => cb([{ isIntersecting: true }])
    }
    observe(target: Element): void {
      observers.push({ fire: this.fire, target })
    }
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
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  for (const prop of ['clientHeight', 'clientWidth', 'scrollHeight', 'scrollTop']) {
    Reflect.deleteProperty(HTMLElement.prototype, prop)
  }
})

describe('the gallery renders a window, not the feed', () => {
  it('a long list puts only the rows near the viewport in the DOM', async () => {
    stubLayout(EXTENT_PX, 20_000)
    const pages: PageMap = new Map([
      [null, { tracks: page(240, 1_000_000), nextCursor: null }],
    ])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelector('[data-testid="tail-end"]')).toBeTruthy())

    const { columns, rowStridePx } = geometry()
    const visibleRows = Math.ceil(EXTENT_PX / rowStridePx)
    const mounted = renderedIds().length
    // The whole point: 240 rows are HELD, a fraction of them are mounted.
    expect(mounted).toBeLessThanOrEqual((visibleRows + 2 * 2) * columns)
    expect(mounted).toBeLessThan(240)
    expect(mounted).toBeGreaterThan(0)
    // …and they are the rows at the top, in feed order.
    expect(renderedIds()[0]).toBe('t1000000')
  })

  it('the scroller still measures the WHOLE list, not the slice', async () => {
    stubLayout(EXTENT_PX, 20_000)
    const pages: PageMap = new Map([
      [null, { tracks: page(240, 1_000_000), nextCursor: null }],
    ])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelector('[data-testid="tail-end"]')).toBeTruthy())

    const { columns, rowStridePx } = geometry()
    const rowCount = Math.ceil(240 / columns)
    const mountedRows = document.querySelectorAll('[data-row-index]').length
    // jsdom gives a rendered row no height, so the mounted rows contribute the
    // ESTIMATE — which is exactly what the window used to place the pads.
    const total = padPx('gallery-pad-top') + mountedRows * rowStridePx + padPx('gallery-pad-bottom')
    expect(total).toBeCloseTo(rowCount * rowStridePx, 5)
    // A scrollbar that described the slice would leave nothing below.
    expect(padPx('gallery-pad-bottom')).toBeGreaterThan(0)
  })

  it('a page landing at the bottom does not move the visible rows', async () => {
    stubLayout(EXTENT_PX, 20_000)
    const pages: PageMap = new Map([
      [null, { tracks: page(60, 1_000_000), nextCursor: 'c1' }],
      ['c1', { tracks: page(60, 900_000), nextCursor: 'c2' }],
      ['c2', { tracks: page(60, 800_000), nextCursor: 'c3' }],
      ['c3', { tracks: page(60, 700_000), nextCursor: null }],
    ])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]').length).toBeGreaterThan(0))
    await pageIn(2)
    await pageIn(3)
    await waitFor(() => expect(document.querySelector('[data-testid="tail-more"]')).toBeNull())

    // Scroll into the middle of the 180 loaded rows (26 grid rows of ~103 px at 7 columns) and settle there.
    const scroller = document.querySelector<HTMLElement>('[data-testid="events-scroller"]')
    if (scroller === null) throw new Error('no scroller')
    await act(async () => {
      scroller.scrollTop = 1_200
      scroller.dispatchEvent(new Event('scroll'))
      await Promise.resolve()
    })
    const before = renderedIds()
    const padBefore = padPx('gallery-pad-top')
    expect(before.length).toBeGreaterThan(0)
    expect(padBefore).toBeGreaterThan(0)

    // The fourth page arrives BELOW everything on screen.
    await pageIn(4)
    await waitFor(() => expect(requests.length).toBe(4))

    expect(renderedIds()).toEqual(before)
    expect(padPx('gallery-pad-top')).toBe(padBefore)
  })

  it('the REEL is not windowed — it mounts what it holds', async () => {
    // Its bound is still the DOM, which is why `resolveMaxRows` clamps it.
    stubLayout(EXTENT_PX, 20_000)
    const pages: PageMap = new Map([[null, { tracks: page(40, 1_000_000), nextCursor: null }]])
    render(
      createElement(Events, {
        client: fakeClient(pages),
        initialConfig: config({ view: 'reel' }),
      }),
    )
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(40))
    expect(document.querySelector('[data-testid="gallery-pad-top"]')).toBeNull()
  })
})
