/**
 * HeroValueEditor — a number (without bounds) or text hero control in a row.
 * The row shows the value as a chip; a tap turns the chip into an inline field
 * (a number with its unit, or text) with ✓ and ✕. ✓ or Enter sends the value
 * to the control's own call; ✕ closes the field and sends nothing.
 *
 * A number is typed in the display unit and sent in the hub's base unit. The
 * viewer has no display-unit preference yet, so its `display` is the identity;
 * the seam is {@link ValueDisplay}, the same pair the admin `NumericControl`
 * is fed with.
 */
import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { IconButton, fireControlHaptic } from '../components/camera/accessory-controls/control-atoms.js'
import { Check, X } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../theme/tokens.js'
import type { HeroCaller } from './use-hero.js'

/** The base unit ↔ display unit pair of a number. */
export interface ValueDisplay {
  readonly toShown: (base: number) => number
  readonly toBase: (shown: number) => number
  /** The unit typed in; absent = the control's own. */
  readonly unit?: string
}

export const IDENTITY_DISPLAY: ValueDisplay = { toShown: (n) => n, toBase: (n) => n }

export interface ValueEditorSpec {
  readonly id: string
  readonly label: string
  readonly kind: 'number' | 'text'
  /** The hub's value: null = not reported. */
  readonly value: number | string | null
  readonly unit: string
  readonly step: number | null
  readonly display?: ValueDisplay
  readonly call: { readonly cap: string; readonly method: string; readonly valueArg: string }
}

/** The row's own text for a value: a number with its unit, a text as is, nothing reported as a dash. */
export function valueText(spec: Pick<ValueEditorSpec, 'value' | 'unit'>): string {
  if (spec.value === null || spec.value === '') return '—'
  return typeof spec.value === 'number' ? `${spec.value}${spec.unit === '' ? '' : ` ${spec.unit}`}` : spec.value
}

/** What a typed number is: a finite number, else null (nothing to send). */
export function parseTyped(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'))
  return text.trim() === '' || !Number.isFinite(n) ? null : n
}

export function HeroValueEditor({
  spec,
  caller,
  disabled,
}: {
  readonly spec: ValueEditorSpec
  readonly caller: HeroCaller
  readonly disabled: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const display = spec.display ?? IDENTITY_DISPLAY
  const unit = display.unit ?? spec.unit
  const shown = typeof spec.value === 'number' ? display.toShown(spec.value) : spec.value
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const typed = spec.kind === 'number' ? parseTyped(draft) : draft

  const begin = (): void => {
    fireControlHaptic('tap')
    setDraft(shown === null ? '' : String(shown))
    setEditing(true)
  }
  const submit = async (): Promise<void> => {
    if (typed === null || disabled) return
    const value = typeof typed === 'number' ? display.toBase(typed) : typed
    setEditing(false)
    await caller.runValue(spec.call, value)
  }

  if (!editing) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('v2.hero.editValue', { name: spec.label })}
        testID={`hero-value-${spec.id}`}
        disabled={disabled}
        onPress={begin}
        style={[
          styles.pill,
          { backgroundColor: colors.backgroundElevated, borderColor: colors.border, opacity: disabled ? 0.45 : 1 },
        ]}
      >
        <Text style={[styles.pillLabel, { color: colors.foreground }]} numberOfLines={1}>
          {valueText({ value: shown, unit })}
        </Text>
      </Pressable>
    )
  }
  return (
    <View style={styles.inline} testID={`hero-value-field-${spec.id}`}>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        autoFocus
        keyboardType={spec.kind === 'number' ? 'decimal-pad' : 'default'}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        accessibilityLabel={spec.label}
        testID={`hero-value-input-${spec.id}`}
        placeholderTextColor={colors.foregroundMuted}
        style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
      />
      {spec.kind === 'number' && unit !== '' ? (
        <Text style={[styles.unit, { color: colors.foregroundMuted }]}>{unit}</Text>
      ) : null}
      <IconButton
        icon={Check}
        label={t('v2.hero.save')}
        disabled={disabled || typed === null || caller.pending}
        onPress={() => void submit()}
      />
      <IconButton icon={X} label={t('v2.common.cancel')} onPress={() => setEditing(false)} />
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    maxWidth: 140,
  },
  pillLabel: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.medium },
  inline: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  input: {
    minWidth: 64,
    maxWidth: 120,
    height: 32,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.sm,
    fontSize: TYPOGRAPHY.size.sm,
  },
  unit: { fontSize: TYPOGRAPHY.size.sm },
})
