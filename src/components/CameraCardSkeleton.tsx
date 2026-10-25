/**
 * Cold-launch skeleton placeholders for the cameras list: shimmering card
 * shells (16:9 media box + footer name line) in the same grid geometry as the
 * real `CameraCard`s, under the SAME `RecentReelBlock` the loaded page draws.
 * Shown while the app is `startingUp` (or the first cameras query is in
 * flight) so a cold open reads as "loading", never as an empty or offline
 * page.
 *
 * The reel row here used to be a second, differently-spaced arrangement of the
 * same pieces (`ReelRowSkeleton`), so the camera grid shifted the moment the
 * real page replaced the skeleton. The block owns that geometry now.
 */
import React from 'react'
import { View, StyleSheet } from 'react-native'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING, RADIUS } from '../theme/tokens.js'
import { SkeletonBox } from './ui/SkeletonBox.js'
import { RecentReelBlock } from './events/track/RecentReelBlock.js'

/** Rows of card skeletons to fill the viewport without measuring it. */
const SKELETON_ROWS = 3

interface CamerasGridSkeletonProps {
  readonly numColumns: number
  /** Reel tile edge (px) — mirrors the user's reel-size preference. */
  readonly reelCardWidth: number
}

/** Full cameras-page skeleton: reel block + card grid. */
export function CamerasGridSkeleton({ numColumns, reelCardWidth }: CamerasGridSkeletonProps) {
  const cards = numColumns * SKELETON_ROWS
  return (
    <View>
      {/* The SAME block the loaded page draws, placeholder-side. It used to be
          a second, differently-spaced arrangement of the same pieces, so the
          camera grid shifted the moment the real page replaced the skeleton. */}
      <RecentReelBlock cardWidth={reelCardWidth} live={false} />
      {/* The list's own content padding, reproduced: on the loaded page the
          gap above the first card is the block's bottom padding plus the
          FlatList's `contentContainerStyle` padding, and the skeleton has to
          spend the same two. */}
      <View style={styles.gridPad}>
        <View style={styles.grid}>
          {Array.from({ length: cards }, (_, i) => (
            <View key={i} style={{ width: `${100 / numColumns}%`, padding: SPACING.md / 2 }}>
              <CameraCardSkeleton />
            </View>
          ))}
        </View>
      </View>
    </View>
  )
}

/** One card shell: bordered surface, 16:9 shimmer media, footer name line. */
export function CameraCardSkeleton() {
  const { colors } = useTheme()
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.media}>
        <SkeletonBox />
      </View>
      <View style={styles.footer}>
        <View style={styles.dot}>
          <SkeletonBox style={styles.dotShape} />
        </View>
        <View style={styles.nameLine}>
          <SkeletonBox style={styles.lineShape} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  gridPad: { padding: SPACING.md },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // Cancel the per-cell padding at the grid edges so cards align with the
    // page padding like the real FlatList (which uses gap instead).
    margin: -SPACING.md / 2,
  },
  card: {
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    overflow: 'hidden',
  },
  media: { width: '100%', aspectRatio: 16 / 9 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  // SkeletonBox absolute-fills its parent, so each shape gets a sized wrapper.
  dot: { width: 8, height: 8 },
  dotShape: { borderRadius: 4 },
  // Matches the real name row: fontSize 15 → ~20px line height, so the footer
  // (and with it the whole card) keeps its final height when content lands.
  nameLine: { width: '55%', height: 20 },
  lineShape: { borderRadius: 7 },
})
