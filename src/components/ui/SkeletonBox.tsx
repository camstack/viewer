/**
 * SkeletonBox — the shared loading "shadow box" with the CLASSIC SHIMMER: a
 * soft translucent gradient band sweeping across the box cyclically (the
 * standard web skeleton look), standing in for content that is still loading
 * (camera previews, event crops, reel cards). Replaces spinners on media
 * surfaces — and masks the FlashList recycling artifact (a reused cell must
 * never show the PREVIOUS row's image while its own loads).
 *
 * Theme-aware (surfaceHover base, lighter sweep) and cheap: one UI-thread
 * translateX loop per instance; the sweep distance follows the measured box
 * width (RN transforms take numbers, not percentages).
 */
import React, { useEffect, useState } from 'react'
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import Animated, {
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { MOTION_EASE } from '../../theme/motion.js'
import { useTheme } from '../../theme/theme-provider.js'

/** One full sweep (off-left → off-right) duration. */
const SWEEP_MS = 2000
/** Rest between sweeps — a continuous loop reads frantic on a grid of boxes. */
const SWEEP_PAUSE_MS = 500
/** The sweeping band's width as a fraction of the box width. */
const BAND_FRACTION = 0.6

export function SkeletonBox({ style }: { readonly style?: StyleProp<ViewStyle> }) {
  const { colors, mode } = useTheme()
  const [boxWidth, setBoxWidth] = useState(0)
  const sweep = useSharedValue<number>(0)

  useEffect(() => {
    if (boxWidth <= 0) return
    sweep.set(0)
    // The rest between sweeps is a hold at the end value; the repeat restarts at 0.
    sweep.set(
      withRepeat(
        withSequence(
          withTiming(1, { duration: SWEEP_MS, easing: MOTION_EASE }),
          withTiming(1, { duration: SWEEP_PAUSE_MS }),
        ),
        -1,
        false,
      ),
    )
    return () => cancelAnimation(sweep)
  }, [sweep, boxWidth])

  const bandWidth = Math.max(1, boxWidth * BAND_FRACTION)
  const bandStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(sweep.get(), [0, 1], [-bandWidth, boxWidth + bandWidth]) }],
  }))
  // The sweep highlight: transparent → soft light → transparent. Light theme
  // sweeps a touch of white; dark theme a brighter one so it reads on the
  // dark base.
  const sweepAlpha = mode === 'dark' ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.55)'
  // Edges MUST be the same hue at alpha 0 — the 'transparent' keyword is
  // rgba(0,0,0,0), and interpolating black→white produces a dark gray halo
  // that reads as a SECOND (dark) band sweeping alongside the light one.
  const sweepEdge = 'rgba(255,255,255,0)'

  return (
    <View
      pointerEvents="none"
      style={[styles.fill, { backgroundColor: colors.surfaceHover }, style]}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width)
        setBoxWidth((prev) => (prev === w ? prev : w))
      }}
    >
      {boxWidth > 0 ? (
        <Animated.View style={[styles.band, { width: bandWidth }, bandStyle]}>
          <LinearGradient
            colors={[sweepEdge, sweepAlpha, sweepEdge]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
  },
  band: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
})
