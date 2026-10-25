/**
 * ChipMultiselect — a compact, wrapping row of CHECKABLE pills.
 *
 * The primitive for "N independent booleans", as distinct from `SegmentedControl`
 * (one value out of N) and `SelectRow` (one value, listed in the anchored dropdown). Reach for it whenever
 * the options are not mutually exclusive: a segmented control silently forbids
 * combinations, which is how the box overlay ended up unable to express
 * "stationary only".
 *
 * Generic over the value type so the caller keeps its union — no stringly-typed
 * callbacks. Purely presentational: selection lives with the caller.
 */
import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'

export interface ChipOption<T extends string> {
  readonly value: T
  readonly label: string
}

export interface ChipMultiselectProps<T extends string> {
  readonly options: readonly ChipOption<T>[]
  /** The CHECKED subset. Membership, not order — the caller owns the order. */
  readonly selected: readonly T[]
  /** Flip one value. The caller decides what "flip" means for its document. */
  readonly onToggle: (value: T) => void
  /** Drawn but not pressable (a control that cannot apply, shown with its reason). */
  readonly disabled?: boolean
}

export function ChipMultiselect<T extends string>({
  options,
  selected,
  onToggle,
  disabled = false,
}: ChipMultiselectProps<T>): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={styles.wrap}>
      {options.map((option) => {
        const active = selected.includes(option.value)
        return (
          <Pressable
            key={option.value}
            onPress={() => onToggle(option.value)}
            disabled={disabled}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active, disabled }}
            style={[
              styles.chip,
              {
                backgroundColor: active ? colors.primary : 'transparent',
                borderColor: active ? colors.primary : colors.border,
                opacity: disabled ? 0.4 : 1,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.label,
                { color: active ? colors.primaryForeground : colors.foreground },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, paddingVertical: SPACING.sm },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  label: { fontSize: 13, fontWeight: '600' },
})
