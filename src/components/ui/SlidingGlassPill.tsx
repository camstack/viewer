/**
 * SlidingGlassPill — THE selection indicator of a glass control: the tinted
 * pill behind the lit entry that SLIDES (a spring) to the new slot instead of
 * the background jumping. Extracted from the bottom tab bar so the section
 * selector (`SegmentedControl` glass variant) moves exactly like it; only the
 * corner radius differs (a segment is more rectangular than a tab).
 *
 * Mount it only once the row is measured: the initial values ARE the placement,
 * so it appears in its slot and never travels in from the edge. Reduce-motion
 * is honoured by `springTo` / `timingTo`.
 */
import React, { useEffect } from 'react'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated'

import { useTheme } from '../../theme/theme-provider.js'
import { MOTION, springTo, timingTo, useReducedMotion } from '../../theme/motion.js'
import { RADIUS, withAlpha } from '../../theme/tokens.js'

/** Where the pill sits, in points from the row's left edge. */
export interface SlidingPillTarget {
  readonly x: number
  readonly width: number
  readonly visible: boolean
}

export interface SlidingGlassPillProps {
  readonly target: SlidingPillTarget
  /** Corner radius; the tab bar's full pill by default. */
  readonly radius?: number
  /** Layout only (vertical insets). */
  readonly style?: StyleProp<ViewStyle>
  readonly testID?: string
}

export function SlidingGlassPill({
  target,
  radius = RADIUS.pill,
  style,
  testID,
}: SlidingGlassPillProps): React.JSX.Element {
  const { colors } = useTheme()
  const x = useSharedValue<number>(target.x)
  const fade = useSharedValue<number>(target.visible ? 1 : 0)
  const width = useSharedValue<number>(target.width)
  const reduced = useReducedMotion()
  const motionStyle = useAnimatedStyle(() => ({ opacity: fade.get(), width: width.get(), transform: [{ translateX: x.get() }] }))

  useEffect(() => {
    x.set(springTo(target.x, reduced, MOTION.tabPill.spring))
    width.set(springTo(target.width, reduced, MOTION.tabPill.spring))
    const fadeMs = target.visible ? MOTION.appear.ms : MOTION.disappear.ms
    fade.set(timingTo(target.visible ? 1 : 0, fadeMs, reduced))
  }, [target.visible, target.x, target.width, x, width, fade, reduced])

  return (
    <Animated.View
      testID={testID}
      pointerEvents="none"
      style={[styles.pill, { backgroundColor: withAlpha(colors.primary, 0.2), borderRadius: radius }, style, motionStyle]}
    />
  )
}

const styles = StyleSheet.create({
  pill: { position: 'absolute', top: 0, bottom: 0, left: 0 },
})
