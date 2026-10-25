/**
 * ColorPickerRow — a settings row that picks one color from a fixed preset
 * palette (no heavy color-picker dependency). The active swatch is ringed.
 */
import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Check, type LucideIcon } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'

/** Preset palette offered for highlight colors. */
export const COLOR_PRESETS: readonly string[] = [
  '#DC2626', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#FFFFFF',
]

export function ColorPickerRow({
  icon: Icon,
  label,
  value,
  onChange,
}: {
  readonly icon?: LucideIcon
  readonly label: string
  readonly value: string
  readonly onChange: (color: string) => void
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.row}>
      <View style={styles.labelRow}>
        {Icon ? <Icon size={18} color={colors.foregroundMuted} /> : null}
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      </View>
      <View style={styles.swatches}>
        {COLOR_PRESETS.map((c) => {
          const active = c.toLowerCase() === value.toLowerCase()
          return (
            <Pressable
              key={c}
              onPress={() => onChange(c)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: c,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                borderColor: active ? colors.foreground : colors.border,
              }}
            >
              {active ? <Check size={14} color={c.toLowerCase() === '#ffffff' ? '#000' : '#fff'} /> : null}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    // Match the standard Section rows (Row/ToggleRow/StepperRow/SelectRow) so the
    // label + swatches line up with the rest of the settings UI instead of
    // sitting flush against the card edge ("out of padding").
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.lg,
    gap: SPACING.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
  },
  label: { fontSize: 14, fontWeight: '500' },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    borderRadius: RADIUS.md,
  },
})
