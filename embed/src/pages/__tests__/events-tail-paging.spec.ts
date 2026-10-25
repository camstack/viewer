/**
 * Infinite scroll at the bottom of the events feed: how EARLY the next page is
 * asked for, and what the surface says when it stops.
 *
 * `.spec.ts` with `createElement` for the same reason as
 * `events-embed-wiring.spec.ts`: the bundle config routes `embed/**\/*.spec.ts`
 * to jsdom, and a `.tsx` there would run under node and die on `document`.
 *
 * jsdom lays everything out at 0×0 — `clientHeight`, `clientWidth` and
 * `scrollHeight` are all 0 unless defined. A 0-extent scroller is exactly the
 * state the page treats as "unmeasured", so a spec that skips
 * {@link stubLayout} would prove nothing about either the prefetch margin or
 * the auto-fill.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventsDataClient, RecentTracksInput } from '../../embed/events-client'
import { type EventsConfig, parseEventsConfig } from '../../embed/events-config'
import { resetAuthedImageCache } from '../../embed/use-authed-image'
import { Events, sentinelMarginPx } from '../EmbedEventsPage'

interface ObserverInit {
  readonly root: Element | null
  readonly rootMargin: string
}

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

let requests: RecentTracksInput[] = []
let observerInits: ObserverInit[] = []
let observerCallbacks: Array<() => void> = []

type PageMap = Map<string | null, { tracks: unknown[]; nextCursor: string | null } | 'fail'>

function fakeClient(pages: PageMap): EventsDataClient {
  return {
    listRecentTracks: (input) => {
      requests.push(input)
      const found = pages.get(input.cursor ?? null)
      if (found === 'fail') return Promise.reject(new Error('Network request failed'))
      return Promise.resolve(found ?? { tracks: [], nextCursor: null })
    },
    listDevices: () => Promise.resolve([{ id: 101, name: 'Front Door' }]),
    searchObjectEvents: () => Promise.resolve([]),
    listEventKinds: () => Promise.resolve([]),
  }
}

/**
 * Give the jsdom scroller a real size.
 *
 * `clientHeight` is the prefetch policy's only input, and `scrollHeight`
 * decides whether the auto-fill considers the viewport full — leaving both at
 * jsdom's 0 makes the page take its "unmeasured, do not guess" branch and every
 * assertion below becomes vacuous.
 */
function stubLayout(clientHeight: number, scrollHeight: number): void {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get: () => clientHeight,
  })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => clientHeight,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight,
  })
}

beforeEach(() => {
  requests = []
  observerInits = []
  observerCallbacks = []
  resetAuthedImageCache()
  ;(
    window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } }
  ).ReactNativeWebView = { postMessage: () => {} }
  // A recording IntersectionObserver: the constructor arguments ARE the
  // prefetch policy, and firing the callback is the operator approaching the
  // end of the loaded rows.
  ;(window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    constructor(
      cb: (entries: ReadonlyArray<{ isIntersecting: boolean }>) => void,
      init: ObserverInit,
    ) {
      observerInits.push(init)
      observerCallbacks.push(() => cb([{ isIntersecting: true }]))
    }
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
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  for (const prop of ['clientHeight', 'clientWidth', 'scrollHeight']) {
    Reflect.deleteProperty(HTMLElement.prototype, prop)
  }
})

describe('the next page is asked for BEFORE the end of the loaded rows', () => {
  it('the margin is one whole scroller, not a constant', () => {
    // A fixed 400 px is two card rows on a phone and a third of a row on a
    // wall display: one number, two policies. Measured, it is one policy.
    expect(sentinelMarginPx(900)).toBe(900)
    expect(sentinelMarginPx(2_400)).toBe(2_400)
  })

  it('an UNMEASURED scroller falls back to the floor, never to zero', () => {
    // Zero would fetch exactly at the wall — the behaviour being fixed.
    expect(sentinelMarginPx(0)).toBe(400)
    expect(sentinelMarginPx(120)).toBe(400)
  })

  it('the live observer is built with the scroller’s own height as its margin', async () => {
    stubLayout(900, 20_000)
    const pages: PageMap = new Map([
      [null, { tracks: page(4, 1_000_000), nextCursor: 'c1' }],
      ['c1', { tracks: page(4, 900_000), nextCursor: null }],
    ])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(4))
    await waitFor(() => expect(observerInits.length).toBeGreaterThan(0))
    const last = observerInits[observerInits.length - 1]
    expect(last?.rootMargin).toBe('900px')
    // …and it is the scroller that is observed, not the viewport: both layouts
    // scroll inside their own element.
    expect((last?.root as HTMLElement | null)?.dataset.testid).toBe('events-scroller')
  })
})

describe('the tail says WHICH of the three things happened', () => {
  it('a server-exhausted feed is the end, and says so', async () => {
    stubLayout(900, 20_000)
    const pages: PageMap = new Map([[null, { tracks: page(4, 1_000_000), nextCursor: null }]])
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
    await waitFor(() => expect(document.querySelector('[data-testid="tail-end"]')).toBeTruthy())
    expect(document.querySelector('[data-testid="tail-more"]')).toBeNull()
    expect(document.querySelector('[data-testid="tail-error"]')).toBeNull()
  })

  it('the CEILING is not the end — it offers to continue, and continuing works', async () => {
    stubLayout(900, 20_000)
    const pages: PageMap = new Map([
      [null, { tracks: page(2, 1_000_000), nextCursor: 'c1' }],
      ['c1', { tracks: page(2, 900_000), nextCursor: null }],
    ])
    // maxRows 2 ⇒ page one fills the budget with a cursor still outstanding.
    render(createElement(Events, { client: fakeClient(pages), initialConfig: config({ maxRows: 2 }) }))
    await waitFor(() => expect(document.querySelector('[data-testid="tail-more"]')).toBeTruthy())
    // THE regression: this is what drew "· fine ·" over five hours of history.
    expect(document.querySelector('[data-testid="tail-end"]')).toBeNull()

    const button = document.querySelector<HTMLButtonElement>('[data-testid="tail-more"]')
    await act(async () => {
      button?.click()
      await Promise.resolve()
    })
    // The lift buys one more block AND reaches the genuine end of the feed.
    await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(4))
    await waitFor(() => expect(document.querySelector('[data-testid="tail-end"]')).toBeTruthy())
  })

  it('a FAILED page never reads as "you have reached the beginning"', async () => {
    // The scroller is full, so nothing auto-fills: the second page is asked
    // for by the sentinel, exactly as an operator scrolling would.
    stubLayout(900, 20_000)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const pages: PageMap = new Map<
        string | null,
        { tracks: unknown[]; nextCursor: string | null } | 'fail'
      >([
        [null, { tracks: page(4, 1_000_000), nextCursor: 'c1' }],
        ['c1', 'fail'],
      ])
      render(createElement(Events, { client: fakeClient(pages), initialConfig: config() }))
      await waitFor(() => expect(document.querySelectorAll('[data-track-id]')).toHaveLength(4))
      await waitFor(() => expect(observerCallbacks.length).toBeGreaterThan(0))
      act(() => {
        observerCallbacks[observerCallbacks.length - 1]?.()
      })
      // Three attempts, 300 ms + 900 ms apart, before a failure is admitted.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000)
      })
      await waitFor(() =>
        expect(document.querySelector('[data-testid="tail-error"]')).toBeTruthy(),
      )
      expect(document.querySelector('[data-testid="tail-end"]')).toBeNull()
      // …and the rows the operator was reading are still on screen: the
      // full-surface error belongs to an EMPTY surface, not over a live list.
      expect(document.querySelectorAll('[data-track-id]')).toHaveLength(4)
      expect(document.querySelector('[data-testid="state-error"]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
