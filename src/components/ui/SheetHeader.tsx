/**
 * SheetHeader — THE top row of a sheet: the title, the sheet's own icon
 * actions, and the close button (an `X` on a `surface` square). Every detail
 * and picker sheet drew this row by hand — ten copies of one 32 pt button and a
 * title that was 16 pt on one sheet and 18 on the next.
 *
 * `actions` sit between the title and the close button; use
 * {@link SheetIconButton} for them so they match it.
 */
import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { X, type LucideIcon } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../theme/tokens.js'

/** Side (pt) of a sheet header's icon button. */
export const SHEET_ICON_BUTTON_SIZE = 32

export interface SheetIconButtonProps {
  readonly icon: LucideIcon
  /** Accessible name — the action. */
  readonly label: string
  readonly onPress: () => void
  readonly tone?: 'neutral' | 'danger'
  readonly disabled?: boolean
  readonly testID?: string
}

export function SheetIconButton({
  icon: Icon,
  label,
  onPress,
  tone = 'neutral',
  disabled = false,
  testID,
}: SheetIconButtonProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      testID={testID}
      style={[styles.iconBtn, { backgroundColor: colors.surface }, disabled ? styles.disabled : null]}
    >
      <Icon size={tone === 'danger' ? 16 : 18} color={tone === 'danger' ? colors.danger : colors.foreground} />
    </Pressable>
  )
}

export interface SheetHeaderProps {
  readonly title: string
  /** A glyph before the title (the analyze sheet's sparkle). */
  readonly icon?: LucideIcon
  /** Icon actions before the close button. */
  readonly actions?: React.ReactNode
  /** Absent ⇒ no close button (the sheet closes another way). */
  readonly onClose?: () => void
  /** Defaults to "Close". */
  readonly closeLabel?: string
  readonly testID?: string
}

export function SheetHeader({
  title,
  icon: Icon,
  actions,
  onClose,
  closeLabel,
  testID,
}: SheetHeaderProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View style={styles.header} testID={testID}>
      {Icon !== undefined ? <Icon size={16} color={colors.primary} /> : null}
      <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
        {title}
      </Text>
      {actions}
      {onClose !== undefined ? (
        <SheetIconButton icon={X} label={closeLabel ?? t('v2.common.close')} onPress={onClose} />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingBottom: SPACING.sm },
  title: { flex: 1, fontSize: TYPOGRAPHY.size.lg, fontWeight: TYPOGRAPHY.weight.bold },
  iconBtn: {
    width: SHEET_ICON_BUTTON_SIZE,
    height: SHEET_ICON_BUTTON_SIZE,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
})
