/** The muted explanatory line under a control, inside a rule-editor `Section`. */
import React from 'react'
import { Text } from 'react-native'
import { useTheme } from '../../../../theme/theme-provider.js'
import { SPACING } from '../../../../theme/tokens.js'

interface HintProps {
  readonly text: string
  readonly last?: boolean
}

/** The muted explanatory line under a control, inside its `Section`. */
export function Hint({ text, last = false }: HintProps) {
  const { colors } = useTheme()
  return (
    <Text
      style={{
        color: colors.foregroundSubtle,
        fontSize: 12,
        lineHeight: 17,
        paddingHorizontal: SPACING.xl,
        paddingTop: SPACING.xs,
        paddingBottom: last ? SPACING.lg : SPACING.md,
      }}
    >
      {text}
    </Text>
  )
}
