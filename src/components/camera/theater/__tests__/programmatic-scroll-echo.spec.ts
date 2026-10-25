// @vitest-environment jsdom
/**
 * OUR OWN SCROLL IS NOT A SCRUB — ON THE WEB EITHER.
 *
 * Recorded playback in the hosted PWA (Chrome, camera 103, 2026-10-07) played
 * in bursts: ~1 s of frames, ~1.5 s of nothing. The hub showed why — a
 * `recorded: feeder state … seek-start` every ~3 s, every one of them a GOP
 * replay from the keyframe — and the viewer's own forwarded log showed who
 * asked: `theater:scrub seek committed` once a second, `source: timeline`,
 * `fineSamples: 0`, `spanMs: 0`, each ~410 ms after the live edge `topMs`
 * ticked. Nobody was touching the timeline.
 *
 * The follower scrolls the list to the playhead every second
 * (`scrollListTo`, marked programmatic). react-native-web's ScrollView then
 * delivers TWO `onScroll` calls for that one scroll: the DOM `scroll` event,
 * and a trailing "scroll end" 100 ms later (`ScrollViewBase.handleScrollEnd`)
 * carrying the same offset. The first one settled the programmatic flag and
 * cleared it; the second arrived with the flag down, was read as a wheel
 * frame, and the 300 ms wheel settle committed it — a seek to where the
 * player already was, once a second, each restarting the feeder at its GOP.
 * 100 + 300 ms is the ~410 ms the log measured. iOS and Android emit no such
 * trailing event, which is why the phone played cleanly.
 *
 * This spec drives the REAL react-native-web ScrollView (the test alias maps
 * `react-native` to it), so the trailing echo is the platform's, not a fake's.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, createElement, useEffect, type FunctionComponent } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ScrollView } from 'react-native'

import { useTimelineScrub, type TimelineScrub } from '../use-timeline-scrub.js'
import { offsetToEpoch } from '../timeline-geometry.js'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

const ZOOM = 2
const TOP_MS = Date.UTC(2026, 9, 7, 5, 26, 0)

interface Recorder {
  readonly begins: number[]
  readonly commits: number[]
}

interface Harness {
  readonly scrub: TimelineScrub
  readonly rec: Recorder
  /** What the browser does when the page (or the user's wheel) scrolls the box. */
  readonly browserScrollsTo: (offset: number) => void
  readonly unmount: () => void
}

function mountScrubOnWebScrollView(): Harness {
  const rec: Recorder = { begins: [], commits: [] }
  let api: TimelineScrub | null = null
  let scrollTop = 0
  let node: HTMLElement | null = null

  const browserScrollsTo = (offset: number): void => {
    if (node === null) throw new Error('the scroll view did not mount')
    scrollTop = offset
    node.dispatchEvent(new Event('scroll'))
  }

  const Probe: FunctionComponent = () => {
    const scrub = useTimelineScrub({
      deviceId: 103,
      topMs: TOP_MS,
      zoomIndex: ZOOM,
      isLive: false,
      selectionArmed: false,
      indicatorPx: 289,
      viewportHeight: 577,
      timelineFromMs: TOP_MS - 24 * 3600_000,
      lookbackDays: 1,
      maxLookbackDays: 30,
      onScrubBegin: () => rec.begins.push(Date.now()),
      onScrubMove: () => undefined,
      onScrubCommit: (epoch) => rec.commits.push(epoch),
      onGoLive: () => undefined,
      onScrollOffset: () => undefined,
      onExtendLookback: () => undefined,
    })
    api = scrub
    useEffect(() => {
      // `TimelineScroller`'s handle is `ScrollView.scrollTo`, which in a browser
      // sets scrollTop and lets the engine fire `scroll` — jsdom lays nothing
      // out, so the engine's half is played by `browserScrollsTo`.
      scrub.scrollerRef.current = { scrollToOffset: ({ offset }) => browserScrollsTo(offset) }
    }, [scrub.scrollerRef])
    return createElement(ScrollView, {
      ref: (r: unknown) => {
        const host = r instanceof HTMLElement ? r : null
        if (host === null || node === host) return
        node = host
        Object.defineProperty(host, 'scrollTop', {
          configurable: true,
          get: () => scrollTop,
          set: (v: number) => {
            scrollTop = v
          },
        })
      },
      onScroll: scrub.onScroll,
      scrollEventThrottle: 16,
    })
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
    browserScrollsTo,
    unmount: () => {
      act(() => root?.unmount())
      host.remove()
    },
  }
}

describe('timeline follower on react-native-web — a programmatic scroll never seeks', () => {
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

  it('the trailing scroll-end echo of a follow scroll commits nothing', () => {
    harness = mountScrubOnWebScrollView()
    const { scrub, rec } = harness
    // Ten seconds of recorded playback: the follower moves the list once a
    // second, as `TheaterTimeline`'s auto-follow effect does.
    for (let i = 0; i < 10; i++) {
      act(() => {
        scrub.scrollListTo(4_000 + i * 3, false)
      })
      act(() => {
        vi.advanceTimersByTime(1_000)
      })
    }
    expect(rec.begins).toEqual([])
    expect(rec.commits).toEqual([])
  })

  it('a real wheel scroll after a follow still seeks to where the wheel stopped', () => {
    harness = mountScrubOnWebScrollView()
    const { scrub, rec, browserScrollsTo } = harness
    act(() => {
      scrub.scrollListTo(4_000, false)
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    act(() => {
      browserScrollsTo(4_400)
      browserScrollsTo(4_800)
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    // ONE seek, where the wheel came to rest — never the follower's offset.
    expect(rec.commits).toEqual([offsetToEpoch(4_800, TOP_MS, ZOOM)])
  })

  it('a wheel that comes to rest where a follow had put the list is still a scrub', () => {
    harness = mountScrubOnWebScrollView()
    const { scrub, rec, browserScrollsTo } = harness
    act(() => {
      scrub.scrollListTo(4_000, false)
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    act(() => {
      browserScrollsTo(4_600)
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    act(() => {
      browserScrollsTo(4_000)
    })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(rec.commits).toEqual([offsetToEpoch(4_600, TOP_MS, ZOOM), offsetToEpoch(4_000, TOP_MS, ZOOM)])
  })
})
