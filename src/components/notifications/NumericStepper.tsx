/**
 * NumericStepper — the −/+ numeric control the condition widgets share.
 *
 * Extracted from `ConditionField` so `OccupancyField` can use the same control
 * without importing the dispatcher that renders it (which would be a cycle),
 * and so `ConditionField` stops growing.
 */
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'

interface NumericStepperProps {
  readonly value: number | undefined
  readonly min: number
  readonly max?: number
  readonly step: number
  readonly decimals: number
  readonly onChange: (next: number | undefined) => void
  /** Offer the clear affordance (`undefined` = unset). Off where the field is
   *  part of a composite value that is cleared as a whole. */
  readonly clearable?: boolean
  /**
   * Where the first press lands when the value is UNSET — for a field whose
   * absence means a derived value, so pinning it starts from what it was
   * already doing rather than from the floor. Absent: `min`, then one step.
   */
  readonly start?: number
}

/** A -/+ numeric field with a clear affordance. `undefined` = unset (any). */
export function NumericStepper({
  value,
  min,
  max,
  step,
  decimals,
  onChange,
  clearable = true,
  start,
}: NumericStepperProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const current = value ?? min
  const round = (n: number): number => Number(n.toFixed(decimals + 2))
  const clamp = (n: number): number => {
    const lo = Math.max(min, n)
    return max !== undefined ? Math.min(max, lo) : lo
  }
  const dec = (): void => onChange(clamp(round(current - step)))
  const inc = (): void =>
    onChange(clamp(round(value === undefined && start !== undefined ? start : current + step)))

  const button = (label: string, onPress: () => void, disabled: boolean): React.ReactNode => (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        width: 38,
        height: 38,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: RADIUS.md,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  )

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
      {button('−', dec, value === undefined || current <= min)}
      <Text style={{ minWidth: 56, textAlign: 'center', color: colors.foreground, fontSize: 16, fontWeight: '600' }}>
        {value === undefined ? '—' : value.toFixed(decimals)}
      </Text>
      {button('+', inc, max !== undefined && current >= max)}
      <View style={{ flex: 1 }} />
      {clearable && value !== undefined ? (
        <Pressable accessibilityRole="button" onPress={() => onChange(undefined)} hitSlop={6}>
          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>
            {t('v2.nc.rules.editor.clear')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}
