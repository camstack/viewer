/**
 * RuleTestCard — the frame both rule tests sit in: a title, a hint, one
 * button, and whatever the test answered. Kept in one place so the dry-run and
 * Test now read as the same kind of control on two screens.
 */
import React from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'

export interface RuleTestCardProps {
  readonly title: string
  readonly hint: string
  readonly buttonLabel: string
  readonly busy: boolean
  readonly disabled: boolean
  readonly onPress: () => void
  readonly children?: React.ReactNode
}

export function RuleTestCard({ title, hint, buttonLabel, busy, disabled, onPress, children }: RuleTestCardProps) {
  const { colors } = useTheme()
  const inert = busy || disabled
  return (
    <View
      style={{
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.md,
        gap: SPACING.sm,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 15, fontWeight: '600' }}>{title}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: inert, busy }}
          disabled={inert}
          onPress={onPress}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACING.sm,
            paddingHorizontal: SPACING.lg,
            paddingVertical: SPACING.sm,
            borderRadius: RADIUS.md,
            borderWidth: 1,
            borderColor: colors.border,
            opacity: inert ? 0.5 : 1,
          }}
        >
          {busy ? <ActivityIndicator size="small" color={colors.foreground} /> : null}
          <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: '600' }}>{buttonLabel}</Text>
        </Pressable>
      </View>
      <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 17 }}>{hint}</Text>
      {children}
    </View>
  )
}
