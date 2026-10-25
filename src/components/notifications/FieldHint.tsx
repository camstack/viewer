/** The muted explanatory line under a condition control. */
import React from 'react'
import { Text } from 'react-native'
import { useTheme } from '../../theme/theme-provider.js'

export function Hint({ text }: { readonly text: string }) {
  const { colors } = useTheme()
  return <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 16 }}>{text}</Text>
}
