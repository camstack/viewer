/**
 * RuleFormFields — the four presentational pieces every notification-rule editor
 * on this app is built from.
 *
 * They were private to `RuleEditorScreen` while there was one editor. There are
 * now THREE (detection/occupancy/sound rules, scheduled timelapses, multi-camera
 * digests) and they are three genuinely different forms over three different
 * stores — but the operator's complaint that started all of this was that the
 * surfaces did not look like each other, so a second hand-rolled target picker
 * or a second labelled text box is the exact failure being fixed, one level
 * down.
 *
 * Deliberately DUMB: no data fetching, no form model, no i18n decisions beyond
 * the two fixed strings the target picker owns. Everything that decides
 * anything lives in the pure `*-form.ts` modules beside this file.
 */
import React from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { UnlistedTargetNote } from './target-ownership.js'
import { saveBlockKey, type SaveBlockReason, type TargetsReadState } from './save-gate.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'

/** One selectable delivery target — id plus the name the operator gave it. */
export interface RuleTargetOption {
  readonly id: string
  readonly name: string
}

export interface TargetPickerProps {
  readonly targets: readonly RuleTargetOption[]
  /**
   * How far the caller's own list has got (`targetsReadState`). Only an
   * ANSWERED list may say "you have none": a pending one spins, a failed one
   * says it failed (D315) — `isLoading` alone is false while disconnected.
   */
  readonly readState: TargetsReadState
  readonly selected: readonly string[]
  readonly invalid: boolean
  readonly onToggle: (id: string) => void
  /**
   * Stored targets NOT in the caller's list (`target-ownership.ts`): not
   * listed, because they are not his to pick, but SAID — kept on an admin's
   * save, removed on anyone else's. `undefined` = nothing to say, or not known.
   */
  readonly unlisted?: UnlistedTargetNote
}

/**
 * Multiselect over the caller's OWN targets. Every personal rule must pick ≥1.
 *
 * The list is the caller's own by construction — the screen feeds it
 * `useNcTargets()` — which is what makes the form's ownership filter a tidy-up
 * rather than the enforcement. The server refuses a target the caller does not
 * own, and it is the authority.
 */
export function TargetPicker({ targets, readState, selected, invalid, onToggle, unlisted }: TargetPickerProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const foreignNote =
    unlisted !== undefined ? (
      <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 17, padding: SPACING.xl }}>
        {t(
          unlisted.fate === 'kept'
            ? 'v2.nc.rules.editor.unlistedTargetsKept'
            : 'v2.nc.rules.editor.unlistedTargetsRemoved',
          { count: unlisted.count },
        )}
      </Text>
    ) : null

  if (readState === 'failed') {
    return (
      <Text style={{ color: colors.danger, fontSize: 13, padding: SPACING.xl }}>
        {t('v2.nc.rules.editor.targetsUnavailable')}
      </Text>
    )
  }
  if (readState === 'pending') {
    return (
      <View style={{ padding: SPACING.xl, alignItems: 'center' }}>
        <ActivityIndicator size="small" color={colors.foregroundSubtle} />
      </View>
    )
  }
  if (targets.length === 0) {
    return (
      <View>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 13, padding: SPACING.xl }}>
          {t('v2.nc.rules.editor.noTargets')}
        </Text>
        {foreignNote}
      </View>
    )
  }
  return (
    <View>
      {invalid ? (
        <Text
          style={{
            color: colors.danger,
            fontSize: 12,
            paddingHorizontal: SPACING.xl,
            paddingTop: SPACING.md,
          }}
        >
          {t('v2.nc.rules.editor.pickTarget')}
        </Text>
      ) : null}
      {targets.map((tgt, index) => {
        const on = selected.includes(tgt.id)
        return (
          <Pressable
            key={tgt.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => onToggle(tgt.id)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: SPACING.md,
              paddingHorizontal: SPACING.xl,
              paddingVertical: SPACING.lg,
              borderBottomWidth: index === targets.length - 1 ? 0 : 1,
              borderBottomColor: colors.borderSubtle,
            }}
          >
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: RADIUS.sm,
                borderWidth: 1.5,
                borderColor: on ? colors.primary : colors.border,
                backgroundColor: on ? colors.primary : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {on ? (
                <Text style={{ color: colors.primaryForeground, fontSize: 12, fontWeight: '700' }}>
                  ✓
                </Text>
              ) : null}
            </View>
            <Text style={{ flex: 1, color: colors.foreground, fontSize: 15 }} numberOfLines={1}>
              {tgt.name}
            </Text>
          </Pressable>
        )
      })}
      {foreignNote}
    </View>
  )
}

export interface LabeledInputProps {
  readonly label: string
  readonly value: string
  readonly onChangeText: (next: string) => void
  readonly placeholder?: string
  readonly invalid?: boolean
  readonly multiline?: boolean
  readonly last?: boolean
  /** A muted line under the label (what the value means, its unit and range). */
  readonly description?: string
  /** Test id of the text box. */
  readonly testID?: string
  /** A number pad instead of the full keyboard. */
  readonly numeric?: boolean
  /** False renders the box read-only (a form being saved). Default true. */
  readonly editable?: boolean
  readonly onBlur?: () => void
  /** The keyboard's action key (a number pad has none on iOS, so a field that is committed per keystroke leaves it alone). */
  readonly returnKeyType?: 'done' | 'next' | 'go' | 'search' | 'send'
  /** Under the box: a hint, or the source of an inherited value and its way out. */
  readonly footer?: React.ReactNode
}

/** A labelled text box inside a `Section`. `last` drops the hairline rule. */
export function LabeledInput({
  label,
  value,
  onChangeText,
  placeholder,
  invalid = false,
  multiline = false,
  last = false,
  description,
  testID,
  numeric = false,
  editable = true,
  onBlur,
  returnKeyType,
  footer,
}: LabeledInputProps) {
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
      <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: '500' }}>{label}</Text>
      {description ? (
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 16 }}>{description}</Text>
      ) : null}
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        returnKeyType={returnKeyType}
        editable={editable}
        keyboardType={numeric ? 'number-pad' : 'default'}
        placeholder={placeholder}
        placeholderTextColor={colors.foregroundSubtle}
        multiline={multiline}
        autoCapitalize="sentences"
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
      {footer}
    </View>
  )
}

/**
 * A server refusal, VERBATIM.
 *
 * The hub is the validation authority and its messages name the thing that is
 * wrong ("camera 102: recording is not enabled — a timelapse renders recorded
 * footage…"). Rewording them into a generic "couldn't save" is how an operator
 * ends up unable to act on a refusal that told them exactly what to do.
 */
export function RuleErrorBanner({ message }: { readonly message: string }) {
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

/**
 * Why Save is disabled (`save-gate.ts`). A FAILED read is a banner — it will
 * not fix itself; a pending one is a quiet line that goes away on its own.
 */
export function SaveBlockedNotice({ reason }: { readonly reason: SaveBlockReason | undefined }) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  if (reason === undefined) return null
  if (reason === 'role-unknown' || reason === 'targets-failed') {
    return <RuleErrorBanner message={t(saveBlockKey(reason))} />
  }
  return (
    <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 17, paddingHorizontal: SPACING.xs }}>
      {t(saveBlockKey(reason))}
    </Text>
  )
}
