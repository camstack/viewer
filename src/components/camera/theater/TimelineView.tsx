/**
 * TimelineView — the timeline itself, WITH its docked bands.
 *
 *   playback bar · fault notice · heatmap + vertical scroller + now-line,
 *   with the tools floating over the body (`TimelineFloatingTools`)
 *
 * ## Why the bands live here and not beside the panels
 *
 * Both bands are the TIMELINE's chrome: they act on the timeline, and they mean
 * nothing while a panel owns the body. The obvious way to express that is a
 * `panelOpen` flag threaded to two sibling bars — and this codebase has already
 * paid for that shape once, in a layout flag that was only honoured by the
 * components somebody remembered to thread it to.
 *
 * So the bands are not siblings of the panel; they are INSIDE the thing they
 * belong to. `TheaterTimeline` keeps this mounted ALWAYS and stacks a panel
 * OVER it (opaque host, frozen underneath — see `FreezeWhileCovered`), so the
 * scroll offset and zoom survive any panel. A band still cannot leak into
 * panel state: it is covered together with the timeline it describes —
 * forgetting is not possible rather than merely unlikely.
 *
 * Everything here is laid out by the column: two bands with their own height and
 * a body that takes the rest. Nothing measures a neighbour, which is the whole
 * point — the two defects this replaces (a clipped action row, a transport pill
 * painted over the activity strip) were both a control guessing at a space it
 * did not own.
 */
import React, { type Ref } from 'react'
import { View, StyleSheet } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'
import type { LayoutChangeEvent } from 'react-native'

import { SPACING } from '../../../theme/tokens.js'
import { HeatmapBar, type HeatmapBarProps } from './HeatmapBar.js'
import { TimelineScroller, type TimelineScrollerProps, type TimelineScrollHandle } from './TimelineScroller.js'
import { TimelinePlaybackBar, type TimelinePlaybackBarProps } from './TimelinePlaybackBar.js'
import { TimelineFloatingTools, type TimelineFloatingToolsProps } from './TimelineFloatingTools.js'
import { TimelineFaultNotice } from './TimelineFaultNotice.js'
import { TimelineClipIncompleteNotice } from './TimelineClipIncompleteNotice.js'
import { TimelineHistoryNotice } from './TimelineHistoryNotice.js'
import { TimelineScopeNotice } from './TimelineScopeNotice.js'
import type { ScopeNoticeInput } from './timeline-scope-notice.js'
import { ClipsStatusNote } from '../clips/ClipsStatusNote.js'
import type { ClipsStatusKind } from '../../../clips/clips-status.js'
import type { ClipIncompleteNotice } from '../../../clips/clip-incomplete-notice.js'
import type { FaultSource, TimelineFault } from './timeline-faults.js'
import {
  TimelineCursorLaneDots,
  TimelineCursorLine,
} from './TimelineCursorLayers.js'
import { TimelineLaneHeader } from './TimelineLaneHeader.js'
import { LANES_RESERVE_PX, TICK_LABEL_WIDTH, type LaneKey } from './timeline-lanes-layout.js'
import type { TimelineCursor } from './timeline-cursor.js'

const NO_HITS: readonly LaneKey[] = []

export interface TimelineIndicatorBinding {
  /** Px from the top of the body where the current epoch rests. */
  readonly offsetPx: number
  /**
   * The cursor's TRANSITION (`timeline-cursor-shift.ts`): a purely visual
   * offset applied to the line and the pill as a TRANSFORM, so they travel
   * with the content instead of teleporting to the new position ahead of it.
   * Both layers take the SAME value the scroller's content wrapper does —
   * they are one composition, and a line that arrives before the content it
   * marks would spend 220 ms pointing at the wrong moment.
   */
  readonly shiftPx?: SharedValue<number>
  /** Suppressed until the body has been measured. */
  readonly measured: boolean
  /**
   * WHAT the cursor is reading — `timeline-cursor.ts`'s single verdict.
   *
   * Two arms, both on the EPOCH axis. A FILE on the frame is neither, and it
   * does not get a third: the cursor is WITHDRAWN there ({@link playhead}),
   * because a mark over a list that commands nothing reads as a control.
   */
  readonly cursor: TimelineCursor
  /** Lanes with an active segment at the cursor's time — the only ones that get a crossing dot. */
  readonly laneHits?: readonly LaneKey[]
}

/**
 * Everything that failed to load, and the two ways out of each.
 *
 * Threaded down rather than read here so this component stays free of data
 * concerns — and so the RULE that decides it (`resolveTimelineFaults`) is a
 * pure function with its own tests rather than a condition buried in JSX.
 *
 * ONE binding for stream, recordings and events on purpose: three bindings is
 * how the screen ended up with three unrelated ways of saying the same thing.
 */
export interface TimelineFaultsBinding {
  readonly faults: readonly TimelineFault[]
  readonly onRetry: (source: FaultSource) => void
  readonly onDismiss: (source: FaultSource) => void
}

/**
 * The "there is more (older) history" fact — see `TimelineHistoryNotice` for
 * why it is not folded into {@link TimelineFaultsBinding}: it is not a
 * failure, it is `useDeviceTracks`'s row-bound REPLACING a silent ceiling
 * with something the operator can act on.
 */
export interface TimelineHistoryBinding {
  readonly visible: boolean
  readonly loading: boolean
  readonly onLoadMore: () => void
}

export interface TimelineViewProps {
  readonly playback: TimelinePlaybackBarProps
  readonly heatmap: HeatmapBarProps
  readonly scroller: TimelineScrollerProps
  readonly scrollerRef: Ref<TimelineScrollHandle>
  readonly indicator: TimelineIndicatorBinding
  /** The floating tools — drawn in an overlay layer above the scroller. */
  readonly tools: Omit<TimelineFloatingToolsProps, 'leftReserve' | 'rightReserve'>
  /** See {@link TimelineFaultsBinding} — an unread day, an unread coverage
   *  window and a dead stream must not pass for an empty, quiet camera. */
  readonly faults: TimelineFaultsBinding
  /** See {@link TimelineHistoryBinding}. */
  readonly history: TimelineHistoryBinding
  /**
   * The camera cut the held clip's replay short (D623) — already resolved
   * against the clip on the stage by `resolveClipIncompleteNotice`, `null`
   * whenever there is nothing to say.
   *
   * A fourth row rather than a member of {@link TimelineFaultsBinding} for the
   * reason `history` and `scope` are: nothing here can be retried. The stream
   * did not fail — it ended early, with footage on screen — and every row of
   * the fault band carries a retry chip that must not be pressed on a camera
   * whose single replay lane is already struggling.
   */
  readonly clipIncomplete?: ClipIncompleteNotice
  /**
   * The cameras this timeline could NOT read — see `TimelineScopeNotice`.
   *
   * A third row rather than a member of {@link TimelineFaultsBinding} for the
   * same reason `history` is: nothing failed. The reads succeeded and answered
   * for fewer cameras than the view holds, which is an ordinary state of a
   * multi-camera timeline and has no retry.
   */
  readonly scope: ScopeNoticeInput
  /**
   * What the clip surface has to say in place of cards — `'hidden'` whenever
   * there are cards, or whenever clips mode is off.
   *
   * Resolved by `resolveClipsStatus`, never derived here: a blank body used to
   * mean six different things (an unread day, an absent cap, a deadline, a
   * dropped socket, a non-admin session, and a quiet camera), and the point of
   * threading a resolved state down is that this component cannot re-decide it.
   */
  readonly clipsStatus?: ClipsStatusKind
  /** Interpolation values for that message. Threaded rather than built here:
   *  two of the sentences name the SOURCE and its own words, and this
   *  component has neither. Rendered through `t(key)` with nothing supplied,
   *  they put the literal `{{source}}` on the operator's screen. */
  readonly clipsStatusValues?: Readonly<Record<string, string | number>>
  /**
   * The day strip — {@link heatmap}'s bar — is drawn (`clips-surface.ts`,
   * `heatmap`). Named for the thing rather than the binding because the
   * binding already owns the name `heatmap`.
   *
   * False for ONE surface: a clip holding the frame over an epoch body, where
   * a press would seek the session behind the picture. Not drawn EMPTY — a
   * blank strip still takes a drag, and there is no target for it there.
   *
   * On a list of FILES it IS drawn, and its press opens the clip covering that
   * instant instead of seeking our recorder; the caller wires the verb. This
   * prop used to be `timeAxis` and used to gate the transport band and the
   * position line too — three questions, one boolean, and the clips list lost
   * every control over a picture that was still playing (D606).
   *
   * Defaults to true, so every existing caller is exactly what it was.
   */
  readonly dayStrip?: boolean
  /**
   * The transport band is drawn.
   *
   * It addresses the frame's OCCUPANT, never the body: a held clip and a list
   * of files both still need play/pause, rate, prev/next and — above all —
   * go-live, which is the only way out of a clip (D570). `resolveClipsSurface`
   * answers true on every surface; the prop stays so a caller that wants the
   * band gone has to say so.
   */
  readonly transport?: boolean
  /**
   * The position indicator is drawn — the claim that follows the BODY's axis.
   *
   * False on both surfaces whose body is a list of FILES, held clip included
   * (`clips-surface.ts`): there is no epoch under the cards, and a cursor over
   * a body that refuses the finger is a control that is not one (D62, and the
   * operator's verdict of 2026-09-23). Where the file is, is the running row's
   * own strip and the transport band's progress bar.
   */
  readonly playhead?: boolean
  /** The body's measured box — feeds the caller's indicator + cluster geometry. */
  readonly onBodyLayout: (e: LayoutChangeEvent) => void
}

export function TimelineView({
  playback,
  heatmap,
  scroller,
  scrollerRef,
  indicator,
  tools,
  faults,
  history,
  clipIncomplete = null,
  scope,
  clipsStatus = 'hidden',
  clipsStatusValues,
  dayStrip = true,
  transport = true,
  playhead = true,
  onBodyLayout,
}: TimelineViewProps): React.JSX.Element {
  // The cursor's transition, shared by both indicator layers and identical to
  // the one the scroller applies to its content wrapper. A consumer that
  // supplies none gets a zero translate.
  // The lanes exist on the time axis only: over a list of files (`hideActivity`)
  // there is nothing for an icon to name and nothing for the cursor to cross.
  const lanesShown = playhead && scroller.hideActivity !== true
  const shiftPx = indicator.shiftPx
  const indicatorShift = useAnimatedStyle(() => ({
    transform: [{ translateY: shiftPx ? shiftPx.get() : 0 }],
  }))
  return (
    <View style={styles.container}>
      {transport ? <TimelinePlaybackBar {...playback} /> : null}

      {/* Directly UNDER the bar, and above everything else: one slot for every
          load that failed — the stream, the recordings, the events. It is the
          bar's second row, not a separate object, and it is the only surface in
          the theater allowed to report a failure. */}
      <TimelineFaultNotice
        faults={faults.faults}
        onRetry={faults.onRetry}
        onDismiss={faults.onDismiss}
      />

      {/* And in the same stack: "the camera cut this clip short". Not a row of
          the band above — that band's grammar includes a retry, and this one
          must not offer one (D623). */}
      <TimelineClipIncompleteNotice notice={clipIncomplete} />

      {/* Directly under the fault band: "history did not load" and "more
          history exists, not loaded yet" are different facts and get
          different rows — see `TimelineHistoryNotice`. */}
      <TimelineHistoryNotice
        visible={history.visible}
        loading={history.loading}
        onLoadMore={history.onLoadMore}
      />

      {/* And under that: "some cameras in this view did not answer". A third
          fact again — not a failure, not a truncation of history, but a UNION
          drawn from fewer cameras than the operator put in the view. */}
      <TimelineScopeNotice
        unknownIds={scope.unknownIds}
        overflowIds={scope.overflowIds}
      />

      {dayStrip ? <HeatmapBar {...heatmap} /> : null}

      {/* Vertical timeline. No touch/wheel gate: the ScrollView's onScroll is the
          sole transport (wheel + drag + touch + momentum on ALL platforms), and
          the programmatic-scroll ref — not a touch — tells a user scrub apart
          from our own auto-follow. */}
      <View style={styles.body} onLayout={onBodyLayout}>
        {/* The current-position LINE, rendered BEFORE the scroller on purpose:
            RN paints later siblings on top, so the line lies UNDER the cluster
            cards — it is a reference mark, and drawn over them it sliced every
            card it crossed (operator, 2026-08-02). The scroller's surface is
            transparent, so across empty timeline space the line still reads.
            Height-0 row centred on the epoch's exact viewport row, the same
            pattern as the scroller's in-content live-edge marker. */}
        {playhead && indicator.measured ? (
          <Animated.View
            style={[styles.indicatorRow, { top: indicator.offsetPx }, indicatorShift]}
            pointerEvents="none"
          >
            <TimelineCursorLine cursor={indicator.cursor} />
          </Animated.View>
        ) : null}

        <TimelineScroller ref={scrollerRef} {...scroller} />

        {/* Over the (empty) scroller, under the indicator: an empty clip day,
            an unread one and a dropped socket must not be the same picture. */}
        <ClipsStatusNote
          status={clipsStatus}
          indicatorOffsetPx={indicator.offsetPx}
          values={clipsStatusValues}
        />

        {/* The time PILL ("LIVE" / HH:MM:SS) stays ABOVE the cards: it is the
            readable current position, and a card sliding under the line must
            not bury it. Separate layer from the line — the operator asked for
            the LINE under the clusters, not for an unreadable playhead.
            pointerEvents="none" → neither layer captures touches / scrubs.
            Gone with the line when there is no time axis: the pill's whole
            content is a position, and there is none over a list of files. */}
        {playhead && indicator.measured ? (
          <Animated.View
            style={[styles.indicatorRow, { top: indicator.offsetPx }, indicatorShift]}
            pointerEvents="none"
          >
            {lanesShown ? (
              <TimelineCursorLaneDots
                showAudio={scroller.showAudioLane}
                showMotion={scroller.showMotionLane}
                hits={indicator.laneHits ?? NO_HITS}
              />
            ) : null}
          </Animated.View>
        ) : null}

        {/* The lanes' icons, over the top of the body: fixed, not scrolling. */}
        {lanesShown ? (
          <TimelineLaneHeader showAudio={scroller.showAudioLane} showMotion={scroller.showMotionLane} />
        ) : null}

        {/* Last, so it is above everything, and OUTSIDE the scroller's content
            so nothing can clip it. The scroller reserves its footprint. */}
        <TimelineFloatingTools
          {...tools}
          leftReserve={SPACING.md + TICK_LABEL_WIDTH + SPACING.sm}
          rightReserve={scroller.hideActivity === true ? SPACING.sm : LANES_RESERVE_PX}
        />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  body: {
    flex: 1,
    position: 'relative',
  },
  // Shared by the two indicator layers (line under the cards, pill above —
  // see the render comments). Height 0 so both the absolute line and the
  // centre-aligned pill sit ON the epoch's row rather than hanging below it;
  // the pill overflows the row exactly like the scroller's live-edge cap.
  indicatorRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.md,
  },
})
