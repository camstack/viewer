/**
 * LiveViewersBadge — how many people watch this camera live right now.
 *
 * An eye and a number, placed like every other overlay (`OverlayPosition` +
 * `ANCHOR_PLACEMENT`) and sized by the device's overlay size (it reads the
 * enclosing `OverlayFrame`'s multiplier). Non-interactive: the picture owns
 * every touch.
 *
 * ## When it draws nothing
 *
 * Like the occupancy chips and the doorbell pill, an EMPTY overlay is absent,
 * not a "0": no pill while nobody watches. And it is also absent while the
 * count is UNKNOWN (`null` — not connected, a hub without the method, a failed
 * call): an unanswered question must never read as "nobody is watching".
 * Viewing on this very device is itself a viewer, so on a live picture the
 * number is normally at least 1.
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Eye } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS, TABULAR } from '../../theme/tokens.js'
import { useLiveViewerCount } from '../../data/use-live-viewers.js'
import { ANCHOR_PLACEMENT, type OverlayPosition } from './overlay/overlay-position.js'
import { useScaledPx, useStyleScaler } from './overlay/OverlayFrame.js'

/** The glyph size before the overlay size is applied. */
const GLYPH_PX = 13

export interface LiveViewersBadgeProps {
  readonly deviceId: number
  /** Where to draw it; `off` mounts nothing and polls nothing. */
  readonly position: OverlayPosition
  /** Poll + draw only while true — the caller gates this to the live edge. */
  readonly enabled: boolean
}

export function LiveViewersBadge({
  deviceId,
  position,
  enabled,
}: LiveViewersBadgeProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const sx = useStyleScaler()
  const px = useScaledPx()
  const placed = position !== 'off'
  const viewers = useLiveViewerCount(deviceId, placed && enabled)
  if (position === 'off' || !enabled || viewers === null || viewers < 1) return null

  return (
    <View
      pointerEvents="none"
      style={[styles.anchor, ANCHOR_PLACEMENT[position]]}
      testID="live-viewers-badge"
    >
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={t('v2.overlay.liveViewersCount', { count: viewers })}
        style={[sx(styles.pill), { backgroundColor: `${colors.background}CC` }]}
      >
        <Eye size={px(GLYPH_PX)} color={colors.foregroundMuted} />
        <Text style={[sx(styles.count), { color: colors.foreground }, TABULAR]}>{viewers}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  anchor: { position: 'absolute' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  count: { fontSize: 12, fontWeight: '700' },
})
