/**
 * ClipExportModal — "keep this clip", with the quality picked first.
 *
 * > *"se abbiamo gia' i profili disponibili su una clip allora va bene,
 * > mostriamo un piccolo modal dove far selezionare la qualita' e con un
 * > progress se possibile"* — the operator, 2026-09-23.
 *
 * ## Every keep goes through it
 *
 * The press on a clip's download icon always opens this dialog: one gesture, one
 * place where the operator sees what will be kept. With one distinct copy it
 * lists that one; with two it lists both with the sizes beside them — the size
 * is the thing that makes the choice mean anything (20.0 MB main vs 0.67 MB sub,
 * on 592).
 *
## An option that would be refused is SHOWN refused
 *
 * A copy above the export path's 50 MiB read bound is drawn disabled with its
 * reason, never dropped. Dropping it would silently downgrade the keep to the
 * sub file, which is the substitution D549 15 forbids doing quietly; and a
 * live control that fails when pressed is the other half of D62's defect.
 *
 * ## The progress is the RECORD's
 *
 * Not an HTTP byte count. The hub renders the export and reports `progressPct`
 * — the same on web and native, honest where no fraction exists (`null`, drawn
 * indeterminate through the app's one progress vocabulary, never a bar at
 * zero), and it keeps running when this modal is dismissed. Closing it
 * abandons the WATCH, never the job.
 *
 * ## What it does not promise
 *
 * It does not hand over a file. A finished export is collected from the
 * Library, which owns the download plane, the retention and the janitor. The
 * ready state says where it went and stops there.
 */

import React, { memo } from 'react'
// ui-check-ok: the clip picker predates SheetModal; migrating its progress states is its own change (pre-existing)
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { X } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { formatBytes } from '../../../data/export-format.js'
import { ProgressStrip } from '../../ui/ProgressStrip.js'
import type { ClipProfile } from '../../../clips/clip-quality.js'
import type { ClipQualityOption } from '../../../clips/clip-export-quality.js'
import type { ClipExportPhase } from '../../../clips/clip-export-progress.js'

export const CLIP_EXPORT_OPTION_TEST_ID = 'clip-export-option'
export const CLIP_EXPORT_PROGRESS_TEST_ID = 'clip-export-progress'

/** The bar's width in px, for the indeterminate sweep's native transform. */
const BAR_WIDTH = 260
const BAR_HEIGHT = 4

export interface ClipExportModalProps {
  readonly visible: boolean
  readonly options: readonly ClipQualityOption[]
  readonly phase: ClipExportPhase
  readonly onPick: (profile: ClipProfile) => void
  readonly onClose: () => void
}

export const ClipExportModal = memo(function ClipExportModal({
  visible,
  options,
  phase,
  onPick,
  onClose,
}: ClipExportModalProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  // Once something has been asked, the picker is spent: a second profile would
  // be a second wake and a second job off one gesture (D558 § 5.2).
  const picking = phase.kind === 'idle'

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.scrim} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.backgroundElevated }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.foreground }]}>
              {t('v2.clips.export.title')}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('v2.clips.export.close')}
              style={[styles.iconBtn, { backgroundColor: colors.surface }]}
            >
              <X size={18} color={colors.foreground} />
            </Pressable>
          </View>

          {picking ? (
            <>
              <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
                {t('v2.clips.export.pickHint')}
              </Text>
              {options.map((option) => (
                <QualityRow
                  key={option.profile}
                  option={option}
                  onPick={onPick}
                />
              ))}
            </>
          ) : (
            <PhaseBody phase={phase} />
          )}
        </View>
      </View>
    </Modal>
  )
})

function QualityRow({
  option,
  onPick,
}: {
  readonly option: ClipQualityOption
  readonly onPick: (profile: ClipProfile) => void
}): React.ReactElement {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const refused = option.refusal !== null
  return (
    <Pressable
      testID={CLIP_EXPORT_OPTION_TEST_ID}
      disabled={refused}
      onPress={() => onPick(option.profile)}
      accessibilityRole="button"
      accessibilityState={{ disabled: refused }}
      style={[
        styles.row,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: refused ? 0.45 : 1,
        },
      ]}
    >
      <Text style={[styles.rowLabel, { color: colors.foreground }]}>
        {t(`v2.clips.export.profile.${option.profile}`)}
      </Text>
      <Text style={[styles.rowMeta, { color: colors.foregroundMuted }]}>
        {refused
          ? t('v2.clips.export.tooLarge')
          : // An absent size is not zero and must not render as "—" beside a
            // live option: it is a copy whose weight the row did not state.
            option.bytes === null
            ? t('v2.clips.export.sizeUnknown')
            : formatBytes(option.bytes)}
      </Text>
    </Pressable>
  )
}

function PhaseBody({ phase }: { readonly phase: ClipExportPhase }): React.ReactElement {
  const { colors } = useTheme()
  const { t } = useTranslation()
  if (phase.kind === 'ready') {
    return (
      <>
        <Text style={[styles.status, { color: colors.foreground }]}>
          {t('v2.clips.export.ready')}
        </Text>
        <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
          {t('v2.clips.export.readyHint')}
        </Text>
      </>
    )
  }
  if (phase.kind === 'failed') {
    return (
      <>
        <Text style={[styles.status, { color: colors.danger }]}>
          {phase.failure?.code !== null && phase.failure?.code !== undefined
            ? t(`v2.clips.export.failure.${phase.failure.code}`)
            : t('v2.clips.export.failed')}
        </Text>
        {/* The producer's own words, verbatim. Never paraphrased (D563) and
            never translated — they are the camera's, not ours. */}
        {phase.failure !== null && phase.failure.detail.length > 0 ? (
          <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
            {phase.failure.detail}
          </Text>
        ) : null}
      </>
    )
  }
  // `asked` and `working` both say "running". They differ in what they can
  // MEASURE: `asked` has no record yet, so there is nothing to measure and the
  // bar is indeterminate by construction rather than by a null.
  const progress = phase.kind === 'working' ? phase.progress : { kind: 'unknown' as const }
  return (
    <>
      <Text style={[styles.status, { color: colors.foreground }]}>
        {t('v2.clips.export.working')}
      </Text>
      <View testID={CLIP_EXPORT_PROGRESS_TEST_ID} style={styles.bar}>
        <ProgressStrip
          progress={progress}
          width={BAR_WIDTH}
          color={colors.primary}
          trackColor={colors.surface}
          height={BAR_HEIGHT}
        />
      </View>
      <Text style={[styles.hint, { color: colors.foregroundMuted }]}>
        {t('v2.clips.export.workingHint')}
      </Text>
    </>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  // ui-check-ok: modal scrim; no scrim token in tokens.ts yet (pre-existing)
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000000AA' },
  sheet: {
    width: BAR_WIDTH + SPACING.lg * 2,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.sm,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 16, fontWeight: '700' },
  iconBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 12 },
  status: { fontSize: 14, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  rowLabel: { fontSize: 14, fontWeight: '600' },
  rowMeta: { fontSize: 12 },
  bar: { borderRadius: RADIUS.sm, overflow: 'hidden' },
})
