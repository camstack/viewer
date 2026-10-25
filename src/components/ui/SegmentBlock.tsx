/**
 * SegmentBlock — a labelled block wrapping a `SegmentedControl` inside a Section
 * card, for a settings sheet (the Cameras reel controls). An anchored menu uses
 * `DisplayMenu`, whose card title IS the label.
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../../theme/tokens.js'
import { SegmentedControl, type SegmentOption } from './SegmentedControl.js'

export interface SegmentBlockProps<T extends string> {
  readonly label: string
  readonly options: readonly SegmentOption<T>[]
  readonly value: T
  readonly onChange: (value: T) => void
}

export function SegmentBlock<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentBlockProps<T>) {
  const { colors } = useTheme()
  return (
    <View style={styles.segmentBlock}>
      <Text
        numberOfLines={2}
        style={[styles.segmentLabel, { color: colors.foreground }]}
      >
        {label}
      </Text>
      <SegmentedControl<T> options={options} value={value} onChange={onChange} />
    </View>
  )
}

const styles = StyleSheet.create({
  segmentBlock: { paddingHorizontal: SPACING.xl, paddingVertical: SPACING.lg, gap: SPACING.md },
  segmentLabel: { fontSize: 15, fontWeight: TYPOGRAPHY.weight.regular },
})
