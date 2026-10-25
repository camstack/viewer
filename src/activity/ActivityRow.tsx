/**
 * ActivityRow — one item of the Activity list: what it is, where it stands, and
 * (once it is a file) the two things you do with it.
 */
import React, { memo, useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { Translate } from '../data/export-format.js'

import { ProgressStrip } from '../components/ui/ProgressStrip.js'
import { useDateLocale } from '../lib/date-locale.js'
import {
  Camera,
  Clapperboard,
  Download,
  RefreshCw,
  Share2,
  Sparkles,
  Trash2,
  UserCheck,
  X,
  type LucideIcon,
} from '../lib/icons.js'
import { progressFrom } from '../lib/progress.js'
import { useTheme } from '../theme/theme-provider.js'
import { RADIUS, SPACING, TABULAR } from '../theme/tokens.js'
import type { ActivityItem, JobKind } from './activity-model.js'
import {
  canCollect,
  exportDurationLabel,
  jobCountLabel,
  jobFailureReason,
  progressPercent,
  rowState,
  rowTitle,
  whenLabel,
} from './activity-present.js'

export interface ActivityRowProps {
  readonly item: ActivityItem
  readonly nowMs: number
  readonly onDownload: (item: ActivityItem) => Promise<void>
  readonly onShare: (item: ActivityItem) => Promise<void>
  readonly onRemove: (id: string) => void
}

const JOB_ICON: Readonly<Record<JobKind, LucideIcon>> = {
  'face-rescore': RefreshCw,
  'face-assign': UserCheck,
  'face-apply-suggestions': Sparkles,
  'face-analyze-assign': Sparkles,
  'face-delete': Trash2,
  'plate-assign': UserCheck,
  'plate-apply-suggestions': Sparkles,
  'plate-delete': Trash2,
}

function iconFor(item: ActivityItem): LucideIcon {
  if (item.kind === 'job') return JOB_ICON[item.jobKind]
  return item.kind === 'snapshot' ? Camera : Clapperboard
}

const ICON_BOX = 36
const ACTION_ICON = 16
const STRIP_HEIGHT = 4

export const ActivityRow = memo(function ActivityRow({
  item,
  nowMs,
  onDownload,
  onShare,
  onRemove,
}: ActivityRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const locale = useDateLocale()
  const [busy, setBusy] = useState<'download' | 'share' | null>(null)
  const [stripWidth, setStripWidth] = useState(0)

  const state = rowState(item)
  const running = state === 'queued' || state === 'rendering' || state === 'running'
  const percent = progressPercent(item)
  const KindIcon = iconFor(item)
  const duration = exportDurationLabel(item)
  const title = rowTitle(item)
  const jobFailure = jobFailureReason(item)
  // A running job cannot be cleared; a queued one is cancelled by the same X.
  const removable = state !== 'running'

  const stateColor =
    state === 'failed'
      ? colors.danger
      : state === 'ready' || state === 'done'
        ? colors.success
        : colors.foregroundMuted
  const stateText = stateLabel(item, state, percent, t)

  const run = useCallback(
    async (kind: 'download' | 'share'): Promise<void> => {
      setBusy(kind)
      try {
        await (kind === 'download' ? onDownload(item) : onShare(item))
      } finally {
        setBusy(null)
      }
    },
    [item, onDownload, onShare],
  )

  const onStripLayout = useCallback((e: LayoutChangeEvent): void => {
    setStripWidth(e.nativeEvent.layout.width)
  }, [])

  return (
    <View
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.borderSubtle }]}
      accessibilityLabel={`${title}, ${stateText}`}
    >
      <View style={styles.head}>
        <View style={[styles.iconBox, { backgroundColor: colors.surfaceHover }]}>
          <KindIcon size={18} color={colors.foregroundMuted} />
        </View>
        <View style={styles.titles}>
          <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.sub, TABULAR, { color: colors.foregroundMuted }]} numberOfLines={1}>
            {whenLabel(item, nowMs, locale)}
            {duration !== null ? ` · ${duration}` : ''}
          </Text>
          {/* Its own line: beside the time it squeezed the duration to "1:…". */}
          <Text style={[styles.state, { color: stateColor }]} numberOfLines={item.kind === 'job' ? 2 : 1}>
            {stateText}
          </Text>
        </View>
        {removable ? (
          <Pressable
            onPress={() => onRemove(item.id)}
            hitSlop={8}
            style={styles.remove}
            accessibilityRole="button"
            accessibilityLabel={state === 'queued' && item.kind === 'job' ? t('v2.activity.cancel') : t('v2.activity.remove')}
          >
            <X size={ACTION_ICON} color={colors.foregroundSubtle} />
          </Pressable>
        ) : null}
      </View>

      {running ? (
        <View onLayout={onStripLayout} style={styles.strip}>
          <ProgressStrip
            progress={progressFrom(percent === null ? null : percent / 100)}
            width={stripWidth}
            color={colors.primary}
            trackColor={colors.border}
            height={STRIP_HEIGHT}
          />
        </View>
      ) : null}

      {state === 'failed' && item.kind === 'export' && item.error !== null ? (
        <Text style={[styles.reason, { color: colors.danger }]} numberOfLines={2}>
          {item.error}
        </Text>
      ) : null}
      {jobFailure !== null ? (
        <Text style={[styles.reason, { color: colors.danger }]} numberOfLines={2}>
          {jobFailure}
        </Text>
      ) : null}

      {canCollect(item) ? (
        <View style={styles.actions}>
          <ActionButton
            label={t('v2.activity.download')}
            busy={busy === 'download'}
            disabled={busy !== null}
            onPress={() => void run('download')}
            icon={<Download size={ACTION_ICON} color={colors.primaryForeground} />}
            filled
          />
          <ActionButton
            label={t('v2.activity.share')}
            busy={busy === 'share'}
            disabled={busy !== null}
            onPress={() => void run('share')}
            icon={<Share2 size={ACTION_ICON} color={colors.foreground} />}
          />
        </View>
      ) : null}
    </View>
  )
})

/** The state line: a job says how far it is or what it did; a file says where it stands. */
function stateLabel(
  item: ActivityItem,
  state: ReturnType<typeof rowState>,
  percent: number | null,
  t: Translate,
): string {
  if (item.kind === 'job') {
    if (item.state === 'running') {
      const count = jobCountLabel(item)
      return count === null ? t('v2.activity.state.running') : t('v2.activity.state.runningCount', { count })
    }
    if (item.state === 'done' && item.summary !== null) return item.summary
    if (item.state === 'failed' && item.interrupted) return t('v2.activity.state.interrupted')
  }
  if (state === 'rendering' && percent !== null) return t('v2.activity.state.renderingPct', { pct: percent })
  return t(`v2.activity.state.${state}`)
}

interface ActionButtonProps {
  readonly label: string
  readonly icon: React.ReactNode
  readonly onPress: () => void
  readonly busy: boolean
  readonly disabled: boolean
  readonly filled?: boolean
}

function ActionButton({ label, icon, onPress, busy, disabled, filled = false }: ActionButtonProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy }}
      style={[
        styles.action,
        filled
          ? { backgroundColor: colors.primary, borderColor: colors.primary }
          : { backgroundColor: colors.surfaceHover, borderColor: colors.border },
        disabled && !busy ? styles.dim : null,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={filled ? colors.primaryForeground : colors.foreground} /> : icon}
      <Text style={[styles.actionText, { color: filled ? colors.primaryForeground : colors.foreground }]}>
        {label}
      </Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: {
    borderWidth: 1,
    borderRadius: RADIUS.xl,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg },
  iconBox: {
    width: ICON_BOX,
    height: ICON_BOX,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 12 },
  state: { fontSize: 12, fontWeight: '600' },
  remove: { padding: SPACING.xs },
  strip: { width: '100%' },
  reason: { fontSize: 12 },
  actions: { flexDirection: 'row', gap: SPACING.md },
  action: {
    flex: 1,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.md,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.lg,
  },
  actionText: { fontSize: 13, fontWeight: '600' },
  dim: { opacity: 0.5 },
})
