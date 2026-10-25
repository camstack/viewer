/**
 * OverlayFrame — the box the read-outs over a picture are laid out in.
 *
 * Wraps every overlay that sits ON the picture. It measures its container,
 * works out where the VIDEO actually is inside it (`videoRectIn` — a
 * letterboxed stream is measured on the picture, not on the bars around it) and
 * does two things with that rectangle:
 *
 *  1. it IS the coordinate space the overlays anchor to, so `top-left` is the
 *     picture's corner, not the window's;
 *  2. it publishes the size multiplier for the device's overlay size level
 *     ({@link overlayScale}), which {@link useStyleScaler} / {@link useOverlayScale}
 *     read — one number every overlay multiplies its dimensions by.
 *
 * An overlay rendered OUTSIDE a frame (a card in the cameras list) reads the
 * context default: scale 1, exactly what it always drew.
 *
 * The frame never takes a touch: `box-none` all the way, so the stage's tap,
 * pinch and pan reach the picture through it.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { StyleSheet, View, type LayoutChangeEvent, type TextStyle, type ViewStyle } from 'react-native'
import { useDeviceSettingsStore } from '../../../store/device-settings-store.js'
import {
  DEFAULT_VIDEO_ASPECT,
  overlayScale,
  scaleStyle,
  videoRectIn,
  type Rect,
  type Size,
  type VideoFit,
} from './overlay-size.js'

interface OverlayMetrics {
  /** Multiplier on every overlay dimension. 1 outside a frame. */
  readonly scale: number
}

const OverlayMetricsContext = createContext<OverlayMetrics>({ scale: 1 })

/** The size multiplier of the frame this overlay sits in (1 outside one). */
export function useOverlayScale(): number {
  return useContext(OverlayMetricsContext).scale
}

type FlatStyle = ViewStyle | TextStyle

/**
 * Scales one style by the frame's multiplier: `const sx = useStyleScaler()`,
 * then `style={sx(styles.pill)}` where `styles.pill` was passed bare. Every
 * dimension (font, padding, gap, radius, width…) grows together; colours,
 * positions and weights are untouched. The identity at scale 1.
 */
export function useStyleScaler(): <T extends FlatStyle>(style: T) => T {
  const scale = useOverlayScale()
  return useCallback(<T extends FlatStyle>(style: T): T => scaleStyle(style, scale), [scale])
}

/** A single dimension (an icon size, a hit slop) scaled like the styles. */
export function useScaledPx(): (n: number) => number {
  const scale = useOverlayScale()
  return useCallback((n: number) => Math.round(n * scale * 100) / 100, [scale])
}

export interface OverlayFrameProps {
  /** How the player fits the picture into its box (`contain` letterboxes). */
  readonly fit: VideoFit
  /** The stream's aspect; 16:9 when unknown. */
  readonly aspect?: number
  /** Ceiling on the multiplier, for a frame much wider than a picture is read
   *  at (the whole grid wall carrying its one device-info pill). */
  readonly maxScale?: number
  readonly children: React.ReactNode
}

export function OverlayFrame({
  fit,
  aspect = DEFAULT_VIDEO_ASPECT,
  maxScale,
  children,
}: OverlayFrameProps) {
  const size = useDeviceSettingsStore((s) => s.settings.overlaySize)
  const [box, setBox] = useState<Size>({ width: 0, height: 0 })
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setBox((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
  }, [])
  const rect: Rect = useMemo(() => videoRectIn(box, fit, aspect), [box, fit, aspect])
  const metrics = useMemo<OverlayMetrics>(
    () => ({ scale: overlayScale(rect.width, size, maxScale) }),
    [rect.width, size, maxScale],
  )
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none" onLayout={onLayout}>
      <OverlayMetricsContext.Provider value={metrics}>
        <View
          pointerEvents="box-none"
          style={{ position: 'absolute', left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          {children}
        </View>
      </OverlayMetricsContext.Provider>
    </View>
  )
}
