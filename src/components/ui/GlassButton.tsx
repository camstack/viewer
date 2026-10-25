/**
 * GlassButton / GlassPressable — the one pressable of every glass control.
 *
 * Press feedback is the iOS one: a spring to {@link GLASS_PRESS}.pressed (scale
 * ~0.92, a touch of opacity) and back, on the UI thread (Reanimated). Native glass also
 * gets `isInteractive` (via `GlassSurface interactive`) so the system's own
 * highlight plays as well.
 *
 * - `GlassButton`   a round / pill glass control: surface + glyph (or children).
 * - `GlassPressable` the press behaviour alone, for a SEGMENT that already sits
 *   inside a glass capsule (back | camera switch) or a pill that owns its surface.
 *
 * Both fire the standard tap haptic unless `haptic={false}`.
 */
import React, { useCallback, useEffect, useMemo } from 'react'
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, type AnimatedStyle } from 'react-native-reanimated'

import { hapticTap } from '../../lib/haptics.js'
import type { LucideIcon } from '../../lib/icons.js'
import { springTo, usePopTransitions, useReducedMotion } from '../../theme/motion.js'
import { useTheme } from '../../theme/theme-provider.js'
import { withAlpha } from '../../theme/tokens.js'
import { GlassSurface } from './GlassSurface.js'
import { GLASS_PRESS, glassPressTarget } from './glass-press.js'

/** Diameter of a glass icon button — the header, the stream chrome and the pills share it. */
export const GLASS_BUTTON_SIZE = 40

interface PressAnimation {
  readonly style: StyleProp<AnimatedStyle<StyleProp<ViewStyle>>>
  readonly onPressIn: () => void
  readonly onPressOut: () => void
}

/** The spring behind both components. */
export function useGlassPressAnimation(disabled = false): PressAnimation {
  const scale = useSharedValue<number>(GLASS_PRESS.rest.scale)
  const opacity = useSharedValue<number>(GLASS_PRESS.rest.opacity)
  const reduced = useReducedMotion()
  const style = useAnimatedStyle(() => ({ opacity: opacity.get(), transform: [{ scale: scale.get() }] }))

  const animate = useCallback(
    (pressed: boolean): void => {
      const target = glassPressTarget(pressed, disabled)
      scale.set(springTo(target.scale, reduced))
      opacity.set(springTo(target.opacity, reduced))
    },
    [scale, opacity, disabled, reduced],
  )

  // A control that becomes disabled mid-press must not stay shrunk.
  useEffect(() => {
    if (disabled) animate(false)
  }, [disabled, animate])

  return useMemo(
    () => ({
      style,
      onPressIn: () => animate(true),
      onPressOut: () => animate(false),
    }),
    [animate, style],
  )
}

export interface GlassPressableProps {
  readonly onPress?: () => void
  readonly label: string
  readonly children: React.ReactNode
  readonly selected?: boolean
  readonly expanded?: boolean
  readonly disabled?: boolean
  readonly testID?: string
  readonly hitSlop?: number
  /** Layout of the pressable box (size, padding). */
  readonly style?: StyleProp<ViewStyle>
  readonly haptic?: boolean
}

export function GlassPressable({
  onPress,
  label,
  children,
  selected,
  expanded,
  disabled = false,
  testID,
  hitSlop = 6,
  style,
  haptic = true,
}: GlassPressableProps): React.JSX.Element {
  const press = useGlassPressAnimation(disabled)
  return (
    <Pressable
      testID={testID}
      onPress={() => {
        if (haptic) hapticTap()
        onPress?.()
      }}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, expanded, disabled }}
    >
      <Animated.View style={[styles.center, style, press.style]}>{children}</Animated.View>
    </Pressable>
  )
}

export interface GlassButtonProps {
  readonly icon?: LucideIcon
  readonly label: string
  readonly onPress?: () => void
  /** An active state: washed with the `primary` tint, glyph on `primaryFill`. */
  readonly active?: boolean
  readonly disabled?: boolean
  readonly size?: number
  /** `round` = a `size` disc (default); `pill` = sized by its content and `style`. */
  readonly shape?: 'round' | 'pill'
  /** Replaces the glyph (a badge on a disc, a caption in a pill). */
  readonly children?: React.ReactNode
  /** Layout of the surface's outer box (margin, position). */
  readonly style?: StyleProp<ViewStyle>
  /** A `pill`'s inner box: min size, padding, row direction. */
  readonly contentStyle?: StyleProp<ViewStyle>
  readonly testID?: string
  readonly haptic?: boolean
  /** Scale + fade in / out as the button joins or leaves a cluster. */
  readonly pop?: boolean
  /** Tint override for the active wash (e.g. a warning pill). */
  readonly tint?: string
  /**
   * Lay the glass's own wash under the native iOS glass (`GlassSurface dense`).
   * For a button that mounts under a fade — the on-video discs — where the
   * system glass may not be drawn and the glyph would sit bare on the picture.
   */
  readonly dense?: boolean
}

export function GlassButton({
  icon: Icon,
  label,
  onPress,
  active = false,
  disabled = false,
  size = GLASS_BUTTON_SIZE,
  shape = 'round',
  children,
  style,
  contentStyle,
  testID,
  haptic = true,
  pop = false,
  tint,
  dense = false,
}: GlassButtonProps): React.JSX.Element {
  const { colors } = useTheme()
  const press = useGlassPressAnimation(disabled)
  const popped = usePopTransitions()
  const glyph = active ? colors.primaryFill : colors.foreground
  const round = shape === 'round'
  return (
    <Animated.View style={press.style} entering={pop ? popped.entering : undefined} exiting={pop ? popped.exiting : undefined}>
      <GlassSurface
        interactive={!disabled}
        dense={dense}
        radius={round ? size / 2 : undefined}
        tint={active ? (tint ?? withAlpha(colors.primary, 0.3)) : undefined}
        style={[round ? { width: size, height: size } : style, disabled ? styles.disabled : null]}
      >
        <Pressable
          testID={testID}
          onPress={() => {
            if (haptic) hapticTap()
            onPress?.()
          }}
          onPressIn={press.onPressIn}
          onPressOut={press.onPressOut}
          disabled={disabled}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ selected: active, disabled }}
          style={round ? [styles.center, { width: size, height: size }] : [styles.center, contentStyle]}
        >
          {children ?? (Icon ? <Icon size={Math.round(size * 0.5)} color={glyph} /> : null)}
        </Pressable>
      </GlassSurface>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
})
