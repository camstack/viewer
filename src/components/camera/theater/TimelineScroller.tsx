/**
 * TimelineScroller — alternative to the FlashList-based vertical timeline, using
 * a single ScrollView with all content (hour ticks, cluster cards, activity bars)
 * absolutely positioned INSIDE the scroll content. Because the cards live in the
 * scrolling content (not a separate overlay), RN resolves gestures naturally:
 * a vertical drag on a card scrolls the timeline, a card's horizontal carousel
 * works, and a tap opens playback.
 *
 * It is a "dumb" surface: the PARENT (TheaterTimeline) owns the scroll behaviour
 * (touch-gated scrub, live-edge → go-live, auto-follow). This component just
 * forwards `onScroll` to the parent's handler and exposes a FlashList-compatible
 * `scrollToOffset` via ref so the parent's auto-follow/go-live can drive it.
 */

import React, {
  memo,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  ScrollView,
  View,
  Text,
  StyleSheet,
} from 'react-native'
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native'
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated'

import { useTranslation } from 'react-i18next'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { epochToOffset, pxPerHour, type TimelineEpochMap } from './timeline-geometry.js'
import { timelineContentHeightPx } from './timeline-content-height.js'
import {
  bandEpochRange,
  bandsEqual,
  itemsInBand,
  mountBand,
  scrollBand,
  spansInBand,
  ticksInBand,
  type MountBand,
} from './timeline-window.js'

import { ClusterCard } from './ClusterCard.js'
import type { ClipRowPlayback } from '../../../clips/clip-row-playback.js'
import { ActivityLanes } from './ActivityLanes.js'
import type { LaneSelection } from './activity-view-types.js'
import {
  CURSOR_LINE_START_PX,
  CURSOR_ORIGIN_DOT_PX,
  LANES_WIDTH_PX,
  LANE_RIGHT_INSET_PX,
  TICK_LABEL_WIDTH,
} from './timeline-lanes-layout.js'
import { classPaintColor } from './event-highlights.js'
import type { ClusterExpansionMap } from './cluster-proximity.js'
import type { ObjectEvent, PositionedCluster } from './event-cluster.js'
import type { ActivityModel } from './activity-view-types.js'
import { resolveClusterBand } from './cluster-band.js'
// Press feedback for the CARD-LEVEL cluster handlers (tap-to-seek, lens) lives
// HERE, not in ClusterCard: this file owns those handlers and is their only
// consumer, so one pulse per press — instrumenting both ends would fire twice
// for the same finger.
import { hapticTap } from '../../../lib/haptics.js'
import { useTimelineScale } from './TimelineScaleProvider.js'
import { formatGapLabel, GAP_ELLIPSIS } from '../../../clips/clip-timeline.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const MS_PER_HOUR = 3_600_000

/** Width of the right-side activity column (px). */
const RIGHT_COL_WIDTH = LANES_WIDTH_PX

/** Right inset of the activity column from the content edge. */
const ACTIVITY_RIGHT_INSET = LANE_RIGHT_INSET_PX

/** Stable empties, so a mode with nothing to draw does not remint an array
 *  every render and re-run the memo that reads it. */
const NO_TICKS: readonly number[] = []
const NO_GAPS: readonly { readonly topPx: number; readonly heightPx: number; readonly durationMs: number }[] = []

// ─── Types ────────────────────────────────────────────────────────────────────

/** FlashList-compatible imperative handle so the parent can drive either engine. */
export interface TimelineScrollHandle {
  scrollToOffset(opts: { offset: number; animated?: boolean }): void
}

/**
 * What the card's corner control is, for ONE card.
 *
 * `onSave: null` is a REFUSAL carrying its reason — drawn and disabled. The
 * absence of a binding altogether is "no control here". Three states, because
 * two would make a refusal look like a build without the feature.
 */
export interface ClipSaveBinding {
  readonly onSave: (() => void) | null
  readonly reason: string | null
  /** This clip's bytes are being fetched right now. */
  readonly saving?: boolean
}

export interface TimelineScrollerProps {
  readonly topMs: number
  readonly zoomIndex: number
  readonly dayWindow: { readonly from: number; readonly to: number }
  readonly clusters: readonly PositionedCluster[]
  readonly activity: ActivityModel
  /** Activity-filter gates for the right-edge lanes (recording always shows). */
  readonly showMotionLane: boolean
  readonly showAudioLane: boolean
  /** The period being selected for an export / delete — tinted over the lanes. */
  readonly laneSelection?: LaneSelection | null
  readonly cardWidth: number
  readonly viewportHeight: number
  /** Height of the TOP SPACER prepended to the scroll content (px). Every
   *  positioned child shifts down by this amount so the current epoch (content-y
   *  = spacer) lands on the indicator line at viewport-y = spacer while ALL
   *  scroll/scrub geometry (offsetToEpoch / epochToOffset) stays unchanged. */
  readonly indicatorOffsetPx: number
  /**
   * The cursor's TRANSITION, as a purely visual offset (`timeline-cursor-shift.ts`).
   *
   * The spacer above jumps to its final value in one commit; this carries the
   * eye there over {@link CURSOR_SHIFT_MS}. It is applied as a TRANSFORM on the
   * one wrapper every positioned child sits in — never as a height and never
   * as a `top` — so `contentSize` is identical before, during and after, no
   * scroll event is emitted and the scrubbed offset is preserved to the pixel.
   */
  readonly cursorShiftPx?: SharedValue<number>
  /**
   * Auto / menu zoom transition (`timeline-zoom-shift.ts`): scaleY from
   * oldPxPerHour/newPxPerHour → 1, origin at the playhead. Applied on the same
   * transform wrapper as {@link cursorShiftPx} so layout never animates.
   */
  readonly zoomScaleY?: SharedValue<number>
  /**
   * Space reserved BELOW the content so a hovering footer cannot bury the last
   * card. A float with no matching inset does not merely overlap: the content
   * under it is unreachable, because there is nothing left to scroll.
   */
  readonly contentBottomInset?: number
  /** Room above the axis so cards can scroll below the top floating tools bar. */
  readonly contentTopInset?: number
  /** Live mode: the fixed readhead already marks the live edge, so the in-content
   *  "now" marker is suppressed to avoid a duplicate bar. It renders only in
   *  playback, where it identifies the live edge while scrubbed into the past. */
  readonly isLive: boolean
  /** Forwarded to the parent's scrub/live-edge handler. */
  readonly onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
  /** Gesture lifecycle (touch): the parent commits the scrub at the TRUE release
   *  (drag end with no momentum, or momentum settle) instead of a mid-drag
   *  stationary debounce. No-ops on web wheel (which has no drag lifecycle). */
  readonly onScrollBeginDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
  readonly onScrollEndDrag?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
  readonly onMomentumScrollBegin?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
  readonly onMomentumScrollEnd?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void
  /** Tap on a cluster card — the visible page AND the card it came from.
   *  The card is not decoration: in clips mode the caller resolves it to the
   *  CLIP the card draws, which is what the advance sequencer keys off. */
  readonly onClusterPress: (event: ObjectEvent, cluster: PositionedCluster) => void
  /** Open the detail modal for a cluster (lens icon). */
  readonly onClusterOpenDetail?: (cluster: PositionedCluster) => void
  /** Cursor proximity per cluster id (0..1, quantised upstream; absent ⟺ 0). */
  readonly expansion?: ClusterExpansionMap
  /** Compressed clips-mode axis. When set, content height and tick placement
   *  follow it instead of the linear hour scale. */
  readonly epochMap?: TimelineEpochMap | null
  /** Collapsed-hole ellipses in clips mode (`topPx` is content-Y without spacer). */
  readonly gapMarkers?: readonly {
    readonly topPx: number
    readonly heightPx: number
    readonly durationMs: number
  }[]
  /**
   * Clips-mode ruler: epoch ms values from `clipAxisTicks`, already confined
   * to real clip intervals (never a gap). Used INSTEAD of the linear hour
   * grid whenever `epochMap` is set — this component only positions them
   * (via `contentY`, which already knows to defer to `epochMap`), it never
   * computes where a tick belongs. See `clip-axis.ts` for why: the axis is
   * compressed and non-uniform per clip, so the geometry cannot be derived
   * here without duplicating what the pure function already verified.
   */
  readonly axisTicks?: readonly number[]
  /** Skip the hour grid — used outside clips mode only; clips mode's ticks
   *  are governed by `axisTicks` instead (see above). */
  readonly hideHourTicks?: boolean
  /** Hide the right-edge activity column (linear bars lie on a compressed axis). */
  readonly hideActivity?: boolean
  /** Cluster actions: the lens (opens the detail directly) and the panel's
   *  per-subject thumbnails. Off in clips mode: a visit is one snapshot, not a
   *  track — and a panel listing subjects the tap will not honour (a clips tap
   *  plays the visit from its start) would tell the operator something untrue. */
  readonly enableClusterActions?: boolean
  /** Clips mode: card id → the instant tapping that card plays from, built by
   *  `clipStartByCardId` from the SAME derived list the tap resolves through.
   *  The card's time label reads it; absent in normal mode. */
  readonly clipStartByCardId?: ReadonlyMap<string, number>
  /** Clips mode: card id → the instant the clip's footage ends, built by
   *  `clipEndByCardId` from the SAME derived list. The card's time label reads
   *  it too; absent in normal mode. */
  readonly clipEndByCardId?: ReadonlyMap<string, number>
  /**
   * Per-card SAVE binding, clips mode only — the control in the magnifier's
   * corner (`clip-download.ts`).
   *
   * A card with no entry gets no control at all (a clip of our own recording,
   * collected through the export path instead). An entry whose `onSave` is
   * null is a clip the provider REFUSED: the control is drawn, disabled, and
   * `reason` carries the provider's own words.
   */
  readonly clipSaveByCardId?: ReadonlyMap<string, ClipSaveBinding>
  /**
   * Clips mode: card id → the state of the clip that is RUNNING. At most one
   * entry — the frame has one occupant.
   *
   * A card with no entry is not playing, and that absence is computed by the
   * timeline off state it holds, never a read that could have failed. The
   * entry's progress carries its own `unknown` arm, so "playing" and "this far
   * through" stay two answers (`clip-row-playback.ts`).
   */
  readonly clipPlaybackByCardId?: ReadonlyMap<string, ClipRowPlayback>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Entries kept before the label cache starts over (a day of 1-minute rows). */
const TICK_LABEL_CACHE_MAX = 1_440
const tickLabelCache = new Map<number, string>()

/**
 * Format epoch ms as "HH:MM".
 *
 * Memoised per tick: `toLocaleTimeString` builds a locale formatter on every
 * call, and every scroll frame that moves the band re-renders the tick rows —
 * a CPU profile of the wide rail spent 2.5 s self time here while the band was
 * unbounded (`measured-scale-box.spec.ts`). Ticks are grid-aligned epochs, so
 * the same few dozen values repeat; a bounded map is enough.
 */
function formatHHMM(ms: number): string {
  const cached = tickLabelCache.get(ms)
  if (cached !== undefined) return cached
  if (tickLabelCache.size >= TICK_LABEL_CACHE_MAX) tickLabelCache.clear()
  const label = new Date(ms).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  })
  tickLabelCache.set(ms, label)
  return label
}

// ─── Component ───────────────────────────────────────────────────────────────

export const TimelineScroller = memo(
  forwardRef<TimelineScrollHandle, TimelineScrollerProps>(function TimelineScroller(
    {
      topMs,
      zoomIndex,
      dayWindow,
      clusters,
      activity,
      showMotionLane,
      showAudioLane,
      laneSelection = null,
      cardWidth,
      viewportHeight,
      indicatorOffsetPx,
      cursorShiftPx,
      zoomScaleY,
      contentBottomInset = 0,
      contentTopInset = 0,
      isLive,
      onScroll,
      onScrollBeginDrag,
      onScrollEndDrag,
      onMomentumScrollBegin,
      onMomentumScrollEnd,
      onClusterPress,
      onClusterOpenDetail,
      expansion,
      epochMap = null,
      gapMarkers,
      axisTicks,
      hideHourTicks = false,
      hideActivity = false,
      enableClusterActions = true,
      clipStartByCardId,
      clipEndByCardId,
      clipSaveByCardId,
      clipPlaybackByCardId,
    },
    ref,
  ): React.ReactElement {
    const { colors } = useTheme()
    // Origin at the playhead: grow/shrink around the moment under the indicator
    // (zoom range transition), then apply the cursor's translate shift. Both
    // values are transforms driven from the UI thread — layout never animates.
    const shiftStyle = useAnimatedStyle(() => ({
      transform: [
        { translateY: indicatorOffsetPx },
        { scaleY: zoomScaleY ? zoomScaleY.get() : 1 },
        { translateY: -indicatorOffsetPx },
        { translateY: cursorShiftPx ? cursorShiftPx.get() : 0 },
      ],
    }))
    const { t } = useTranslation()

    const layoutOriginPx = indicatorOffsetPx + contentTopInset

    const scrollViewRef = useRef<ScrollView>(null)
    const scrollOffsetRef = useRef(0)
    const [scrollWidth, setScrollWidth] = useState(0)
    const [band, setBand] = useState<MountBand>(() =>
      mountBand({ viewportTopPx: -layoutOriginPx, viewportHeightPx: viewportHeight }),
    )
    const bandRef = useRef<MountBand>(band)
    // The container's own scale. `scale < 1` means narrower than the reference
    // phone width — i.e. the landscape drawer, and nothing else. Used to decide
    // whether the card fills its band; see `cluster-band.ts`.
    const ui = useTimelineScale()

    useImperativeHandle(
      ref,
      () => ({
        scrollToOffset: ({ offset, animated }) =>
          scrollViewRef.current?.scrollTo({ y: offset, animated: animated ?? false }),
      }),
      [],
    )

    // Day span in pixels (live edge → midnight), at least one viewport tall.
    // Clips mode replaces the hour scale with the compressed visit axis.
    const dayHeight = Math.max(
      viewportHeight,
      epochMap !== null ? epochMap.contentSpanPx : epochToOffset(dayWindow.from, topMs, zoomIndex),
    )
    // Content height = top spacer (= indicatorOffsetPx) + the day span + the
    // TRAILING ROOM. The spacer shifts every positioned child down so the
    // current epoch rests on the indicator line; the trailing room is what
    // makes the OTHER end reachable, and it was missing.
    //
    // `timeline-content-height.ts` has the measurement: the old expression
    // (`spacer + dayHeight + footerInset`) left the last
    // `viewportHeight − indicatorPx − footerInset` of the axis — 558 px on a
    // 700 px body — impossible to scroll to, so the list stopped short and
    // every card down there rendered that far BELOW the cursor.
    const contentHeight = timelineContentHeightPx({
      indicatorOffsetPx,
      dayHeightPx: dayHeight,
      contentBottomInsetPx: contentBottomInset,
      contentTopInsetPx: contentTopInset,
      viewportHeightPx: viewportHeight,
    })

    // ── The MOUNT WINDOW ──────────────────────────────────────────────────
    // Everything positioned inside the scroll content is drawn only for this
    // band. The content HEIGHT above is untouched and so is every px↔epoch
    // mapping: windowing changes what EXISTS, never where anything is, which is
    // the only way it can be invisible to the scrub. See `timeline-window.ts`.
    //
    // The offset is CLAMPED to the scrollable range, and that is not defensive
    // tidiness. Clips mode swaps a day of pixels for a few hundred: the offset
    // the list was left at no longer exists, and the ScrollView clamps it
    // itself — but the clamp is not guaranteed to reach us as a scroll event.
    // An unclamped read would leave the band parked past the end of the new
    // content with nothing in it, which is a BLANK TIMELINE that no gesture
    // recovers. Clamping here also means the band is right in the same commit
    // the axis changes, so the swap does not flash empty for a frame.
    const syncBand = useCallback(
      (offsetY: number): void => {
        const next = scrollBand({
          offsetY,
          contentHeightPx: contentHeight,
          viewportHeightPx: viewportHeight,
          topSpacerPx: layoutOriginPx,
        })
        // Quantised, so this is a no-op for most scroll frames — which is the
        // point: a band recomputed per frame would re-mount the list per frame.
        if (bandsEqual(next, bandRef.current)) return
        bandRef.current = next
        setBand(next)
      },
      [layoutOriginPx, viewportHeight, contentHeight],
    )
    // The band also moves when the CONTENT or the BOX does — the clips toggle,
    // the first measure, a rotation, the drawer opening — none of which is a
    // scroll. Reads the last offset from the ref rather than waiting for an
    // event that may never come.
    useEffect(() => {
      syncBand(scrollOffsetRef.current)
    }, [syncBand])

    // The spacer band ABOVE the live edge represents the immediate FUTURE (times
    // not yet reached); ticks for those upcoming minutes render there instead of
    // leaving the band blank. `ticksInBand` is told how deep it is, in pixels,
    // as `futurePx` below.
    const pph = pxPerHour(zoomIndex)
    // Content-Y for an epoch, UNCLAMPED (negative offsets allowed → future ticks
    // land in the spacer above `now`). `now` (topMs) sits at `indicatorOffsetPx`.
    const contentY = (epochMs: number): number =>
      epochMap !== null
        ? epochMap.epochToOffset(epochMs) + layoutOriginPx
        : ((topMs - epochMs) / MS_PER_HOUR) * pph + layoutOriginPx

    // Only the marks the band can show. The old generator walked the whole
    // loaded window on the zoom's grid — 43 200 elements at the finest zoom over
    // a thirty-day back-scroll, all but twenty of them created and then
    // discarded by a `null` return. `epochMap !== null` (clips) has no linear
    // grid at all — it draws `axisTicks` instead, computed by the parent from
    // `clipAxisTicks` (pure, per-clip; see `clip-axis.ts`). This component only
    // positions them, via `contentY` below, which already defers to `epochMap`.
    const ticks = useMemo(
      () => {
        if (hideHourTicks) return NO_TICKS
        if (epochMap !== null) return axisTicks ?? NO_TICKS
        return ticksInBand({
          topMs,
          zoomIndex,
          band,
          oldestMs: dayWindow.from,
          futurePx: layoutOriginPx,
        })
      },
      [hideHourTicks, epochMap, axisTicks, topMs, zoomIndex, band, dayWindow.from, layoutOriginPx],
    )

    // Centre cards in the band BETWEEN the left time-label column and the right
    // activity column (not the full content width).
    // Compact containers (the landscape drawer) FILL the band; roomy ones keep
    // the operator's `cardWidthFraction`. See `cluster-band.ts` — the card used
    // to be a fraction of the whole body, which left a third of the drawer as a
    // black column with only the activity strips in it.
    const cardBand = resolveClusterBand({
      scrollWidth,
      leftReserve: SPACING.md + TICK_LABEL_WIDTH + SPACING.sm,
      rightReserve: hideActivity ? SPACING.sm : ACTIVITY_RIGHT_INSET + RIGHT_COL_WIDTH,
      preferredWidth: cardWidth,
      compact: ui.scale < 1,
    })
    const cardLeft = cardBand.left
    const cardBoxWidth = cardBand.width

    // The mounted slice. `itemsInBand` returns the INPUT array when nothing is
    // dropped, so a short day keeps one identity and the cards' memo holds.
    const visibleClusters = useMemo(() => itemsInBand(clusters, band), [clusters, band])
    const detectionMarks = useMemo(
      () =>
        visibleClusters.map((c) => ({
          id: c.id,
          timestampMs: c.anchorMs,
          color: classPaintColor(c.importantEvent.className),
        })),
      [visibleClusters],
    )
    const visibleGaps = useMemo(
      () => itemsInBand(gapMarkers ?? NO_GAPS, band),
      [gapMarkers, band],
    )
    // The activity column is placed by TIME, so it is windowed by the band's
    // epoch range. Same identity rule: an unfiltered model is the model itself,
    // so `ActivityLanes`'s own memo is not defeated by the wrapper.
    const bandedActivity = useMemo(() => {
      if (hideActivity || epochMap !== null) return activity
      const { fromMs, toMs } = bandEpochRange(band, topMs, zoomIndex)
      const recording = spansInBand(activity.recording, fromMs, toMs)
      const motion = spansInBand(activity.motion, fromMs, toMs)
      const audio = spansInBand(activity.audio, fromMs, toMs)
      if (
        recording === activity.recording &&
        motion === activity.motion &&
        audio === activity.audio
      ) {
        return activity
      }
      return { recording, motion, audio }
    }, [hideActivity, epochMap, activity, band, topMs, zoomIndex])

    const handleScroll = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
        scrollOffsetRef.current = event.nativeEvent.contentOffset.y
        syncBand(scrollOffsetRef.current)
        onScroll(event)
      },
      [onScroll, syncBand],
    )
    const handleScrollBeginDrag = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
        onScrollBeginDrag?.(event)
      },
      [onScrollBeginDrag],
    )
    return (
      <View style={styles.root}>
        <ScrollView
        ref={scrollViewRef}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={onScrollEndDrag}
        onMomentumScrollBegin={onMomentumScrollBegin}
        onMomentumScrollEnd={onMomentumScrollEnd}
        onLayout={(e) => setScrollWidth(e.nativeEvent.layout.width)}
        scrollEventThrottle={16}
        decelerationRate="normal"
        style={styles.scrollView}
        contentContainerStyle={{ height: contentHeight, position: 'relative' }}
      >
        {/* ── The cursor's TRANSITION layer ────────────────────────────────
              ONE wrapper holding every positioned child, carrying the cursor's
              move between its two positions as a TRANSFORM. A transform changes
              no frame: `contentContainerStyle.height` above is the final value
              from the first frame of the move to the last, so `contentSize` is
              constant throughout, no scroll event is emitted and the offset the
              operator scrubbed to is preserved to the pixel. Putting the move in
              the spacer's HEIGHT instead would re-lay-out every card per frame —
              the storm `scrollOffsetRef` exists to prevent — and would emit a
              scroll event on a body that may be at its clamp.
              `box-none` so card taps still land. `timeline-cursor-shift.ts`. */}
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.shiftLayer,
            { height: contentHeight },
            shiftStyle,
          ]}
        >
        {/* ── Hour/tick gridlines (past below `now`, future in the spacer above) ── */}
        {ticks.map((tickMs) => {
          const top = contentY(tickMs)
          if (top < 0 || top > contentHeight) return null
          return (
            <TickRow
              key={tickMs}
              tickMs={tickMs}
              top={top}
              labelColor={colors.foregroundSubtle}
              lineColor={colors.borderSubtle}
            />
          )
        })}

        {/* ── Live-edge marker: a clean cyan hairline at the live edge (topMs),
              capped on the RIGHT by a small "● LIVE" tag. It separates the future
              (above) from recorded history (below) and, while scrubbed into the
              past, tells the operator where live actually is — "you're N behind".
              Rendered ONLY in playback: in live the fixed readhead already sits on
              the edge, so this would duplicate it. Cyan `colors.live` keeps it
              clearly distinct from the RED readhead (the current-position line) and
              from the amber primary, and the cap sits opposite the left readhead
              pill so the two never collide. Pointer-transparent. */}
        {!isLive ? (
          <View pointerEvents="none" style={[styles.liveEdge, { top: layoutOriginPx }]}>
            <View style={[styles.liveEdgeLine, { backgroundColor: colors.live }]} />
            <View style={[styles.liveEdgeDot, styles.liveEdgeOrigin, { backgroundColor: colors.live }]} />
            <View style={[styles.liveEdgeCap, { backgroundColor: colors.live }]}>
              <View style={[styles.liveEdgeDot, { backgroundColor: colors.primaryForeground }]} />
              <Text style={[styles.liveEdgeLabel, { color: colors.primaryForeground }]}>
                {t('v2.theater.live')}
              </Text>
            </View>
          </View>
        ) : null}

        {/* Cluster cards never scale or move. */}
        {cardWidth > 0 && visibleClusters.map((cluster) => (
          <ClusterSlot
            key={cluster.id}
            cluster={cluster}
            top={cluster.topPx + layoutOriginPx}
            left={cardLeft}
            width={cardBoxWidth}
            selected={(expansion?.get(cluster.id) ?? 0) >= 0.75}
            onPress={onClusterPress}
            onOpenDetail={enableClusterActions ? onClusterOpenDetail : undefined}
            paging={enableClusterActions}
            clipStartMs={clipStartByCardId?.get(cluster.id)}
            clipEndMs={clipEndByCardId?.get(cluster.id)}
            clipSave={clipSaveByCardId?.get(cluster.id)}
            clipPlayback={clipPlaybackByCardId?.get(cluster.id)}
          />
        ))}

        {visibleGaps.map((gap) => (
          <GapMarker
            key={`gap_${gap.topPx}_${gap.durationMs}`}
            top={gap.topPx + layoutOriginPx}
            height={gap.heightPx}
            left={cardLeft}
            width={cardBoxWidth}
            durationMs={gap.durationMs}
            color={colors.foregroundSubtle}
          />
        ))}

        {/* ── Activity bars (right edge, content-space — scrollOffsetY=0) ───
            The column origin is the top spacer (indicatorOffsetPx); its inner
            bars are placed via epochToOffset relative to that origin, so they
            shift down with the ticks/cards and stay aligned to the same epochs. */}
        {dayHeight > 0 && !hideActivity && (
          <View
            pointerEvents="none"
            style={[styles.activityColumn, { top: layoutOriginPx, height: dayHeight }]}
          >
            <ActivityLanes
              model={bandedActivity}
              topMs={topMs}
              zoomIndex={zoomIndex}
              height={dayHeight}
              scrollOffsetY={0}
              width={RIGHT_COL_WIDTH}
              showMotion={showMotionLane}
              showAudio={showAudioLane}
              detections={showMotionLane ? detectionMarks : undefined}
              selection={laneSelection}
            />
          </View>
        )}
        </Animated.View>
        </ScrollView>
      </View>
    )
  }),
)

/**
 * One card in its slot — and the reason the card's `memo` is worth anything.
 *
 * The scroller used to build the card's three handlers INLINE in the map, so
 * every render of the scroller handed every card three new functions and
 * `ClusterCard`'s memo was defeated on all of them. It has been memoised since
 * it was written and it had never once skipped a render.
 *
 * The closures live here instead, behind a memo of their own whose props are
 * the stable handlers the parent already holds. A card now re-renders when its
 * cluster, its geometry or its selection changes, and at no other time.
 */
const ClusterSlot = memo(function ClusterSlot({
  cluster,
  top,
  left,
  width,
  selected,
  onPress,
  onOpenDetail,
  paging,
  clipStartMs,
  clipEndMs,
  clipSave,
  clipPlayback,
}: {
  readonly cluster: PositionedCluster
  readonly top: number
  readonly left: number
  readonly width: number
  readonly selected: boolean
  readonly onPress: (event: ObjectEvent, cluster: PositionedCluster) => void
  readonly onOpenDetail?: (cluster: PositionedCluster) => void
  readonly paging: boolean
  readonly clipStartMs?: number
  readonly clipEndMs?: number
  readonly clipSave?: ClipSaveBinding
  /** This row's clip is running, and how far through — absent when it is not. */
  readonly clipPlayback?: ClipRowPlayback
}): React.ReactElement {
  const handlePress = useCallback(
    (event: ObjectEvent): void => {
      hapticTap()
      onPress(event, cluster)
    },
    [onPress, cluster],
  )
  const handleOpenDetail = useMemo(
    () =>
      onOpenDetail === undefined
        ? undefined
        : (): void => {
            hapticTap()
            onOpenDetail(cluster)
          },
    [onOpenDetail, cluster],
  )
  return (
    <View style={[styles.clusterWrapper, { top, left, width, height: cluster.heightPx }]}>
      <ClusterCard
          cluster={cluster}
          width={width}
          selected={selected}
          onPress={handlePress}
          onOpenDetail={handleOpenDetail}
          paging={paging}
          clipStartMs={clipStartMs}
          clipEndMs={clipEndMs}
          clipPlayback={clipPlayback}
          {...(clipSave !== undefined
            ? {
                onSaveClip: clipSave.onSave,
                saveClipRefusedReason: clipSave.reason,
                savingClip: clipSave.saving === true,
              }
            : {})}
      />
    </View>
  )
})

/**
 * One grid mark, memoised.
 *
 * A screen holds ~50 of them and each is three elements, so re-rendering the
 * scroller re-rendered 150 elements that had not moved — which is most of what
 * a parent re-render cost once the CARDS stopped re-rendering. Memoised on the
 * four values it draws, it costs nothing until the geometry actually moves.
 */
const TickRow = memo(function TickRow({
  tickMs,
  top,
  labelColor,
  lineColor,
}: {
  readonly tickMs: number
  readonly top: number
  readonly labelColor: string
  readonly lineColor: string
}): React.ReactElement {
  return (
    <View pointerEvents="none" style={[styles.tickRow, { top }]}>
      <Text style={[styles.tickLabel, { color: labelColor }]}>{formatHHMM(tickMs)}</Text>
      <View style={[styles.tickLine, { backgroundColor: lineColor }]} />
    </View>
  )
})

/** One collapsed-hole ellipsis on the clips axis. Memoised for the same reason
 *  as {@link TickRow}. */
const GapMarker = memo(function GapMarker({
  top,
  height,
  left,
  width,
  durationMs,
  color,
}: {
  readonly top: number
  readonly height: number
  readonly left: number
  readonly width: number
  readonly durationMs: number
  readonly color: string
}): React.ReactElement {
  return (
    <View pointerEvents="none" style={[styles.gapMarker, { top, height, left, width }]}>
      <Text style={[styles.gapLabel, { color }]}>
        {GAP_ELLIPSIS} {formatGapLabel(durationMs)}
      </Text>
    </View>
  )
})

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // The cursor-transition layer: absolute so it adds NO layout of its own and
  // its transform cannot reach the content container's measured height.
  shiftLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  root: {
    flex: 1,
    position: 'relative',
  },
  scrollView: {
    flex: 1,
  },
  tickRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.md,
    gap: SPACING.sm,
  },
  tickLabel: {
    fontSize: 9,
    fontVariant: ['tabular-nums'],
    width: TICK_LABEL_WIDTH,
    flexShrink: 0,
  },
  // Live-edge marker (playback only): a subtle full-width hairline with a small
  // right-docked "● LIVE" cap, both centered on the live-edge row.
  liveEdge: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 0,
    justifyContent: 'center',
  },
  liveEdgeLine: {
    position: 'absolute',
    left: CURSOR_LINE_START_PX,
    right: 0,
    height: 1,
    opacity: 0.5,
  },
  // The live line's time marker, at its left end, past the label column.
  liveEdgeOrigin: {
    position: 'absolute',
    left: CURSOR_LINE_START_PX,
    top: -CURSOR_ORIGIN_DOT_PX / 2,
    width: CURSOR_ORIGIN_DOT_PX,
    height: CURSOR_ORIGIN_DOT_PX,
    borderRadius: CURSOR_ORIGIN_DOT_PX / 2,
  },
  liveEdgeCap: {
    position: 'absolute',
    right: SPACING.sm,
    top: -8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: RADIUS.sm,
  },
  liveEdgeDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  liveEdgeLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  tickLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    opacity: 0.5,
  },
  clusterWrapper: {
    position: 'absolute',
    overflow: 'hidden',
  },
  gapMarker: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gapLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  activityColumn: {
    position: 'absolute',
    top: 0,
    right: ACTIVITY_RIGHT_INSET,
  },
})
