/**
 * MediaBadge — a small label drawn ON a picture: the theme's media scrim
 * (`mediaScrim`) with `foreground` text, an optional leading icon, and — when
 * it is a switch — `active` fills it with the accent. The track detail's kind ·
 * resolution caption and its Full-resolution switch are two of these; each
 * used to paint its own black-and-white overlay that ignored the theme.
 *
 * Position it with `style` (layout only: absolute corner, max width).
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import type { LucideIcon } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TABULAR, TYPOGRAPHY, mediaScrim } from '../../theme/tokens.js'

export interface MediaBadgeProps {
  readonly label: string
  readonly icon?: LucideIcon
  /** Makes it a button. */
  readonly onPress?: () => void
  /** A switch that is on: accent fill. */
  readonly active?: boolean
  readonly accessibilityLabel?: string
  /** Layout only. */
  readonly style?: StyleProp<ViewStyle>
  readonly testID?: string
}

/** Icon size (pt) inside the badge. */
const ICON_SIZE = 13

export function MediaBadge({
  label,
  icon: Icon,
  onPress,
  active = false,
  accessibilityLabel,
  style,
  testID,
}: MediaBadgeProps): React.JSX.Element {
  const { colors } = useTheme()
  const fill = active ? colors.primary : mediaScrim(colors)
  const ink = active ? colors.primaryForeground : colors.foreground
  const body = (
    <>
      {Icon !== undefined ? <Icon size={ICON_SIZE} color={ink} /> : null}
      <Text style={[styles.text, TABULAR, { color: ink }]} numberOfLines={1}>
        {label}
      </Text>
    </>
  )
  if (onPress === undefined) {
    return (
      <View style={[styles.badge, { backgroundColor: fill }, style]} pointerEvents="none" testID={testID}>
        {body}
      </View>
    )
  }
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: active }}
      style={[styles.badge, { backgroundColor: fill }, style]}
      testID={testID}
    >
      {body}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.sm,
  },
  text: { fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.bold, flexShrink: 1 },
})
