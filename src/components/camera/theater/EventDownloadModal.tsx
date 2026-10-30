/**
 * EventDownloadModal — "keep this event", opened by the card's download icon.
 *
 * > The operator, issue camstack/server#6: the icon on a native clip's card now
 * > sits on every event's card, and always opens a dialog.
 *
 * Two things can be kept:
 *
 *  - a CLIP — the event's span widened by a lead-in and a tail (5 s each unless
 *    changed), exported through the SAME path as a timeline selection
 *    (`planSelectionCommit` + `useRunExport`), so the Activity item and the
 *    notice are the ones that flow already produces;
 *  - a SNAPSHOT — the event's still, at the native full resolution when its
 *    media has one, else the display variant, saved through the track detail's
 *    own share path (`useShareTrackMedia`).
 *
 * ## An option that cannot work is SHOWN refused
 *
 * Save is disabled with its reason when nothing was recorded under the clip
 * (`absent`), and the high-resolution row is drawn disabled when the event has
 * no full variant — never dropped, never live-and-failing. A clip that is only
 * partly recorded asks first, with the recorder flow's own words.
 */
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useDateLocale } from '../../../lib/date-locale.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING, TABULAR, TYPOGRAPHY } from '../../../theme/tokens.js'
import { useEventSnapshotGroup } from '../../../data/use-event-snapshot-group.js'
import { useShareTrackMedia } from '../../../data/use-share-track-media.js'
import {
  EVENT_CLIP_DEFAULT_PAD_MS,
  EVENT_CLIP_PAD_CHOICES_MS,
  eventClipCoverage,
  eventClipGate,
  eventClipRange,
  eventSnapshotFilename,
  snapshotOptions,
  type SnapshotResolution,
} from '../../../recording/event-download.js'
import { formatSelectionDuration, formatSelectionSpan } from '../../../recording/export-selection.js'
import { planSelectionCommit } from '../../../recording/selection-commit.js'
import { useRunExport } from '../../../recording/use-run-export.js'
import type { TimeRange } from '../../../timeline/coverage.js'
import { Button } from '../../ui/Button.js'
import { useConfirm } from '../../ui/confirm.js'
import { SegmentedControl } from '../../ui/SegmentedControl.js'
import { SheetHeader } from '../../ui/SheetHeader.js'
import { SheetModal } from '../../ui/SheetModal.js'
import type { ObjectEvent } from './event-cluster.js'

export const EVENT_DOWNLOAD_MODAL_TEST_ID = 'event-download-modal'
export const EVENT_DOWNLOAD_SAVE_TEST_ID = 'event-download-save'
export const EVENT_DOWNLOAD_SNAPSHOT_OPTION_TEST_ID = 'event-download-snapshot-option'

type DownloadMode = 'clip' | 'snapshot'

export interface EventDownloadModalProps {
  readonly event: ObjectEvent
  readonly cameraName: string
  /** The day-window recorded coverage the timeline already holds. */
  readonly coverage: readonly TimeRange[]
  readonly windowFromMs: number
  readonly windowToMs: number
  readonly onClose: () => void
}

function clockLabel(ms: number, locale: string): string {
  return new Date(ms).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export const EventDownloadModal = memo(function EventDownloadModal({
  event,
  cameraName,
  coverage,
  windowFromMs,
  windowToMs,
  onClose,
}: EventDownloadModalProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState<DownloadMode>('clip')

  return (
    <SheetModal
      visible
      onClose={onClose}
      backdropLabel={t('v2.common.close')}
      testID={EVENT_DOWNLOAD_MODAL_TEST_ID}
      sheetStyle={[
        styles.sheet,
        { backgroundColor: colors.backgroundElevated, paddingBottom: insets.bottom + SPACING.md },
      ]}
    >
      <SheetHeader title={t('v2.eventDownload.title')} onClose={onClose} />
      <View style={styles.body}>
        <SegmentedControl<DownloadMode>
          options={[
            { value: 'clip', label: t('v2.eventDownload.modeClip') },
            { value: 'snapshot', label: t('v2.eventDownload.modeSnapshot') },
          ]}
          value={mode}
          onChange={setMode}
        />
        {mode === 'clip' ? (
          <ClipPanel
            event={event}
            cameraName={cameraName}
            coverage={coverage}
            windowFromMs={windowFromMs}
            windowToMs={windowToMs}
            onDone={onClose}
          />
        ) : (
          <SnapshotPanel event={event} onDone={onClose} />
        )}
      </View>
    </SheetModal>
  )
})

function padOptions(t: (key: string, opts?: Record<string, unknown>) => string) {
  return EVENT_CLIP_PAD_CHOICES_MS.map((ms) => ({
    value: String(ms),
    label: t('v2.eventDownload.seconds', { count: ms / 1000 }),
  }))
}

function ClipPanel({
  event,
  cameraName,
  coverage,
  windowFromMs,
  windowToMs,
  onDone,
}: {
  readonly event: ObjectEvent
  readonly cameraName: string
  readonly coverage: readonly TimeRange[]
  readonly windowFromMs: number
  readonly windowToMs: number
  readonly onDone: () => void
}): React.ReactElement {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const locale = useDateLocale()
  const confirm = useConfirm()
  const { run, pending } = useRunExport(event.deviceId, cameraName)
  const [preMs, setPreMs] = useState(EVENT_CLIP_DEFAULT_PAD_MS)
  const [postMs, setPostMs] = useState(EVENT_CLIP_DEFAULT_PAD_MS)

  const range = useMemo(
    () => eventClipRange(event, preMs, postMs, Date.now()),
    [event, preMs, postMs],
  )
  const verdict = eventClipCoverage(coverage, windowFromMs, windowToMs, range)
  const gate = eventClipGate(verdict)
  const options = useMemo(() => padOptions(t), [t])

  const onSave = useCallback((): void => {
    void (async () => {
      const plan = planSelectionCommit('export', true, event.deviceId, range)
      if (plan.action !== 'export') return
      if (gate === 'confirm-gap') {
        const proceed = await confirm({
          title: t('v2.exportSelection.gapTitle'),
          message: t('v2.exportSelection.gapMessage', {
            duration: formatSelectionDuration(range.durationMs),
          }),
          confirmLabel: t('v2.exportSelection.gapConfirm'),
          cancelLabel: t('common.cancel'),
        })
        if (!proceed) return
      }
      try {
        await run(plan)
      } finally {
        onDone()
      }
    })()
  }, [confirm, event.deviceId, gate, onDone, range, run, t])

  return (
    <View style={styles.panel}>
      <Text style={[styles.label, { color: colors.foregroundMuted }]}>
        {t('v2.eventDownload.before')}
      </Text>
      <SegmentedControl
        options={options}
        value={String(preMs)}
        onChange={(v) => setPreMs(Number(v))}
      />
      <Text style={[styles.label, { color: colors.foregroundMuted }]}>
        {t('v2.eventDownload.after')}
      </Text>
      <SegmentedControl
        options={options}
        value={String(postMs)}
        onChange={(v) => setPostMs(Number(v))}
      />
      <Text style={[styles.span, TABULAR, { color: colors.foreground }]}>
        {t('v2.eventDownload.span', {
          from: clockLabel(range.fromMs, locale),
          to: clockLabel(range.toMs, locale),
          duration: formatSelectionSpan(range.durationMs),
        })}
      </Text>
      {gate === 'blocked' ? (
        <Text style={[styles.note, { color: colors.danger }]}>{t('v2.eventDownload.absent')}</Text>
      ) : gate === 'confirm-gap' ? (
        <Text style={[styles.note, { color: colors.warning }]}>{t('v2.eventDownload.partial')}</Text>
      ) : null}
      <Button
        label={t('v2.eventDownload.saveClip')}
        onPress={onSave}
        disabled={gate === 'blocked'}
        busy={pending}
        testID={EVENT_DOWNLOAD_SAVE_TEST_ID}
      />
    </View>
  )
}

function SnapshotPanel({
  event,
  onDone,
}: {
  readonly event: ObjectEvent
  readonly onDone: () => void
}): React.ReactElement {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const found = useEventSnapshotGroup(event)
  const shared = useShareTrackMedia(event.deviceId, event.trackId ?? null)
  const choices = snapshotOptions(found.status === 'ready' ? found.group : null)
  const [picked, setPicked] = useState<SnapshotResolution>('high')
  const resolution: SnapshotResolution = choices.high === null ? 'low' : picked
  const file = resolution === 'high' ? choices.high : choices.low

  useEffect(() => {
    if (shared.result === 'done') onDone()
  }, [shared.result, onDone])

  const rows: readonly { readonly value: SnapshotResolution; readonly refused: boolean }[] = [
    { value: 'high', refused: choices.high === null },
    { value: 'low', refused: choices.low === null },
  ]
  const reason =
    found.status === 'loading'
      ? t('v2.eventDownload.snapshotLoading')
      : found.status === 'none'
        ? t('v2.eventDownload.snapshotNone')
        : choices.high === null
          ? t('v2.eventDownload.highUnavailable')
          : null

  return (
    <View style={styles.panel}>
      {rows.map((row) => {
        const selected = row.value === resolution && !row.refused
        return (
          <Pressable
            key={row.value}
            testID={EVENT_DOWNLOAD_SNAPSHOT_OPTION_TEST_ID}
            disabled={row.refused}
            onPress={() => setPicked(row.value)}
            accessibilityRole="button"
            accessibilityState={{ disabled: row.refused, selected }}
            style={[
              styles.row,
              {
                backgroundColor: colors.surface,
                borderColor: selected ? colors.primary : colors.border,
                opacity: row.refused ? 0.45 : 1,
              },
            ]}
          >
            <Text style={[styles.rowLabel, { color: colors.foreground }]}>
              {t(`v2.eventDownload.resolution.${row.value}`)}
            </Text>
          </Pressable>
        )
      })}
      {reason !== null ? (
        <Text style={[styles.note, { color: colors.foregroundMuted }]}>{reason}</Text>
      ) : null}
      {shared.result === 'failed' ? (
        <Text style={[styles.note, { color: colors.danger }]}>{t('v2.eventDownload.failed')}</Text>
      ) : null}
      <Button
        label={t('v2.eventDownload.saveSnapshot')}
        onPress={() => {
          if (file !== null) shared.share(file, eventSnapshotFilename(event, resolution))
        }}
        disabled={file === null}
        busy={shared.busy}
        testID={EVENT_DOWNLOAD_SAVE_TEST_ID}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
  },
  body: { paddingHorizontal: SPACING.lg, gap: SPACING.md },
  panel: { gap: SPACING.sm },
  label: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.medium },
  span: { fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.medium, paddingVertical: SPACING.xs },
  note: { fontSize: TYPOGRAPHY.size.sm },
  row: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  rowLabel: { fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.medium },
})
