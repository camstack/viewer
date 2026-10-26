/**
 * ActivityLanes — three vertical lanes on the right edge of the theater
 * timeline, matching the 24h heatmap language (geometry: `timeline-lanes-layout`):
 *   left   audio level (live-meter green→red rungs, no outline)
 *   centre recording (continuous red line)
 *   right  motion (green line) with object-detection dots of the prominent class
 *
 * Positioned absolutely; pointerEvents is "none" so the timeline still scrolls
 * and scrubs through it. Each segment is placed via epochToOffset minus the
 * current scrollOffsetY, then clipped to the visible viewport.
 */

import React, { memo } from 'react'
import { View, StyleSheet } from 'react-native'

import { epochToOffset } from './timeline-geometry.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { audioPeakColor } from './event-highlights.js'
import { useKindPaint } from '../../../../shared/palette.js'
import type { ActivityRendererProps, LaneSelection } from './activity-view-types.js'
import { LANE_DOT_PX, LANE_LINE_PX, laneMarkLeft } from './timeline-lanes-layout.js'

const LINE_PX = LANE_LINE_PX
const DOT_PX = LANE_DOT_PX

/** Convert a time range to top/height in px, clamped to the viewport. */
function rangeToSegment(
  startMs: number,
  endMs: number,
  topMs: number,
  zoomIndex: number,
  scrollOffsetY: number,
  viewportHeight: number,
): { top: number; height: number } | null {
  // epochToOffset gives a SMALLER offset for NEWER times (top = 0), so the later
  // edge (endMs) is the visual TOP and the earlier edge (startMs) the BOTTOM.
  const rawTop = epochToOffset(endMs, topMs, zoomIndex) - scrollOffsetY
  const rawBottom = epochToOffset(startMs, topMs, zoomIndex) - scrollOffsetY

  const clampedTop = Math.max(0, rawTop)
  const clampedBottom = Math.min(viewportHeight, rawBottom)
  const height = clampedBottom - clampedTop
  if (height <= 0) return null
  return { top: clampedTop, height }
}

/** A detection mark on the motion column. */
export interface DetectionMark {
  readonly id: string
  readonly timestampMs: number
  readonly color: string
}

/** ActivityLanes props: the shared renderer surface plus the activity-filter
 *  gates. A deselected layer is simply not drawn; recording always is. */
export interface ActivityLanesProps extends ActivityRendererProps {
  readonly showMotion?: boolean
  readonly showAudio?: boolean
  readonly detections?: readonly DetectionMark[]
  /** The period being selected, tinted across the three lanes. */
  readonly selection?: LaneSelection | null
}

export const ActivityLanes = memo(function ActivityLanes({
  model,
  topMs,
  zoomIndex,
  height,
  scrollOffsetY,
  width,
  showMotion = true,
  showAudio = true,
  detections = [],
  selection = null,
}: ActivityLanesProps): React.ReactElement {
  const { colors } = useTheme()
  const paint = useKindPaint()
  const place = (startMs: number, endMs: number) =>
    rangeToSegment(startMs, endMs, topMs, zoomIndex, scrollOffsetY, height)
  const audioLeft = laneMarkLeft('audio', LINE_PX)
  const recordingLeft = laneMarkLeft('recording', LINE_PX)
  const motionLeft = laneMarkLeft('motion', LINE_PX)
  const dotLeft = laneMarkLeft('motion', DOT_PX)

  return (
    <View pointerEvents="none" style={[styles.ribbon, { width, height }]}>
      {selection !== null ? <SelectionSpan selection={selection} place={place} width={width} /> : null}
      {model.recording.map((r) => {
        const seg = place(r.startMs, r.endMs)
        if (seg === null) return null
        return (
          <View
            key={`rec_${r.startMs}_${r.endMs}`}
            style={[
              styles.recordingLane,
              {
                top: seg.top,
                height: seg.height,
                left: recordingLeft,
                backgroundColor: paint('recording'),
              },
            ]}
          />
        )
      })}
      {showMotion
        ? model.motion.map((b) => {
            if (b.intensity <= 0) return null
            const seg = place(b.startMs, b.endMs)
            if (seg === null) return null
            return (
              <View
                key={`mot_${b.startMs}`}
                style={[
                  styles.motionLane,
                  {
                    top: seg.top,
                    height: seg.height,
                    left: motionLeft,
                    backgroundColor: paint('motion'),
                    opacity: Math.max(0.35, b.intensity),
                  },
                ]}
              />
            )
          })
        : null}
      {showMotion
        ? detections.map((d) => {
            const y = epochToOffset(d.timestampMs, topMs, zoomIndex) - scrollOffsetY
            if (y < -DOT_PX || y > height) return null
            return (
              <View
                key={`det_${d.id}`}
                style={[
                  styles.detectionDot,
                  {
                    top: y - DOT_PX / 2,
                    left: dotLeft,
                    backgroundColor: d.color,
                    borderColor: colors.background,
                  },
                ]}
              />
            )
          })
        : null}
      {showAudio
        ? model.audio.map((b) => {
            if (b.intensity <= 0) return null
            const seg = place(b.startMs, b.endMs)
            if (seg === null) return null
            return (
              <View
                key={`aud_${b.startMs}`}
                style={[
                  styles.audioLane,
                  {
                    top: seg.top,
                    height: seg.height,
                    left: audioLeft,
                    backgroundColor: audioPeakColor(b.intensity),
                  },
                ]}
              />
            )
          })
        : null}
    </View>
  )
})

const styles = StyleSheet.create({
  ribbon: {
    overflow: 'hidden',
    borderRadius: 2,
  },
  selectionSpan: {
    position: 'absolute',
    left: 0,
    borderWidth: 1.5,
    borderRadius: 3,
  },
  recordingLane: {
    position: 'absolute',
    width: LINE_PX,
  },
  motionLane: {
    position: 'absolute',
    width: LINE_PX,
  },
  audioLane: {
    position: 'absolute',
    width: LINE_PX,
  },
  detectionDot: {
    position: 'absolute',
    width: DOT_PX,
    height: DOT_PX,
    borderRadius: DOT_PX / 2,
    borderWidth: 1,
  },
})

interface SelectionSpanProps {
  readonly selection: LaneSelection
  readonly place: (startMs: number, endMs: number) => { top: number; height: number } | null
  readonly width: number
}

/**
 * The selected period, over the lanes' full width: the accent for an export,
 * the danger colour — dashed, so it reads as "this will go" — for a delete.
 * Drawn first, under the marks, so the recording and activity inside the span
 * stay visible through the tint.
 */
function SelectionSpan({ selection, place, width }: SelectionSpanProps): React.ReactElement | null {
  const { colors } = useTheme()
  const seg = place(selection.startMs, selection.endMs)
  if (seg === null) return null
  const deleting = selection.kind === 'delete'
  const tone = deleting ? colors.danger : colors.primary
  return (
    <View
      style={[
        styles.selectionSpan,
        {
          top: seg.top,
          height: Math.max(seg.height, 2),
          width,
          backgroundColor: `${tone}${deleting ? '2E' : '3D'}`,
          borderColor: tone,
          borderStyle: deleting ? 'dashed' : 'solid',
        },
      ]}
    />
  )
}
