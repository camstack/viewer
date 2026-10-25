/**
 * EventsManagementPanel — per-camera durable event-store management, as a panel
 * that TAKES OVER the timeline body.
 *
 * It was a `presentationStyle="pageSheet"` `<Modal>` — see
 * `StorageManagementPanel` for what a portrait-shaped window of its own does to
 * the landscape camera view, and `panels-own-the-body.spec` for the guard that
 * keeps it from coming back. The `visible` prop went with the modal: the panel
 * is mounted only while it owns the body, so the footprint query no longer
 * needs a flag to tell it whether anyone is looking.
 *
 * Shows this camera's event rows + media bytes (from the cluster-wide
 * `pipelineAnalytics.getEventStoreFootprint`) plus the totals, and offers two
 * admin ops guarded by a confirm dialog:
 *   • Prune events older than a preset (`pruneEvents` — CLUSTER-WIDE by design),
 *   • Delete every event for this camera (`deleteDeviceEvents`).
 *
 * Uses the Section/Row shell and the shared `useConfirm` / `useNotice` surface
 * (`components/ui/confirm.tsx`) for its destructive confirmations: the system
 * alert is a no-op on the web and this panel is reachable from a browser.
 */
import React, { useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ListTree, Trash2, Timer } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { TimelinePanelHost } from '../theater/TimelinePanelHost.js'
import { Section } from '../../ui/Section.js'
import { useConfirm, useNotice } from '../../ui/confirm.js'
import { Row } from '../../ui/Row.js'
import { formatBytes } from '../../../data/export-format.js'
import {
  useEventStoreFootprint,
  usePruneEvents,
  useDeleteDeviceEvents,
  type EventPruneCounts,
} from '../../../data/use-storage-management.js'

export interface EventsManagementPanelProps {
  readonly deviceId: number
  readonly cameraName: string
  /** Return to the view-options panel this one was opened from. */
  readonly onBack: () => void
  readonly onClose: () => void
}

/** Older-than presets (ms back from now). */
const OLDER_THAN_PRESETS: readonly { readonly key: string; readonly ms: number }[] = [
  { key: 'older24h', ms: 24 * 3600_000 },
  { key: 'older7d', ms: 7 * 24 * 3600_000 },
  { key: 'older30d', ms: 30 * 24 * 3600_000 },
]

function totalCount(c: EventPruneCounts): number {
  return c.motion + c.object + c.audio
}

export function EventsManagementPanel({
  deviceId,
  cameraName,
  onBack,
  onClose,
}: EventsManagementPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const notice = useNotice()
  const { colors } = useTheme()
  const [olderKey, setOlderKey] = useState<string>(OLDER_THAN_PRESETS[1].key)

  const footprint = useEventStoreFootprint(true)
  const prune = usePruneEvents()
  const del = useDeleteDeviceEvents()
  const busy = prune.isPending || del.isPending

  const deviceFp = useMemo(
    () => footprint.data?.devices.find((d) => d.deviceId === deviceId),
    [footprint.data, deviceId],
  )

  const selectedOlder = OLDER_THAN_PRESETS.find((o) => o.key === olderKey) ?? OLDER_THAN_PRESETS[1]

  const onPrune = (): void => {
    const olderThanMs = Date.now() - selectedOlder.ms
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: t('v2.eventsMgmt.pruneConfirmTitle', 'Prune old events?'),
        message: t('v2.eventsMgmt.pruneConfirmBody', {
          defaultValue:
            'Delete events older than {{range}} across ALL cameras. This cannot be undone.',
          range: t(`v2.eventsMgmt.${selectedOlder.key}`),
        }),
        confirmLabel: t('v2.eventsMgmt.pruneAction', 'Prune'),
        cancelLabel: t('v2.eventsMgmt.cancel', 'Cancel'),
        destructive: true,
      })
      if (!ok) return
      prune.mutate(
        { olderThanMs, reason: 'manual' },
        {
          onSuccess: (c) =>
            notice({
              title: t('v2.eventsMgmt.title', 'Events'),
              message: t('v2.eventsMgmt.pruneResult', {
                defaultValue: 'Deleted {{count}} events.',
                count: totalCount(c),
              }),
            }),
          onError: (e) => notice({ title: t('v2.eventsMgmt.title', 'Events'), message: e.message }),
        },
      )
    })()
  }

  const onDelete = (): void => {
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: t('v2.eventsMgmt.deleteConfirmTitle', 'Delete all events?'),
        message: t('v2.eventsMgmt.deleteConfirmBody', {
          defaultValue: 'Permanently delete every event for {{name}}. This cannot be undone.',
          name: cameraName,
        }),
        confirmLabel: t('v2.eventsMgmt.deleteAction', 'Delete'),
        cancelLabel: t('v2.eventsMgmt.cancel', 'Cancel'),
        destructive: true,
      })
      if (!ok) return
      del.mutate(deviceId, {
        onSuccess: (c) =>
          notice({
            title: t('v2.eventsMgmt.title', 'Events'),
            message: t('v2.eventsMgmt.deleteResult', {
              defaultValue: 'Deleted {{count}} events.',
              count: totalCount(c),
            }),
          }),
        onError: (e) => notice({ title: t('v2.eventsMgmt.title', 'Events'), message: e.message }),
      })
    })()
  }

  return (
    <TimelinePanelHost title={t('v2.eventsMgmt.title', 'Events')} onBack={onBack} onClose={onClose}>
      {/* Footprint */}
      <Section title={t('v2.eventsMgmt.footprintTitle', 'Footprint')}>
        <Row
          label={cameraName}
          value={
            footprint.isLoading
              ? '…'
              : t('v2.eventsMgmt.rowsBytes', {
                  defaultValue: '{{rows}} events · {{bytes}}',
                  rows: deviceFp?.rows ?? 0,
                  bytes: formatBytes(deviceFp?.bytes ?? 0),
                })
          }
          icon={ListTree}
        />
        <Row
          label={t('v2.eventsMgmt.clusterTotal', 'Cluster total')}
          value={
            footprint.isLoading
              ? '…'
              : t('v2.eventsMgmt.rowsBytes', {
                  defaultValue: '{{rows}} events · {{bytes}}',
                  rows: footprint.data?.totalRows ?? 0,
                  bytes: formatBytes(footprint.data?.totalBytes ?? 0),
                })
          }
          last
        />
      </Section>

      {/* Prune older-than (cluster-wide) */}
      <Section title={t('v2.eventsMgmt.pruneTitle', 'Prune older than')}>
        <View style={styles.block}>
          <View style={styles.chipRow}>
            {OLDER_THAN_PRESETS.map((o) => {
              const active = o.key === olderKey
              return (
                <Pressable
                  key={o.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setOlderKey(o.key)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: active ? colors.primary : colors.background,
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={{
                      color: active ? colors.primaryForeground : colors.foregroundMuted,
                      fontSize: 13,
                      fontWeight: active ? '700' : '500',
                    }}
                  >
                    {t(`v2.eventsMgmt.${o.key}`)}
                  </Text>
                </Pressable>
              )
            })}
          </View>
          <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
            {t('v2.eventsMgmt.pruneHint', 'Applies to all cameras.')}
          </Text>
        </View>
        <Row
          label={t('v2.eventsMgmt.pruneAction', 'Prune')}
          icon={Timer}
          danger
          onPress={busy ? undefined : onPrune}
          last
        />
      </Section>

      {/* Delete this camera's events */}
      <Section title={t('v2.eventsMgmt.deleteTitle', 'Delete camera events')}>
        <Row
          label={t('v2.eventsMgmt.deleteAction', 'Delete all events for this camera')}
          icon={Trash2}
          danger
          onPress={busy ? undefined : onDelete}
          last
        />
      </Section>
    </TimelinePanelHost>
  )
}

const styles = StyleSheet.create({
  block: { padding: SPACING.xl, gap: SPACING.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.md },
  chip: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  hint: { fontSize: 12 },
})
