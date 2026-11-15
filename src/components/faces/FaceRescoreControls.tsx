/**
 * FaceRescoreControls — "Recompute" for ONE face, and the verdict it returns.
 *
 * Shared by the track's face sheet (`FaceAssignSheet`) and the Library face
 * detail (`FaceReviewDetailModal`, issue 557: "recompute one photo and show
 * every identity %"). Both used to need the same button and the same verdict
 * box; one copy keeps them reading alike. The per-person percentages are NOT
 * drawn here: each caller puts them on its own people list, so a sheet never
 * grows a second, competing list of the same people.
 *
 * The verdict says what the pipeline WOULD do with this face now, and the two
 * numbers that decide it (threshold and margin). `model-mismatch` gets the
 * warning tint and its own escape hatch (re-embed) rather than a "0%" — see
 * `rescoreVerdictTone` for why those two must never look alike.
 */
import React, { memo } from 'react'
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Sparkles } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import {
  formatRescoreScore,
  rescoreVerdictKey,
  rescoreVerdictTone,
  shouldOfferReembed,
  type FaceRescoreReport,
} from '../../data/face-rescore.js'

/** Which recompute is in flight, if any. */
export type FaceRescorePending = 'rescore' | 'reembed' | null

export interface FaceRescoreControlsProps {
  /** The last report for THIS face, or null before one. */
  readonly report: FaceRescoreReport | null
  /** Any write on the face is in flight: the buttons dim. */
  readonly busy: boolean
  readonly pending: FaceRescorePending
  readonly onRescore: (reembed: boolean) => void
}

export const FaceRescoreControls = memo(function FaceRescoreControls({
  report,
  busy,
  pending,
  onRescore,
}: FaceRescoreControlsProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  return (
    <>
      <Pressable
        onPress={() => onRescore(false)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t('v2.tracks.rescore.button')}
        accessibilityState={{ disabled: busy, busy: pending === 'rescore' }}
        testID="face-rescore"
        style={[
          styles.rescoreBtn,
          { borderColor: colors.primary, opacity: busy && pending !== 'rescore' ? 0.5 : 1 },
        ]}
      >
        {pending === 'rescore' ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <RefreshCw size={16} color={colors.primary} />
        )}
        <Text style={[styles.rescoreBtnText, { color: colors.primary }]}>{t('v2.tracks.rescore.button')}</Text>
      </Pressable>
      {report !== null ? (
        <RescoreVerdict
          report={report}
          busy={busy}
          reembedPending={pending === 'reembed'}
          onReembed={() => onRescore(true)}
        />
      ) : null}
    </>
  )
})

interface RescoreVerdictProps {
  readonly report: FaceRescoreReport
  readonly busy: boolean
  readonly reembedPending: boolean
  readonly onReembed: () => void
}

const RescoreVerdict = memo(function RescoreVerdict({
  report,
  busy,
  reembedPending,
  onReembed,
}: RescoreVerdictProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const tone = rescoreVerdictTone(report.verdict)
  const tint =
    tone === 'good'
      ? colors.success
      : tone === 'medium'
        ? colors.primary
        : tone === 'warning'
          ? colors.warning
          : colors.foregroundMuted
  const winner = report.identities.find((i) => i.wouldAutoAssign)
  const threshold = formatRescoreScore(report.params.threshold)
  const margin = formatRescoreScore(report.params.margin)
  return (
    <View style={[styles.verdictBox, { borderColor: tint, backgroundColor: `${tint}14` }]}>
      <Text style={[styles.verdictText, { color: tint }]}>
        {t(rescoreVerdictKey(report.verdict), {
          name: winner?.name ?? '',
          min: report.params.minIdentitySamples,
        })}
      </Text>
      {report.comparable && threshold !== null && margin !== null ? (
        <Text style={[styles.verdictMeta, { color: colors.foregroundSubtle }]}>
          {t('v2.tracks.rescore.params', { threshold, margin })}
        </Text>
      ) : null}
      {/* Only when it could change the answer: out of the cluster space AND the
          crop still exists AND a re-embed has not already succeeded. */}
      {shouldOfferReembed(report) ? (
        <Pressable
          onPress={onReembed}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={t('v2.tracks.rescore.reembed')}
          accessibilityState={{ disabled: busy, busy: reembedPending }}
          style={[styles.reembedBtn, { borderColor: colors.warning, opacity: busy && !reembedPending ? 0.5 : 1 }]}
        >
          {reembedPending ? (
            <ActivityIndicator size="small" color={colors.warning} />
          ) : (
            <Sparkles size={14} color={colors.warning} />
          )}
          <Text style={[styles.reembedBtnText, { color: colors.warning }]}>{t('v2.tracks.rescore.reembed')}</Text>
        </Pressable>
      ) : null}
      {/* A refusal is never silent: the operator asked for inference and must
          be told exactly why none happened. */}
      {report.reembed.attempted && !report.reembed.succeeded ? (
        <Text style={[styles.verdictMeta, { color: colors.danger }]}>
          {t('v2.tracks.rescore.reembedFailed', {
            reason: report.reembed.detail ?? report.reembed.reason ?? '',
          })}
        </Text>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  rescoreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs, paddingVertical: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, marginTop: SPACING.sm },
  rescoreBtnText: { fontSize: 13, fontWeight: '700' },
  verdictBox: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm, marginTop: SPACING.sm, gap: 4 },
  verdictText: { fontSize: 13, fontWeight: '700' },
  verdictMeta: { fontSize: 11, fontWeight: '500' },
  reembedBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: SPACING.xs, paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm, borderRadius: RADIUS.md, borderWidth: 1, marginTop: SPACING.xs, alignSelf: 'flex-start' },
  reembedBtnText: { fontSize: 12, fontWeight: '700' },
})
