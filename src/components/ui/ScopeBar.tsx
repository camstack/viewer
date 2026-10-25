/**
 * The tab-level segment selector: a `SegmentedControl` on the menus' glass
 * (operator, 2026-10-22), in a hairline-bordered bar that carries the top
 * safe-area inset itself.
 *
 * One component for every tab split into sections (Library, Settings, the
 * Notification Center), so they read as the same control rather than
 * look-alikes that drift. The bar
 * owns the inset because the screens under it render no app bar of their own.
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../../theme/theme-provider.js'
import { SCREEN_GUTTER, SPACING } from '../../theme/tokens.js'
import { SegmentedControl, type SegmentOption } from './SegmentedControl.js'

export interface ScopeBarProps<T extends string> {
  readonly options: readonly SegmentOption<T>[]
  readonly value: T
  readonly onChange: (value: T) => void
  /**
   * Carry the top safe-area inset (default). `false` for a bar placed under a
   * `ScreenHeader`, which already clears the notch — a stacked alias of a tab
   * (the Notification Center at `/settings/notifications`) keeps its back
   * button and the same selector.
   */
  readonly safeArea?: boolean
}

export function ScopeBar<T extends string>({ options, value, onChange, safeArea = true }: ScopeBarProps<T>) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View
      style={[styles.bar, { paddingTop: (safeArea ? insets.top : 0) + SPACING.sm, borderBottomColor: colors.border }]}
    >
      <SegmentedControl options={options} value={value} onChange={onChange} variant="glass" />
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: SCREEN_GUTTER,
    paddingBottom: SPACING.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
})
