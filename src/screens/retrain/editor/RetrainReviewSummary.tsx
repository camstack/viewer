/**
 * The review summary strip: one badge per verdict that has boxes, `+2 added`,
 * `−1 removed`, `~1 reclassified`, `↔1 adjusted`, `=3 unchanged`, plus
 * model error and unconfirmed drafts. The collapsed sheet shows only this.
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Badge } from '../../../components/ui/Badge.js'
import { boxLook, SUMMARY_SYMBOL } from '../../../retrain/box-look.js'
import type { BoxDiffKind } from '../../../retrain/live-review.js'
import { summaryEntries } from '../../../retrain/rows.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../../../theme/tokens.js'

export interface RetrainReviewSummaryProps {
  readonly counts: Readonly<Record<BoxDiffKind, number>>
  /** Some verdict was reached against a re-derived baseline (a legacy frame). */
  readonly approximate: boolean
}

export function RetrainReviewSummary({
  counts,
  approximate,
}: RetrainReviewSummaryProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const entries = summaryEntries(counts)
  if (entries.length === 0) {
    return (
      <Text style={[styles.empty, { color: colors.foregroundMuted }]}>
        {t('v2.retrain.editor.noBoxes', 'No subjects on this frame yet.')}
      </Text>
    )
  }
  return (
    <View style={styles.row} testID="retrain-review-summary">
      {entries.map(({ kind, count }) => {
        const look = boxLook(kind)
        const text = `${approximate && kind !== 'draft' ? '≈' : ''}${SUMMARY_SYMBOL[kind]}${String(count)} ${t(look.translationKey, look.fallback).toLowerCase()}`
        return (
          <Badge
            key={kind}
            label={text}
            tone={look.tone}
            look={look.badgeLook}
            dashed={look.badgeLook === 'outline'}
            size="sm"
          />
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, alignItems: 'center' },
  empty: { fontSize: TYPOGRAPHY.size.sm },
})
