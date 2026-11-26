/**
 * MotionRegionsOverlay — the moving AREAS the motion detector found, drawn on
 * the live picture.
 *
 * Not to be confused with `MotionBoxesOverlay`, which despite its name draws
 * DETECTION boxes (person, vehicle — from `detection.result`). These are the
 * changed-pixel regions from `detection.motion-zones-raw` / `motion-analysis`, and the two answer
 * different questions: "what is it?" versus "where did the picture change?".
 * The second is what an operator tunes motion sensitivity against, which is why
 * the analysis schema calls its raw set "used for UI debug overlay".
 *
 * Two layers: every raw changed area gets a thin neutral outline; a region
 * that passed the area bar (the ones that gate detection) additionally gets the
 * motion-coloured border and a faint fill whose opacity follows its pixel
 * count, so a large slow change and a small sharp one look different. No labels — a motion region has
 * no identity to name, and text here would compete with the detection boxes
 * that usually sit on top of it.
 *
 * Fills its (relative) parent, non-interactive.
 */
import React, { useCallback, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'

import { useMotionOverlayBoxes, type MotionOverlayBox } from '../../data/use-motion.js'
import { usePlaybackSlice, type PlaybackOverlayStore } from '../../playback-overlay/playback-overlay-store.js'
import type { MotionRegionBox } from '../../playback-overlay/playback-overlay-source.js'
import { useTheme } from '../../theme/theme-provider.js'
import { useStreamAspect } from '../../live/stream-aspect.js'
import { pictureRectIn, placeNormalizedBox } from './overlay/picture-box.js'

/** Pixel count at which a region reaches full fill opacity. */
const FULL_INTENSITY_PIXELS = 4000
/** Fill opacity ceiling — the region is context, not the subject. */
const MAX_FILL_ALPHA = 0.28

export interface MotionRegionsOverlayProps {
  readonly deviceId: number
  /** Mount + subscribe only while true. */
  readonly enabled: boolean
  /** Recorded playback: draw the stored regions of the episode at the playback
   *  time instead of subscribing to the live frames. */
  readonly playbackStore?: PlaybackOverlayStore
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

const NO_STORED: readonly MotionRegionBox[] = []

function storedRegions(frame: { readonly availability: string; readonly motionRegions?: readonly MotionRegionBox[] }): readonly MotionRegionBox[] {
  return frame.motionRegions ?? NO_STORED
}

/** The same overlay over the recorded picture: the regions the hub stored for
 *  the motion episode under the playhead. A range with no stored regions draws
 *  nothing. */
function PlaybackMotionRegions({ deviceId, store }: { readonly deviceId: number; readonly store: PlaybackOverlayStore }) {
  const stored = usePlaybackSlice(store, storedRegions, Object.is)
  const regions = React.useMemo<readonly MotionOverlayBox[]>(
    () => stored.map((r) => ({ ...r, intensity: 0, filtered: true })),
    [stored],
  )
  return <RegionBoxes deviceId={deviceId} regions={regions} />
}

function LiveMotionRegions({ deviceId, enabled }: { readonly deviceId: number; readonly enabled: boolean }) {
  const regions = useMotionOverlayBoxes(deviceId, enabled)
  return <RegionBoxes deviceId={deviceId} regions={regions} />
}

export function MotionRegionsOverlay({ deviceId, enabled, playbackStore }: MotionRegionsOverlayProps) {
  return playbackStore !== undefined ? (
    <PlaybackMotionRegions deviceId={deviceId} store={playbackStore} />
  ) : (
    <LiveMotionRegions deviceId={deviceId} enabled={enabled} />
  )
}

function RegionBoxes({ deviceId, regions }: { readonly deviceId: number; readonly regions: readonly MotionOverlayBox[] }) {
  const { colors } = useTheme()
  const [box, setBox] = useState<BoxSize>({ width: 0, height: 0 })
  // The player letterboxes a stream that is not the box's shape: regions are
  // placed on the picture, never on the bands (`picture-box.ts`).
  const aspect = useStreamAspect(deviceId)
  const picture = pictureRectIn(box, aspect)

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setBox({ width, height })
  }, [])

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {box.width <= 0 || box.height <= 0
        ? null
        : regions.map((r, i) => {
            const at = placeNormalizedBox({ x1: r.x, y1: r.y, x2: r.x + r.w, y2: r.y + r.h }, picture)
            return (
              <View
                key={`${r.x}:${r.y}:${r.w}:${r.h}:${i}`}
                style={[
                  styles.region,
                  r.filtered ? styles.filtered : styles.raw,
                  {
                    // Raw areas: neutral light stroke, no fill. A region that
                    // passed the area bar gets the motion colour on top.
                    borderColor: r.filtered ? colors.warning : colors.onPicture,
                    backgroundColor: r.filtered
                      ? `${colors.warning}${alphaHex(regionAlpha(r.pixelCount))}`
                      : 'transparent',
                    left: at.x,
                    top: at.y,
                    width: at.width,
                    height: at.height,
                  },
                ]}
              />
            )
          })}
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
  raw: { borderWidth: 1, opacity: 0.7 },
  filtered: { borderWidth: 2 },
})
