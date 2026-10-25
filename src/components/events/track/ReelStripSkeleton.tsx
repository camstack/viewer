/**
 * The reel strip's placeholder — ONE implementation, three callers.
 *
 * There used to be two, drawing the same strip at two different heights —
 * the drift the height contract in `reel-layout.ts` exists to prevent — so the
 * component is shared and both numbers come from the contract.
 *
 * Callers:
 *  - `TrackReel`, while its first page is in flight;
 *  - `RecentReelBlock`, in flow, while there is no connection to load over;
 *  - `CamerasGridSkeleton`, on a cold launch, via `RecentReelBlock`.
 */
import React from 'react'
import { View, StyleSheet } from 'react-native'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { SkeletonBox } from '../../ui/SkeletonBox.js'
import { reelRowHeight } from './reel-layout.js'

/** Tiles drawn. Eight fills a tablet row; the strip clips the overflow, so a
 *  phone simply shows fewer. */
const REEL_TILE_COUNT = 8

interface ReelStripSkeletonProps {
  /** Card edge (px) — the user's reel-size preference. */
  readonly cardWidth: number
}

/** A horizontal row of reel-card shells at EXACTLY `reelRowHeight(cardWidth)`. */
export function ReelStripSkeleton({ cardWidth }: ReelStripSkeletonProps) {
  const { colors } = useTheme()
  return (
    <View style={[styles.row, { height: reelRowHeight(cardWidth) }]}>
      {Array.from({ length: REEL_TILE_COUNT }, (_, i) => (
        <View key={i} style={[styles.card, { width: cardWidth, backgroundColor: colors.surface }]}>
          <View style={{ width: cardWidth, height: cardWidth }}>
            <SkeletonBox />
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    overflow: 'hidden',
  },
  card: { flexShrink: 0, borderRadius: RADIUS.md, overflow: 'hidden' },
})
