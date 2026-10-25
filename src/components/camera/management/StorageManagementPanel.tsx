/**
 * StorageManagementPanel — per-camera recordings storage management, as a panel
 * that TAKES OVER the timeline body.
 *
 * It was a `presentationStyle="pageSheet"` `<Modal>`, reached from the
 * view-options menu — which was itself a floating card. A pageSheet is a
 * PORTRAIT-shaped presentation in a window of its own: rotate into the
 * landscape camera view and it arrives as a sheet over a rotated app, detached
 * from the surface that opened it. That is the same defect as the floats this
 * layout retired, and a modal is the one float that never LOOKS broken, so
 * nothing but a guard keeps it from coming back (`panels-own-the-body.spec`).
 *
 * The `visible` prop went with it. The panel is MOUNTED only while it owns the
 * body, so "is it showing" is not a second fact anyone can get wrong — and the
 * usage query, which used to take `visible` as its enabled flag, is simply
 * always enabled here.
 *
 * Shows this camera's recorded footage bytes (from the node-wide
 * `recording.getStorageUsage`) plus the node total + per-location capacity, and
 * offers three admin ops guarded by a confirm dialog:
 *   • Apply retention now (`pruneFootage`, reason-tagged),
 *   • Delete a recent window (`deleteFootprint({ fromMs, toMs })`),
 *   • Delete the whole footprint (`deleteFootprint({ deviceId })`).
 *
 * Uses the Section/Row shell and the shared `useConfirm` / `useNotice` surface
 * (`components/ui/confirm.tsx`) for its destructive confirmations: the system
 * alert is a no-op on the web and this panel is reachable from a browser.
 */
import React, { useMemo, useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { HardDrive, Trash2, Timer } from '../../../lib/icons.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { TimelinePanelHost } from '../theater/TimelinePanelHost.js'
import { Section } from '../../ui/Section.js'
import { useConfirm, useNotice } from '../../ui/confirm.js'
import { Row } from '../../ui/Row.js'
import { formatBytes } from '../../../data/export-format.js'
import {
  useStorageUsage,
  usePruneFootage,
  useDeleteFootprint,
} from '../../../data/use-storage-management.js'

export interface StorageManagementPanelProps {
  readonly deviceId: number
  readonly cameraName: string
  /** Return to the view-options panel this one was opened from. */
  readonly onBack: () => void
  readonly onClose: () => void
}

/** Windowed-delete presets (ms back from now). `null` = whole footprint. */
const WINDOW_PRESETS: readonly { readonly key: string; readonly ms: number | null }[] = [
  { key: 'window24h', ms: 24 * 3600_000 },
  { key: 'window7d', ms: 7 * 24 * 3600_000 },
  { key: 'window30d', ms: 30 * 24 * 3600_000 },
  { key: 'windowAll', ms: null },
]

export function StorageManagementPanel({
  deviceId,
  cameraName,
  onBack,
  onClose,
}: StorageManagementPanelProps): React.JSX.Element {
  const { t } = useTranslation()
  const confirm = useConfirm()
  const notice = useNotice()
  const { colors } = useTheme()
  const [windowKey, setWindowKey] = useState<string>(WINDOW_PRESETS[0].key)

  const usage = useStorageUsage(true)
  const prune = usePruneFootage()
  const del = useDeleteFootprint()
  const busy = prune.isPending || del.isPending

  const deviceUsed = useMemo(() => {
    const found = usage.data?.devices.find((d) => d.deviceId === deviceId)
    return found?.usedBytes ?? 0
  }, [usage.data, deviceId])

  const selectedWindow = WINDOW_PRESETS.find((w) => w.key === windowKey) ?? WINDOW_PRESETS[0]

  const onPrune = (): void => {
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: t('v2.storage.pruneConfirmTitle', 'Apply retention?'),
        message: t('v2.storage.pruneConfirmBody', {
          defaultValue: 'Delete footage on {{name}} that exceeds its retention policy.',
          name: cameraName,
        }),
        confirmLabel: t('v2.storage.pruneAction', 'Apply'),
        cancelLabel: t('v2.storage.cancel', 'Cancel'),
      })
      if (!ok) return
      prune.mutate(
        { deviceId, reason: 'manual' },
        {
          onSuccess: (r) =>
            notice({
              title: t('v2.storage.title', 'Storage'),
              message: t('v2.storage.pruneResult', {
                defaultValue: 'Reclaimed {{bytes}} ({{buckets}} segments).',
                bytes: formatBytes(r?.reclaimedBytes ?? 0),
                buckets: r?.deletedBuckets ?? 0,
              }),
            }),
          onError: (e) => notice({ title: t('v2.storage.title', 'Storage'), message: e.message }),
        },
      )
    })()
  }

  const onDelete = (): void => {
    const now = Date.now()
    const input =
      selectedWindow.ms === null
        ? { deviceId }
        : { deviceId, fromMs: now - selectedWindow.ms, toMs: now }
    void (async (): Promise<void> => {
      const ok = await confirm({
        title: t('v2.storage.deleteConfirmTitle', 'Delete footage?'),
        message: t('v2.storage.deleteConfirmBody', {
          defaultValue:
            'Permanently delete {{range}} of footage on {{name}}. This cannot be undone.',
          range: t(`v2.storage.${selectedWindow.key}`),
          name: cameraName,
        }),
        confirmLabel: t('v2.storage.deleteAction', 'Delete'),
        cancelLabel: t('v2.storage.cancel', 'Cancel'),
        destructive: true,
      })
      if (!ok) return
      del.mutate(input, {
        onSuccess: (r) =>
          notice({
            title: t('v2.storage.title', 'Storage'),
            message: t('v2.storage.deleteResult', {
              defaultValue: 'Reclaimed {{bytes}} ({{buckets}} segments).',
              bytes: formatBytes(r?.reclaimedBytes ?? 0),
              buckets: r?.deletedBuckets ?? 0,
            }),
          }),
        onError: (e) => notice({ title: t('v2.storage.title', 'Storage'), message: e.message }),
      })
    })()
  }

  return (
    <TimelinePanelHost title={t('v2.storage.title', 'Storage')} onBack={onBack} onClose={onClose}>
      {/* Usage */}
      <Section title={t('v2.storage.usageTitle', 'Usage')}>
        <Row
          label={cameraName}
          value={usage.isLoading ? '…' : formatBytes(deviceUsed)}
          icon={HardDrive}
        />
        <Row
          label={t('v2.storage.nodeTotal', 'Node total')}
          value={usage.isLoading ? '…' : formatBytes(usage.data?.totalUsedBytes ?? 0)}
        />
        {(usage.data?.locations ?? []).map((loc, i) => (
          <Row
            key={loc.locationId ?? `loc-${i}`}
            label={loc.locationId ?? t('v2.storage.defaultLocation', 'Default location')}
            value={
              loc.availableBytes !== null
                ? t('v2.storage.locationFree', {
                    defaultValue: '{{free}} free',
                    free: formatBytes(loc.availableBytes),
                  })
                : formatBytes(loc.usedBytes)
            }
            last={i === (usage.data?.locations.length ?? 0) - 1}
          />
        ))}
      </Section>

      {/* Retention prune */}
      <Section title={t('v2.storage.retentionTitle', 'Retention')}>
        <Row
          label={t('v2.storage.pruneAction', 'Apply retention now')}
          icon={Timer}
          onPress={busy ? undefined : onPrune}
          last
        />
      </Section>

      {/* Windowed / full delete */}
      <Section title={t('v2.storage.deleteTitle', 'Delete footage')}>
        <View style={styles.block}>
          <View style={styles.chipRow}>
            {WINDOW_PRESETS.map((w) => {
              const active = w.key === windowKey
              return (
                <Pressable
                  key={w.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setWindowKey(w.key)}
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
                    {t(`v2.storage.${w.key}`)}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>
        <Row
          label={t('v2.storage.deleteAction', 'Delete')}
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
})
