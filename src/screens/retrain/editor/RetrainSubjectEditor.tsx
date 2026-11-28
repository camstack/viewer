/**
 * The selected subject's editor (the sheet's full snap, the side panel on a
 * wide screen): macro class, label with suggestions from the corpus vocabulary,
 * sub-label, "mark as model error", accept (for a draft) and delete.
 *
 * Typing is one undo step: focus opens it, blur closes it.
 */
import React, { useMemo } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { RetrainMacroClass } from '@dominevo/types'
import { ItemPicker } from '../../../components/notifications/ItemPicker.js'
import { FilterChip } from '../../../components/ui/FilterChip.js'
import { ToggleRow } from '../../../components/ui/ToggleRow.js'
import { isRetrainMacroClass } from '../../../data/retrain-parse.js'
import { useNcConditionTaxonomy } from '../../../data/use-notification-center.js'
import {
  type ClassLabelPick,
  classLabelPickerItems,
  classLabelPickId,
  originalClassText,
  parseClassLabelPick,
  subClassPickerItems,
} from '../../../retrain/class-picker.js'
import type { BoxDiff } from '../../../retrain/live-review.js'
import { Check, ChevronRight, Trash2 } from '../../../lib/icons.js'
import type { EditorBox } from '../../../retrain/editor.js'
import { suggestLabels, type VocabularyEntry } from '../../../retrain/vocabulary.js'
import { tierError } from '../../../retrain/validate.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../../theme/tokens.js'
import { RetrainSourceIcon, SOURCE_LABEL } from './RetrainSourceIcon.js'

export interface RetrainSubjectEditorProps {
  readonly box: EditorBox
  readonly vocabulary: readonly VocabularyEntry[]
  /** The box's live review verdict — says what a reclassified box used to be. */
  readonly diff?: BoxDiff | undefined
  /** One pick in the class-and-label list: both fields, one undo step. */
  readonly onClassLabel: (pick: ClassLabelPick) => void
  readonly onLabel: (label: string) => void
  readonly onSubLabel: (subLabel: string) => void
  readonly onTextFocus: () => void
  readonly onTextBlur: () => void
  readonly onModelError: () => void
  /** Accept the draft and close the subject editor. */
  readonly onAccept: () => void
  /** Accept, then open the next waiting draft; absent when none waits. */
  readonly onAcceptNext?: (() => void) | undefined
  readonly onDelete: () => void
}

export function RetrainSubjectEditor({
  box,
  vocabulary,
  diff,
  onClassLabel,
  onLabel,
  onSubLabel,
  onTextFocus,
  onTextBlur,
  onModelError,
  onAccept,
  onAcceptNext,
  onDelete,
}: RetrainSubjectEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const suggestions = useMemo(
    () => suggestLabels(vocabulary, box.label ?? '', box.macroClass),
    [vocabulary, box.label, box.macroClass],
  )
  const taxonomy = useNcConditionTaxonomy().data
  const macroName = (macro: RetrainMacroClass): string => t(`v2.retrain.class.${macro}`, macro)
  const subItems = useMemo(
    () => subClassPickerItems(taxonomy, box.macroClass),
    [taxonomy, box.macroClass],
  )
  const subName = new Map(subItems.map((i) => [i.id, i.name]))
  const classLabelItems = useMemo(() => classLabelPickerItems(taxonomy, macroName), [taxonomy, t])
  // A label the taxonomy does not list (a name typed by hand) is still the
  // box's label: the pick shows the class with that label beside it.
  const pickedId = classLabelPickId(box.macroClass, box.label)
  const pickedName =
    box.label === undefined || box.label === ''
      ? macroName(box.macroClass)
      : `${macroName(box.macroClass)} · ${subName.get(box.label) ?? box.label}`
  const was = originalClassText({
    diff,
    macroClass: box.macroClass,
    label: box.label,
    macroName,
  })
  const labelTier = tierError(box.label)
  const subLabelTier = tierError(box.subLabel)
  const source = SOURCE_LABEL[box.source]
  const input = [
    styles.input,
    {
      color: colors.foreground,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
  ]
  return (
    <View style={styles.root} testID="retrain-subject-editor">
      <View style={styles.provenance}>
        <RetrainSourceIcon source={box.source} size={14} color={colors.foregroundMuted} />
        <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
          {[
            t(source.key, source.fallback),
            box.assistModelId,
            box.assistScore !== undefined ? box.assistScore.toFixed(2) : undefined,
          ]
            .filter((p): p is string => p !== undefined)
            .join(' · ')}
        </Text>
      </View>

      <Text style={[styles.title, { color: colors.foregroundMuted }]}>
        {t('v2.retrain.editor.classAndLabel')}
      </Text>
      <ItemPicker<string>
        items={classLabelItems}
        state="answered"
        judged={[{ id: pickedId, name: pickedName, removed: false }]}
        value={[pickedId]}
        onChange={(next) => {
          const pick = parseClassLabelPick(next[0] ?? '', isRetrainMacroClass)
          if (pick === null) return
          if (pick.macroClass === box.macroClass && pick.label === (box.label ?? '')) return
          onClassLabel(pick)
        }}
        single
        title={t('v2.retrain.editor.classAndLabel')}
        searchLabel={t('v2.retrain.editor.classSearch', 'Search classes')}
        noMatchesLabel={t('v2.retrain.editor.classNoMatches', 'No class matches.')}
        groupTitle={(group) =>
          group.type !== null && isRetrainMacroClass(group.type) ? macroName(group.type) : ''
        }
        removedLabel={(id) => id}
        unknownLabel={(id) => id}
        testID="retrain-class-picker"
      />
      {was !== null ? (
        <Text style={[styles.hint, { color: colors.foregroundMuted }]} testID="retrain-was">
          <Text style={styles.struck}>{was.original}</Text>
          {' → '}
          <Text style={{ color: colors.foreground }}>{was.current}</Text>
        </Text>
      ) : null}

      {subItems.length > 0 ? null : (
        <>
          <Text style={[styles.title, { color: colors.foregroundMuted }]}>
            {t('v2.retrain.editor.label', 'Label')}
          </Text>
          <TextInput
            testID="retrain-label-input"
            value={box.label ?? ''}
            onChangeText={onLabel}
            onFocus={onTextFocus}
            onBlur={onTextBlur}
            placeholder={t('v2.retrain.editor.labelPlaceholder', 'postman, Marco, Fiat Panda...')}
            placeholderTextColor={colors.foregroundSubtle}
            autoCapitalize="none"
            autoCorrect={false}
            style={input}
          />
          {labelTier !== null ? (
            <Text style={[styles.error, { color: colors.danger }]}>
              {t('v2.retrain.editor.tierError', '"{{value}}" is a class, not a label.', {
                value: labelTier,
              })}
            </Text>
          ) : null}
          {suggestions.length > 0 ? (
            <View style={styles.chips}>
              {suggestions.map((s) => (
                <FilterChip key={s} label={s} active={false} onPress={() => onLabel(s)} />
              ))}
            </View>
          ) : null}
        </>
      )}

      <Text style={[styles.title, { color: colors.foregroundMuted }]}>
        {t('v2.retrain.editor.subLabel', 'Sub-label')}
      </Text>
      <TextInput
        testID="retrain-sublabel-input"
        value={box.subLabel ?? ''}
        onChangeText={onSubLabel}
        onFocus={onTextFocus}
        onBlur={onTextBlur}
        placeholder={t('v2.retrain.editor.subLabelPlaceholder', 'colour, model, detail...')}
        placeholderTextColor={colors.foregroundSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        style={input}
      />
      {subLabelTier !== null ? (
        <Text style={[styles.error, { color: colors.danger }]}>
          {t('v2.retrain.editor.tierError', '"{{value}}" is a class, not a label.', {
            value: subLabelTier,
          })}
        </Text>
      ) : null}

      <ToggleRow
        label={t('v2.retrain.editor.modelError', 'Model error')}
        description={t(
          'v2.retrain.editor.modelErrorHint',
          'The detector is wrong here: teach it not to detect this.',
        )}
        value={box.kind === 'model_error'}
        onValueChange={onModelError}
        last
      />

      <View style={styles.actions}>
        {box.draft ? (
          <Pressable
            onPress={onAccept}
            accessibilityRole="button"
            style={[styles.action, { backgroundColor: colors.primaryFill }]}
            testID="retrain-accept"
          >
            <Check size={16} color={colors.primaryOn} />
            <Text style={[styles.actionText, { color: colors.primaryOn }]}>
              {t('v2.retrain.editor.accept', 'Accept')}
            </Text>
          </Pressable>
        ) : null}
        {box.draft && onAcceptNext !== undefined ? (
          <Pressable
            onPress={onAcceptNext}
            accessibilityRole="button"
            style={[styles.action, styles.actionOutline, { borderColor: colors.primary }]}
            testID="retrain-accept-next"
          >
            <ChevronRight size={16} color={colors.primary} />
            <Text style={[styles.actionText, { color: colors.primary }]}>
              {t('v2.retrain.editor.acceptNext')}
            </Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={onDelete}
          accessibilityRole="button"
          style={[styles.action, { backgroundColor: colors.dangerFill }]}
          testID="retrain-delete"
        >
          <Trash2 size={16} color={colors.dangerOn} />
          <Text style={[styles.actionText, { color: colors.dangerOn }]}>
            {t('v2.retrain.editor.delete', 'Delete')}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { padding: SPACING.lg, gap: SPACING.md },
  provenance: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  hint: { fontSize: TYPOGRAPHY.size.sm },
  title: {
    fontSize: TYPOGRAPHY.size.xs,
    fontWeight: TYPOGRAPHY.weight.bold,
    textTransform: 'uppercase',
    marginTop: SPACING.sm,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.lg,
    fontSize: TYPOGRAPHY.size.md,
  },
  struck: { textDecorationLine: 'line-through' },
  error: { fontSize: TYPOGRAPHY.size.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.lg, marginTop: SPACING.md },
  actionOutline: { borderWidth: 1 },
  action: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
    borderRadius: RADIUS.md,
  },
  actionText: {
    fontSize: TYPOGRAPHY.size.md,
    fontWeight: TYPOGRAPHY.weight.bold,
  },
})
