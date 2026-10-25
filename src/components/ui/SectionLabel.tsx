/**
 * SectionLabel — THE small uppercase heading of the viewer: the title a
 * `Section` draws above its card, and the same words over content that is not
 * a card (a chip group in a rule editor, a list in a detail sheet, a block in
 * a menu). One look, so a label never drifts a point or a weight from the
 * next screen's (`Section` itself draws its title with it).
 *
 * `level`: `section` heads a group of rows or a card; `group` is the smaller
 * label of a sub-group INSIDE one (a family of checkboxes in a menu).
 * `value` is a short figure at the line's end (a count). `style` is layout
 * only (margins).
 */
import React from 'react'
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../../theme/tokens.js'

export type SectionLabelLevel = 'section' | 'group'

export interface SectionLabelProps {
  readonly children: string
  readonly value?: string
  readonly level?: SectionLabelLevel
  /** Indent by `SPACING.xs`, as a `Section` title sits over its card's edge. */
  readonly inset?: boolean
  readonly style?: StyleProp<ViewStyle>
  readonly testID?: string
}

export function SectionLabel({
  children,
  value,
  level = 'section',
  inset = false,
  style,
  testID,
}: SectionLabelProps): React.JSX.Element {
  const { colors } = useTheme()
  const text = [level === 'section' ? styles.section : styles.group, { color: colors.foregroundSubtle }]
  return (
    <View style={[styles.row, inset ? styles.inset : null, style]} testID={testID}>
      <Text style={[text, value !== undefined ? styles.label : null]}>
        {children}
      </Text>
      {value !== undefined ? <Text style={text}>{value}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  inset: { paddingHorizontal: SPACING.xs },
  label: { flex: 1 },
  section: {
    fontSize: TYPOGRAPHY.size.sm,
    fontWeight: TYPOGRAPHY.weight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  group: {
    fontSize: TYPOGRAPHY.size.xs,
    fontWeight: TYPOGRAPHY.weight.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
})
