import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Minus, Plus, type LucideIcon } from '../../lib/icons.js'
import { hapticTap } from '../../lib/haptics.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'

interface StepperRowProps {
  /** Primary label on the left. */
  readonly label: string
  /** Optional leading lucide icon component. */
  readonly icon?: LucideIcon
  /** Current value (already validated/clamped by the caller's store). */
  readonly value: number
  /** Minimum allowed value (decrement disabled at the floor). */
  readonly min: number
  /** Maximum allowed value (increment disabled at the ceiling). */
  readonly max: number
  /** Step applied per press. Defaults to 1. */
  readonly step?: number
  /** Called with the next (clamped) value. */
  readonly onChange: (value: number) => void
  /** Hide the bottom hairline (e.g. for the last row in a card). */
  readonly last?: boolean
}

/** A settings row with a -/+ stepper for an integer value, clamped to [min,max].
 *  The store re-clamps on write, so this only governs button enablement + UX. */
export function StepperRow({
  label,
  icon: Icon,
  value,
  min,
  max,
  step = 1,
  onChange,
  last = false,
}: StepperRowProps) {
  const { colors } = useTheme()
  const canDec = value > min
  const canInc = value < max

  const button = (enabled: boolean, ButtonIcon: LucideIcon, onPress: () => void): React.ReactNode => (
    <Pressable
      accessibilityRole="button"
      disabled={!enabled}
      onPress={() => { hapticTap(); onPress() }}
      style={{
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: RADIUS.md,
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.border,
        opacity: enabled ? 1 : 0.4,
      }}
    >
      <ButtonIcon size={16} color={colors.foreground} />
    </Pressable>
  )

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.lg,
        paddingHorizontal: SPACING.xl,
        paddingVertical: SPACING.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.borderSubtle,
      }}
    >
      {Icon ? <Icon size={18} color={colors.foregroundMuted} /> : null}
      <Text style={{ flex: 1, color: colors.foreground, fontSize: 15, fontWeight: '500' }} numberOfLines={1}>
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        {button(canDec, Minus, () => onChange(Math.max(min, value - step)))}
        <Text
          style={{
            minWidth: 28,
            textAlign: 'center',
            color: colors.foreground,
            fontSize: 16,
            fontWeight: '600',
          }}
        >
          {value}
        </Text>
        {button(canInc, Plus, () => onChange(Math.min(max, value + step)))}
      </View>
    </View>
  )
}
