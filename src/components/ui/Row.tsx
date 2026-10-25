import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { ChevronRight, type LucideIcon } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'

interface RowProps {
  /** Primary label on the left. */
  readonly label: string
  /** Optional secondary value shown on the right (muted). Ignored when `right` is set. */
  readonly value?: string
  /** Optional leading lucide icon component. */
  readonly icon?: LucideIcon
  /** When set, the row is pressable and renders a trailing chevron. */
  readonly onPress?: () => void
  /** Render the label (and icon) in the danger color. */
  readonly danger?: boolean
  /** Custom trailing content; takes precedence over `value`/chevron. */
  readonly right?: React.ReactNode
  /** Hide the bottom hairline (e.g. for the last row in a card). */
  readonly last?: boolean
}

/** A single settings row inside a `Section` card: leading icon + label on the
 *  left, an optional muted value / custom right slot, and a chevron when the row
 *  is pressable. Themed; draws a bottom hairline unless `last`. */
export function Row({ label, value, icon: Icon, onPress, danger = false, right, last = false }: RowProps) {
  const { colors } = useTheme()
  const labelColor = danger ? colors.danger : colors.foreground
  const iconColor = danger ? colors.danger : colors.foregroundMuted
  const pressable = typeof onPress === 'function'

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.lg,
        paddingHorizontal: SPACING.xl,
        paddingVertical: SPACING.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.borderSubtle,
      }}
    >
      {Icon ? <Icon size={18} color={iconColor} /> : null}
      <Text style={{ flex: 1, color: labelColor, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
        {label}
      </Text>
      {right ??
        (value ? (
          <Text
            style={{ color: colors.foregroundMuted, fontSize: 14, maxWidth: '55%' }}
            numberOfLines={1}
          >
            {value}
          </Text>
        ) : null)}
      {pressable && !right ? <ChevronRight size={18} color={colors.foregroundSubtle} /> : null}
    </View>
  )

  if (!pressable) return content

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      android_ripple={{ color: colors.surfaceHover }}
      style={({ pressed }) => ({ backgroundColor: pressed ? colors.surfaceHover : 'transparent' })}
    >
      {content}
    </Pressable>
  )
}
