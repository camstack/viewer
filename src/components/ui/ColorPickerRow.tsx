/**
 * ColorPickerRow — a settings row that picks one color from a fixed preset
 * palette (no heavy color-picker dependency). The active swatch is ringed.
 */
import React from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { Check, type LucideIcon } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS, CONTROL, ICON, TYPOGRAPHY, controlHitSlop } from '../../theme/tokens.js'

/** Preset palette offered for highlight colors. */
export const COLOR_PRESETS: readonly string[] = [
  '#DC2626', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#FFFFFF', // ui-check-ok: stored highlight colour values (user data), not theme colours
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
        {Icon ? <Icon size={ICON.md} color={colors.foregroundMuted} /> : null}
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      </View>
      <View style={styles.swatches}>
        {COLOR_PRESETS.map((c) => {
          const active = c.toLowerCase() === value.toLowerCase()
          return (
            <Pressable
              key={c}
              onPress={() => onChange(c)}
              hitSlop={controlHitSlop(CONTROL.md)}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              style={{
                width: CONTROL.md,
                height: CONTROL.md,
                borderRadius: CONTROL.md / 2,
                backgroundColor: c,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                borderColor: active ? colors.foreground : colors.border,
              }}
            >
              {active ? <Check size={ICON.sm} color={c.toLowerCase() === '#ffffff' ? '#000' : '#fff'} /* ui-check-ok: contrast tick on a data swatch, independent of theme */ /> : null}
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
  label: { fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.regular },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.md,
    borderRadius: RADIUS.md,
  },
})
