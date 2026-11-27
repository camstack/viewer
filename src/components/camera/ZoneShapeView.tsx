/**
 * ZoneShapeView — draws ONE zone shape (rect or polygon) inside a measured box.
 *
 * The shared renderer behind `ZoneActiveOverlay` (the timeline's active filter)
 * and `ConfiguredZonesOverlay` (the camera's configured zones): one outline
 * look, so the two cannot drift. A rect is a bordered `View`; a polygon is an
 * SVG `Polygon` (a two-point tripwire degenerates to its line). Non-interactive.
 * `color` is a theme token the caller picks; an optional `label` is drawn at
 * the shape's top-left.
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Svg, { Polygon } from 'react-native-svg'

import type { ZoneShape } from './theater/zone-filter.js'
import { shapeBounds } from './theater/zone-filter.js'

export interface ZoneShapeViewProps {
  readonly shape: ZoneShape
  /** The measured box (px) the 0..1 geometry is projected onto. */
  readonly box: { readonly width: number; readonly height: number }
  /** Outline colour — a theme token. */
  readonly color: string
  readonly labelColor?: string
  readonly label?: string
}

export function ZoneShapeView({
  shape,
  box,
  color,
  labelColor,
  label,
}: ZoneShapeViewProps): React.JSX.Element | null {
  if (box.width <= 0 || box.height <= 0) return null
  const bounds = shapeBounds(shape)
  return (
    <>
      {shape.kind === 'rect' ? (
        <View
          style={[
            styles.zoneRect,
            {
              borderColor: color,
              backgroundColor: `${color}14`,
              left: shape.rect.x * box.width,
              top: shape.rect.y * box.height,
              width: shape.rect.w * box.width,
              height: shape.rect.h * box.height,
            },
          ]}
        />
      ) : (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Polygon
            points={shape.points.map((p) => `${p.x * box.width},${p.y * box.height}`).join(' ')}
            fill={`${color}14`}
            stroke={color}
            strokeWidth={1.5}
          />
        </Svg>
      )}
      {label !== undefined && bounds !== null ? (
        <Text
          numberOfLines={1}
          style={[
            styles.label,
            { color: labelColor ?? color, left: bounds.x * box.width + 4, top: bounds.y * box.height + 2 },
          ]}
        >
          {label}
        </Text>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  zoneRect: {
    position: 'absolute',
    borderWidth: 1.5,
    borderRadius: 2,
  },
  label: {
    position: 'absolute',
    fontSize: 11,
    fontWeight: '600',
    maxWidth: '80%',
  },
})
