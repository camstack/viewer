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
 * Rect vs polygon drawing lives in `ZoneShapeView`, shared with the
 * configured-zones overlay.
 */
import React, { memo, useCallback, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'

import { useTheme } from '../../theme/theme-provider.js'
import type { ZoneShape } from './theater/zone-filter.js'
import { ZoneShapeView } from './ZoneShapeView.js'

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
      <ZoneShapeView shape={zone} box={boxSize} color={colors.warning} />
    </View>
  )
})
