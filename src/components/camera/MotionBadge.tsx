/**
 * MotionBadge — the "motion right now" pill.
 *
 * Rendered by the camera-detail player and, since 2026-08-02, by the cameras
 * list card, both gated on the lingered `useMotionHighlight` state and on the
 * per-camera overlay config's `motionBadge` POSITION (it was a boolean pinned
 * to the top-right until then).
 *
 * The caller owns visibility; this owns only what the pill looks like and
 * where it sits. Placement comes from the shared `ANCHOR_PLACEMENT` map so the
 * badge and the pinned readouts cannot drift apart.
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { useStyleScaler } from './overlay/OverlayFrame.js'

interface MotionBadgeProps {
  /** Override the default localized "Motion" label. */
  readonly label?: string
}

/** "Motion" pill — placed by the overlay stack, not by itself. Renders nothing
 *  about visibility itself: the caller mounts it only while motion (with
 *  linger) is active. */
export function MotionBadge({ label }: MotionBadgeProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const sx = useStyleScaler()
  return (
    <View
      style={[sx(styles.badge), { backgroundColor: `${colors.warning}26` }]}
      pointerEvents="none"
    >
      <View style={[sx(styles.dot), { backgroundColor: colors.warning }]} />
      <Text style={[sx(styles.text), { color: colors.warning }]}>{label ?? t('v2.cameras.motion')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  text: { fontSize: 11, fontWeight: '700' },
})
