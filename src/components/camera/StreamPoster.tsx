/**
 * StreamPoster — the OPAQUE "last known frame" surface a player shows before its
 * first decoded frame arrives (and while it reconnects from cold).
 *
 * WHY it exists: the live players cover their video surface until the embed
 * reports `playing`, so the viewer never sees the embed's own (English,
 * un-editable) connecting loader or a garbage first frame. That cover used to be
 * solid `#000`, which meant every camera open showed a black rectangle for the
 * whole WebView-boot + signalling + keyframe window — and it covered the poster
 * the embed had been given for exactly this purpose.
 *
 * The source is the same per-frame snapshot URL every other surface uses
 * (`useSnapshot` + `SnapshotImage`, `memory-disk`), and the URL is stable for as
 * long as the frame is — so a re-open is a platform-cache hit with no network
 * round-trip on the critical path. The WebView player poster uses a signed
 * `getSnapshotLinks` URL for the same reason.
 *
 * It asks for its own MEASURED width, which is usually a different ladder rung
 * from the card's, so the very first open of a camera is not necessarily a hit
 * on the card's bytes. That is the right trade: a card-sized still stretched
 * over a full-bleed player looks like a bug. The previous frame is still handed
 * to `<Image placeholder>`, so the swap cross-fades rather than flashing.
 *
 * Fallback ladder — never raw black:
 *   1. a painted snapshot (cache hit or fresh);
 *   2. the shared `SkeletonBox` shimmer while the first frame loads (the same
 *      loading treatment `CameraCard` uses for its thumbnail);
 *   3. a plain themed surface when no snapshot is available at all.
 *
 * Purely presentational + self-fetching; the caller owns when it is mounted.
 */
import React, { useCallback, useState } from 'react'
import { View, StyleSheet } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { useTheme } from '../../theme/theme-provider.js'
import { useSnapshot } from '../../data/use-snapshot.js'
import { SnapshotImage } from './SnapshotImage.js'
import { snapshotWidthForCssPx } from '../../hooks/use-responsive.js'
import { SkeletonBox } from '../ui/SkeletonBox.js'
import { resolvePosterFit } from './poster-fit.js'

export interface StreamPosterProps {
  readonly deviceId: number
  /** Paint only while the cover is on screen. False drops the snapshot URL once
   *  the player has taken over (and never wakes a camera for a poster nobody
   *  can see). */
  readonly enabled?: boolean
}

export function StreamPoster({ deviceId, enabled = true }: StreamPosterProps) {
  const { colors } = useTheme()
  const [box, setBox] = useState<{ width: number; height: number } | null>(null)
  // It already measures itself for `contentFit`; the same measurement answers
  // "how many pixels does this poster actually need". Before the box lands we
  // ask for nothing rather than guessing — one undersized first paint is worse
  // than one frame of no poster, and the box arrives on the first layout.
  const snapshot = useSnapshot(deviceId, enabled, snapshotWidthForCssPx(box?.width ?? 0), {
    refreshWhileWaiting: true,
  })
  const { isLoading } = snapshot
  // The poster must be fitted the way the VIDEO will be fitted in this same
  // box, or the first decoded frame visibly re-frames the picture. The box is
  // the only thing that knows — in `fill` it is the whole window (~2.17:1 on a
  // landscape phone) while the source is 16:9, and a hard-coded `cover` there
  // blew the still up to full bleed and then cross-faded it into a letterboxed
  // video. Measuring here covers every caller (detail, grid tile, embed)
  // instead of threading a `fill` flag none of them would remember to pass.
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setBox((prev) =>
      prev !== null && Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
        ? prev
        : { width, height },
    )
  }, [])
  const contentFit = resolvePosterFit(box?.width ?? 0, box?.height ?? 0)
  return (
    <View
      onLayout={onLayout}
      style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface }]}
      pointerEvents="none"
    >
      <SnapshotImage
        source={snapshot}
        deviceId={deviceId}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
      />
      {isLoading ? <SkeletonBox /> : null}
    </View>
  )
}
