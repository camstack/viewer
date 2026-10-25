/**
 * TargetForm — the create/edit form for one of the caller's own delivery
 * targets. Every input is derived from the selected {@link TargetKind}'s
 * `configSchema` (see {@link parseConfigSchema}) — there is NO per-kind UI code.
 * Field types map onto the repo's settings primitives:
 *   • boolean → `ToggleRow`   • select → `SelectRow`
 *   • text / password / textarea / number → a themed `TextInput` row.
 *
 * The server is the validation authority: local validation only gates an
 * obviously-incomplete submit; any server rejection is surfaced verbatim. On
 * save the values are serialized (secrets merged, numbers coerced) and sent via
 * `useNcUpsertTarget`. Secrets are blanked on edit and only re-sent when
 * re-typed (the redaction contract).
 */
import React, { useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { Section } from '../ui/Section.js'
import { ToggleRow } from '../ui/ToggleRow.js'
import { SelectRow, type SelectOption } from '../ui/SelectRow.js'
import { NotifierIcon } from './NotifierIcon.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { useNcUpsertTarget } from '../../data/use-notification-center.js'
import type { Target, TargetKind } from '../../data/notification-center.js'
import {
  buildInitialConfig,
  buildTargetPayload,
  configFromTarget,
  parseConfigSchema,
  validateConfig,
  type NcConfigValues,
  type NcFormField,
} from './target-form.js'

interface TargetFormProps {
  readonly kind: TargetKind
  /** The target being edited, or `null` when creating. */
  readonly target: Target | null
  readonly onCancel: () => void
  readonly onSaved: () => void
}

export function TargetForm({ kind, target, onCancel, onSaved }: TargetFormProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const upsert = useNcUpsertTarget()

  const fields = useMemo(() => parseConfigSchema(kind.configSchema), [kind])
  const secretKeys = useMemo(() => fields.filter((f) => f.secret).map((f) => f.key), [fields])

  const [name, setName] = useState<string>(target?.name ?? kind.label)
  const [values, setValues] = useState<NcConfigValues>(() =>
    target ? configFromTarget(kind, target) : buildInitialConfig(kind),
  )
  const [invalid, setInvalid] = useState<readonly string[]>([])

  const setValue = (key: string, next: unknown): void =>
    setValues((prev) => ({ ...prev, [key]: next }))

  const serverError = upsert.error instanceof Error ? upsert.error.message : null

  const handleSave = (): void => {
    const trimmed = name.trim()
    // Editing keeps stored secrets, so blank required secrets don't block save.
    const result = validateConfig(kind, values, {
      keepSecretKeys: target ? secretKeys : [],
    })
    const missing = [...result.missing, ...(trimmed.length === 0 ? ['__name__'] : [])]
    if (missing.length > 0) {
      setInvalid(missing)
      return
    }
    setInvalid([])
    upsert.mutate(buildTargetPayload({ kind, existing: target, name: trimmed, values }), {
      onSuccess: onSaved,
    })
  }

  return (
    <View style={{ gap: SPACING.xl }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        <NotifierIcon kind={kind} size={26} />
        <Text style={{ flex: 1, color: colors.foreground, fontSize: 17, fontWeight: '600' }}>
          {target ? t('v2.nc.targets.editTitle', { name: target.name }) : t('v2.nc.targets.addTitle', { kind: kind.label })}
        </Text>
      </View>

      {serverError ? <ErrorBanner message={serverError} /> : null}

      <Section title={t('v2.nc.targets.form.details')}>
        <FieldRow
          label={t('v2.nc.targets.form.nameLabel')}
          description={t('v2.nc.targets.form.nameHint')}
          required
          invalid={invalid.includes('__name__')}
          value={name}
          onChangeText={setName}
          placeholder={kind.label}
          last
        />
      </Section>

      {fields.length > 0 ? (
        <Section title={t('v2.nc.targets.form.config')}>
          {fields.map((field, index) => (
            <FieldControl
              key={field.key}
              field={field}
              value={values[field.key]}
              onChange={(next) => setValue(field.key, next)}
              invalid={invalid.includes(field.key)}
              editing={target !== null}
              last={index === fields.length - 1}
            />
          ))}
        </Section>
      ) : null}

      <View style={{ flexDirection: 'row', gap: SPACING.md }}>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={{
            flex: 1,
            alignItems: 'center',
            paddingVertical: SPACING.lg,
            borderRadius: RADIUS.lg,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '600' }}>
            {t('v2.nc.targets.cancel')}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={upsert.isPending}
          onPress={handleSave}
          style={{
            flex: 1,
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: SPACING.sm,
            paddingVertical: SPACING.lg,
            borderRadius: RADIUS.lg,
            backgroundColor: colors.primary,
            opacity: upsert.isPending ? 0.6 : 1,
          }}
        >
          {upsert.isPending ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : null}
          <Text style={{ color: colors.primaryForeground, fontSize: 15, fontWeight: '600' }}>
            {target ? t('v2.nc.targets.save') : t('v2.nc.targets.create')}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

// ── field controls ──────────────────────────────────────────────────────────

interface FieldControlProps {
  readonly field: NcFormField
  readonly value: unknown
  readonly onChange: (next: unknown) => void
  readonly invalid: boolean
  readonly editing: boolean
  readonly last: boolean
}

/** Render one `NcFormField` onto the matching settings primitive. */
function FieldControl({ field, value, onChange, invalid, editing, last }: FieldControlProps) {
  const { t } = useTranslation()

  if (field.type === 'boolean') {
    return (
      <ToggleRow
        label={field.label}
        description={field.description}
        value={value === true}
        onValueChange={onChange}
        last={last}
      />
    )
  }

  if (field.type === 'select') {
    const options: readonly SelectOption<string>[] = field.options.map((o) => ({
      value: o.value,
      label: o.label,
    }))
    return (
      <SelectRow<string>
        label={field.label}
        options={options}
        value={typeof value === 'string' ? value : (options[0]?.value ?? '')}
        onChange={onChange}
        last={last}
      />
    )
  }

  // text / password / textarea / number → themed TextInput row.
  const secretHint = field.secret && editing ? t('v2.nc.targets.form.secretHint') : undefined
  const description = field.description ?? secretHint
  return (
    <FieldRow
      label={field.label}
      description={secretHint && field.description ? `${field.description} ${secretHint}` : description}
      required={field.required}
      invalid={invalid}
      value={typeof value === 'string' ? value : value == null ? '' : String(value)}
      onChangeText={onChange}
      placeholder={field.placeholder}
      secure={field.secret}
      multiline={field.type === 'textarea'}
      numeric={field.type === 'number'}
      last={last}
    />
  )
}

interface FieldRowProps {
  readonly label: string
  readonly description?: string
  readonly required?: boolean
  readonly invalid?: boolean
  readonly value: string
  readonly onChangeText: (next: string) => void
  readonly placeholder?: string
  readonly secure?: boolean
  readonly multiline?: boolean
  readonly numeric?: boolean
  readonly last?: boolean
}

/** A labeled text input laid out like a settings row (label + optional hint
 *  above the input), themed, with a bottom hairline unless `last`. */
function FieldRow({
  label,
  description,
  required = false,
  invalid = false,
  value,
  onChangeText,
  placeholder,
  secure = false,
  multiline = false,
  numeric = false,
  last = false,
}: FieldRowProps) {
  const { colors } = useTheme()
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
      <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '500' }}>
        {label}
        {required ? <Text style={{ color: colors.danger }}> *</Text> : null}
      </Text>
      {description ? (
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 16 }}>
          {description}
        </Text>
      ) : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundSubtle}
        secureTextEntry={secure}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={numeric ? 'numeric' : 'default'}
        style={{
          color: colors.foreground,
          backgroundColor: colors.background,
          borderColor: invalid ? colors.danger : colors.border,
          borderWidth: 1,
          borderRadius: RADIUS.md,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.md,
          fontSize: 15,
          minHeight: multiline ? 72 : undefined,
          textAlignVertical: multiline ? 'top' : 'center',
        }}
      />
    </View>
  )
}

function ErrorBanner({ message }: { readonly message: string }) {
  const { colors } = useTheme()
  return (
    <View
      style={{
        backgroundColor: `${colors.danger}1a`,
        borderColor: colors.danger,
        borderWidth: 1,
        borderRadius: RADIUS.md,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.md,
      }}
    >
      <Text style={{ color: colors.danger, fontSize: 13, lineHeight: 18 }}>{message}</Text>
    </View>
  )
}
