/**
 * HeroValueEditor — a number or text hero control in a row: the row shows the
 * value, a tap opens a `SheetModal` with the editor. A number gets a field and
 * a step down / up; a text gets a field. Save sends the value to the control's
 * own call, exactly as the admin row does.
 *
 * The value is in the hub's base unit and so is what is sent: the viewer has no
 * display-unit preference, so there is nothing to convert.
 */
import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { IconButton, fireControlHaptic } from '../components/camera/accessory-controls/control-atoms.js'
import { ConfirmFooter } from '../components/ui/Button.js'
import { SheetHeader } from '../components/ui/SheetHeader.js'
import { SheetModal } from '../components/ui/SheetModal.js'
import { Minus, Plus } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../theme/tokens.js'
import type { HeroCaller } from './use-hero.js'

export interface ValueEditorSpec {
  readonly id: string
  readonly label: string
  readonly kind: 'number' | 'text'
  /** The hub's value: null = not reported. */
  readonly value: number | string | null
  readonly unit: string
  readonly step: number | null
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
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const text = valueText(spec)
  const typed = spec.kind === 'number' ? parseTyped(draft) : draft
  const step = spec.step ?? 1

  const show = (): void => {
    fireControlHaptic('tap')
    setDraft(spec.value === null ? '' : String(spec.value))
    setOpen(true)
  }
  const nudge = (direction: 1 | -1): void => {
    const base = parseTyped(draft) ?? 0
    setDraft(String(Math.round((base + direction * step) * 1000) / 1000))
  }
  const save = async (): Promise<void> => {
    if (typed === null) return
    await caller.runValue(spec.call, typed)
    setOpen(false)
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('v2.hero.editValue', { name: spec.label })}
        testID={`hero-value-${spec.id}`}
        disabled={disabled}
        onPress={show}
        style={[
          styles.pill,
          { backgroundColor: colors.backgroundElevated, borderColor: colors.border, opacity: disabled ? 0.45 : 1 },
        ]}
      >
        <Text style={[styles.pillLabel, { color: colors.foreground }]} numberOfLines={1}>
          {text}
        </Text>
      </Pressable>
      <SheetModal
        visible={open}
        onClose={() => setOpen(false)}
        testID={`hero-value-sheet-${spec.id}`}
        backdropLabel={t('v2.common.close')}
        sheetStyle={[styles.sheet, { backgroundColor: colors.background }]}
      >
        <SheetHeader title={spec.label} onClose={() => setOpen(false)} />
        <View style={styles.body}>
          {spec.kind === 'number' ? (
            <IconButton icon={Minus} label={t('v2.hero.stepDown', { name: spec.label })} disabled={disabled} onPress={() => nudge(-1)} />
          ) : null}
          <TextInput
            value={draft}
            onChangeText={setDraft}
            autoFocus
            keyboardType={spec.kind === 'number' ? 'decimal-pad' : 'default'}
            accessibilityLabel={spec.label}
            testID={`hero-value-input-${spec.id}`}
            placeholderTextColor={colors.foregroundMuted}
            style={[styles.input, { color: colors.foreground, borderColor: colors.border }]}
          />
          {spec.kind === 'number' ? (
            <IconButton icon={Plus} label={t('v2.hero.stepUp', { name: spec.label })} disabled={disabled} onPress={() => nudge(1)} />
          ) : null}
        </View>
        <ConfirmFooter
          cancelLabel={t('v2.common.cancel')}
          onCancel={() => setOpen(false)}
          confirmLabel={t('v2.hero.save')}
          onConfirm={() => void save()}
          confirmDisabled={disabled || typed === null || caller.pending}
          busy={caller.pending}
          testID={`hero-value-footer-${spec.id}`}
        />
      </SheetModal>
    </>
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
  sheet: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    padding: SPACING.xl,
    gap: SPACING.lg,
  },
  body: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    fontSize: TYPOGRAPHY.size.md,
  },
})
