/**
 * Button / ConfirmFooter — THE text button of the viewer and the Cancel +
 * primary pair that closes an editor or a form.
 *
 * `Button` was the sign-in forms' `PanelButton`; the rule, summary, timelapse
 * and alarm editors each drew their own copy of the same Cancel / Save pair
 * with the same paddings. One component now: `kind` primary (accent fill),
 * secondary (outlined) or danger (danger fill); `size` md for a form inside a
 * card, lg for the footer of a page-long editor; `busy` shows a spinner beside
 * the label and refuses a second press.
 */
import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../theme/tokens.js'

/** Label size (pt): between the body's `md` and the title's `lg`, as every button already was. */
const BUTTON_FONT_SIZE = 15

export type ButtonKind = 'primary' | 'secondary' | 'danger'
export type ButtonSize = 'md' | 'lg'

export interface ButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly kind?: ButtonKind
  readonly size?: ButtonSize
  readonly disabled?: boolean
  /** In flight: a spinner beside the label, and no second press. */
  readonly busy?: boolean
  /** Share a row equally with its siblings. */
  readonly grow?: boolean
  readonly testID?: string
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  size = 'md',
  disabled = false,
  busy = false,
  grow = false,
  testID,
}: ButtonProps): React.JSX.Element {
  const { colors } = useTheme()
  const fill = kind === 'primary' ? colors.primary : kind === 'danger' ? colors.danger : undefined
  const ink = kind === 'secondary' ? colors.foreground : colors.primaryForeground
  const inert = disabled || busy
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inert, busy }}
      disabled={inert}
      onPress={onPress}
      style={[
        styles.button,
        size === 'lg' ? styles.lg : styles.md,
        fill !== undefined ? { backgroundColor: fill } : { borderWidth: 1, borderColor: colors.border },
        grow ? styles.grow : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={ink} /> : null}
      <Text style={[styles.label, { color: ink }]}>{label}</Text>
    </Pressable>
  )
}

export interface ConfirmFooterProps {
  readonly cancelLabel: string
  readonly onCancel: () => void
  readonly cancelDisabled?: boolean
  /** Absent ⇒ only the cancel button (a read-only view's Back). */
  readonly confirmLabel?: string
  readonly onConfirm?: () => void
  readonly confirmDisabled?: boolean
  readonly busy?: boolean
  readonly confirmKind?: Exclude<ButtonKind, 'secondary'>
  readonly testID?: string
}

export function ConfirmFooter({
  cancelLabel,
  onCancel,
  cancelDisabled = false,
  confirmLabel,
  onConfirm,
  confirmDisabled = false,
  busy = false,
  confirmKind = 'primary',
  testID,
}: ConfirmFooterProps): React.JSX.Element {
  return (
    <View style={styles.footer} testID={testID}>
      <Button label={cancelLabel} onPress={onCancel} kind="secondary" size="lg" grow disabled={cancelDisabled} />
      {confirmLabel !== undefined && onConfirm !== undefined ? (
        <Button
          label={confirmLabel}
          onPress={onConfirm}
          kind={confirmKind}
          size="lg"
          grow
          disabled={confirmDisabled}
          busy={busy}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.sm },
  md: { paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg, borderRadius: RADIUS.md },
  lg: { paddingVertical: SPACING.lg, paddingHorizontal: SPACING.xl, borderRadius: RADIUS.lg },
  grow: { flex: 1 },
  disabled: { opacity: 0.5 },
  label: { fontSize: BUTTON_FONT_SIZE, fontWeight: TYPOGRAPHY.weight.medium },
  footer: { flexDirection: 'row', gap: SPACING.md },
})
