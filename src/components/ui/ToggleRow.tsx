import React from 'react'
import { Switch, Text, View } from 'react-native'
import { type LucideIcon } from '../../lib/icons.js'
import { hapticAction, hapticTap } from '../../lib/haptics.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../../theme/tokens.js'

interface ToggleRowProps {
  /** Primary label on the left. */
  readonly label: string
  /** Optional secondary description below the label (muted). */
  readonly description?: string
  /** Optional leading lucide icon component. */
  readonly icon?: LucideIcon
  /** Current on/off value. */
  readonly value: boolean
  /** Called with the next value when the switch is toggled. */
  readonly onValueChange: (value: boolean) => void
  /** Hide the bottom hairline (e.g. for the last row in a card). */
  readonly last?: boolean
  /** Render disabled (e.g. behind a feature gate). */
  readonly disabled?: boolean
  /**
   * How heavy the confirming vibration should be. `tap` (default) suits a
   * display preference; pass `action` for a switch that changes what the
   * SYSTEM does — arming, a per-camera function switch (D62), anything an
   * operator would want to feel they had just done.
   */
  readonly haptic?: 'tap' | 'action'
  /** Test id of the description line. */
  readonly descriptionTestID?: string
  /** Test id of the native switch itself. */
  readonly switchTestID?: string
  /** Accessible name of the switch, when the visible label alone does not say what it does. */
  readonly switchAccessibilityLabel?: string
  /** Extra lines under the label and description (a row that reads more than one fact). */
  readonly detail?: React.ReactNode
  /** Leading control beside the switch (a spinner while its write is in flight). */
  readonly accessory?: React.ReactNode
  /** Overrides the row's opacity (a switch that waits for another write); wins over `disabled`. */
  readonly opacity?: number
  /**
   * Menu type scale: the label at `TYPOGRAPHY.size.sm` — the Library filter
   * row's chips — with tighter padding, instead of the settings-screen 15 pt.
   * For a toggle inside an anchored menu (`DisplayMenu`, every Library eye).
   */
  readonly compact?: boolean
}

/** The label wraps to at most this many lines, then ellipsizes: a long
 *  translation (Italian runs ~25% longer) stays readable beside the switch
 *  instead of being cut after a few words. */
export const TOGGLE_ROW_LABEL_LINES = 2

/** A settings row with a native `Switch` on the right. Mirrors `Row`'s layout
 *  (icon + label, themed hairline) and supports an optional helper line. */
export function ToggleRow({
  label,
  description,
  icon: Icon,
  value,
  onValueChange,
  last = false,
  disabled = false,
  haptic = 'tap',
  descriptionTestID,
  switchTestID,
  switchAccessibilityLabel,
  detail,
  accessory,
  opacity,
  compact = false,
}: ToggleRowProps) {
  const { colors } = useTheme()
  const labelColor = disabled ? colors.foregroundDisabled : colors.foreground
  // Every switch in the app answers the touch from here — the single funnel is
  // why the whole settings surface feels the same, and why the user's Vibration
  // switch actually governs all of it.
  const onToggle = (next: boolean): void => {
    onValueChange(next)
    // Fired AFTER the change, not before: this row also renders the "Vibrate on
    // press" switch itself, and reading the setting post-change is what makes
    // that one honest — enabling it buzzes immediately, disabling it goes
    // silent at once instead of getting one last buzz it just forbade.
    if (haptic === 'action') hapticAction()
    else hapticTap()
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.lg,
        paddingHorizontal: compact ? SPACING.lg : SPACING.xl,
        paddingVertical: compact ? SPACING.sm : SPACING.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.borderSubtle,
        opacity: opacity ?? (disabled ? 0.6 : 1),
      }}
    >
      {Icon ? <Icon size={18} color={disabled ? colors.foregroundDisabled : colors.foregroundMuted} /> : null}
      <View style={{ flex: 1, flexShrink: 1, minWidth: 0, gap: 2 }}>
        <Text
          style={{
            color: labelColor,
            fontSize: compact ? TYPOGRAPHY.size.sm : 15,
            fontWeight: TYPOGRAPHY.weight.regular,
            flexShrink: 1,
          }}
          numberOfLines={TOGGLE_ROW_LABEL_LINES}
        >
          {label}
        </Text>
        {description ? (
          <Text testID={descriptionTestID} style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 16 }}>
            {description}
          </Text>
        ) : null}
        {detail}
      </View>
      {accessory}
      <Switch
        testID={switchTestID}
        accessibilityLabel={switchAccessibilityLabel}
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.backgroundElevated}
        ios_backgroundColor={colors.border}
      />
    </View>
  )
}
