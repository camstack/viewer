/**
 * HeatmapBar — the horizontal 24h NVR tape under the toolbar.
 *
 * One tape: recording is a hairline along the TOP (including the cursor-cap
 * overshoot), audio hangs as intensity-colored peaks from that edge, and the
 * bottom fill is motion — or the prominent detection class when any object is
 * in the slot. Hour marks 00 / 06 / 12 / 18 sit under the tape.
 *
 * The CURRENT-MOMENT MARKER overshoots the tape at both ends (see
 * `heatmap-cursor.ts`). It is the only mark whose silhouette breaks the strip.
 */
import React, { memo, useMemo, useRef } from 'react'
import { View, Text, StyleSheet, type LayoutChangeEvent, type GestureResponderEvent } from 'react-native'

import { useTheme } from '../../../theme/theme-provider.js'
import { BAND } from '../../../theme/tokens.js'
import type { HeatmapBin } from './mock-data.js'
import { pointerFraction } from './heatmap-scrub.js'
import {
  heatmapCursorGeometry,
  HEATMAP_BAND_HEIGHT_PX,
  HEATMAP_HOUR_LABELS_HEIGHT_PX,
  HEATMAP_HOUR_MARKS,
} from './heatmap-cursor.js'
import { heatmapBinLayers } from './event-highlights.js'
import { hapticTap } from '../../../lib/haptics.js'
import { log } from '../../../lib/logger.js'
import { HEATMAP_SCRUB_EMIT_MS, shouldEmitScrubSample } from '../../../lib/scrub-throttle.js'

/** Finger travel (px) below which a touch is a tap (seek), not a drag (scrub). */
const TAP_SLOP_PX = 8

/** Every dimension of the strip and its marker, from the one module that owns
 *  their relationship. Constant — resolved once, not per render. */
const CURSOR = heatmapCursorGeometry()


/** A real recorded-coverage interval (epoch ms), from recording.getAvailability. */
export interface CoverageRange {
  readonly startMs: number
  readonly endMs: number
}

/**
 * The dashed "we did not read every camera" rail. Its own testID because the
 * whole point is that it must not look like the solid recording hairline, and
 * on react-native-web the style that separates them lives in a generated class
 * name no test can read.
 */
export const HEATMAP_UNKNOWN_TEST_ID = 'heatmap-coverage-unknown'

/**
 * The export-selection band.
 *
 * Its own testID for the same reason the dashed rail has one: on
 * react-native-web the fill that separates it from the coverage hairline lives
 * in a generated class name, so a mount test cannot read it off the style.
 */
export const HEATMAP_SELECTION_TEST_ID = 'heatmap-export-selection'

export interface HeatmapBarProps {
  readonly bins: readonly HeatmapBin[]
  /** 0..1 position of the time cursor. */
  readonly cursorFraction: number
  /** Real recorded coverage (epoch ms). When provided WITH a day window, the
   *  tape body comes from this instead of the mock `bins[].recorded`. */
  readonly coverage?: readonly CoverageRange[]
  /**
   * How many cameras in the view this tape could NOT read.
   *
   * Above zero the strip grows a dashed rail spanning the whole window, drawn
   * UNDER the solid coverage. The two marks then say different things and can
   * be told apart at a glance: a solid segment is "somebody has footage here",
   * and the dashed rail is "and some cameras never answered, so the gaps you
   * see are not necessarily gaps".
   *
   * Without it the union of an incomplete read is drawn exactly like the union
   * of a complete one — which is the single way a batched multi-camera timeline
   * can lie to an operator, and the reason the hub tags every row.
   */
  readonly unknownCameras?: number
  /** Day window the strip spans (epoch ms) — required to place `coverage`. */
  readonly dayStartMs?: number
  readonly dayEndMs?: number
  /**
   * The period the operator is currently drawing for an export, or null.
   *
   * Drawn in the SAME language as everything else on this tape: a %-placed band
   * over `[dayStartMs, dayEndMs]`, produced by the same `coverageToBands` that
   * places recorded coverage. It fills the tape's whole height rather than the
   * hairline row, because it is a selection OF the strip and not another lane
   * on it — one paint, no new vocabulary.
   */
  readonly selection?: CoverageRange | null
  /** What the selection is for: a delete is drawn in the danger colour. */
  readonly selectionKind?: 'export' | 'delete'
  /** Tap on the strip → the tapped day-fraction (0..1). Wired to VOD seek. */
  readonly onSeekFraction?: (fraction: number) => void
  /** Drag (scrub) on the strip: start, per-move fraction, settle fraction. */
  readonly onScrubStart?: () => void
  readonly onScrubFraction?: (fraction: number) => void
  readonly onScrubEnd?: (fraction: number) => void
}

interface RecordedBand {
  readonly leftPct: number
  readonly widthPct: number
}

/** Place real coverage ranges as %-bands over [dayStart, dayEnd]. */
function coverageToBands(
  coverage: readonly CoverageRange[],
  dayStartMs: number,
  dayEndMs: number,
): readonly RecordedBand[] {
  const span = dayEndMs - dayStartMs
  if (span <= 0) return []
  const bands: RecordedBand[] = []
  for (const r of coverage) {
    const a = Math.max(r.startMs, dayStartMs)
    const b = Math.min(r.endMs, dayEndMs)
    if (b <= a) continue
    bands.push({ leftPct: ((a - dayStartMs) / span) * 100, widthPct: ((b - a) / span) * 100 })
  }
  return bands
}

/** Collapse contiguous recorded bins into bands for an even backdrop. */
function toRecordedBands(bins: readonly HeatmapBin[]): readonly RecordedBand[] {
  const n = bins.length
  if (n === 0) return []
  const bands: RecordedBand[] = []
  let runStart = -1
  for (let i = 0; i < n; i++) {
    const on = bins[i].recorded
    if (on && runStart < 0) runStart = i
    const end = !on || i === n - 1
    if (end && runStart >= 0) {
      const last = on ? i : i - 1
      bands.push({
        leftPct: (runStart / n) * 100,
        widthPct: ((last - runStart + 1) / n) * 100,
      })
      runStart = -1
    }
  }
  return bands
}

function padHour(hour: number): string {
  return hour < 10 ? `0${hour}` : String(hour)
}

export const HeatmapBar = memo(function HeatmapBar({
  bins,
  cursorFraction,
  coverage,
  unknownCameras = 0,
  dayStartMs,
  dayEndMs,
  selection = null,
  selectionKind = 'export',
  onSeekFraction,
  onScrubStart,
  onScrubFraction,
  onScrubEnd,
}: HeatmapBarProps) {
  const { colors } = useTheme()
  const widthRef = useRef(0)
  const startXRef = useRef(0)
  const movedRef = useRef(false)
  const interactive = !!(onSeekFraction || onScrubFraction)
  // Prefer REAL coverage (when a day window is supplied); else the mock bins.
  const recordedBands = useMemo(() => {
    if (coverage && dayStartMs !== undefined && dayEndMs !== undefined) {
      return coverageToBands(coverage, dayStartMs, dayEndMs)
    }
    return toRecordedBands(bins)
  }, [coverage, dayStartMs, dayEndMs, bins])

  // A zero-width band would be invisible AND indistinguishable from "no
  // selection", so a degenerate range draws nothing: `coverageToBands` already
  // drops `b <= a`, and an empty result renders no band.
  const selectionBands = useMemo(() => {
    if (!selection || dayStartMs === undefined || dayEndMs === undefined) return []
    return coverageToBands([selection], dayStartMs, dayEndMs)
  }, [selection, dayStartMs, dayEndMs])

  const onLayout = (e: LayoutChangeEvent): void => {
    widthRef.current = e.nativeEvent.layout.width
  }
  // `locationX` is strip-relative on every platform (native responder-relative;
  // RNW = clientX − currentTarget rect, so scroll-safe). We divide by the measured
  // width via the pure `pointerFraction`, which returns null when the strip is not
  // measured yet — a tap in that window is DROPPED, never mapped to 0 (= midnight),
  // which was the "the tap did nothing / jumped to a wrong early time" symptom.
  const frac = (e: GestureResponderEvent): number | null =>
    pointerFraction(e.nativeEvent.locationX, widthRef.current)
  // Unified touch: a tap (no real move) seeks; a drag scrubs. scrubStart fires on
  // the FIRST genuine move (not on grant) so a plain tap is a clean seek — and a
  // slightly-jittery finger (a few px) still counts as a tap, not a scrub.
  const lastMoveDispatchRef = useRef(0)
  const lastFracRef = useRef<number | null>(null)

  const onGrant = (e: GestureResponderEvent): void => {
    startXRef.current = e.nativeEvent.locationX
    movedRef.current = false
    lastMoveDispatchRef.current = 0
    lastFracRef.current = frac(e)
    log.debug('heatmap', 'grant', { interactive, x: e.nativeEvent.locationX })
  }
  const onMove = (e: GestureResponderEvent): void => {
    if (!movedRef.current && Math.abs(e.nativeEvent.locationX - startXRef.current) > TAP_SLOP_PX) {
      movedRef.current = true
      hapticTap()
      onScrubStart?.()
    }
    if (!movedRef.current) return
    const f = frac(e)
    if (f === null) return
    lastFracRef.current = f
    // THROTTLE the propagation, not the gesture. Each dispatch travels up to the
    // screen and re-renders it; unthrottled that is one full re-render per
    // pointer move, ~60 a second, while the finger is down.
    //
    // `HEATMAP_SCRUB_EMIT_MS` (33 ms, ~30/s) is the tightest of the three
    // intervals in `scrub-throttle.ts`: this one also drives the visible
    // cursor, and halving the rate keeps it smooth where quartering it would
    // not. The release is
    // never throttled, so the committed position is always the exact one the
    // finger left — a dropped intermediate costs a frame of preview, a dropped
    // commit would seek to the wrong place.
    const now = Date.now()
    if (!shouldEmitScrubSample(lastMoveDispatchRef.current, now, HEATMAP_SCRUB_EMIT_MS)) return
    lastMoveDispatchRef.current = now
    onScrubFraction?.(f)
  }
  const onRelease = (e: GestureResponderEvent): void => {
    const f = frac(e)
    log.debug('heatmap', 'release', { moved: movedRef.current, fraction: f })
    if (f === null) return // unmeasured strip — drop rather than seek to midnight
    if (movedRef.current) {
      // The release commits the seek — the one dispatch of the drag that is
      // never throttled, so exactly one pulse per gesture.
      hapticTap()
      onScrubEnd?.(f)
    } else onSeekFraction?.(f)
  }
  // A parent ScrollView (export panel) must not steal the responder mid-scrub —
  // that left the cursor mid-drag and, on the export panel, the scroller locked.
  const onTerminationRequest = (): boolean => false
  const onTerminate = (): void => {
    if (!movedRef.current) return
    const f = lastFracRef.current
    if (f === null) return
    onScrubEnd?.(f)
  }

  return (
    <View
      onLayout={onLayout}
      onStartShouldSetResponder={() => interactive}
      onMoveShouldSetResponder={() => interactive}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      onResponderTerminationRequest={onTerminationRequest}
      onResponderTerminate={onTerminate}
      style={[styles.bar, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}
    >
      {/* ALL visuals are pointer-INERT (`pointerEvents="none"`): the touch
          TARGET must always be the strip container itself. On native,
          `nativeEvent.locationX` is relative to the touch TARGET — a tap
          landing ON a bin/band/marker child made locationX child-relative
          (0..~8px) → fraction ≈ 0 → seek to ~midnight, the "heatmap tap jumps
          to a completely different point" bug (taps on empty strip areas hit
          the container and worked, which made it look random). */}

      {/* Recording occupies the TOP overshoot (the white gap the cursor caps
          used to sit in empty). It is a hairline, not a translucent body. */}
      <View
        pointerEvents="none"
        style={[styles.recordingRow, { height: CURSOR.bandInsetPx }]}
      >
        {/* Drawn FIRST so the solid coverage sits on top of it: where a camera
            did record, that fact is the stronger one to show. The rail spans
            the whole window because "unreadable" is a property of the CAMERA,
            not of an hour — nobody looked, anywhere in this window. */}
        {unknownCameras > 0 ? (
          <View
            testID={HEATMAP_UNKNOWN_TEST_ID}
            style={[styles.unknownRail, { borderTopColor: colors.foregroundSubtle }]}
          />
        ) : null}
        {recordedBands.map((band, i) => (
          <View
            key={`rec-${i}`}
            style={[
              styles.recordingHairline,
              {
                left: `${band.leftPct}%`,
                width: `${band.widthPct}%`,
                backgroundColor: BAND.recording,
              },
            ]}
          />
        ))}
      </View>

      <View
        pointerEvents="none"
        style={[
          styles.tape,
          {
            top: CURSOR.bandInsetPx,
            height: HEATMAP_BAND_HEIGHT_PX,
            backgroundColor: colors.background,
          },
        ]}
      >
        {bins.map((bin, i) => {
          const layers = heatmapBinLayers(bin, colors.laneAudio)
          return (
            <View key={i} style={styles.bin}>
              {layers.bottom ? (
                <View
                  style={[
                    styles.bottomFill,
                    {
                      height: `${layers.bottom.heightPct}%`,
                      backgroundColor: layers.bottom.color,
                    },
                  ]}
                />
              ) : null}
              {layers.audio ? (
                <View
                  style={[
                    styles.audioPeak,
                    {
                      height: `${layers.audio.heightPct}%`,
                      backgroundColor: layers.audio.color,
                    },
                  ]}
                />
              ) : null}
            </View>
          )
        })}
      </View>

      {/* Over the tape and under the cursor: the operator has to see WHICH
          activity they enclosed, so this tints the lanes rather than hiding
          them, and the moment marker still wins the top of the paint order. */}
      {selectionBands.map((band, i) => (
        <View
          key={`sel-${i}`}
          testID={i === 0 ? HEATMAP_SELECTION_TEST_ID : undefined}
          pointerEvents="none"
          style={[
            styles.selectionBand,
            {
              left: `${band.leftPct}%`,
              width: `${band.widthPct}%`,
              top: CURSOR.bandInsetPx,
              height: HEATMAP_BAND_HEIGHT_PX,
              backgroundColor: selectionKind === 'delete' ? colors.danger : colors.primary,
              borderColor: selectionKind === 'delete' ? colors.danger : colors.primary,
            },
          ]}
        />
      ))}

      <View pointerEvents="none" style={styles.hours}>
        {HEATMAP_HOUR_MARKS.map((hour) => (
          <Text
            key={hour}
            style={[
              styles.hourLabel,
              { left: `${(hour / 24) * 100}%`, color: colors.foregroundMuted },
            ]}
          >
            {padHour(hour)}
          </Text>
        ))}
      </View>

      {/* Current-moment marker. LAST child on purpose: the strip sets no zIndex,
          so source order is the paint order and this must sit over every lane it
          has to be told apart from.

          Four pieces, and only the first three are about being SEEN — the caps
          are what makes it recognisable. They sit in the overshoot above and
          below the tape (the top overshoot also holds the recording hairline),
          so the marker is identified by a break in the silhouette rather than
          by hue. */}
      <View
        pointerEvents="none"
        style={[styles.cursor, { left: `${cursorFraction * 100}%` }]}
      >
        {/* Legibility outline: separates the stem from whatever it crosses in a
            dense region, and stays out of the way in an empty one. */}
        <View style={[styles.cursorHalo, { backgroundColor: colors.background }]} />
        <View style={[styles.cursorStem, { backgroundColor: colors.primary }]} />
        <View style={[styles.cursorCapTop, { backgroundColor: colors.primary }]} />
        <View style={[styles.cursorCapBottom, { backgroundColor: colors.primary }]} />
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  bar: {
    height: CURSOR.stripHeightPx,
    borderBottomWidth: 1,
    paddingHorizontal: 2,
  },
  tape: {
    position: 'absolute',
    left: 2,
    right: 2,
    flexDirection: 'row',
    overflow: 'visible',
    borderRadius: 2,
  },
  bin: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  recordingRow: {
    position: 'absolute',
    top: 0,
    left: 2,
    right: 2,
  },
  /** A dashed hairline across the whole window: read as "unknown", never as
   *  the solid "recorded" mark it sits behind. */
  unknownRail: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
  },
  selectionBand: {
    position: 'absolute',
    minWidth: 2,
    opacity: 0.28,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  recordingHairline: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    minWidth: 2,
  },
  bottomFill: {
    width: '100%',
    borderRadius: 1,
    minHeight: 3,
  },
  audioPeak: {
    position: 'absolute',
    top: 0,
    left: 1,
    right: 1,
    boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
  },
  hours: {
    position: 'absolute',
    left: 2,
    right: 2,
    bottom: 0,
    height: HEATMAP_HOUR_LABELS_HEIGHT_PX,
  },
  hourLabel: {
    position: 'absolute',
    top: 1,
    fontSize: 9,
    lineHeight: 12,
    fontVariant: ['tabular-nums'],
  },
  // ── Current-moment marker ────────────────────────────────────────────────
  // Height is the tape + overshoots, NOT the hour labels — those sit below.
  cursor: {
    position: 'absolute',
    top: 0,
    height: CURSOR.markerHeightPx,
    width: CURSOR.capWidthPx,
    marginLeft: CURSOR.centeringOffsetPx,
  },
  cursorHalo: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: (CURSOR.capWidthPx - CURSOR.haloWidthPx) / 2,
    width: CURSOR.haloWidthPx,
    borderRadius: CURSOR.haloWidthPx / 2,
    opacity: 0.85,
  },
  cursorStem: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: (CURSOR.capWidthPx - CURSOR.stemWidthPx) / 2,
    width: CURSOR.stemWidthPx,
  },
  cursorCapTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: CURSOR.capWidthPx,
    height: CURSOR.capHeightPx,
    borderRadius: CURSOR.capHeightPx / 2,
  },
  cursorCapBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: CURSOR.capWidthPx,
    height: CURSOR.capHeightPx,
    borderRadius: CURSOR.capHeightPx / 2,
  },
})
