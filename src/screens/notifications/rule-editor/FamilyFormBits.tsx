/**
 * FamilyFormBits — the two small pieces the timelapse and digest editors
 * share: a labelled control outside a settings row, and a refused-save reason
 * shown beside its field.
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING } from '../../../theme/tokens.js'
import { Hint } from '../../../components/notifications/FieldHint.js'

export interface LabeledControlProps {
  readonly label: string
  readonly hint?: string
  readonly children: React.ReactNode
}

/** A labelled control outside a settings row — label, the control, its hint. */
export function LabeledControl({ label, hint, children }: LabeledControlProps) {
  const { colors } = useTheme()
  return (
    <View style={{ gap: SPACING.sm }}>
      <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      {children}
      {hint !== undefined ? <Hint text={hint} /> : null}
    </View>
  )
}

export interface ProblemProps {
  readonly text: string
}

/** One refused-save reason, in the operator's language, beside its field. */
export function Problem({ text }: ProblemProps) {
  const { colors } = useTheme()
  return (
    <Text style={{ color: colors.danger, fontSize: 12, paddingHorizontal: SPACING.xs }}>{text}</Text>
  )
}
