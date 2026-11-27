import React from 'react'
import { Pressable, Text } from 'react-native'
import { Square, CheckSquare } from '../../lib/icons.js'
import { hapticTap } from '../../lib/haptics.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'

interface CheckboxRowProps {
  readonly label: string
  readonly value: boolean
  readonly onValueChange: (value: boolean) => void
}

/** A compact checkbox + label row for an option nested under an activation row
 *  in a floating panel (a card-sized `ToggleRow` would not fit there). */
export function CheckboxRow({ label, value, onValueChange }: CheckboxRowProps): React.JSX.Element {
  const { colors } = useTheme()
  const Icon = value ? CheckSquare : Square
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => {
        hapticTap()
        onValueChange(!value)
      }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md, paddingVertical: SPACING.sm }}
    >
      <Icon size={18} color={value ? colors.primary : colors.foregroundMuted} />
      <Text style={{ flex: 1, color: colors.foreground, fontSize: 14, fontWeight: '500' }}>{label}</Text>
    </Pressable>
  )
}
