/**
 * IdentityAuditModal — one person's enrolled samples, worst first.
 *
 * ## What it is for
 *
 * The gallery is the only input to recognition nobody re-reads. A sample
 * enrolled from the wrong face keeps voting forever: it pulls its name onto
 * every future match near it, and because auto-assignment then looks confident,
 * nobody goes back to check. On this cluster there is exactly one such pair,
 * and finding it took a script and a day.
 *
 * `faceGallery.auditIdentitySamples` ranks the person's samples; this panel
 * shows the ranking with the crop beside it, because the operator's decision is
 * visual: "0.61 against Dave" is a claim, the two faces are the proof.
 *
 * ## What it deliberately does not do
 *
 * It does not remove anything on its own, and it does not hide the rest of the
 * gallery. Every sample is listed — the flagged ones first, then the quiet
 * ones — because the operator asked to see the person, not only the
 * accusations, and a panel that showed only suspects would make a clean gallery
 * look empty.
 *
 * A sample the hub could not compare (a different face model) is shown with its
 * reason and NO score. A cosine across feature spaces is a well-formed float
 * with no meaning, and this list ends in a Remove button.
 */
import React from 'react'
// ui-check-ok: centred audit dialog; SheetModal is a layout change (pre-existing)
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useTranslation } from 'react-i18next'

import { buildMediaIdUrl } from '../../data/event-media-url.js'
import {
  type IdentityAuditRow,
  useIdentityAudit,
  useRemoveIdentitySample,
} from '../../data/use-identity-audit.js'
import { hapticAction, hapticTap } from '../../lib/haptics.js'
import { log } from '../../lib/logger.js'
import { ImageOff, Trash2 } from '../../lib/icons.js'
import { useConfirm } from '../ui/confirm.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, withAlpha } from '../../theme/tokens.js'

export interface IdentityAuditModalProps {
  /** Null = closed. The person to analyse when open. */
  readonly identityId: string | null
  readonly serverUrl: string | null
  readonly mediaHeaders?: Readonly<Record<string, string>>
  readonly onClose: () => void
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

interface RowProps {
  readonly row: IdentityAuditRow
  readonly identityId: string
  readonly flagThreshold: number
  readonly serverUrl: string | null
  readonly mediaHeaders?: Readonly<Record<string, string>>
}

function AuditRow({ row, identityId, flagThreshold, serverUrl, mediaHeaders }: RowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const confirm = useConfirm()
  const remove = useRemoveIdentitySample()
  const [failure, setFailure] = React.useState<string | null>(null)
  const flagged = row.suspicion >= flagThreshold
  const uri =
    row.mediaId !== undefined && serverUrl !== null
      ? buildMediaIdUrl(serverUrl, row.mediaId)
      : null

  // A removal that FAILED says so, on the row, in the hub's own words. It used
  // to reject into a floating `void onRemove()`: the row stayed, the panel said
  // nothing, and the operator reported the whole feature as inert. A write that
  // drops silently is indistinguishable from one that was never wired.
  const onRemove = async (): Promise<void> => {
    hapticTap()
    const ok = await confirm({
      title: t('v2.faceReview.auditRemoveTitle'),
      message: t('v2.faceReview.auditRemoveBody'),
      destructive: true,
    })
    if (!ok) return
    hapticAction()
    setFailure(null)
    try {
      await remove.mutateAsync({ identityId, sampleId: row.sampleId })
    } catch (error: unknown) {
      log.error('face-audit', 'removing an enrolled sample failed', {
        identityId,
        sampleId: row.sampleId,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      })
      setFailure(
        error instanceof Error && error.message.length > 0
          ? error.message
          : t('v2.faceReview.auditRemoveFailed'),
      )
    }
  }

  return (
    <View
      style={[
        styles.row,
        { borderColor: flagged ? colors.warning : colors.border },
      ]}
    >
      {uri === null ? (
        // NOT a blank square. A missing crop is a FACT about this sample — on
        // this gallery, 2026-09-08, 276 of 327 enrolled samples have a row and
        // no blob — and a grey box reads as "loading" or "empty", which is the
        // one thing it must not. The vector is intact either way, so the scores
        // beside it still mean what they say.
        <View style={[styles.thumb, styles.thumbGone, { borderColor: colors.border }]}>
          <ImageOff size={16} color={colors.foregroundMuted} />
        </View>
      ) : (
        <Image
          source={mediaHeaders === undefined ? { uri } : { uri, headers: { ...mediaHeaders } }}
          style={styles.thumb}
          resizeMode="cover"
        />
      )}
      <View style={styles.rowBody}>
        {!row.comparable ? (
          <Text style={[styles.reason, { color: colors.foregroundMuted }]}>
            {t('v2.faceReview.auditNotComparable')}
          </Text>
        ) : (
          <>
            <Text style={[styles.reason, { color: colors.foreground }]}>
              {row.bestForeign === undefined
                ? t('v2.faceReview.auditSelfOnly', {
                    self: row.selfMean === null ? '—' : percent(row.selfMean),
                  })
                : t('v2.faceReview.auditLooksLike', {
                    name: row.bestForeign.name,
                    foreign: percent(row.bestForeign.score),
                    self: row.selfMean === null ? '—' : percent(row.selfMean),
                  })}
            </Text>
            <Text style={[styles.meta, { color: colors.foregroundMuted }]}>
              {new Date(row.enrolledAt).toLocaleString()}
              {row.deviceId === undefined ? '' : ` · #${String(row.deviceId)}`}
              {row.source === 'photo' ? ` · ${t('v2.faceReview.auditFromPhoto')}` : ''}
            </Text>
          </>
        )}
        {failure !== null ? (
          <Text style={[styles.failure, { color: colors.danger }]}>
            {t('v2.faceReview.auditRemoveFailed')} {failure}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('v2.faceReview.auditRemoveTitle')}
        disabled={remove.isPending}
        onPress={() => {
          void onRemove()
        }}
        style={styles.remove}
      >
        {remove.isPending ? (
          <ActivityIndicator size="small" color={colors.danger} />
        ) : (
          <Trash2 size={16} color={colors.danger} />
        )}
      </Pressable>
    </View>
  )
}

export function IdentityAuditModal({
  identityId,
  serverUrl,
  mediaHeaders,
  onClose,
}: IdentityAuditModalProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { data, isLoading, isError } = useIdentityAudit(identityId)

  return (
    <Modal
      visible={identityId !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { backgroundColor: withAlpha(colors.background, 0.5) }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={t('v2.common.close')}
          onPress={onClose}
        />
        <View
          style={[
            styles.card,
            { backgroundColor: colors.backgroundElevated, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t('v2.faceReview.auditTitle', { name: data?.name ?? '' })}
          </Text>
          {isLoading ? (
            <ActivityIndicator style={styles.centre} color={colors.primary} />
          ) : isError || data === null || data === undefined ? (
            // A hub too old for the method answers nothing. Saying "not
            // available" is the truth; an empty list would read as a clean
            // gallery, which is the one conclusion this panel must never
            // produce by accident.
            <Text style={[styles.centre, { color: colors.foregroundMuted }]}>
              {t('v2.faceReview.auditUnavailable')}
            </Text>
          ) : (
            <>
              <Text style={[styles.summary, { color: colors.foregroundMuted }]}>
                {t('v2.faceReview.auditSummary', {
                  flagged: data.flagged,
                  total: data.totalSamples,
                })}
              </Text>
              <ScrollView style={styles.scroll}>
                {data.rows.map((row) => (
                  <AuditRow
                    key={row.sampleId}
                    row={row}
                    identityId={data.identityId}
                    flagThreshold={data.flagThreshold}
                    serverUrl={serverUrl}
                    {...(mediaHeaders === undefined ? {} : { mediaHeaders })}
                  />
                ))}
              </ScrollView>
            </>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={[styles.close, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.closeLabel, { color: colors.primaryOn }]}>{t('v2.common.ok')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '85%',
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
  },
  title: { fontSize: 16, fontWeight: '600' },
  summary: { fontSize: 12, marginTop: SPACING.xs, marginBottom: SPACING.sm },
  centre: { marginVertical: SPACING.lg, textAlign: 'center', fontSize: 13 },
  scroll: { flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.sm,
    marginBottom: SPACING.xs,
  },
  thumb: { width: 56, height: 56, borderRadius: RADIUS.sm },
  thumbGone: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed' },
  rowBody: { flex: 1, gap: 2 },
  reason: { fontSize: 12 },
  meta: { fontSize: 10 },
  failure: { fontSize: 10, fontWeight: '700' },
  remove: { padding: SPACING.sm },
  close: {
    marginTop: SPACING.md,
    alignSelf: 'flex-end',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: RADIUS.md,
  },
  closeLabel: { fontSize: 13, fontWeight: '600' },
})
