import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The scrub handlers survive the trip from the hook to the ScrollView.
 *
 * On 2026-08-01 the operator asked whether scrub and playback had broken in the
 * chrome restructure, and nothing in the repo could answer. The suite was green
 * at 1194, `tsc` was clean and the bundle exported — and all three pass with the
 * handlers disconnected, because the scrub specs cover PURE modules
 * (`heatmap-scrub`, `scroll-scrub-gesture`) and nothing covered the PATH:
 *
 *   useTimelineScrub (TheaterTimeline) → scroller binding → TimelineView
 *     → TimelineScroller → ScrollView
 *
 * A restructure that moves a component between parents is exactly when that path
 * breaks and exactly when a green suite is least informative.
 *
 * This is a SOURCE guard for the same reason `docked-timeline-chrome.spec.ts` is
 * one: the viewer's vitest config includes only `src/**\/__tests__/**\/*.spec.ts`
 * and the environment is `node`, with no react renderer installed — so a
 * component cannot be mounted here at all, and a `.spec.tsx` is silently never
 * collected. Adding that toolchain is a dependency decision for the operator,
 * not something to slip into a bug fix. Until then, this is the instrument
 * available, and it does catch the regression it names: a handler dropped
 * during a move.
 */

const THEATER = join(process.cwd(), 'src', 'components', 'camera', 'theater')
const read = (f: string): string => readFileSync(join(THEATER, f), 'utf8')

/**
 * Every scroll callback the scrub hook exposes. Losing ONE silently kills a
 * distinct gesture rather than scrolling as a whole — `onMomentumScrollEnd`
 * alone is what commits a fling, so its loss looks like "sometimes it does not
 * seek", which is the hardest kind of report to act on.
 */
const SCROLL_HANDLERS = [
  'onScroll',
  'onScrollBeginDrag',
  'onScrollEndDrag',
  'onMomentumScrollBegin',
  'onMomentumScrollEnd',
] as const

describe('scrub wiring survives the component boundary', () => {
  /**
   * The body of a `const <name> = useCallback(` declaration, or `null`.
   * Crude but sufficient: it stops at the dependency array, which every
   * callback in this file has.
   */
  function callbackBody(src: string, name: string): string | null {
    const from = src.indexOf(`const ${name} = useCallback(`)
    if (from === -1) return null
    const end = src.indexOf('\n  }, [', from)
    return end === -1 ? null : src.slice(from, end)
  }

  it('TheaterTimeline binds every scrub handler into the scroller props', () => {
    // Direct, OR through a local wrapper that CALLS the hook's handler in its
    // own body. The invariant is "no gesture is silently lost", not a spelling:
    // `onScrollBeginDrag` was wrapped for a year so the clip follow could
    // break its hook on the same finger, and the wrapper is allowed to come
    // back for the next such reason. What may never happen is a handler that
    // is bound and does not forward.
    //
    // A wrapper that merely EXISTS is not enough, and this guard was briefly
    // written that way: `const alias = scrub.onScrollBeginDrag` sitting
    // anywhere in the file satisfied it while the wrapper dropped the call.
    // The forwarding has to be inside the body that is bound.
    const src = read('TheaterTimeline.tsx')
    const missing = SCROLL_HANDLERS.filter((h) => {
      if (src.includes(`${h}: scrub.${h}`)) return false
      const bound = new RegExp(`${h}: (\\w+),`).exec(src)
      if (bound === null) return true
      const body = callbackBody(src, bound[1] ?? '')
      if (body === null) return true
      // Either the hook's handler by its full name, or a local alias of it.
      const aliases = [...src.matchAll(new RegExp(`const (\\w+) = scrub\\.${h}\\b`, 'g'))].map(
        (m) => m[1] ?? '',
      )
      return ![`scrub.${h}(`, ...aliases.map((a) => `${a}(`)].some((call) => body.includes(call))
    })
    expect(missing).toEqual([])
  })

  it('TheaterTimeline hands the scroller REF to the view', () => {
    // Without it the list can never be scrolled BY US: "go live" and playback
    // auto-follow silently do nothing while dragging still works, which reads
    // as "playback is broken" rather than as a missing ref.
    expect(read('TheaterTimeline.tsx')).toContain('scrollerRef={scrub.scrollerRef}')
  })

  it('TimelineView forwards the scroller props and the ref onward', () => {
    const src = read('TimelineView.tsx')
    expect(src).toContain('ref={scrollerRef}')
    expect(src).toContain('{...scroller}')
    // The footer is DOCKED (in flow, under the body), so the list reserves
    // nothing for it: a reservation here would count its height twice.
    expect(src).not.toContain('contentBottomInset')
  })

  it('TimelineScroller still declares the handlers and throttles scroll events', () => {
    const src = read('TimelineScroller.tsx')
    for (const h of SCROLL_HANDLERS) expect(src).toContain(h)
    // Without a throttle iOS delivers `onScroll` once per gesture, which turns
    // a smooth scrub into a single jump — working, and useless.
    expect(src).toContain('scrollEventThrottle')
  })

  it('the back-scroll latch is the MODEL, not an inline number', () => {
    // `lookback-walk.spec.ts` proves the day-boundary walk; it proves nothing
    // about this hook unless the hook actually runs that model. The bug it
    // fixes lived in a bare `useRef(-1)` compared against a mirrored
    // `lookbackDays`, and a re-inlined comparison would restore it with the
    // pure suite still green.
    const src = read('use-timeline-scrub.ts')
    expect(src).toContain("from './lookback-walk.js'")
    expect(src).toContain('observeLookbackDays(lookbackWalkRef.current, lookbackDays)')
    expect(src).toContain('decideLookbackExtension(walk, maxLookbackDays)')
    expect(src).toContain('markLookbackRequested(walk)')
    expect(src).not.toContain('extendRequestedAtRef')
  })

  it('a near-bottom hit that does NOT extend still leaves a line', () => {
    // The stall the operator reported produced no log at all, so "the walk
    // stopped asking" and "there is no older footage" were the same silence.
    // Both non-extending outcomes must reach the pipeline, carrying WHICH one.
    const src = read('use-timeline-scrub.ts')
    expect(src).toContain("'back-scroll did NOT extend'")
    expect(src).toContain("'back-scroll extending lookback'")
    // `outcome` on the payload is the whole point of the line: without it the
    // limit and the in-flight request are indistinguishable again.
    expect(/back-scroll did NOT extend[\s\S]{0,600}?outcome,/.test(src)).toBe(true)
  })

  it('the selection reaches BOTH per-frame gates, or the fix is not wired', () => {
    // Both are pure and tested (`scrub-dispatch-budget`, `scroll-scrub-gesture`)
    // and both are useless unwired: the detent would keep pulsing through a
    // selection, and dragging the free end forward would snap live and drop the
    // anchor. Neither failure has a test that can see it from inside a module.
    const src = read('TheaterTimeline.tsx')
    expect(src).toContain('detentKeyWhileScrubbing(selectingRef.current')
    expect(/useTimelineScrub\(\{[\s\S]{0,400}?selectionArmed,/.test(src)).toBe(true)
    const hook = read('use-timeline-scrub.ts')
    expect(hook).not.toContain("feedScrub({ kind: 'liveEdge' })")
    expect(hook).toContain("armedSelection: selectionArmedRef.current")
  })

  it('the playback bar is bound to the transport, not to the indicator offset', () => {
    const src = read('TheaterTimeline.tsx')
    expect(src).toContain('onTogglePause:')
    expect(src).toContain('onGoLive:')
    // The bar is docked now; if it starts reading the indicator offset again it
    // has gone back to positioning itself against the timeline body.
    expect(read('TimelinePlaybackBar.tsx')).not.toContain('indicatorOffsetPx')
  })
})
