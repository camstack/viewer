/**
 * OccupancyBadge — the live "who's in frame right now" overlay for the camera
 * player. Reads the hub's `zoneAnalytics` current occupancy snapshot and renders
 * one compact chip per detection class (taxonomy glyph + count), highest first.
 *
 * A trailing PARKED chip reports `stationaryCount` — every parked object the
 * snapshot reported, which is not the same number the `stationary` overlay layer
 * draws: that layer can only draw the ones whose bbox and frame dimensions
 * survived narrowing. The count was parsed and rendered by nothing, which read
 * as a design that existed; now it is the one place the whole parked set is
 * stated, whether or not it is drawable.
 *
 * Non-interactive; renders nothing until there is occupancy. LIVE only: the
 * snapshot is the current frame, so callers mount it at the live edge (a recorded
 * playhead needs durable per-timestamp history, which is a server follow-up).
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { CircleParking } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { useCurrentOccupancy } from '../../data/use-occupancy.js'
import { occupancyClassCounts } from '../../data/occupancy.js'
import { useEventKindResolver } from '../../data/use-event-kind-resolver.js'
import { useKindPaint } from '../../../shared/palette.js'
import { type OverlayAnchor } from './overlay/overlay-position.js'
import { useScaledPx, useStyleScaler } from './overlay/OverlayFrame.js'

/** The parked accent — the same muted steel `StationaryBoxesOverlay` draws with,
 *  deliberately outside the class-color palette. */
const STATIONARY_COLOR = '#8b98a5'

/** Cap the number of class chips so a busy scene stays a compact strip. */
const MAX_CHIPS = 4

interface OccupancyBadgeProps {
  readonly deviceId: number
  /** Mount + poll only while true (the caller gates this to the live edge). */
  readonly enabled: boolean
  /** Which anchor to sit at. Defaults to the bottom-left it always occupied. */
  readonly corner?: OverlayAnchor
}

/** Live occupancy strip. Empty (renders nothing) with no occupancy. */
export function OccupancyBadge({ deviceId, enabled, corner = 'bottom-left' }: OccupancyBadgeProps) {
  const { colors } = useTheme()
  const sx = useStyleScaler()
  const px = useScaledPx()
  const resolver = useEventKindResolver([deviceId])
  const paint = useKindPaint()
  const { data: snapshot = null } = useCurrentOccupancy(deviceId, enabled)
  const counts = occupancyClassCounts(snapshot)
  const parked = snapshot?.stationaryCount ?? 0
  if (!enabled || (counts.length === 0 && parked === 0)) return null

  const chips = counts.slice(0, MAX_CHIPS)
  const extra = counts.length - chips.length

  return (
    <View style={[sx(styles.row), CORNER[corner]]} pointerEvents="none">
      {chips.map(({ className, count }) => {
        const Glyph = resolver.resolveIcon(className)
        const color = paint(className)
        return (
          <View key={className} style={[sx(styles.chip), { backgroundColor: `${colors.background}CC` }]}>
            <Glyph size={px(13)} color={color} />
            <Text style={[sx(styles.count), { color: colors.foreground }]}>{count}</Text>
          </View>
        )
      })}
      {extra > 0 ? (
        <View style={[sx(styles.chip), { backgroundColor: `${colors.background}CC` }]}>
          <Text style={[sx(styles.count), { color: colors.foregroundMuted }]}>+{extra}</Text>
        </View>
      ) : null}
      {/* The parked set, stated whether or not the overlay can draw it. Muted
          steel, the same accent `StationaryBoxesOverlay` uses, so the number and
          the boxes read as one thing. */}
      {parked > 0 ? (
        <View style={[sx(styles.chip), { backgroundColor: `${colors.background}CC` }]}>
          <CircleParking size={px(13)} color={STATIONARY_COLOR} />
          <Text style={[sx(styles.count), { color: STATIONARY_COLOR }]}>{parked}</Text>
        </View>
      ) : null}
    </View>
  )
}

/** Absolute placement per anchor — the strip itself is identical at all eight.
 *  Edge midpoints stretch between the opposing edges and centre the row inside
 *  (`justifyContent` = main/horizontal axis, `alignItems` = cross/vertical). */
const CORNER: Readonly<Record<OverlayAnchor, object>> = {
  'top-left': { top: SPACING.md, left: SPACING.md },
  'top-center': { top: SPACING.md, left: 0, right: 0, justifyContent: 'center' },
  'top-right': { top: SPACING.md, right: SPACING.md },
  'left-center': { left: SPACING.md, top: 0, bottom: 0, alignItems: 'center' },
  'right-center': { right: SPACING.md, top: 0, bottom: 0, alignItems: 'center' },
  'bottom-left': { bottom: SPACING.md, left: SPACING.md },
  'bottom-center': { bottom: SPACING.md, left: 0, right: 0, justifyContent: 'center' },
  'bottom-right': { bottom: SPACING.md, right: SPACING.md },
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  count: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
})
