/**
 * ActivityRing — the circle around the Activity icon.
 *
 * Idle it is a hairline track and nothing else (subtle on purpose: the item is
 * always tappable, it just has nothing to say). While exports run, an arc fills
 * to the overall fraction — or, when no running job has a real fraction yet, a
 * short arc simply turns, declining to claim a number it does not have (the
 * rule `progress.ts` states). The turn is a UI-thread rotation of the
 * whole svg, so a running export costs no JS frames.
 */
import React, { useEffect } from 'react'
import { StyleSheet } from 'react-native'
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle } from 'react-native-svg'

import type { OverallProgress } from './activity-model.js'

export interface ActivityRingProps {
  readonly size: number
  readonly strokeWidth: number
  readonly progress: OverallProgress
  readonly color: string
  readonly trackColor: string
}

/** Arc length shown while the work has no measured fraction. */
const INDETERMINATE_FRACTION = 0.28
const TURN_MS = 1400

export function ActivityRing({
  size,
  strokeWidth,
  progress,
  color,
  trackColor,
}: ActivityRingProps): React.ReactElement {
  const turn = useSharedValue<number>(0)
  const running = progress.kind !== 'idle'

  useEffect(() => {
    if (!running) {
      turn.set(0)
      return
    }
    turn.set(0)
    turn.set(withRepeat(withTiming(1, { duration: TURN_MS, easing: Easing.linear }), -1, false))
    return () => cancelAnimation(turn)
  }, [running, turn])
  const turnStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 360}deg` }] }))

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const fraction =
    progress.kind === 'known'
      ? Math.max(0.04, progress.fraction)
      : progress.kind === 'indeterminate'
        ? INDETERMINATE_FRACTION
        : 0
  // A known fraction is drawn from 12 o'clock and does not spin: the arc IS the
  // answer. Only the unmeasured arc turns.
  const spins = progress.kind === 'indeterminate'

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, spins ? turnStyle : null]}
    >
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {fraction > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${circumference * fraction} ${circumference}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
    </Animated.View>
  )
}
