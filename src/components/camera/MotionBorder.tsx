/**
 * MotionBorder — the animated "motion right now" treatment for the cameras-list
 * card. Replaces the old top-right MotionBadge pill on the card: a pulsing
 * ring overlaying the whole card, mounted only while motion (with linger) is
 * active. Non-interactive.
 *
 * Colour and width come from the GLOBAL highlight appearance
 * (`settings.highlight.motionColor` / `.thickness`) — the same setting the
 * detail border and the grid tile draw with. The ring shipped hardcoded to the
 * theme's warning colour and the operator read the mismatch as a bug
 * (2026-08-02): the list is not a different surface, it is the same motion in
 * a different place.
 *
 * The card clips to its rounded corners (`overflow:'hidden'` + RADIUS.lg), so an
 * absolute-fill ring with the same radius draws just inside the card edge.
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
import { useSettings } from '../../data/use-settings.js'
import { RADIUS } from '../../theme/tokens.js'

/** One half of the ring's breathe cycle (ms). */
const PULSE_HALF_MS = 700

export interface MotionBorderProps {
  /**
   * Ring colour. ABSENT ⇒ the global motion colour, which is what the
   * cameras-list card has always drawn — so the existing call site is
   * unchanged.
   *
   * Supplied by a surface whose ring can be lit by something OTHER than motion:
   * the tablet camera reel draws one ring for motion, audio or detection and
   * passes that trigger's own colour (`use-reel-highlight.ts`). Without this a
   * card lit by audio would glow in the motion colour and say something false.
   */
  readonly color?: string
  /**
   * Corner radius. ABSENT ⇒ `RADIUS.lg`, the cameras-list card's radius.
   *
   * The ring draws just inside a clipped, rounded box, so it has to match the
   * box it is drawn in — the reel's card is `RADIUS.md`, and an `lg` ring inside
   * an `md` card shows daylight at the corners.
   */
  readonly radius?: number
}

export function MotionBorder({ color, radius }: MotionBorderProps = {}) {
  const { settings } = useSettings()
  const opacity = useSharedValue(0.35)
  useEffect(() => {
    opacity.value = withRepeat(
      withTiming(1, { duration: PULSE_HALF_MS, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    )
    return () => cancelAnimation(opacity)
  }, [opacity])

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.border,
        {
          borderColor: color ?? settings.highlight.motionColor,
          borderWidth: settings.highlight.thickness,
          ...(radius === undefined ? {} : { borderRadius: radius }),
        },
        animatedStyle,
      ]}
    />
  )
}

const styles = StyleSheet.create({
  border: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: RADIUS.lg,
  },
})
