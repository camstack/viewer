// @vitest-environment jsdom
/**
 * MOMENTUM SETTLEMENT IS THE SEEK.
 *
 * A flick must decelerate naturally. Preview follows the strip and the one
 * committed seek uses its resting position. A slow drag still commits after
 * the short grace in which React Native would announce momentum.
 *
 * This is a REAL run of the hook, not a source guard. The viewer has no
 * react-native renderer, but this hook touches React only through `useRef`,
 * `useCallback` and `useEffect` — every react-native import in it is a `type`
 * import, erased at compile time — so `react-dom` in jsdom drives it exactly as
 * the app does. That matters here: the defect is in the ORDER of the impure
 * event plumbing (which handler owns the commit), which is precisely what a
 * pure-reducer test cannot see. `scroll-scrub-gesture.spec.ts` was green
 * throughout the whole life of this bug.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createElement, type FunctionComponent } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'

import { useTimelineScrub, type TimelineScrub } from '../use-timeline-scrub.js'
import { offsetToEpoch } from '../timeline-geometry.js'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const ZOOM = 2
/** A fixed live edge, so every expectation is arithmetic rather than a clock. */
const TOP_MS = Date.UTC(2026, 7, 8, 12, 0, 0)

interface Recorder {
  readonly begins: number[]
  readonly moves: number[]
  readonly commits: number[]
  readonly goLives: number[]
}

interface Harness {
  readonly scrub: TimelineScrub
  readonly rec: Recorder
  readonly unmount: () => void
}

const scrollEvent = (offsetY: number): NativeSyntheticEvent<NativeScrollEvent> =>
  ({ nativeEvent: { contentOffset: { y: offsetY } } }) as NativeSyntheticEvent<NativeScrollEvent>

function mountScrub(): Harness {
  const rec: Recorder = { begins: [], moves: [], commits: [], goLives: [] }
  let api: TimelineScrub | null = null

  const Probe: FunctionComponent = () => {
    api = useTimelineScrub({
      deviceId: 101,
      topMs: TOP_MS,
      zoomIndex: ZOOM,
      isLive: false,
    selectionArmed: false,
      indicatorPx: 120,
      viewportHeight: 400,
      timelineFromMs: TOP_MS - 24 * 3600_000,
      lookbackDays: 1,
      maxLookbackDays: 30,
      onScrubBegin: () => rec.begins.push(Date.now()),
      onScrubMove: (epoch) => rec.moves.push(epoch),
      onScrubCommit: (epoch) => rec.commits.push(epoch),
      onGoLive: () => rec.goLives.push(Date.now()),
      onScrollOffset: () => undefined,
      onExtendLookback: () => undefined,
    })
    return null
  }

  const host = document.createElement('div')
  document.body.appendChild(host)
  let root: Root | null = null
  act(() => {
    root = createRoot(host)
    root.render(createElement(Probe))
  })
  if (api === null) throw new Error('the hook did not run')
  return {
    scrub: api,
    rec,
    unmount: () => {
      act(() => root?.unmount())
      host.remove()
    },
  }
}

describe('timeline scrub — momentum settles before playback commits', () => {
  let harness: Harness | null = null

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    vi.useFakeTimers()
  })
  afterEach(() => {
    harness?.unmount()
    harness = null
    vi.useRealTimers()
  })

  it('commits the resting offset after a fling', () => {
    harness = mountScrub()
    const { scrub, rec } = harness
    const release = 5_000
    const drifted = 9_000 // where inertia would have carried the strip

    act(() => {
      scrub.onScrollBeginDrag()
      scrub.onScroll(scrollEvent(4_800))
      scrub.onScrollEndDrag(scrollEvent(release))
    })

    expect(rec.commits).toEqual([])
    act(() => {
      scrub.onMomentumScrollBegin()
      scrub.onMomentumScrollEnd(scrollEvent(drifted))
      vi.advanceTimersByTime(1_000)
    })
    expect(rec.commits).toEqual([offsetToEpoch(drifted, TOP_MS, ZOOM)])
  })

  it('does not emit a second seek when momentum begins after the release grace', () => {
    harness = mountScrub()
    const { scrub, rec } = harness
    const release = 4_000
    const rest = 8_000
    act(() => {
      scrub.onScrollBeginDrag()
      scrub.onScroll(scrollEvent(release))
      scrub.onScrollEndDrag(scrollEvent(release))
      vi.advanceTimersByTime(100)
      scrub.onMomentumScrollBegin()
      scrub.onScroll(scrollEvent(rest))
      scrub.onMomentumScrollEnd(scrollEvent(rest))
    })
    expect(rec.commits).toEqual([offsetToEpoch(release, TOP_MS, ZOOM)])
  })

  it('never pins the strip with a programmatic scroll', () => {
    harness = mountScrub()
    const { scrub } = harness
    const offsets: number[] = []
    scrub.scrollerRef.current = {
      scrollToOffset: ({ offset }: { offset: number; animated?: boolean }) => {
        offsets.push(offset)
      },
    } as unknown as (typeof scrub.scrollerRef)['current']

    const release = 3_400
    act(() => {
      scrub.onScrollBeginDrag()
      scrub.onScroll(scrollEvent(3_300))
      scrub.onScrollEndDrag(scrollEvent(release))
    })

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(offsets).toEqual([])
  })

  it('a slow drag with no fling behaves exactly the same', () => {
    harness = mountScrub()
    const { scrub, rec } = harness
    const release = 2_222
    act(() => {
      scrub.onScrollBeginDrag()
      scrub.onScroll(scrollEvent(2_000))
      scrub.onScroll(scrollEvent(release))
      scrub.onScrollEndDrag(scrollEvent(release))
      vi.advanceTimersByTime(100)
    })
    expect(rec.commits).toEqual([offsetToEpoch(release, TOP_MS, ZOOM)])
  })

  it('releasing INTO the live edge goes live instead of seeking', () => {
    harness = mountScrub()
    const { scrub, rec } = harness
    act(() => {
      scrub.onScrollBeginDrag()
      scrub.onScroll(scrollEvent(3_000))
      // Offset 0 = the live edge.
      scrub.onScrollEndDrag(scrollEvent(0))
      vi.advanceTimersByTime(100)
    })
    expect(rec.commits).toEqual([])
    expect(rec.goLives.length).toBe(1)
  })

  it('a web wheel still commits on the idle settle — there is no release event', () => {
    harness = mountScrub()
    const { scrub, rec } = harness
    const rest = 6_100
    act(() => {
      scrub.onScroll(scrollEvent(6_000))
      scrub.onScroll(scrollEvent(rest))
    })
    expect(rec.commits).toEqual([])
    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(rec.commits).toEqual([offsetToEpoch(6_000, TOP_MS, ZOOM)])
  })
})
