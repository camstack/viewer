/**
 * FaceConfidenceBadge — compact pill that shows WHY a face was AUTO-assigned:
 * the winning match score as a percentage ("62%"), the native face size appended
 * when known ("62% · 54px"), tinted by quality band (good → success, medium →
 * warning, low → danger). Renders NOTHING when there's no score (legacy rows /
 * manual assignments carry `undefined`). The caller still gates on auto-assigned
 * (`faceHasPerson(id) && !assigned`) — the badge only explains recognizer picks.
 *
 * The tint band + label format are pure and unit-tested in
 * `data/__tests__/face-confidence.spec.ts`; the numbers themselves need no i18n.
 */
import React, { memo } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { ShieldCheck } from '../../lib/icons.js'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { faceConfidenceTone, formatFaceConfidence, type FaceConfidenceTone } from '../../data/face-confidence.js'

export interface FaceConfidenceBadgeProps {
  /** Winning cosine similarity 0..1; `undefined` on legacy / manual rows → hidden. */
  readonly score: number | undefined
  /** Native face short-side px, when the server stored it. */
  readonly px: number | undefined
  /** Force the tint band, overriding the score-derived one — e.g. a "suggested"
   *  pill is always medium/amber regardless of its (sub-auto-threshold) score. */
  readonly tone?: FaceConfidenceTone
}

/** Auto-assign confidence pill. Self-hides when `score` is absent. */
export const FaceConfidenceBadge = memo(function FaceConfidenceBadge({
  score,
  px,
  tone: toneOverride,
}: FaceConfidenceBadgeProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const label = formatFaceConfidence(score, px)
  // `label === null` ⇔ no usable score; the explicit `score` guard also narrows
  // it to `number` for `faceConfidenceTone`.
  if (label === null || score === undefined) return null
  const tone = toneOverride ?? faceConfidenceTone(score)
  const tint = tone === 'good' ? colors.success : tone === 'medium' ? colors.warning : colors.danger
  return (
    <View
      style={[styles.badge, { backgroundColor: `${tint}22` }]}
      accessibilityRole="text"
      accessibilityLabel={`${t('v2.tracks.matchConfidence')}: ${label}`}
    >
      <ShieldCheck size={11} color={tint} />
      <Text style={[styles.text, { color: tint }]}>{label}</Text>
    </View>
  )
})

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 3,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.sm,
  },
  text: { fontSize: 11, fontWeight: '700' },
})
