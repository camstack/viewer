/**
 * ActivationRow — THE row of the overlay panel (planning#749).
 *
 * One structure for everything the operator can switch on over the picture: an
 * overlay (audio level, occupancy, stats, viewers, doorbell, device info,
 * camera name, motion badge, zones, the control groups) AND a highlight-border
 * trigger (motion, audio, detection). The activation row sits on top; while it
 * is ON, only that element's own settings render beneath it, inset. A host
 * never lays out its own switch + detail pair, so the panel cannot grow a
 * second row shape again.
 *
 * `alwaysOn` is for what cannot be switched off (the two control groups): no
 * switch, the settings are simply shown.
 */
import React from 'react'
import { View, Text, Switch, StyleSheet } from 'react-native' // ui-check-ok: compact panel switch — ToggleRow's card paddings do not fit a popover
import { type LucideIcon } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { CONTROL, ICON, SPACING, TYPOGRAPHY } from '../../theme/tokens.js'

/** Compact icon + label + switch row used inside floating panels/dialogs.
 *  (Distinct from `ui/ToggleRow`, whose card paddings/hairline don't fit a
 *  popover.) Shared by `CameraMenuPanel`, `GridShareDialog` and
 *  {@link ActivationRow}. */
export function PanelToggleRow({
  icon: Icon,
  label,
  value,
  onValueChange,
}: {
  readonly icon: LucideIcon
  readonly label: string
  readonly value: boolean
  readonly onValueChange: () => void
}): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <View style={styles.row}>
      <Icon size={ICON.md} color={value ? colors.primary : colors.foregroundMuted} />
      <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor="#ffffff" /* ui-check-ok: native switch thumb is white in both themes */
      />
    </View>
  )
}

export interface ActivationRowProps {
  readonly icon: LucideIcon
  readonly label: string
  /** Is the element active? Its settings render only while true. */
  readonly on: boolean
  readonly onToggle: () => void
  /** No switch — the element is always active (the control groups). */
  readonly alwaysOn?: boolean
  /** The element's own settings, shown beneath the row while it is on. */
  readonly children?: React.ReactNode
}

export function ActivationRow({
  icon,
  label,
  on,
  onToggle,
  alwaysOn = false,
  children,
}: ActivationRowProps): React.JSX.Element {
  const { colors } = useTheme()
  const active = alwaysOn || on
  const Icon = icon
  return (
    <View>
      {alwaysOn ? (
        <View style={styles.row}>
          <Icon size={ICON.md} color={colors.primary} />
          <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        </View>
      ) : (
        <PanelToggleRow icon={icon} label={label} value={on} onValueChange={onToggle} />
      )}
      {active && children !== undefined && children !== null ? (
        <View style={styles.settings}>{children}</View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    minHeight: CONTROL.lg,
  },
  label: { flex: 1, fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.regular },
  settings: { paddingLeft: SPACING.xl + SPACING.sm },
})
