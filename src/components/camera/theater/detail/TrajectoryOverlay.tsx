/**
 * TrajectoryOverlay — draws EVERY position of one track over its stored full
 * frame: the path (a polyline whose segments brighten toward the end, with an
 * arrowhead on the last one), per-node dwell markers (radius + label grow with
 * how long the subject held that spot), and a dashed region for samples that
 * carried no localisation (near-full-frame motion boxes).
 *
 * Projection: node coords are NORMALISED 0..1 of the detection frame (see
 * track-trajectory.ts); this overlay projects them onto the contain-rendered
 * image rect via the SAME `containRect` the bounding-box overlay uses, so path
 * points and boxes can never disagree about where the picture sits. Rendered
 * INSIDE the ZoomableImage content node, so the path scales and pans with the
 * image for free. Pointer-transparent, presentational only.
 */

import React, { memo } from 'react'
import { StyleSheet } from 'react-native'
import Svg, { Circle, Line, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg'
import { containRect } from './cluster-detail.js'
import {
  arrowHeadPoints,
  dwellMs,
  nodeRadius,
  normalizedRectToScreen,
  pointToScreen,
  type TrackTrajectory,
} from './track-trajectory.js'
import type { PixelSize } from '../../../../data/track-media-groups.js'

/** Dwell nodes at or above this get a seconds label next to the marker. */
const DWELL_LABEL_MS = 1500

export interface TrajectoryOverlayProps {
  readonly trajectory: TrackTrajectory
  /** The hero container box (the ZoomableImage content size). */
  readonly width: number
  readonly height: number
  /** ACTUAL pixel size of the rendered image when known (JPEG header / onLoad);
   *  falls back to the detection-frame dims (same scene, usually same aspect). */
  readonly imageSize: PixelSize | null
  /** Class accent color (matches the detail's bounding boxes / class dot). */
  readonly color: string
}

export const TrajectoryOverlay = memo(function TrajectoryOverlay({
  trajectory, width, height, imageSize, color,
}: TrajectoryOverlayProps) {
  if (width <= 0 || height <= 0) return null
  const frameW = imageSize?.width ?? trajectory.frame.w
  const frameH = imageSize?.height ?? trajectory.frame.h
  const image = containRect(frameW, frameH, width, height)

  const points = trajectory.nodes.map((n) => pointToScreen(n.x, n.y, image))
  const last = points[points.length - 1]
  const beforeLast = points.length >= 2 ? points[points.length - 2] : undefined
  const lastNode = trajectory.nodes[trajectory.nodes.length - 1]
  const unlocalizedRect =
    trajectory.unlocalized !== null
      ? normalizedRectToScreen(trajectory.unlocalized.bbox, image)
      : null

  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Samples with NO localisation: the dashed region they claimed — honest
          "somewhere in here", never a fake center dot. */}
      {unlocalizedRect !== null ? (
        <Rect
          x={unlocalizedRect.left}
          y={unlocalizedRect.top}
          width={unlocalizedRect.width}
          height={unlocalizedRect.height}
          fill={color}
          fillOpacity={0.06}
          stroke={color}
          strokeOpacity={0.55}
          strokeWidth={1.5}
          strokeDasharray="7 5"
        />
      ) : null}

      {/* The subject's extent at its FINAL position — anchors the path's scale. */}
      {lastNode !== undefined ? (
        <Rect
          {...(() => {
            const r = normalizedRectToScreen(lastNode.bbox, image)
            return { x: r.left, y: r.top, width: r.width, height: r.height }
          })()}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.45}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
      ) : null}

      {/* Dark halo under the whole path so it reads on any frame content. */}
      {points.length >= 2 ? (
        <Polyline
          points={points.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="#000000"
          strokeOpacity={0.5}
          strokeWidth={5}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ) : null}

      {/* Path segments, opacity ramping start → end: the fade IS the direction. */}
      {points.slice(1).map((p, i) => {
        const from = points[i]
        if (from === undefined) return null
        const t = points.length > 2 ? i / (points.length - 2) : 1
        return (
          <Line
            key={`seg-${i}`}
            x1={from.x}
            y1={from.y}
            x2={p.x}
            y2={p.y}
            stroke={color}
            strokeOpacity={0.35 + 0.65 * t}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        )
      })}

      {/* Arrowhead on the final segment (direction of travel). */}
      {last !== undefined && beforeLast !== undefined ? (
        <Polygon points={arrowHeadPoints(beforeLast, last, 9)} fill={color} stroke="#ffffff" strokeWidth={0.8} />
      ) : null}

      {/* Nodes: radius encodes dwell; the first gets a START ring. */}
      {trajectory.nodes.map((n, i) => {
        const p = points[i]
        if (p === undefined) return null
        const r = nodeRadius(n)
        return (
          <React.Fragment key={`node-${i}`}>
            {i === 0 ? (
              <Circle cx={p.x} cy={p.y} r={r + 3.5} fill="none" stroke="#ffffff" strokeWidth={1.5} strokeOpacity={0.9} />
            ) : null}
            <Circle cx={p.x} cy={p.y} r={r} fill={color} fillOpacity={0.9} stroke="#ffffff" strokeWidth={1} />
          </React.Fragment>
        )
      })}

      {/* Dwell labels: how long the subject HELD a spot (≥1.5s), in seconds. */}
      {trajectory.nodes.map((n, i) => {
        const held = dwellMs(n)
        if (held < DWELL_LABEL_MS) return null
        const p = points[i]
        if (p === undefined) return null
        return (
          <SvgText
            key={`dwell-${i}`}
            x={p.x}
            y={p.y - nodeRadius(n) - 5}
            fontSize={10}
            fontWeight="700"
            fill="#ffffff"
            stroke="#000000"
            strokeWidth={0.4}
            textAnchor="middle"
          >
            {`${Math.round(held / 1000)}s`}
          </SvgText>
        )
      })}
    </Svg>
  )
})
