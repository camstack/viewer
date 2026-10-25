/**
 * DoorbellBadge — the live doorbell indicator for the camera player, sibling to
 * `MotionBadge` (top-right) and `OccupancyBadge` (bottom-left). Pinned top-LEFT
 * so it never collides with the motion pill.
 *
 * Two visual states, driven by `useDoorbell`:
 *  - `ringingNow` (a press within the last `RING_WINDOW_MS`): a pulsing bell
 *    glyph + "Ringing" label in the accent colour (reanimated breathe, same
 *    pattern as `ConnectingIndicator`).
 *  - otherwise, if the doorbell ever rang: a subtle static "5m" pill showing the
 *    relative age of the last ring (refreshed on a slow tick).
 *
 * Renders NOTHING when the camera has no doorbell (`enabled` false → the hook is
 * idle) and it never rang. The caller gates `enabled` on the `doorbell-button`
 * device feature so non-doorbell cameras show nothing at all.
 */
import React, { useEffect, useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { BellRing } from '../../lib/icons.js'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { useDoorbell, formatRingAgo } from '../../data/use-doorbell.js'
import { useScaledPx, useStyleScaler } from './overlay/OverlayFrame.js'

/** One half of the bell's breathe cycle while ringing. */
const PULSE_HALF_MS = 500
/** How often the idle "N ago" label refreshes (relative time drifts slowly). */
const AGO_TICK_MS = 60_000

interface DoorbellBadgeProps {
  readonly deviceId: number
  /** Poll + subscribe only while true — gate on the `doorbell-button` feature. */
  readonly enabled: boolean
}

/** Top-left doorbell pill. Self-hides when the camera has no doorbell and never
 *  rang; pulses while ringing, shows a subtle "last ring" age otherwise. */
export function DoorbellBadge({ deviceId, enabled }: DoorbellBadgeProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const sx = useStyleScaler()
  const px = useScaledPx()
  const { lastPressedAt, ringingNow } = useDoorbell(deviceId, enabled)

  // Slow tick so the idle "5m ago" label stays roughly fresh without a per-frame
  // clock. Only runs while there's something to show and it isn't ringing.
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled || ringingNow || lastPressedAt === null) return
    const timer = setInterval(() => setNowTick(Date.now()), AGO_TICK_MS)
    return () => clearInterval(timer)
  }, [enabled, ringingNow, lastPressedAt])

  // Bell breathe — runs only while ringing (mirrors ConnectingIndicator's dot).
  const breathe = useSharedValue(1)
  useEffect(() => {
    if (!ringingNow) {
      breathe.value = withTiming(1, { duration: 150 })
      return undefined
    }
    breathe.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: PULSE_HALF_MS, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: PULSE_HALF_MS, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    )
    return () => cancelAnimation(breathe)
  }, [breathe, ringingNow])

  const bellStyle = useAnimatedStyle(() => ({
    opacity: breathe.value,
    transform: [{ scale: 0.85 + 0.15 * breathe.value }],
  }))

  if (!enabled) return null

  // Ringing → accent, animated bell + "Ringing".
  if (ringingNow) {
    return (
      <View style={[sx(styles.badge), { backgroundColor: `${colors.primary}26` }]} pointerEvents="none">
        <Animated.View style={bellStyle}>
          <BellRing size={px(13)} color={colors.primary} />
        </Animated.View>
        <Text style={[sx(styles.text), { color: colors.primary }]}>{t('v2.cameras.doorbellRinging')}</Text>
      </View>
    )
  }

  // Idle → subtle "last ring N ago" (hidden entirely if it never rang).
  const ago = formatRingAgo(lastPressedAt, nowTick)
  if (ago === null) return null
  return (
    <View style={[sx(styles.badge), { backgroundColor: `${colors.background}CC` }]} pointerEvents="none">
      <BellRing size={px(12)} color={colors.foregroundMuted} />
      <Text style={[sx(styles.text), { color: colors.foregroundMuted }]}>
        {t('v2.cameras.doorbellLastRing', { time: ago })}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: SPACING.md,
    left: SPACING.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  text: { fontSize: 11, fontWeight: '700' },
})
