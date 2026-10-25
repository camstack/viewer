/**
 * MenuRow — the ONE row of an anchored menu: icon, fixed gap, label
 * left-aligned, trailing slot, one height and padding. A destructive row
 * changes colour and nothing else.
 *
 * The layout lives on an inner `View`, never on the `Pressable`: a row can be
 * wrapped by a `TabTrigger asChild`, which re-styles its child, and a layout
 * set on the pressable was replaced there (the label jumped to the far right
 * on the Settings row only). The inner view cannot be touched by the wrapper.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import type { LucideIcon } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'

export interface MenuRowProps {
  readonly icon: LucideIcon
  readonly label: string
  readonly onPress: () => void
  /** Colours the row as destructive; the structure is unchanged. */
  readonly destructive?: boolean
  /** Right-hand adornment (a check mark). */
  readonly trailing?: React.ReactNode
  readonly selected?: boolean
  readonly testID?: string
}

export const MENU_ROW_ICON_SIZE = 18

export function MenuRow({ icon: Icon, label, onPress, destructive = false, trailing, selected, testID }: MenuRowProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="menuitem"
      accessibilityState={selected === undefined ? undefined : { selected }}
    >
      <View style={styles.row} testID={testID === undefined ? undefined : `${testID}-row`}>
        <Icon size={MENU_ROW_ICON_SIZE} color={destructive ? colors.danger : colors.foregroundMuted} />
        <Text numberOfLines={1} style={[styles.label, { color: destructive ? colors.danger : colors.foreground }]}>
          {label}
        </Text>
        {trailing}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: SPACING.lg,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.md,
  },
  label: { flex: 1, fontSize: 15, fontWeight: '500', textAlign: 'left' },
})
