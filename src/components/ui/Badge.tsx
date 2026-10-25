/**
 * Badge — a compact status chip. `fill` (default) is an opaque background with
 * AA text, so it stays legible over a photo; `outline` is a bordered, dashed-able
 * hint for provisional states; `tint` is the soft wash of the older pills.
 *
 * Colours come from `useTheme().colors` (`*Fill` / `*On`); the label is already
 * translated by the caller. An optional leading icon keeps meaning off colour alone.
 */
import React, { memo, type ReactNode } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS, TYPOGRAPHY } from '../../theme/tokens.js'
import { badgeColors, type BadgeLook, type BadgeTone } from './badge-colors.js'

export type BadgeSize = 'sm' | 'md'

export interface BadgeProps {
  readonly label: string
  readonly tone?: BadgeTone
  readonly look?: BadgeLook
  readonly size?: BadgeSize
  /** A leading glyph; receives the text colour and the icon size to draw with. */
  readonly renderIcon?: (color: string, size: number) => ReactNode
  /** Dashed border (outline only) — "approximate" / provisional. */
  readonly dashed?: boolean
}

const ICON_SIZE: Readonly<Record<BadgeSize, number>> = { sm: 10, md: 12 }

export const Badge = memo(function Badge({
  label,
  tone = 'neutral',
  look = 'fill',
  size = 'md',
  renderIcon,
  dashed = false,
}: BadgeProps) {
  const { colors } = useTheme()
  const c = badgeColors(colors, tone, look)
  const small = size === 'sm'
  return (
    <View
      style={[
        styles.badge,
        small ? styles.small : styles.medium,
        {
          backgroundColor: c.background,
          borderColor: c.border,
          borderStyle: look === 'outline' && dashed ? 'dashed' : 'solid',
        },
      ]}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      {renderIcon ? renderIcon(c.text, ICON_SIZE[size]) : null}
      <Text
        style={[
          styles.text,
          { color: c.text, fontSize: small ? TYPOGRAPHY.size.xs - 1 : TYPOGRAPHY.size.xs },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  )
})

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: SPACING.sm,
    borderWidth: 1,
    borderRadius: RADIUS.sm,
  },
  small: { paddingHorizontal: SPACING.sm, paddingVertical: 1 },
  medium: { paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs },
  text: { fontWeight: TYPOGRAPHY.weight.bold },
})
