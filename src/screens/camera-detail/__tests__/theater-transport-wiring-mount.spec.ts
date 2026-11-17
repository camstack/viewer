/**
 * @vitest-environment jsdom
 *
 * The theater's controls reach the PLAYER — mounted, not grepped (planning#110).
 *
 * `timeline-scrub-wiring.spec.ts` and `clip-row-and-rate-order-wiring.spec.ts`
 * were written when nothing in this repo could mount a component, so they read
 * the source and look for prop names. A prop can be spelled right and still be
 * forwarded to nothing. Each test here mounts the whole camera screen over the
 * stub hub, works the control the way the operator does, and reads what the
 * player actually received: the commands injected into its WebView
 * (`webview-control.ts`), which is the only channel the embed listens to.
 *
 *   1. scrub → transport   a scroll of the timeline starts a scrub, drags the
 *                          player through `scrubTo`, and commits ONE seek
 *                          at the instant the drag stopped on.
 *   2. selection → player  a tap on an event card seeks the player to that
 *                          event.
 *   3. rate order → player the speed rows are listed fastest-first (the menu
 *                          opens upward), and a row sets the player's rate.
 *
 * A refactor that drops any link of these chains (hook → scroller → screen
 * sink → player handle → WebView) leaves every type and every pure spec green;
 * these fail.
 *
 * Deterministic: the scrub's idle commit is a 300 ms timer, driven with fake
 * timers; no assertion reads the wall clock. And the clock itself is PINNED at
 * local noon: the stub event sits {@link EVENT_AGO_MS} before the newest
 * instant, which in the first minutes after local midnight fell before the
 * day's window and drew no card at all (red from 00:00 to ~00:30, every TZ).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import React from 'react'

import i18n from '../../../app/i18n.js'
import { mountScreen } from '../../../testing/mount.js'
import { deliverLayout } from '../../../testing/layout-control.js'
import { injectedWebViewScripts } from '../../../testing/webview-control.js'
import { CameraDetailScreen } from '../../CameraDetailScreen.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)

const CAMERA_NAME = 'Front gate'
const PHONE = { width: 390, height: 600 } as const
/** How far before the newest instant the one event on the timeline starts. */
const EVENT_AGO_MS = 20 * 60_000
const EVENT_SPAN_MS = 12_000
/** The pinned wall clock: local noon on an ordinary (non-DST) day, in any TZ. */
const PINNED_NOW_MS = new Date(2026, 9, 14, 12, 0, 0, 0).getTime()

interface TracksRequest {
  readonly since: number
  readonly until: number
}

function isTracksRequest(input: unknown): input is TracksRequest {
  return (
    typeof input === 'object' &&
    input !== null &&
    typeof Reflect.get(input, 'since') === 'number' &&
    typeof Reflect.get(input, 'until') === 'number'
  )
}

/** The one event the stub hub serves, and when it started — read back by the assertions. */
const served = { firstSeen: 0 }

function tracksAnswer(input: unknown): readonly unknown[] {
  if (!isTracksRequest(input)) return []
  const firstSeen = input.until - EVENT_AGO_MS
  if (firstSeen <= input.since) return []
  served.firstSeen = firstSeen
  return [
    {
      trackId: 't1',
      deviceId: 1,
      className: 'person',
      firstSeen,
      lastSeen: firstSeen + EVENT_SPAN_MS,
      state: 'idle',
      active: false,
      zonesVisited: [],
      zoneNames: [],
      classes: ['person'],
      audioLabels: [],
      bestEventId: 'ev-t1',
      source: 'pipeline',
    },
  ]
}

const HUB = {
  'deviceManager.listAll': [
    { id: 1, name: CAMERA_NAME, type: 'camera', isCamera: true, online: true, disabled: false, features: [] },
  ],
  'pipelineAnalytics.listTracks': tracksAnswer,
}

/** A command the screen injected into the player since `from`, decoded. */
interface PlayerCall {
  readonly method: string
  readonly args: readonly unknown[]
}

const EMBED_CALL = /^try\{window\.__camstackEmbed\.(\w+)\((.*)\)\}catch\(e\)\{\}; true;$/

function playerCallsSince(from: number): readonly PlayerCall[] {
  return injectedWebViewScripts()
    .slice(from)
    .flatMap((script) => {
      const match = EMBED_CALL.exec(script)
      if (match === null) return []
      const args: unknown = JSON.parse(`[${match[2]}]`)
      return [{ method: match[1], args: Array.isArray(args) ? args : [] }]
    })
}

function epochArg(call: PlayerCall | undefined): number {
  const epoch = call?.args[0]
  if (typeof epoch !== 'number') throw new Error(`no epoch in ${JSON.stringify(call)}`)
  return epoch
}

async function openTheater(): Promise<void> {
  mountScreen(React.createElement(CameraDetailScreen, { deviceId: 1 }), { hub: HUB })
  await screen.findAllByText(CAMERA_NAME)
  deliverLayout(document.body, PHONE)
}

/**
 * RNW draws a vertical ScrollView as an `overflowY` box over a content
 * container carrying the height it was given. The timeline is the one whose
 * content has a height: a day of axis.
 */
function timelineScroller(): HTMLElement {
  const scrollers = [...document.querySelectorAll<HTMLElement>('[class*="r-overflowY"]')].filter((el) => {
    const content = el.firstElementChild
    return content instanceof HTMLElement && Number.parseFloat(content.style.height) > 0
  })
  expect(scrollers).toHaveLength(1)
  return scrollers[0]
}

/** Tap the one event card's pill — the operator picking an event on the timeline. */
async function tapEventCard(): Promise<void> {
  const card = await screen.findByTestId('cluster-card')
  const pill = card.querySelector('[role="button"], button')
  if (pill === null) throw new Error('the event card has no pressable pill')
  fireEvent.click(pill)
  await act(async () => undefined)
}

beforeEach(async () => {
  // Only `Date`, and it keeps ticking from the pinned instant — timers stay
  // real, so the mount's deferrals run exactly as before.
  vi.useFakeTimers({ toFake: ['Date'], now: PINNED_NOW_MS, shouldAdvanceTime: true })
  served.firstSeen = 0
  await AsyncStorage.clear()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('scrub → transport', () => {
  it('a scroll of the timeline scrubs the player and commits one seek where it stopped', async () => {
    await openTheater()
    const scroller = timelineScroller()
    const from = injectedWebViewScripts().length

    // Hand the pinned clock over to fully driven timers, at the same instant.
    const pinned = Date.now()
    vi.useRealTimers()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'], now: pinned })
    for (const offsetY of [200, 400, 600]) {
      act(() => {
        scroller.scrollTop = offsetY
        scroller.dispatchEvent(new Event('scroll'))
      })
      act(() => vi.advanceTimersByTime(50))
    }
    // The scrub's idle commit (`SCRUB_IDLE_COMMIT_MS`, 300 ms) fires once the scrolling stops.
    act(() => vi.advanceTimersByTime(1_000))

    const calls = playerCallsSince(from)
    const methods = calls.map((c) => c.method)
    expect(methods[0]).toBe('scrubStart')
    expect(methods.filter((m) => m === 'scrubCommit')).toHaveLength(1)
    expect(methods.at(-1)).toBe('scrubCommit')

    // Further down the timeline is further back in time, and the commit lands
    // on the instant the last drag sample showed.
    const drags = calls.filter((c) => c.method === 'scrubTo').map(epochArg)
    expect(drags.length).toBeGreaterThanOrEqual(3)
    expect(drags[1]).toBeLessThan(drags[0])
    const commit = epochArg(calls.at(-1))
    expect(commit).toBe(drags.at(-1))
    expect(commit).toBeLessThan(drags[0])

    // Start and commit name the same gesture, so hub and app logs join.
    expect(calls[0].args[0]).toBe(calls.at(-1)?.args[1])
  })
})

describe('timeline selection → player', () => {
  it('a tap on an event card seeks the player to that event', async () => {
    await openTheater()
    await screen.findByTestId('cluster-card')
    expect(served.firstSeen).toBeGreaterThan(0)
    const from = injectedWebViewScripts().length

    await tapEventCard()

    const seeks = playerCallsSince(from).filter((c) => c.method === 'seek')
    expect(seeks).toHaveLength(1)
    const epoch = epochArg(seeks[0])
    // Onto the event: never after it ended, and no further back than a lead-in.
    expect(epoch).toBeLessThanOrEqual(served.firstSeen + EVENT_SPAN_MS)
    expect(epoch).toBeGreaterThanOrEqual(served.firstSeen - 60_000)
  })
})

describe('rate order → player', () => {
  const RATE_LABEL = /^\d+(\.\d+)?×$/

  function rateRows(): readonly HTMLElement[] {
    return [...document.querySelectorAll<HTMLElement>('[aria-label]')].filter((el) =>
      RATE_LABEL.test(el.getAttribute('aria-label') ?? ''),
    )
  }

  const rateOf = (el: HTMLElement): number => Number.parseFloat(el.getAttribute('aria-label') ?? '')

  it('lists the speeds fastest-first and a row sets the player’s rate', async () => {
    await openTheater()
    // Live has no speed; a recording does. Enter one the way the operator does.
    expect(rateRows()).toHaveLength(0)
    await tapEventCard()
    fireEvent.click(screen.getByLabelText(i18n.t('v2.playback.moreControls')))
    await act(async () => undefined)

    const rates = rateRows().map(rateOf)
    expect(rates.length).toBeGreaterThan(1)
    expect(rates).toEqual([...rates].sort((a, b) => b - a))

    const target = rateRows().find((el) => rateOf(el) === 2)
    if (target === undefined) throw new Error('no 2× row')
    const from = injectedWebViewScripts().length
    fireEvent.click(target)
    await act(async () => undefined)

    expect(playerCallsSince(from)).toContainEqual({ method: 'setRate', args: [2] })
  })
})
