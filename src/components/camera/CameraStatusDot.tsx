/**
 * CameraStatusDot — the shared, self-contained status dot for a camera, used by
 * the cameras-list card footer and the live player name overlay.
 *
 * It resolves its own colour by fixed priority (see `camera-status.ts`):
 *   disabled → black · offline → grey · recording-continuous → red ·
 *   recording-events → blue · online → green.
 *
 * The recording mode is fetched internally (only while online + not disabled, so
 * an offline/disabled camera never polls). The "alive" states (online +
 * recording) breathe with a gentle pulse; offline + disabled render static (no
 * life to signal). The disabled dot carries a hairline ring so pure black stays
 * visible on a dark surface.
 */
import React, { useEffect } from 'react'
import { View, StyleSheet } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { useTheme } from '../../theme/theme-provider.js'
import { useRecordingMode } from '../../data/use-recording.js'
import { useCameraBadgeRow } from '../../data/CameraBadgesProvider.js'
import { cameraStatusColor, cameraStatusKind, isAlive } from './camera-status.js'

/** One half of the breathe cycle (ms) for the pulsing "alive" states. */
const PULSE_HALF_MS = 850

interface CameraStatusDotProps {
  readonly deviceId: number
  readonly online: boolean
  readonly disabled: boolean
  /** Gate the recording-mode query (e.g. off while the card is not visible). */
  readonly enabled?: boolean
  /** Dot diameter (px). Default 8 (card); the player passes a larger value. */
  readonly size?: number
}

export function CameraStatusDot({
  deviceId,
  online,
  disabled,
  enabled = true,
  size = 8,
}: CameraStatusDotProps) {
  const { colors } = useTheme()
  // Recording mode only matters (and only polls) while online + not disabled.
  // Same aggregate as the card's battery, same rule: when the screen supplied
  // a REAL recording status, this camera's own recording query never runs.
  // A null cap is a timeout/unavailable answer, not "recording off".
  const badges = useCameraBadgeRow(deviceId)
  const batchMode = badges.supported ? badges.row.recordingMode : null
  // Not while the aggregate is still in flight: an unanswered batch is not a
  // null cap, and asking 27 cameras for their config at boot was the burst.
  const batchPending = !badges.supported && badges.pending
  const { data: ownMode = null } = useRecordingMode(
    deviceId,
    enabled && online && !disabled && batchMode === null && !batchPending,
  )
  // `null` all the way through: neither the aggregate nor this camera's own
  // query may be defaulted into `'off'`. The dot renders the difference.
  const recordingMode = batchMode ?? ownMode
  const kind = cameraStatusKind({ disabled, online, recordingMode })
  const color = cameraStatusColor(kind, colors)
  const alive = isAlive(kind)

  const pulse = useSharedValue(1)
  useEffect(() => {
    if (!alive) {
      cancelAnimation(pulse)
      pulse.value = 1
      return
    }
    pulse.value = withRepeat(
      withTiming(0.4, { duration: PULSE_HALF_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    )
    return () => cancelAnimation(pulse)
  }, [alive, pulse])

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ scale: 0.85 + pulse.value * 0.15 }],
  }))

  const dotStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    backgroundColor: color,
  }

  // Disabled (black) gets a hairline ring so it stays visible on a dark surface,
  // and never pulses.
  if (kind === 'disabled') {
    return (
      <View
        style={[dotStyle, { borderWidth: StyleSheet.hairlineWidth * 2, borderColor: colors.foregroundDisabled }]}
      />
    )
  }
  if (!alive) return <View style={dotStyle} />
  return <Animated.View style={[dotStyle, animatedStyle]} />
}
