/**
 * MotionRegionsOverlay — the moving AREAS the motion detector found, drawn on
 * the live picture.
 *
 * Not to be confused with `MotionBoxesOverlay`, which despite its name draws
 * DETECTION boxes (person, vehicle — from `detection.result`). These are the
 * raw changed-pixel regions from `motion.onMotionChanged`, and the two answer
 * different questions: "what is it?" versus "where did the picture change?".
 * The second is what an operator tunes motion sensitivity against, which is why
 * the analysis schema calls its raw set "used for UI debug overlay".
 *
 * Deliberately quieter than the detection boxes: a thin dashed outline and a
 * faint fill whose opacity follows the region's pixel count, so a large slow
 * change and a small sharp one look different. No labels — a motion region has
 * no identity to name, and text here would compete with the detection boxes
 * that usually sit on top of it.
 *
 * Fills its (relative) parent, non-interactive.
 */
import React, { useCallback, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'

import { useMotionRegions } from '../../data/use-motion.js'
import { useTheme } from '../../theme/theme-provider.js'

/** Pixel count at which a region reaches full fill opacity. */
const FULL_INTENSITY_PIXELS = 4000
/** Fill opacity ceiling — the region is context, not the subject. */
const MAX_FILL_ALPHA = 0.28

export interface MotionRegionsOverlayProps {
  readonly deviceId: number
  /** Mount + subscribe only while true. */
  readonly enabled: boolean
}

interface BoxSize {
  readonly width: number
  readonly height: number
}

/** Fill alpha for a region, ramped by changed-pixel count and clamped. */
export function regionAlpha(pixelCount: number): number {
  if (!Number.isFinite(pixelCount) || pixelCount <= 0) return 0.08
  return Math.min(MAX_FILL_ALPHA, 0.08 + (pixelCount / FULL_INTENSITY_PIXELS) * MAX_FILL_ALPHA)
}

/** Two hex digits for an alpha in 0..1 — the `#RRGGBBAA` suffix RN accepts. */
export function alphaHex(alpha: number): string {
  const clamped = Math.min(1, Math.max(0, alpha))
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0')
}

export function MotionRegionsOverlay({ deviceId, enabled }: MotionRegionsOverlayProps) {
  const { colors } = useTheme()
  const [box, setBox] = useState<BoxSize>({ width: 0, height: 0 })
  const regions = useMotionRegions(deviceId, enabled)

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setBox({ width, height })
  }, [])

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {box.width <= 0 || box.height <= 0
        ? null
        : regions.map((r, i) => (
            <View
              key={`${r.x}:${r.y}:${r.w}:${r.h}:${i}`}
              style={[
                styles.region,
                {
                  borderColor: colors.warning,
                  backgroundColor: `${colors.warning}${alphaHex(regionAlpha(r.pixelCount))}`,
                  left: r.x * box.width,
                  top: r.y * box.height,
                  width: r.w * box.width,
                  height: r.h * box.height,
                },
              ]}
            />
          ))}
    </View>
  )
}

const styles = StyleSheet.create({
  region: {
    position: 'absolute',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 2,
  },
})
