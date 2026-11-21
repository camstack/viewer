/**
 * HeroSceneTile — the model's look as a tile: the state icon on a tone wash.
 * 44 px in a list row (the mini-scene zone), large in the hero card. The scene's
 * animated backdrop is not ported to the viewer; the icon, tone and the level
 * bar are, so a row and its hero still read as the same picture at two sizes.
 */
import React, { useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import type { HeroTone } from '@camstack/types'
import { CatalogIcon } from '../components/CatalogIcon.js'
import { useTheme } from '../theme/theme-provider.js'
import { MOTION_EASE } from '../theme/motion.js'
import { RADIUS, SPACING, withAlpha } from '../theme/tokens.js'
import { toneColor } from './hero-view.js'

export const SCENE_TILE_MINI = 44
export const SCENE_TILE_HERO = 120

export interface HeroSceneTileProps {
  readonly icon: string
  readonly tone: HeroTone
  readonly size?: number
  /** 0..1 — volume, position, progress; drawn as a thin bar at the foot. */
  readonly level?: number | null
  readonly muted?: boolean
  /** Offline / unavailable: drawn with the disabled foreground, below `muted`. */
  readonly disabled?: boolean
  /** A change is in flight: the tile breathes until it settles. Still under reduced motion. */
  readonly pulsing?: boolean
  readonly testID?: string
}

/** Full at rest, dimmed at the trough: visible without being a strobe (same as the control buttons). */
const PULSE_MIN_OPACITY = 0.4
const PULSE_HALF_CYCLE_MS = 550

export function HeroSceneTile({ icon, tone, size = SCENE_TILE_MINI, level = null, muted = false, disabled = false, pulsing = false, testID }: HeroSceneTileProps): React.JSX.Element {
  const { colors } = useTheme()
  const color = disabled ? colors.foregroundDisabled : muted ? colors.foregroundSubtle : toneColor(tone, colors)
  const reduceMotion = useReducedMotion()
  const pulse = useSharedValue<number>(1)
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }))
  // Reduced motion keeps the state (the tile is dimmed, not animated) so a send in flight is still visible.
  const animate = pulsing && !reduceMotion
  useEffect(() => {
    if (!animate) {
      cancelAnimation(pulse)
      pulse.set(pulsing ? PULSE_MIN_OPACITY : 1)
      return
    }
    pulse.set(
      withRepeat(
        withSequence(
          withTiming(PULSE_MIN_OPACITY, { duration: PULSE_HALF_CYCLE_MS, easing: MOTION_EASE }),
          withTiming(1, { duration: PULSE_HALF_CYCLE_MS, easing: MOTION_EASE }),
        ),
        -1,
        false,
      ),
    )
    return () => {
      cancelAnimation(pulse)
      pulse.set(1)
    }
  }, [animate, pulsing, pulse])
  const hero = size > SCENE_TILE_MINI
  return (
    <Animated.View
      testID={testID}
      style={[
        styles.tile,
        {
          width: hero ? undefined : size,
          height: size,
          alignSelf: hero ? 'stretch' : undefined,
          borderRadius: hero ? RADIUS.xl : 12,
          backgroundColor: withAlpha(color, 0.12),
          borderColor: withAlpha(color, 0.3),
        },
        pulseStyle,
      ]}
    >
      <CatalogIcon iconKey={icon} size={hero ? 56 : 22} color={color} />
      {level !== null ? (
        <View style={[styles.track, { backgroundColor: withAlpha(color, 0.18) }]}>
          <View style={[styles.fill, { backgroundColor: color, width: `${Math.round(Math.min(1, Math.max(0, level)) * 100)}%` }]} />
        </View>
      ) : null}
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  tile: { borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  track: { position: 'absolute', left: SPACING.md, right: SPACING.md, bottom: SPACING.sm, height: 4, borderRadius: RADIUS.pill },
  fill: { height: 4, borderRadius: RADIUS.pill },
})
