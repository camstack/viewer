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
import type { RetrainMacroClass } from '@camstack/types'
import { ItemPicker } from '../../../components/notifications/ItemPicker.js'
import { FilterChip } from '../../../components/ui/FilterChip.js'
import { ToggleRow } from '../../../components/ui/ToggleRow.js'
import { isRetrainMacroClass } from '../../../data/retrain-parse.js'
import { useNcConditionTaxonomy } from '../../../data/use-notification-center.js'
import {
  macroPickerItems,
  originalClassText,
  subClassPickerItems,
} from '../../../retrain/class-picker.js'
import type { BoxDiff } from '../../../retrain/live-review.js'
import { Check, Trash2 } from '../../../lib/icons.js'
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
  readonly onClass: (macro: RetrainMacroClass) => void
  readonly onLabel: (label: string) => void
  readonly onSubLabel: (subLabel: string) => void
  readonly onTextFocus: () => void
  readonly onTextBlur: () => void
  readonly onModelError: () => void
  readonly onAccept: () => void
  readonly onDelete: () => void
}

export function RetrainSubjectEditor({
  box,
  vocabulary,
  diff,
  onClass,
  onLabel,
  onSubLabel,
  onTextFocus,
  onTextBlur,
  onModelError,
  onAccept,
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
  const macroItems = useMemo(() => macroPickerItems(taxonomy, macroName), [taxonomy, t])
  const subItems = useMemo(
    () => subClassPickerItems(taxonomy, box.macroClass),
    [taxonomy, box.macroClass],
  )
  const subName = new Map(subItems.map((i) => [i.id, i.name]))
  const was = originalClassText({
    diff,
    macroClass: box.macroClass,
    label: box.label,
    macroName,
  })
  const changeClass = (macro: RetrainMacroClass): void => {
    onClass(macro)
    // A taxonomy sub-class belongs to its macro: it does not follow to another.
    if (macro !== box.macroClass && box.label !== undefined && subName.has(box.label)) onLabel('')
  }
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
        {t('v2.retrain.editor.macroClass', 'Class')}
      </Text>
      <ItemPicker<string>
        items={macroItems}
        state="answered"
        judged={[
          {
            id: box.macroClass,
            name: macroName(box.macroClass),
            removed: false,
          },
        ]}
        value={[box.macroClass]}
        onChange={(next) => {
          const macro = next[0]
          if (isRetrainMacroClass(macro)) changeClass(macro)
        }}
        single
        title={t('v2.retrain.editor.macroClass', 'Class')}
        searchLabel={t('v2.retrain.editor.classSearch', 'Search classes')}
        noMatchesLabel={t('v2.retrain.editor.classNoMatches', 'No class matches.')}
        groupTitle={() => t('v2.retrain.editor.macroClass', 'Class')}
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

      <Text style={[styles.title, { color: colors.foregroundMuted }]}>
        {t('v2.retrain.editor.label', 'Label')}
      </Text>
      {subItems.length > 0 ? (
        <View style={styles.chips}>
          <ItemPicker<string>
            items={subItems}
            state="answered"
            judged={
              box.label !== undefined && box.label !== '' && !subName.has(box.label)
                ? [{ id: box.label, name: box.label, removed: false }]
                : []
            }
            value={box.label !== undefined && box.label !== '' ? [box.label] : []}
            onChange={(next) => onLabel(next[0] ?? '')}
            single
            emptyLabel={t('v2.retrain.editor.noLabel', 'No label')}
            title={t('v2.retrain.editor.label', 'Label')}
            searchLabel={t('v2.retrain.editor.classSearch', 'Search classes')}
            noMatchesLabel={t('v2.retrain.editor.classNoMatches', 'No class matches.')}
            groupTitle={() => macroName(box.macroClass)}
            removedLabel={(id) => id}
            unknownLabel={(id) => id}
            testID="retrain-label-picker"
          />
          {box.label !== undefined && box.label !== '' ? (
            <FilterChip
              label={t('v2.retrain.editor.clearLabel', 'Clear label')}
              active={false}
              onPress={() => onLabel('')}
            />
          ) : null}
        </View>
      ) : (
        <>
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
  actions: { flexDirection: 'row', gap: SPACING.lg, marginTop: SPACING.md },
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
