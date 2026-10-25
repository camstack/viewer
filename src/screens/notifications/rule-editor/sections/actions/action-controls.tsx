/**
 * The small controls the Actions sub-screen repeats: a plain text field (no
 * auto-capitalisation or auto-correct — method names, argument keys and JSON
 * are identifiers, and a phone "fixing" `setState` into `SetState` breaks the
 * call), a text-button, and the error line drawn under a field.
 */
import React from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { Plus, RefreshCw, Trash2 } from '../../../../../lib/icons.js'
import { useTheme } from '../../../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../../../theme/tokens.js'

const FIELD_FONT = 15
const MULTILINE_MIN_HEIGHT = 72
const ICON_SIZE = 14

export interface ActionTextFieldProps {
  readonly value: string
  readonly onChangeText: (next: string) => void
  readonly label?: string
  readonly placeholder?: string
  readonly invalid?: boolean
  readonly multiline?: boolean
  /** Monospace, for JSON. */
  readonly code?: boolean
  readonly accessibilityLabel?: string
}

export function ActionTextField({
  value,
  onChangeText,
  label,
  placeholder,
  invalid = false,
  multiline = false,
  code = false,
  accessibilityLabel,
}: ActionTextFieldProps) {
  const { colors } = useTheme()
  return (
    <View style={{ gap: SPACING.sm, flex: 1 }}>
      {label !== undefined ? (
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '500' }}>{label}</Text>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundSubtle}
        accessibilityLabel={accessibilityLabel ?? label}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        style={{
          color: colors.foreground,
          backgroundColor: colors.background,
          borderColor: invalid ? colors.danger : colors.border,
          borderWidth: 1,
          borderRadius: RADIUS.md,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.md,
          fontSize: FIELD_FONT,
          fontFamily: code ? 'monospace' : undefined,
          minHeight: multiline ? MULTILINE_MIN_HEIGHT : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  )
}

export interface ActionLinkButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly kind: 'add' | 'remove' | 'retry'
  readonly disabled?: boolean
}

export function ActionLinkButton({ label, onPress, kind, disabled = false }: ActionLinkButtonProps) {
  const { colors } = useTheme()
  const color = kind === 'remove' ? colors.danger : colors.primary
  const Icon = kind === 'remove' ? Trash2 : kind === 'retry' ? RefreshCw : Plus
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.sm,
        paddingVertical: SPACING.md,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon size={ICON_SIZE} color={color} />
      <Text style={{ color, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  )
}

export function ActionErrorLine({ text }: { readonly text: string }) {
  const { colors } = useTheme()
  return (
    <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 12 }}>
      {text}
    </Text>
  )
}
