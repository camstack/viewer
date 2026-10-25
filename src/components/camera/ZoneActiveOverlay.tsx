/**
 * ZoneActiveOverlay — the ACTIVE timeline zone filter, rendered as a
 * non-interactive outline over the live/playback video box so the drawn zone
 * stays visible while the filter applies (live AND recorded playback).
 *
 * Coordinate math mirrors `ZoneDrawOverlay`: the shape is normalised 0..1
 * against the DISPLAYED video box, so this overlay measures the same box via
 * `onLayout` and projects it back to pixels. Amber (colors.warning) matches the
 * zone FAB's active state; `pointerEvents="none"` throughout so the video's
 * tap/pinch/pan gestures are never intercepted.
 *
 * A rect is drawn as a bordered `View` and a polygon as an SVG `Polygon` —
 * not one code path with the rect expressed as four points. The View costs no
 * SVG surface for the common gesture, and the two are pixel-identical in
 * border weight and fill because both read the same tokens.
 */
import React, { memo, useCallback, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import Svg, { Polygon } from 'react-native-svg'

import { useTheme } from '../../theme/theme-provider.js'
import type { ZoneShape } from './theater/zone-filter.js'

export interface ZoneActiveOverlayProps {
  /** The active zone, normalised 0..1 of the displayed video box. */
  readonly zone: ZoneShape
}

interface BoxSize {
  readonly width: number
  readonly height: number
}

export const ZoneActiveOverlay = memo(function ZoneActiveOverlay({
  zone,
}: ZoneActiveOverlayProps) {
  const { colors } = useTheme()
  const [boxSize, setBoxSize] = useState<BoxSize>({ width: 0, height: 0 })

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setBoxSize({ width, height })
  }, [])

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {boxSize.width <= 0 || boxSize.height <= 0 ? null : zone.kind === 'rect' ? (
        <View
          style={[
            styles.zoneRect,
            {
              borderColor: colors.warning,
              backgroundColor: `${colors.warning}14`,
              left: zone.rect.x * boxSize.width,
              top: zone.rect.y * boxSize.height,
              width: zone.rect.w * boxSize.width,
              height: zone.rect.h * boxSize.height,
            },
          ]}
        />
      ) : (
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <Polygon
            points={zone.points
              .map((p) => `${p.x * boxSize.width},${p.y * boxSize.height}`)
              .join(' ')}
            fill={`${colors.warning}14`}
            stroke={colors.warning}
            strokeWidth={1.5}
          />
        </Svg>
      )}
    </View>
  )
})

const styles = StyleSheet.create({
  zoneRect: {
    position: 'absolute',
    borderWidth: 1.5,
    borderRadius: 2,
  },
})
