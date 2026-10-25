/**
 * AnchoredDropdown — THE select menu for the viewer.
 *
 * A compact card attached to the control that opened it (the occupancy
 * picker), not a full-screen bottom sheet and not a Modal centered on the
 * window. `SelectRow` and `OverlayPositionPicker` both render through this
 * so every selector in the app is the same component.
 *
 * Chrome lives in {@link AnchoredMenu}; this file is the single-value list.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { Check } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { AnchoredMenu } from './AnchoredMenu.js'
import type { AnchorRect, DropdownAlign, DropdownPlacement } from './dropdown-placement.js'

export interface AnchoredDropdownOption<T extends string | number> {
  readonly value: T
  readonly label: string
  readonly detail?: string
}

export interface AnchoredDropdownProps<T extends string | number> {
  readonly visible: boolean
  readonly onRequestClose: () => void
  readonly anchor: AnchorRect | null
  readonly options: readonly AnchoredDropdownOption<T>[]
  readonly value: T
  readonly onChange: (value: T) => void
  readonly align?: DropdownAlign
  readonly minWidth?: number
  /** Force above/below when the caller already knows (footer chip → above). */
  readonly preferredPlacement?: DropdownPlacement
}

const ROW_HEIGHT = 40
const DETAIL_EXTRA = 18

export function AnchoredDropdown<T extends string | number>({
  visible,
  onRequestClose,
  anchor,
  options,
  value,
  onChange,
  align = 'end',
  minWidth = 200,
  preferredPlacement,
}: AnchoredDropdownProps<T>): React.JSX.Element | null {
  const { colors } = useTheme()
  const estimatedHeight = options.reduce(
    (sum, o) => sum + ROW_HEIGHT + (o.detail ? DETAIL_EXTRA : 0),
    8,
  )

  return (
    <AnchoredMenu
      visible={visible}
      onRequestClose={onRequestClose}
      anchor={anchor}
      align={align}
      minWidth={minWidth}
      estimatedHeight={estimatedHeight}
      preferredPlacement={preferredPlacement}
    >
      <View accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value
          return (
            <Pressable
              key={String(option.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => {
                onChange(option.value)
                onRequestClose()
              }}
              style={({ pressed }) => [
                styles.row,
                { backgroundColor: pressed ? colors.surfaceHover : 'transparent' },
              ]}
            >
              <View style={styles.rowText}>
                <Text
                  style={{
                    color: selected ? colors.primary : colors.foreground,
                    fontSize: 14,
                    fontWeight: selected ? '600' : '500',
                  }}
                >
                  {option.label}
                </Text>
                {option.detail ? (
                  <Text style={{ color: colors.foregroundMuted, fontSize: 12 }} numberOfLines={2}>
                    {option.detail}
                  </Text>
                ) : null}
              </View>
              {selected ? <Check size={16} color={colors.primary} /> : null}
            </Pressable>
          )
        })}
      </View>
    </AnchoredMenu>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  rowText: { flex: 1, gap: 2 },
})
