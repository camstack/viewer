/**
 * RetrainCorpusSkeleton — the loading shadow of the frames grid: the same
 * 2-column tile layout the loaded list renders (16:9 image, two meta lines),
 * built from the kit's `SkeletonBox`. `SkeletonBox` is absolutely filled, so
 * every box needs a SIZED parent — a bare one collapses to a thin line.
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { SkeletonBox } from '../../components/ui/SkeletonBox.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'

const SKELETON_ROWS = 4
const COLUMNS = 2

export function RetrainCorpusSkeleton(): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={styles.grid} testID="retrain-corpus-skeleton">
      {Array.from({ length: SKELETON_ROWS }, (_, row) => (
        <View key={row} style={styles.row}>
          {Array.from({ length: COLUMNS }, (_, col) => (
            <View
              key={col}
              style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.image}>
                <SkeletonBox />
              </View>
              <View style={styles.metaLong}>
                <SkeletonBox style={{ borderRadius: RADIUS.sm }} />
              </View>
              <View style={styles.metaShort}>
                <SkeletonBox style={{ borderRadius: RADIUS.sm }} />
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { padding: SPACING.sm },
  row: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm },
  tile: {
    flex: 1,
    borderWidth: 1,
    borderRadius: RADIUS.sm,
    overflow: 'hidden',
    paddingBottom: SPACING.xs,
  },
  image: { aspectRatio: 16 / 9, overflow: 'hidden' },
  metaLong: { height: 10, width: '60%', marginTop: 6, marginLeft: SPACING.xs, overflow: 'hidden' },
  metaShort: { height: 10, width: '35%', marginTop: 4, marginLeft: SPACING.xs, overflow: 'hidden' },
})
