/**
 * The body shared by the portrait sheet and the landscape side panel: the compact
 * subject list and, when the panel is expanded and a subject is selected, that
 * subject's editor under it.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { RetrainMacroClass } from '@camstack/types'
import type { EditorBox, EditorState } from '../../../retrain/editor.js'
import type { LiveReview } from '../../../retrain/live-review.js'
import type { SubjectRow } from '../../../retrain/rows.js'
import type { VocabularyEntry } from '../../../retrain/vocabulary.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../../../theme/tokens.js'
import { RetrainSubjectEditor } from './RetrainSubjectEditor.js'
import { RetrainSubjectRowView } from './RetrainSubjectRow.js'

export interface RetrainEditorPanelProps {
  readonly rows: readonly SubjectRow[]
  readonly review: LiveReview
  readonly editor: EditorState
  readonly selectedBox: EditorBox | null
  readonly vocabulary: readonly VocabularyEntry[]
  /** Show the selected subject's editor (the sheet's full snap, or a wide panel). */
  readonly expanded: boolean
  /**
   * `list` keeps every row (half snap, wide panel); `selected` shows only the
   * selected subject's row above its editor (the sheet's full snap).
   */
  readonly listMode: 'list' | 'selected'
  readonly onSelectRow: (key: string) => void
  readonly onHover: (key: string | null) => void
  readonly onClass: (macro: RetrainMacroClass) => void
  readonly onLabel: (label: string) => void
  readonly onSubLabel: (subLabel: string) => void
  readonly onTextFocus: () => void
  readonly onTextBlur: () => void
  readonly onModelError: () => void
  readonly onAccept: () => void
  readonly onDelete: () => void
}

export function RetrainEditorPanel(props: RetrainEditorPanelProps): React.JSX.Element {
  const { rows, review, editor, selectedBox, vocabulary, expanded, listMode, onSelectRow, onHover } = props
  const shown =
    listMode === 'selected' && expanded && selectedBox !== null
      ? rows.filter((r) => r.key === editor.selectedKey)
      : rows
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View style={styles.root}>
      {shown.length === 0 ? (
        <Text style={[styles.empty, { color: colors.foregroundMuted }]}>
          {t('v2.retrain.editor.emptyList', 'Nothing to review. Add a box to start.')}
        </Text>
      ) : (
        shown.map((row) => (
          <RetrainSubjectRowView
            key={row.key}
            row={row}
            selected={row.key === editor.selectedKey}
            onPress={onSelectRow}
            onHover={onHover}
          />
        ))
      )}
      {expanded && selectedBox !== null ? (
        <View style={[styles.editor, { borderTopColor: colors.border }]}>
          <RetrainSubjectEditor
            box={selectedBox}
            vocabulary={vocabulary}
            diff={review.byKey.get(selectedBox.key)}
            onClass={props.onClass}
            onLabel={props.onLabel}
            onSubLabel={props.onSubLabel}
            onTextFocus={props.onTextFocus}
            onTextBlur={props.onTextBlur}
            onModelError={props.onModelError}
            onAccept={props.onAccept}
            onDelete={props.onDelete}
          />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { paddingBottom: SPACING['2xl'] },
  empty: { padding: SPACING.xl, fontSize: TYPOGRAPHY.size.md },
  editor: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: SPACING.md },
})
