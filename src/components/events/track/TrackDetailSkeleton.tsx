/**
 * TrackDetailSkeleton — the shadow box the track detail wears while its media
 * manifest is in flight.
 *
 * It draws the SHAPE of what is coming: the hero frame, the two share buttons,
 * the large viewer, the media strip's tiles, and the metadata lines. Not a
 * spinner, and not an empty pane — both of those throw the layout away and then
 * snap it back, and on this surface the snap is violent because the hero is a
 * full-width 16:9 frame. Matching the real geometry means the content lands
 * where the eye is already looking.
 *
 * The shapes here MUST track {@link TrackDetailView}'s layout — same aspect
 * ratio, same tile size, same spacing tokens — or the skeleton stops being a
 * promise and becomes a lie. They are deliberately built from the same
 * `FRAME_ASPECT`/`SPACING`/`RADIUS` constants rather than copied numbers.
 *
 * Header and flags are NOT skeletonised: the title, timestamps and the operator
 * flags all come from the already-loaded feed row, so they are real from the
 * first frame and only the media below them is pending.
 */
import React from 'react'
import { StyleSheet, View, type DimensionValue } from 'react-native'

import { SkeletonBox } from '../../ui/SkeletonBox.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'

/** Must match TrackDetailView's hero/viewer aspect. */
const FRAME_ASPECT = 16 / 9
/** Must match TrackDetailView's `tile` / `tileWrap` width. */
const TILE = 64
/** How many placeholder tiles the strip shows — enough to read as a strip. */
const TILE_COUNT = 5

interface ShapeProps {
  readonly width: DimensionValue
  readonly height: number
  readonly radius?: number
}

/** One shimmering block. `SkeletonBox` fills its parent absolutely, so the
 *  parent is what carries the size, the radius and the clip. */
function Shape({ width, height, radius = RADIUS.sm }: ShapeProps) {
  return (
    <View style={{ width, height, borderRadius: radius, overflow: 'hidden' }}>
      <SkeletonBox />
    </View>
  )
}

/** A section caption placeholder (the small uppercase labels). */
function CaptionShape() {
  return (
    <View style={styles.caption}>
      <Shape width={78} height={9} radius={4} />
    </View>
  )
}

export function TrackDetailSkeleton() {
  return (
    <View style={styles.root} accessibilityRole="progressbar" accessibilityLabel="">
      {/* 1 — BEST SHOT hero. */}
      <CaptionShape />
      <View style={styles.hero}>
        <SkeletonBox />
      </View>

      {/* Share row — two equal-width buttons. */}
      <View style={styles.shareRow}>
        <View style={styles.shareBtn}>
          <SkeletonBox />
        </View>
        <View style={styles.shareBtn}>
          <SkeletonBox />
        </View>
      </View>

      {/* 2 — MEDIA: the large viewer. */}
      <CaptionShape />
      <View style={styles.frame}>
        <SkeletonBox />
      </View>

      {/* The n/N counter. */}
      <View style={styles.counter}>
        <Shape width={30} height={9} radius={4} />
      </View>

      {/* The media strip: tile + its label, repeated. */}
      <View style={styles.strip}>
        {Array.from({ length: TILE_COUNT }, (_, i) => (
          <View key={i} style={styles.tileWrap}>
            <Shape width={TILE} height={TILE} />
            <Shape width={40} height={8} radius={4} />
          </View>
        ))}
      </View>

      {/* Metadata lines — a short label against a longer value, twice. */}
      <View style={styles.meta}>
        <View style={styles.metaRow}>
          <Shape width={72} height={10} radius={4} />
          <Shape width="45%" height={10} radius={4} />
        </View>
        <View style={styles.metaRow}>
          <Shape width={72} height={10} radius={4} />
          <Shape width="60%" height={10} radius={4} />
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { paddingBottom: SPACING.md },
  caption: { marginTop: SPACING.sm, marginBottom: SPACING.xs },
  hero: { width: '100%', aspectRatio: FRAME_ASPECT, borderRadius: RADIUS.md, overflow: 'hidden' },
  shareRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.sm },
  shareBtn: { flex: 1, height: 38, borderRadius: RADIUS.md, overflow: 'hidden' },
  frame: { width: '100%', aspectRatio: FRAME_ASPECT, borderRadius: RADIUS.md, overflow: 'hidden' },
  counter: { alignItems: 'center', marginTop: SPACING.xs },
  strip: { flexDirection: 'row', gap: SPACING.sm, paddingVertical: SPACING.sm },
  tileWrap: { width: TILE, alignItems: 'center', gap: 4 },
  meta: { marginTop: SPACING.md, gap: SPACING.sm },
  metaRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
})
