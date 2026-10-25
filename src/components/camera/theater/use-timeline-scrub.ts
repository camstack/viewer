/**
 * use-timeline-scrub — the vertical timeline's scroll ⇄ playback plumbing.
 *
 * Extracted verbatim from `TheaterTimeline`, which had grown past the file cap
 * and could not take the docked-layout work on top. Nothing here changed in the
 * move: the same refs, the same throttles, the same gesture-end paths.
 *
 * What it owns:
 *
 *  - the scroll offset → epoch mapping, against the shared live-edge reference
 *    `topMs` (offset 0 = now), and the TIME-based live-edge decision;
 *  - the pure scrub-gesture reducer's impure half — begin-once / move / ONE
 *    commit. Touch gestures keep previewing through native momentum and commit
 *    once the list settles; a slow drag commits after a short no-momentum grace.
 *    On a web wheel there is no release event at all, so an idle-settle timer is
 *    the only "gesture end", suppressed while the pointer is down or momentum runs;
 *  - the programmatic-scroll flag that tells OUR auto-follow scrolls apart from
 *    a real user scrub — without it the passive position poller and the
 *    auto-follow feed each other;
 *  - progressive back-scroll: extend the past window as the oldest end nears.
 *    The decision is NOT here — it is the pure latch in `lookback-walk.ts`,
 *    because it is the piece that got the midnight walk wrong and the piece that
 *    could not be tested from inside a hook.
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { Platform, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'

import { mappedEpochToOffset, mappedOffsetToEpoch, msPerPixel, type TimelineEpochMap } from './timeline-geometry.js'
import { atLiveEdge, scrollIsHand } from './live-edge.js'
import { timelineMaxScrollOffsetPx } from './timeline-content-height.js'
import {
  reduceScrubGesture,
  idleScrubGesture,
  type ScrubGestureState,
  type ScrubGestureInput,
  type ScrubFrameHint,
} from './scroll-scrub-gesture.js'
import { beginDrag, mapDragSample, type DragMapState } from '../../../utils/drag-mapping.js'
import {
  armLookbackWalk,
  idleLookbackWalk,
  observeLookbackDays,
  decideLookbackExtension,
  markLookbackRequested,
  nearOldestEnd,
  type LookbackWalkState,
} from './lookback-walk.js'
import type { TimelineScrollHandle } from './TimelineScroller.js'
import type { ScrubSource } from '../../../recording/playback-machine.js'
import { log } from '../../../lib/logger.js'
import { TIMELINE_SCRUB_EMIT_MS, shouldEmitScrubSample } from '../../../lib/scrub-throttle.js'

/**
 * How close (in TIME) the scrubbed position must be to the live edge before the
 * timeline counts as "live" (flips the pill, and on a hand drag ATTACHES the
 * live stream). TIME-based, not px: a fixed pixel slack meant wildly different
 * spans across zooms (≈42 min at the coarsest 30-min zoom!), so the live stream
 * latched far too eagerly. Anchored to `topMs`, the live edge is at offset 0, so
 * this is simply "scrubbed to within N seconds of now".
 */
export const LIVE_EDGE_TOLERANCE_MS = 15_000


/** Web-wheel settle: a wheel/trackpad scroll has no discrete "release" event, so
 *  the ONLY signal that the gesture ended is the scroll going idle this long. */
const SCRUB_IDLE_COMMIT_MS = 300

/** RN emits momentum-begin just after drag-end. This grace distinguishes a
 *  stationary release from a fling without pinning or cancelling inertia. */
const DRAG_END_GRACE_MS = 80

/** How close (px) a settling programmatic scroll must land to its target before
 *  we clear the programmatic flag. */
const PROGRAMMATIC_SETTLE_PX = 2

/** How long after OUR scroll settled a scroll report at the same offset is
 *  still read as that scroll's echo rather than a hand. react-native-web
 *  repeats the last offset 100 ms after the DOM scroll (`ScrollViewBase`
 *  `handleScrollEnd`); the slack covers a busy main thread. */
const PROGRAMMATIC_ECHO_MS = 400

/** Hard fallback: force-clear the programmatic flag this long after an
 *  auto-follow scroll, so a clamped/never-quite-reached target can never strand
 *  the flag on (which would swallow the user's next scrub). */
const PROGRAMMATIC_MAX_MS = 500

/** Min ms between "the back-scroll did not extend" logs (avoids per-scroll spam). */
const NO_EXTEND_LOG_THROTTLE_MS = 5_000

export interface TimelineScrubOptions {
  readonly deviceId: number
  /** The live-edge anchor: scroll offset 0 maps to this epoch. */
  readonly topMs: number
  readonly zoomIndex: number
  /** Machine mode is live — read synchronously inside the throttled handler. */
  readonly isLive: boolean
  /**
   * An export selection is armed — read the same way, and for the same kind of
   * reason: scrubbing the free end FORWARD walks into the live-edge band, and
   * snapping live there would clear the anchor mid-gesture. See
   * `ScrubGestureInput['liveEdge'].armedSelection`.
   */
  readonly selectionArmed: boolean
  /** Now-line offset from the top of the body (= the scroll content's top spacer). */
  readonly indicatorPx: number
  readonly viewportHeight: number
  /** Oldest epoch the vertical list currently reaches. */
  readonly timelineFromMs: number
  readonly lookbackDays: number
  readonly maxLookbackDays: number
  readonly onScrubBegin: (source: ScrubSource) => void
  readonly onScrubMove: (epochMs: number, source: ScrubSource, hint?: ScrubFrameHint) => void
  readonly onScrubCommit: (epochMs: number, source: ScrubSource) => void
  readonly onGoLive: () => void
  /** Every scroll frame's offset — drives the cluster/activity windowing. */
  readonly onScrollOffset: (offsetY: number) => void
  /** Near the oldest end: load one more day. */
  readonly onExtendLookback: () => void
  /** Clips-mode compressed axis. Null/undefined → linear hour scale. */
  readonly epochMap?: TimelineEpochMap | null
}

export interface TimelineScrub {
  readonly scrollerRef: RefObject<TimelineScrollHandle | null>
  /** Drive the scroller ourselves; the resulting onScroll is not read as a scrub. */
  readonly scrollListTo: (offset: number, animated: boolean) => void
  readonly onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
  readonly onScrollBeginDrag: () => void
  readonly onScrollEndDrag: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
  readonly onMomentumScrollBegin: () => void
  readonly onMomentumScrollEnd: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
}

export function useTimelineScrub(options: TimelineScrubOptions): TimelineScrub {
  const {
    deviceId,
    topMs,
    zoomIndex,
    isLive,
    selectionArmed,
    indicatorPx,
    viewportHeight,
    timelineFromMs,
    lookbackDays,
    maxLookbackDays,
    onScrubBegin,
    onScrubMove,
    onScrubCommit,
    onGoLive,
    onScrollOffset,
    onExtendLookback,
    epochMap = null,
  } = options

  const scrollerRef = useRef<TimelineScrollHandle>(null)
  const lastScrollEvalRef = useRef(0)
  const scrubGestureRef = useRef<ScrubGestureState>(idleScrubGesture)
  // ── Velocity-adaptive px→time mapping (the jog dial, `drag-mapping.ts`) ────
  // At the default zoom one px is ~8.8 s of media while the feeder's sweep
  // window is 4 s: a careful drag mapped absolutely NEVER sweeps (48 h hub
  // census: 282 jumps vs 3 sweeps, mapUnknown on every tick). The mapping
  // integrates every scroll sample; a slow careful drag detaches into a fine
  // 1 px = 1 s scale whose deltas the server can sweep, and the commit lands
  // on the CURSOR (the strip realigns to it on release).
  const dragMapRef = useRef<DragMapState | null>(null)
  const lastRawSampleRef = useRef<{ epoch: number; at: number } | null>(null)
  const endedFineRef = useRef(false)
  const dragCensusRef = useRef({
    fine: 0,
    coarse: 0,
    flips: 0,
    velMax: 0,
    vels: [] as number[],
    anchorMs: 0,
  })
  const pointerDownRef = useRef(false)
  const momentumRef = useRef(false)
  const idleCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const releaseCommittedRef = useRef(false)
  const lastNoExtendLogRef = useRef(0)

  // Mirrors read by the throttled handler, whose closure must stay stable.
  // Written in an effect, never during render: the handler reads them from a
  // committed tree, and the go-live command they gate is idempotent, so a
  // one-commit lag is harmless where a render-phase ref write is not.
  const isLiveRef = useRef(isLive)
  const selectionArmedRef = useRef(selectionArmed)
  const indicatorPxRef = useRef(indicatorPx)
  const viewportHeightRef = useRef(viewportHeight)
  const timelineFromMsRef = useRef(timelineFromMs)
  const epochMapRef = useRef<TimelineEpochMap | null>(epochMap)
  /** The progressive back-scroll latch — see `lookback-walk.ts` for why it is a
   *  model and not a number. */
  const lookbackWalkRef = useRef<LookbackWalkState>(idleLookbackWalk)
  useEffect(() => {
    isLiveRef.current = isLive
    selectionArmedRef.current = selectionArmed
    indicatorPxRef.current = indicatorPx
    viewportHeightRef.current = viewportHeight
    timelineFromMsRef.current = timelineFromMs
    epochMapRef.current = epochMap
    lookbackWalkRef.current = observeLookbackDays(lookbackWalkRef.current, lookbackDays)
  }, [isLive, selectionArmed, indicatorPx, viewportHeight, timelineFromMs, lookbackDays, epochMap])

  const programmaticRef = useRef(false)
  const programmaticTargetRef = useRef(0)
  /**
   * Where OUR last scroll came to rest, and when. On react-native-web one
   * programmatic scroll reaches `onScroll` TWICE: the DOM `scroll` event, which
   * settles and clears the flag below, and a trailing "scroll end" 100 ms later
   * carrying the same offset. With the flag already down, that echo was read
   * as a wheel frame and the wheel settle committed it — the follower seeked
   * the player to where it already was once a second, every seek restarting
   * the recorded feeder at its GOP (camera 103 in the hosted PWA, 2026-10-07:
   * frames in bursts with ~1.5 s gaps). Native platforms send no such echo.
   */
  const settledProgrammaticRef = useRef<{ readonly offset: number; readonly at: number } | null>(null)
  const programmaticClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearProgrammatic = useCallback((): void => {
    programmaticRef.current = false
    if (programmaticClearTimerRef.current) {
      clearTimeout(programmaticClearTimerRef.current)
      programmaticClearTimerRef.current = null
    }
  }, [])

  const scrollListTo = useCallback((offset: number, animated: boolean): void => {
    settledProgrammaticRef.current = null
    programmaticRef.current = true
    programmaticTargetRef.current = offset
    if (programmaticClearTimerRef.current) clearTimeout(programmaticClearTimerRef.current)
    programmaticClearTimerRef.current = setTimeout(() => {
      programmaticRef.current = false
      programmaticClearTimerRef.current = null
    }, PROGRAMMATIC_MAX_MS)
    scrollerRef.current?.scrollToOffset({ offset, animated })
  }, [])

  const clearIdleCommit = useCallback((): void => {
    if (idleCommitTimerRef.current) {
      clearTimeout(idleCommitTimerRef.current)
      idleCommitTimerRef.current = null
    }
  }, [])
  const clearDragEndCommit = useCallback((): void => {
    if (dragEndTimerRef.current) {
      clearTimeout(dragEndTimerRef.current)
      dragEndTimerRef.current = null
    }
  }, [])

  const resetDragMapping = useCallback((): void => {
    dragMapRef.current = null
    lastRawSampleRef.current = null
    endedFineRef.current = false
  }, [])

  /**
   * Fold one raw scroll sample (absolute offset→epoch) into the jog-dial
   * mapping. Every sample feeds it — including throttled-out ones — so the
   * cursor integrates the whole gesture; only the EMISSION is throttled.
   * Returns the epoch to emit (the cursor) and the mapping hint for the hub.
   */
  const mapRawSample = useCallback(
    (rawEpoch: number, at: number): { epoch: number; hint?: ScrubFrameHint } => {
      const msPerPx = msPerPixel(zoomIndex)
      const prevRaw = lastRawSampleRef.current
      lastRawSampleRef.current = { epoch: rawEpoch, at }
      const state = dragMapRef.current
      if (state === null || prevRaw === null || msPerPx <= 0) {
        dragMapRef.current = beginDrag(rawEpoch)
        endedFineRef.current = false
        dragCensusRef.current = {
          fine: 0,
          coarse: 0,
          flips: 0,
          velMax: 0,
          vels: [],
          anchorMs: rawEpoch,
        }
        return { epoch: rawEpoch }
      }
      const dtMs = Math.max(at - prevRaw.at, 1)
      // px-equivalent of the media-time delta at the NOMINAL zoom scale: on the
      // clips-compressed axis this is an approximation, which only ever biases
      // the velocity thresholds, never the coarse target (coarse Δ = raw Δ by
      // construction).
      const dxPx = (rawEpoch - prevRaw.epoch) / msPerPx
      const prevMode = state.mode
      const next = mapDragSample(state, { dxPx, dtMs }, { coarseMsPerPx: msPerPx })
      const velocityPxPerS = (Math.abs(dxPx) / dtMs) * 1000
      const census = dragCensusRef.current
      if (next.mode === 'fine') census.fine += 1
      else census.coarse += 1
      if (next.mode !== prevMode) census.flips += 1
      census.velMax = Math.max(census.velMax, velocityPxPerS)
      if (census.vels.length < 512) census.vels.push(velocityPxPerS)
      endedFineRef.current = next.mode === 'fine'
      // Clamp AFTER the mapping (fine deltas are what get clamped), inside the
      // window the timeline can express.
      const epoch = Math.round(Math.min(Math.max(next.cursorMs, timelineFromMsRef.current), topMs))
      dragMapRef.current = epoch === next.cursorMs ? next : { cursorMs: epoch, mode: next.mode }
      return { epoch, hint: { mode: next.mode, velocityPxPerS: Math.round(velocityPxPerS) } }
    },
    [zoomIndex, topMs],
  )

  const applyScrubCommands = useCallback(
    (commands: ReturnType<typeof reduceScrubGesture>['commands']): void => {
      for (const cmd of commands) {
        switch (cmd.kind) {
          case 'begin':
            onScrubBegin('timeline')
            break
          case 'move':
            onScrubMove(cmd.epoch, 'timeline', cmd.hint)
            break
          case 'commit':
            // The SINGLE commit per gesture — fires only at the true release,
            // so an INFO line here is one per drag, not per frame.
            //
            // It was `debug`, which does not reach the log pipeline, so an
            // operator reporting "the seek is off by a bit" left no trace to
            // measure: the whole point of the number is comparing what the
            // timeline ASKED for against where the player LANDED. Reported
            // 2026-08-01 after the chrome restructure, and unanswerable until
            // this line existed. The geometry inputs ride along because a drift
            // between the indicator and the stream is a px→time mapping fault,
            // and these are its terms.
            {
              const census = dragCensusRef.current
              const vels = [...census.vels].sort((a, b) => a - b)
              log.info('theater:scrub', 'seek committed', {
                epoch: cmd.epoch,
                at: new Date(cmd.epoch).toISOString(),
                indicatorPx,
                viewportHeight,
                zoomIndex,
                topMs,
                // The drag's mapping census — the client half of the hub's
                // per-drag aggregate (`mapFine`/`mapCoarse` must agree).
                fineSamples: census.fine,
                coarseSamples: census.coarse,
                modeFlips: census.flips,
                velPxPerSMax: Math.round(census.velMax),
                velPxPerSP50: vels.length > 0 ? Math.round(vels[vels.length >> 1] ?? 0) : null,
                spanMs: census.anchorMs > 0 ? Math.round(cmd.epoch - census.anchorMs) : null,
              })
              onScrubCommit(cmd.epoch, 'timeline')
              // Jog-dial semantics: in fine mode the cursor detached from the
              // finger. Realign the strip to the COMMITTED cursor so the ruler
              // agrees with the frame that lands.
              if (endedFineRef.current) {
                scrollListTo(
                  mappedEpochToOffset(cmd.epoch, topMs, zoomIndex, epochMapRef.current),
                  false,
                )
              }
              resetDragMapping()
            }
            break
          case 'goLive':
            resetDragMapping()
            // Idempotent: the machine ignores GO_LIVE echoes once already live.
            if (!isLiveRef.current) {
              log.debug('theater:live-edge', 'go-live (scrolled into live edge)', {})
              onGoLive()
            }
            break
        }
      }
    },
    [onScrubBegin, onScrubMove, onScrubCommit, onGoLive, indicatorPx, viewportHeight, zoomIndex, topMs, scrollListTo, resetDragMapping],
  )

  const feedScrub = useCallback(
    (input: ScrubGestureInput): void => {
      const { state, commands } = reduceScrubGesture(scrubGestureRef.current, input)
      scrubGestureRef.current = state
      applyScrubCommands(commands)
    },
    [applyScrubCommands],
  )

  const armIdleCommit = useCallback((): void => {
    clearIdleCommit()
    idleCommitTimerRef.current = setTimeout(() => {
      idleCommitTimerRef.current = null
      if (!pointerDownRef.current && !momentumRef.current) feedScrub({ kind: 'end' })
    }, SCRUB_IDLE_COMMIT_MS)
  }, [clearIdleCommit, feedScrub])

  const handleGestureEnd = useCallback(
    (offsetY: number): void => {
      clearIdleCommit()
      if (!scrubGestureRef.current.active || programmaticRef.current) return
      const rawEpoch = Math.round(mappedOffsetToEpoch(offsetY, topMs, zoomIndex, epochMapRef.current))
      if (atLiveEdge(topMs - rawEpoch, LIVE_EDGE_TOLERANCE_MS)) {
        resetDragMapping()
        feedScrub({ kind: 'liveEdge', armedSelection: selectionArmedRef.current })
        return
      }
      // Land the commit on the MAPPED cursor (jog-dial: the cursor, not the
      // finger's absolute position, is what the operator was steering).
      const mapped = mapRawSample(rawEpoch, Date.now())
      feedScrub({ kind: 'frame', epoch: mapped.epoch, hint: mapped.hint })
      feedScrub({ kind: 'end' })
    },
    [topMs, zoomIndex, feedScrub, clearIdleCommit, mapRawSample, resetDragMapping],
  )

  const onScrollBeginDrag = useCallback((): void => {
    // A TOUCH is the only thing that buys another day of history (D574). Until
    // 2026-09-21 the arming was "`lookbackDays` moved", which our own extension
    // does — so the clamp frames a self-emptying clips list produces walked the
    // window to the 30-day cap with the finger already off the glass.
    lookbackWalkRef.current = armLookbackWalk(lookbackWalkRef.current)
    // A finger is down: whatever scrolls next is the hand, never our echo.
    settledProgrammaticRef.current = null
    pointerDownRef.current = true
    momentumRef.current = false
    releaseCommittedRef.current = false
    clearIdleCommit()
    clearDragEndCommit()
  }, [clearIdleCommit, clearDragEndCommit])

  /**
   * A release may be either a stationary end or the start of native momentum.
   * Wait briefly for RN's momentum-begin event. If it arrives, scroll frames
   * keep driving preview and momentum-end owns the single commit. Otherwise
   * commit the release offset without issuing a programmatic scroll.
   */
  const onScrollEndDrag = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
      pointerDownRef.current = false
      clearIdleCommit()
      const offsetY = e.nativeEvent.contentOffset.y
      clearDragEndCommit()
      dragEndTimerRef.current = setTimeout(() => {
        dragEndTimerRef.current = null
        if (!momentumRef.current) {
          releaseCommittedRef.current = true
          handleGestureEnd(offsetY)
        }
      }, DRAG_END_GRACE_MS)
    },
    [clearIdleCommit, clearDragEndCommit, handleGestureEnd],
  )

  const onMomentumScrollBegin = useCallback((): void => {
    momentumRef.current = true
    clearDragEndCommit()
  }, [clearDragEndCommit])

  /**
   * Momentum settled. After a hand release this is a NO-OP by construction —
   * the gesture was committed and closed at the release, and the reducer
   * ignores an `end` with no active scrub. It stays wired for the paths that
   * never produce a release event at all (a programmatic fling, a platform that
   * omits `onScrollEndDrag`): losing the commit there would look like "sometimes
   * it does not seek".
   */
  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
      momentumRef.current = false
      clearDragEndCommit()
      if (releaseCommittedRef.current) {
        releaseCommittedRef.current = false
        return
      }
      handleGestureEnd(e.nativeEvent.contentOffset.y)
    },
    [clearDragEndCommit, handleGestureEnd],
  )

  // Cancel any pending gesture-end timer on unmount.
  useEffect(
    () => () => {
      clearIdleCommit()
      clearDragEndCommit()
    },
    [clearIdleCommit, clearDragEndCommit],
  )

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
      const offsetY = e.nativeEvent.contentOffset.y

      // Track scroll offset for the cluster/activity overlay.
      onScrollOffset(offsetY)

      // Progressive back-scroll: extend the past window as we approach the oldest
      // end. Purely additive — runs for programmatic scrolls too (harmless).
      const indicatorPxLatest = indicatorPxRef.current
      const viewportHeightLatest = viewportHeightRef.current
      const bottomSpanPx = mappedEpochToOffset(timelineFromMsRef.current, topMs, zoomIndex, epochMapRef.current)
      // ONE authority on this number: `timeline-content-height.ts`, the same
      // module the scroller lays the content out with. What stood here was the
      // PRE-fix formula (`indicatorPx + max(viewport, span) − viewport`), which
      // was 630 px short of the real maximum at a tenth — and would now VARY
      // with the cursor, for no reason, since the cursor is two states. The
      // direction was harmless (it asks for a day earlier than it needs to),
      // which is exactly why it survived a day past the fix.
      //
      // The footer's reservation is not threaded here and does not need to be:
      // the trailing room is `max(viewport − indicator, footer)` and the footer
      // band (~72 px) is smaller than that at BOTH cursor positions on every
      // body, so passing 0 gives the same answer — and where it would not, it
      // errs short, in the same harmless direction. `dayHeight` is `max(
      // viewport, span)`, as the scroller computes it.
      const maxScroll = timelineMaxScrollOffsetPx({
        indicatorOffsetPx: indicatorPxLatest,
        dayHeightPx: Math.max(viewportHeightLatest, bottomSpanPx),
        contentBottomInsetPx: 0,
        viewportHeightPx: viewportHeightLatest,
      })
      // The threshold is NOT one viewport on every axis — see `nearOldestEnd`.
      if (
        nearOldestEnd({
          offsetY,
          maxScrollPx: maxScroll,
          viewportHeightPx: viewportHeightLatest,
          compressed: epochMapRef.current !== null,
        })
      ) {
        // The three outcomes are kept apart deliberately — see `lookback-walk.ts`.
        // To the operator all three look identical (the timeline stops moving),
        // and they have nothing in common: one is a request going out, one is a
        // request already in flight, one is a hard 30-day ceiling. A stall that
        // logs nothing reads as "the history ends here", which is how this
        // surface hid a walk that had simply stopped asking.
        const walk = lookbackWalkRef.current
        const outcome = decideLookbackExtension(walk, maxLookbackDays)
        if (outcome === 'extend') {
          lookbackWalkRef.current = markLookbackRequested(walk)
          log.info('theater', 'back-scroll extending lookback', {
            deviceId,
            fromDays: walk.observedDays,
            oldest: new Date(timelineFromMsRef.current).toISOString(),
          })
          onExtendLookback()
        } else {
          const now = Date.now()
          if (now - lastNoExtendLogRef.current >= NO_EXTEND_LOG_THROTTLE_MS) {
            lastNoExtendLogRef.current = now
            log.info('theater', 'back-scroll did NOT extend', {
              deviceId,
              // 'capped' = a LIMIT (there IS older history, we refuse to load
              // it). 'spent' = this gesture already bought its day, or nothing
              // touched the surface at all. Never "the camera has no older
              // footage": this walk is arithmetic on midnights and never asks
              // whether a day holds anything.
              outcome,
              days: walk.observedDays,
              maxLookbackDays,
            })
          }
        }
      }

      // WE caused this scroll (auto-follow / go-live / cluster centre) → it is not
      // a user scrub. Clear the flag once the settling frame reaches ~the target.
      if (programmaticRef.current) {
        if (Math.abs(offsetY - programmaticTargetRef.current) <= PROGRAMMATIC_SETTLE_PX) {
          clearProgrammatic()
          settledProgrammaticRef.current = { offset: offsetY, at: Date.now() }
        }
        return
      }

      // The ECHO of our settled scroll (react-native-web's trailing scroll-end,
      // see `settledProgrammaticRef`): same offset, moments later, no finger.
      // Any report that MOVED, or one past the window, ends it and is a hand.
      const settled = settledProgrammaticRef.current
      if (settled !== null) {
        if (
          Math.abs(offsetY - settled.offset) <= PROGRAMMATIC_SETTLE_PX &&
          Date.now() - settled.at <= PROGRAMMATIC_ECHO_MS
        ) {
          return
        }
        settledProgrammaticRef.current = null
      }

      // Defensive edge: a platform announced momentum only after the release
      // grace had already committed. Let the native strip settle, but never
      // reactivate the scrub reducer and emit a second seek.
      if (momentumRef.current && releaseCommittedRef.current) return

      // Map this scroll offset to its epoch ONCE, against the shared live-edge
      // reference `topMs` (offset 0 = topMs = now). The live-vs-scrub decision is
      // on the TIME delta behind the live edge, not a pixel slack, so it behaves
      // identically at every zoom.
      const rawEpoch = Math.round(mappedOffsetToEpoch(offsetY, topMs, zoomIndex, epochMapRef.current))
      const behindLiveMs = topMs - rawEpoch

      // Scrolled INTO the live edge by hand → GO_LIVE (attach the live stream),
      // not a recorded seek to ~now. Drops any in-progress scrub WITHOUT
      // committing it. Idempotent: the machine ignores GO_LIVE echoes once live.
      // The decision is on the RAW finger position — a fine-mode cursor lagging
      // behind must not keep a finger AT the live edge from going live.
      if (atLiveEdge(behindLiveMs, LIVE_EDGE_TOLERANCE_MS)) {
        // No hand on the list: a layout-induced report inside the band (after a
        // tap seeked to a recent event) is not "scrolled home".
        if (
          !isLiveRef.current &&
          !scrollIsHand({
            pointerDown: pointerDownRef.current,
            momentum: momentumRef.current,
            scrubActive: scrubGestureRef.current.active,
            web: Platform.OS === 'web',
          })
        ) {
          return
        }
        clearIdleCommit()
        resetDragMapping()
        feedScrub({ kind: 'liveEdge', armedSelection: selectionArmedRef.current })
        return
      }

      // Scrubbing (recorded navigation). The reducer begins the drag on the first
      // frame and previews every move; it NEVER commits here — the single commit
      // fires at the true gesture end (release / momentum settle / wheel idle).
      // The mapping consumes EVERY sample (the cursor integrates the whole
      // gesture); only the EMISSION is throttled.
      const now = Date.now()
      const mapped = mapRawSample(rawEpoch, now)
      const active = scrubGestureRef.current.active
      if (active && !shouldEmitScrubSample(lastScrollEvalRef.current, now, TIMELINE_SCRUB_EMIT_MS)) {
        // Still (re)arm the wheel settle so a throttled-out final frame commits.
        armIdleCommit()
        return
      }
      lastScrollEvalRef.current = now
      feedScrub({ kind: 'frame', epoch: mapped.epoch, hint: mapped.hint })
      armIdleCommit()
    },
    [
      topMs,
      zoomIndex,
      deviceId,
      maxLookbackDays,
      onScrollOffset,
      onExtendLookback,
      clearProgrammatic,
      feedScrub,
      armIdleCommit,
      clearIdleCommit,
      mapRawSample,
      resetDragMapping,
    ],
  )

  return {
    scrollerRef,
    scrollListTo,
    onScroll,
    onScrollBeginDrag,
    onScrollEndDrag,
    onMomentumScrollBegin,
    onMomentumScrollEnd,
  }
}
