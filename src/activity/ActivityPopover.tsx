/**
 * ActivityPopover — the Activity list: what this device queued or captured,
 * newest first, as a popover anchored to the Activity button (the same
 * `AnchoredMenu` the account menu uses), as tall as its rows up to about half
 * the window, then scrolling inside.
 *
 * Opening it marks everything seen (the "ready" dot clears) and keeps doing so
 * while it stays open, so an export that finishes under the operator's eyes
 * does not leave a dot behind it.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { AnchoredMenu } from '../components/ui/AnchoredMenu.js'
import type { AnchorRect } from '../components/ui/dropdown-placement.js'
import { useNotice } from '../components/ui/confirm.js'
import { useViewportSize } from '../hooks/use-viewport-size.js'
import { Activity, X } from '../lib/icons.js'
import { useTheme } from '../theme/theme-provider.js'
import { SPACING } from '../theme/tokens.js'
import { POPOVER_MIN_WIDTH } from '../navigation/popover-metrics.js'
import { useActivityStore } from './activity-instance.js'
import type { ActivityItem } from './activity-model.js'
import { hasFinishedJobs, orderForDisplay } from './activity-jobs.js'
import { activityPopoverSize } from './activity-popover-size.js'
import { ActivityRow } from './ActivityRow.js'
import { useActivityCollect } from './use-activity-collect.js'

export interface ActivityPopoverProps {
  readonly visible: boolean
  readonly onClose: () => void
  readonly anchor: AnchorRect | null
  readonly menuAlign: 'start' | 'end'
}

export function ActivityPopover({ visible, onClose, anchor, menuAlign }: ActivityPopoverProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const notice = useNotice()
  const items = useActivityStore((s) => s.items)
  const remove = useActivityStore((s) => s.remove)
  const dismiss = useActivityStore((s) => s.dismiss)
  const dismissFinished = useActivityStore((s) => s.dismissFinished)
  const markSeen = useActivityStore((s) => s.markSeen)
  const collect = useActivityCollect()

  // Seen while open: on open, and again whenever the list changes under it.
  useEffect(() => {
    if (visible) markSeen()
  }, [visible, items, markSeen])

  const listed = useMemo(() => orderForDisplay(items), [items])
  const canClearFinished = useMemo(() => hasFinishedJobs(items), [items])
  // A job is cleared (finished: hidden, queued: cancelled); a file is removed.
  const clearItem = useCallback(
    (id: string): void => {
      if (items.some((item) => item.id === id && item.kind === 'job')) dismiss(id)
      else remove(id)
    },
    [items, dismiss, remove],
  )

  // One timestamp per render of the list: "today" must not flip row by row.
  const nowMs = useMemo(() => Date.now(), [items, visible]) // eslint-disable-line react-hooks/exhaustive-deps

  const failed = useCallback(
    (): void => notice({ title: t('v2.activity.title'), message: t('v2.activity.collectFailed') }),
    [notice, t],
  )
  const onDownload = useCallback(
    async (item: ActivityItem): Promise<void> => {
      if (!(await collect.download(item))) failed()
    },
    [collect, failed],
  )
  const onShare = useCallback(
    async (item: ActivityItem): Promise<void> => {
      if (!(await collect.share(item))) failed()
    },
    [collect, failed],
  )

  const { height } = useViewportSize()
  // As tall as its rows, up to about half the window; the list scrolls inside
  // past that. `AnchoredMenu` places the card from its estimated height, so the
  // estimate follows the list's measured content once it has been laid out.
  const [measuredBody, setMeasuredBody] = useState<number | null>(null)
  const { sheetHeight, maxBodyHeight } = activityPopoverSize(listed.length, measuredBody, height)

  return (
    <AnchoredMenu
      visible={visible}
      onRequestClose={onClose}
      anchor={anchor}
      align={menuAlign}
      preferredPlacement="above"
      minWidth={POPOVER_MIN_WIDTH}
      estimatedHeight={sheetHeight}
    >
      <View style={styles.header}>
        <Text style={[styles.heading, { color: colors.foreground }]}>{t('v2.activity.title')}</Text>
        <View style={styles.headerActions}>
          {canClearFinished ? (
            <Pressable onPress={dismissFinished} hitSlop={8} accessibilityRole="button">
              <Text style={[styles.clear, { color: colors.primary }]}>{t('v2.activity.clearFinished')}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('v2.common.close')}>
            <X size={18} color={colors.foregroundMuted} />
          </Pressable>
        </View>
      </View>
      {listed.length === 0 ? (
        <View style={styles.empty}>
          <Activity size={22} color={colors.foregroundSubtle} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>{t('v2.activity.empty')}</Text>
          <Text style={[styles.emptyHint, { color: colors.foregroundMuted }]}>{t('v2.activity.emptyHint')}</Text>
        </View>
      ) : (
        <ScrollView
          style={{ maxHeight: maxBodyHeight }}
          contentContainerStyle={styles.list}
          onContentSizeChange={(_w, h) => setMeasuredBody(h)}
          nestedScrollEnabled
        >
          {listed.map((item) => (
            <ActivityRow key={item.id} item={item} nowMs={nowMs} onDownload={onDownload} onShare={onShare} onRemove={clearItem} />
          ))}
        </ScrollView>
      )}
    </AnchoredMenu>
  )
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.lg,
  },
  heading: { fontSize: 16, fontWeight: '700' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg },
  clear: { fontSize: 13, fontWeight: '600' },
  list: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg, gap: SPACING.md },
  empty: { alignItems: 'center', justifyContent: 'center', gap: SPACING.md, paddingHorizontal: SPACING['2xl'], paddingVertical: SPACING['2xl'] },
  emptyTitle: { fontSize: 15, fontWeight: '600' },
  emptyHint: { fontSize: 13, textAlign: 'center' },
})
