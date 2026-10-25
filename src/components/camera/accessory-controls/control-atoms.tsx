/**
 * Shared compact primitives for accessory inline controls — a small pill button
 * and an icon-only round button. Both honour a disabled state (offline row or
 * in-flight mutation) and use camstack theme tokens.
 */
import React, { useEffect, useState } from 'react'
// ui-check-ok: compact option menu over the accessory row; SheetModal is a layout change (pre-existing)
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import { ChevronDown, ChevronUp, type LucideIcon } from '../../../lib/icons.js'
import { hapticAction, hapticTap } from '../../../lib/haptics.js'
import { MOTION_EASE } from '../../../theme/motion.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING, withAlpha } from '../../../theme/tokens.js'

/** `Pressable` that accepts an animated style — RN does not export one. */
const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

/**
 * How heavy an accessory press should feel.
 *
 * `tap` is the default and covers the reversible, repeatable majority — dimming,
 * fan speed, media transport, picking a mode. `action` is for the ones with a
 * consequence in the physical world that you would not want to trigger by
 * accident: a SIREN, a LOCK, ARM/DISARM. Feeling the difference is the point —
 * an operator reaching for the light should not get the same answer as an
 * operator reaching for the siren.
 */
export type ControlHaptic = 'tap' | 'action'

/** Play the press feedback for a control weight. The ONE place the accessory
 *  atoms decide this, so all ~26 call sites stay consistent by construction. */
function fireControlHaptic(weight: ControlHaptic): void {
  if (weight === 'action') hapticAction()
  else hapticTap()
}

export interface PillButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly disabled?: boolean
  /** Render as the active/primary state (filled). */
  readonly active?: boolean
  readonly icon?: LucideIcon
  /** See {@link ControlHaptic}. Defaults to `tap`. */
  readonly haptic?: ControlHaptic
}

/** A small labelled action pill. Filled when `active`, outlined otherwise. */
export function PillButton({ label, onPress, disabled, active, icon: Icon, haptic = 'tap' }: PillButtonProps) {
  const { colors } = useTheme()
  const bg = active ? colors.primary : colors.backgroundElevated
  const fg = active ? colors.primaryForeground : colors.foreground
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => { fireControlHaptic(haptic); onPress() }}
      disabled={disabled}
      style={[
        styles.pill,
        { backgroundColor: bg, borderColor: colors.border, opacity: disabled ? 0.45 : 1 },
      ]}
    >
      {Icon ? <Icon size={14} color={fg} /> : null}
      <Text style={[styles.pillLabel, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}


export interface OptionPickerOption {
  readonly value: string
  readonly label: string
}

export interface OptionPickerProps {
  readonly label: string
  readonly options: readonly OptionPickerOption[]
  readonly selected: string | null
  readonly onSelect: (value: string) => void
  readonly disabled?: boolean
  readonly icon?: LucideIcon
}

/**
 * Small pill that opens a modal list of options. Mirrors the web viewer's select
 * affordance, but stays compact in the accessory row.
 */
export function OptionPicker({
  label,
  options,
  selected,
  onSelect,
  disabled,
  icon: Icon,
}: OptionPickerProps) {
  const { colors } = useTheme()
  const [open, setOpen] = useState(false)
  const active = selected !== null && selected !== ''
  const selectedLabel = active ? options.find((option) => option.value === selected)?.label ?? selected : label

  return (
    <>
      <PillButton
        label={selectedLabel}
        icon={Icon}
        active={active}
        disabled={disabled || options.length === 0}
        onPress={() => setOpen(true)}
      />
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          style={[styles.backdrop, { backgroundColor: withAlpha(colors.background, 0.45) }]}
          onPress={() => setOpen(false)}
        >
          <View style={[styles.menu, { backgroundColor: colors.backgroundElevated, borderColor: colors.border }]}>
            <Text style={[styles.menuTitle, { color: colors.foregroundMuted }]}>{label}</Text>
            {options.map((option) => (
              <Pressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: option.value === selected }}
                onPress={() => {
                  hapticTap()
                  setOpen(false)
                  if (option.value !== selected) onSelect(option.value)
                }}
                style={[
                  styles.option,
                  option.value === selected ? { backgroundColor: colors.primary } : null,
                ]}
              >
                <Text
                  style={[
                    styles.optionLabel,
                    { color: option.value === selected ? colors.primaryForeground : colors.foreground },
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

export interface IconButtonProps {
  readonly icon: LucideIcon
  readonly label: string
  readonly onPress: () => void
  readonly disabled?: boolean
  readonly active?: boolean
  /** See {@link ControlHaptic}. Defaults to `tap`. */
  readonly haptic?: ControlHaptic
  /**
   * The thing this button asked for is HAPPENING — pulse until it stops.
   *
   * A cover takes ten to twenty seconds to travel, and until the move ends the
   * only evidence the command landed is this button. Without it the operator
   * presses "down" on a shutter that IS closing and reads "no effect" —
   * measured on the Hall shutter, 2026-09-24.
   *
   * It is a pulse and not a spinner because the button is 32pt and already
   * carries the direction; swapping the glyph for a spinner would lose which
   * way it is going, which is the one thing worth saying.
   */
  readonly pulsing?: boolean
}

/** Full at rest, dimmed at the trough — visible without being a strobe. */
const PULSE_MIN_OPACITY = 0.35
const PULSE_HALF_CYCLE_MS = 550

/** A round icon-only action button. */
export function IconButton({
  icon: Icon,
  label,
  onPress,
  disabled,
  active,
  pulsing,
  haptic = 'tap',
}: IconButtonProps) {
  const { colors } = useTheme()
  const bg = active ? colors.primary : colors.backgroundElevated
  const fg = active ? colors.primaryForeground : colors.foreground
  const pulse = useSharedValue<number>(1)
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.get() }))

  useEffect(() => {
    if (pulsing !== true) {
      cancelAnimation(pulse)
      pulse.set(1)
      return
    }
    pulse.set(
      withRepeat(
        withSequence(
          withTiming(PULSE_MIN_OPACITY, { duration: PULSE_HALF_CYCLE_MS, easing: MOTION_EASE }),
          withTiming(1, { duration: PULSE_HALF_CYCLE_MS, easing: MOTION_EASE }),
        ),
        -1,
        false,
      ),
    )
    // Stopped AND reset: a loop left at its trough would leave the button
    // permanently half-lit once the move ends.
    return () => {
      cancelAnimation(pulse)
      pulse.set(1)
    }
  }, [pulsing, pulse])

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => { fireControlHaptic(haptic); onPress() }}
      disabled={disabled}
      style={[
        styles.icon,
        { backgroundColor: bg, borderColor: colors.border },
        // A disabled button is dimmed outright; a pulsing one is animated. The
        // two never multiply — a pulse inside a 0.45 opacity is invisible.
        disabled === true ? { opacity: 0.45 } : pulseStyle,
      ]}
    >
      <Icon size={16} color={fg} />
    </AnimatedPressable>
  )
}

export interface StepperArrowsProps {
  readonly upLabel: string
  readonly downLabel: string
  readonly onUp: () => void
  readonly onDown: () => void
  readonly disabled?: boolean
}

/**
 * A compact VERTICAL ▲/▼ pair in one capsule. Two round `IconButton`s side by
 * side cost ~72pt of a row that also has to fit a name, a mode dropdown and a
 * readout; stacked they cost 30pt and stay inside the 36pt row height the
 * devices panel already sets with its type-icon tile.
 */
export function StepperArrows({ upLabel, downLabel, onUp, onDown, disabled }: StepperArrowsProps) {
  const { colors } = useTheme()
  return (
    <View
      style={[
        styles.stepper,
        { backgroundColor: colors.backgroundElevated, borderColor: colors.border, opacity: disabled ? 0.45 : 1 },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={upLabel}
        onPress={() => { hapticTap(); onUp() }}
        disabled={disabled}
        style={styles.stepperHalf}
      >
        <ChevronUp size={14} color={colors.foreground} />
      </Pressable>
      <View style={[styles.stepperDivider, { backgroundColor: colors.border }]} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={downLabel}
        onPress={() => { hapticTap(); onDown() }}
        disabled={disabled}
        style={styles.stepperHalf}
      >
        <ChevronDown size={14} color={colors.foreground} />
      </Pressable>
    </View>
  )
}

/** Small inline spinner used while a control's status is first loading. */
export function ControlSpinner() {
  const { colors } = useTheme()
  return (
    <View style={styles.spinner}>
      <ActivityIndicator size="small" color={colors.foregroundSubtle} />
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pillLabel: { fontSize: 12, fontWeight: '600' },
  icon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  stepper: {
    width: 30,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  stepperHalf: { alignItems: 'center', height: 18, justifyContent: 'center' },
  stepperDivider: { height: StyleSheet.hairlineWidth, width: '100%' },
  spinner: { paddingHorizontal: SPACING.sm },
  backdrop: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  menu: {
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 360,
    padding: SPACING.sm,
    width: '100%',
  },
  menuTitle: {
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  option: { borderRadius: RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.md },
  optionLabel: { fontSize: 14, fontWeight: '600' },
})
