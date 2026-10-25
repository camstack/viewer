/**
 * A notification template field with a `{{variable}}` picker (Plan C, Task 6).
 *
 * The chips come from the hub's catalog, already filtered for the field being
 * edited (`varsForContext`); tapping one inserts its token at the CARET. The
 * warning under the field names every placeholder the hub would print EMPTY in
 * this context — the renderer's unknown-name rule, spelled out before the
 * operator saves rather than discovered on a lock screen.
 *
 * `vars === undefined` means the catalog has not answered (an older hub, or not
 * yet): no chips and no warning — never "no variables", which would claim an
 * absence nobody measured (D315).
 *
 * Reused by the timelapse/digest editors (Plan D) — keep the props stable.
 */
import React, { useState } from 'react'
import {
  Pressable,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { useNcTemplatePreview } from '../../data/use-notification-center.js'
import type { NcTemplateVarContext, NcTemplateVarDescriptor } from '../../data/notification-center.js'
import {
  groupTemplateVars,
  insertPlaceholder,
  placeholderToken,
  templateVarLabel,
  unknownPlaceholders,
  type TextSelection,
} from './template-field.js'
import { SectionLabel } from '../ui/SectionLabel.js'

export interface TemplateFieldProps {
  readonly label: string
  readonly value: string
  readonly onChangeText: (next: string) => void
  /** `undefined` = the catalog has not answered: no chips, no warning. */
  readonly vars: readonly NcTemplateVarDescriptor[] | undefined
  readonly multiline?: boolean
  readonly placeholder?: string
  readonly last?: boolean
  readonly testID: string
}

interface TemplateVarChipsProps {
  readonly vars: readonly NcTemplateVarDescriptor[]
  readonly onPick: (descriptor: NcTemplateVarDescriptor) => void
  readonly testID: string
}

function TemplateVarChips({ vars, onPick, testID }: TemplateVarChipsProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (vars.length === 0) {
    return (
      <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>
        {t('v2.nc.templateField.noVars')}
      </Text>
    )
  }
  return (
    <>
      {groupTemplateVars(vars).map((entry) => (
        <View
          key={entry.group}
          style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: SPACING.sm }}
        >
          <SectionLabel level="group">
            {t(`v2.nc.templateField.groups.${entry.group}`)}
          </SectionLabel>
          {entry.vars.map((descriptor) => {
            const label = templateVarLabel(t, descriptor)
            const token = placeholderToken(descriptor).text
            return (
              <Pressable
                key={descriptor.name}
                testID={`${testID}-chip-${descriptor.name}`}
                onPress={() => onPick(descriptor)}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityHint={token}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: RADIUS.sm,
                  paddingHorizontal: SPACING.sm,
                  paddingVertical: SPACING.xs,
                }}
              >
                <Text style={{ color: colors.foreground, fontSize: 12 }}>{label}</Text>
                {/* The token itself, so the operator learns the name and two
                    similar labels are still told apart. */}
                <Text style={{ color: colors.foregroundSubtle, fontSize: 10 }}>{token}</Text>
              </Pressable>
            )
          })}
        </View>
      ))}
    </>
  )
}

export function TemplateField({
  label,
  value,
  onChangeText,
  vars,
  multiline = false,
  placeholder,
  last = false,
  testID,
}: TemplateFieldProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [selection, setSelection] = useState<TextSelection>({ start: value.length, end: value.length })
  // Set only right after an insert, so the caret lands after the token; cleared
  // on the next native selection event — a permanently controlled `selection`
  // fights the keyboard on Android.
  const [forced, setForced] = useState<TextSelection | undefined>(undefined)
  const unknown = vars ? unknownPlaceholders(value, vars) : []

  const onSelectionChange = (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>): void => {
    setSelection(e.nativeEvent.selection)
    setForced(undefined)
  }

  const insert = (descriptor: NcTemplateVarDescriptor): void => {
    const token = placeholderToken(descriptor)
    const result = insertPlaceholder(value, selection, token.text)
    const cursor = result.cursor - token.text.length + token.cursorOffset
    onChangeText(result.value)
    setSelection({ start: cursor, end: cursor })
    setForced({ start: cursor, end: cursor })
  }

  return (
    <View
      style={{
        gap: SPACING.sm,
        paddingHorizontal: SPACING.xl,
        paddingVertical: SPACING.lg,
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: colors.borderSubtle,
      }}
    >
      <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '500' }}>{label}</Text>
      <TextInput
        testID={`${testID}-input`}
        value={value}
        onChangeText={onChangeText}
        onSelectionChange={onSelectionChange}
        selection={forced}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundSubtle}
        multiline={multiline}
        // Braces must survive: no capitalisation, no autocorrect (which on iOS
        // also turns off smart quotes/dashes), no spell-check rewrite, and no
        // smart spacing around a pasted or inserted token.
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        smartInsertDelete={false}
        style={{
          color: colors.foreground,
          backgroundColor: colors.background,
          borderColor: unknown.length > 0 ? colors.warning : colors.border,
          borderWidth: 1,
          borderRadius: RADIUS.md,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.md,
          fontSize: 15,
          minHeight: multiline ? 72 : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
      {vars ? <TemplateVarChips vars={vars} onPick={insert} testID={testID} /> : null}
      {unknown.length > 0 ? (
        <Text testID={`${testID}-unknown`} style={{ color: colors.warning, fontSize: 12 }}>
          {t('v2.nc.templateField.unknown', {
            names: unknown.map((name) => `{{${name}}}`).join(' '),
            interpolation: { escapeValue: false },
          })}
        </Text>
      ) : null}
    </View>
  )
}

export interface TemplatePreviewProps {
  readonly context: NcTemplateVarContext
  readonly title: string
  readonly body: string
  /** The heading over the render; defaults to "Preview". */
  readonly label?: string
}

/** The hub's own render of the draft with example values; nothing until it answers. */
export function TemplatePreview({ context, title, body, label }: TemplatePreviewProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // One call renders BOTH fields under the caller's (body) context: the title
  // shares the body's vocabulary except the body-only `{{ai}}`, which the
  // title field's own chips/warning already flag as empty.
  const preview = useNcTemplatePreview(context, { title, body }, true)
  if (!preview.data) return null
  return (
    <View style={{ paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, gap: SPACING.xs }}>
      <SectionLabel level="group">
        {label ?? t('v2.nc.templateField.preview')}
      </SectionLabel>
      {preview.data.title !== null ? (
        <Text style={{ color: colors.foreground, fontWeight: '600' }}>{preview.data.title}</Text>
      ) : null}
      {preview.data.body !== null ? (
        <Text style={{ color: colors.foreground }}>{preview.data.body}</Text>
      ) : null}
    </View>
  )
}
