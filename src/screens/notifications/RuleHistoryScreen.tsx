/**
 * RuleHistoryScreen — one rule's deliveries (`/notifications/rule/[id]/history`),
 * opened from the "last run" line of its card.
 *
 * ADMIN ONLY. `getHistory` and `resolveArtifactUrl` are admin, and the card only
 * offers the way in to an admin — but a route can be deep-linked, so the screen
 * guards itself too, without a single call being made for anyone else. What it
 * SAYS depends on why it did not ask (D315):
 *   • verdict pending → a spinner;
 *   • `not-admin` (the hub ANSWERED) → "only an administrator…" — the one case
 *     that is a claim about the viewer's role;
 *   • `unknown` (`auth.me` failed) → an error with a retry, never a role;
 *   • a confirmed admin whose connection dropped → the list it already had,
 *     or a spinner, never "only an administrator…".
 *
 * The list is ONE `getHistory({ filter: { ruleId, limit: 50 } })`, newest
 * first, with no `since` — the outbox's own prune window already bounds it.
 * Pending, failed and empty are three different screens (D315): a read that
 * failed never reads as "no deliveries".
 *
 * Each row: when, which device, which target, how it ended (and why, for a
 * failure), and — when the delivery carried media — a thumbnail minted on
 * demand for that row alone ({@link RuleHistoryThumb}).
 *
 * A rule delivers for ANY device type — a contact sensor, a node, a
 * cross-camera digest — so a row is named from the device CATALOGUE the rule
 * pickers already read (`useDeviceCatalogue`), asked only while this screen is
 * mounted and only for an admin. The camera list goes first so an operator's
 * local camera rename reads here as everywhere else. A device neither source
 * names — including while the catalogue is loading or after it failed — is
 * "Device #id": never a camera word, and never "removed", which only an
 * answered read could say (D315).
 */
import React, { useMemo } from 'react'
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { NcHistoryEntry } from '@camstack/types'
import { ScreenHeader } from '../../components/ScreenHeader.js'
import { RuleHistoryThumb } from '../../components/notifications/RuleHistoryThumb.js'
import { deliveryStatusColor, useMinuteClock } from '../../components/notifications/RuleLastRunRow.js'
import { deliveryStatusKey } from '../../components/notifications/rule-last-run.js'
import { isStateSummaryHistoryRow } from '../../components/notifications/system-event-delivery.js'
import { capturedLabel, capturedStamp } from '../../data/nc-artifact-format.js'
import { useCameras } from '../../data/use-cameras.js'
import { useDeviceCatalogue } from '../../accessories/use-device-catalogue.js'
import { useMe } from '../../data/use-me.js'
import { useNcTargets } from '../../data/use-notification-center.js'
import { useRuleHistory } from '../../data/use-rule-history.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { EmptyState, ErrorState } from '../../components/ui/EmptyState.js'
import { History } from '../../lib/icons.js'

const NOTIFICATION_CENTER_PATH = '/settings/notifications'

export interface RuleHistoryScreenProps {
  readonly id: string
  /** The rule's name as the card knew it; absent on a bare deep link. */
  readonly name?: string
}

/** Names the rows need, resolved once per list. */
interface RowNames {
  readonly devices: ReadonlyMap<number, string>
  readonly targets: ReadonlyMap<string, string>
}

export function RuleHistoryScreen({ id, name }: RuleHistoryScreenProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  const me = useMe()
  const { asked, verdict, connected, query } = useRuleHistory(id)
  const cameras = useCameras({ includeHidden: true })
  const catalogue = useDeviceCatalogue(asked)
  const targets = useNcTargets()
  const nowMs = useMinuteClock()

  const names = useMemo<RowNames>(
    () => ({
      // Later entries win: catalogue first, then the camera list's local names.
      devices: new Map([
        ...(catalogue.data ?? []).map((device): readonly [number, string] => [device.id, device.name]),
        ...(cameras.data ?? []).map((camera): readonly [number, string] => [camera.id, camera.name]),
      ]),
      targets: new Map((targets.data ?? []).map((target) => [target.id, target.name])),
    }),
    [catalogue.data, cameras.data, targets.data],
  )

  const ruleName = name ?? query.data?.entries[0]?.ruleName
  const title =
    ruleName !== undefined && ruleName.length > 0
      ? t('v2.nc.rules.history.title', { name: ruleName })
      : t('v2.nc.rules.history.titleFallback')

  const back = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace(NOTIFICATION_CENTER_PATH)
  }

  const body = (() => {
    if (verdict === 'pending') return <Loading />
    if (verdict === 'not-admin') return <EmptyState fill={false} icon={History} title={t('v2.nc.rules.history.adminOnly')} />
    if (verdict === 'unknown') {
      return (
        <ErrorState fill={false} title={t('v2.nc.rules.history.verdictUnknown')} onRetry={() => void me.refetch()} />
      )
    }
    if (query.data === undefined) {
      if (!connected) return <Loading />
      return query.isError ? <ErrorState fill={false} title={t('v2.nc.rules.history.error')} onRetry={() => void query.refetch()} /> : <Loading />
    }
    if (query.data.entries.length === 0) return <EmptyState fill={false} icon={History} title={t('v2.nc.rules.history.empty')} />
    return (
      <FlatList
        data={query.data.entries}
        keyExtractor={(entry) => entry.id}
        renderItem={({ item }) => <HistoryRow entry={item} names={names} nowMs={nowMs} />}
        initialNumToRender={8}
        windowSize={5}
        contentContainerStyle={{ padding: SPACING.xl, gap: SPACING.md }}
      />
    )
  })()

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={title} onBack={back} bordered />
      {body}
    </View>
  )
}

interface HistoryRowProps {
  readonly entry: NcHistoryEntry
  readonly names: RowNames
  readonly nowMs: number
}

function HistoryRow({ entry, names, nowMs }: HistoryRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // A state summary (D647) spans devices: it is named for what it is.
  const device = isStateSummaryHistoryRow(entry)
    ? t('v2.nc.rules.history.stateSummary')
    : (names.devices.get(entry.deviceId) ?? t('v2.nc.rules.history.deviceById', { id: entry.deviceId }))
  const target = names.targets.get(entry.targetId) ?? entry.targetId
  const artifactId = entry.artifactIds?.[0]
  return (
    <View
      testID={`rule-history-row-${entry.id}`}
      style={{
        flexDirection: 'row',
        gap: SPACING.md,
        padding: SPACING.lg,
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: colors.borderSubtle,
        backgroundColor: colors.surface,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
          {device}
        </Text>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>
          {`${capturedStamp(entry.createdAt)} · ${capturedLabel(entry.createdAt, nowMs, t)}`}
        </Text>
        <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }} numberOfLines={1}>
          {`${t('v2.nc.rules.history.target')}: ${target}`}
        </Text>
        <Text style={{ color: deliveryStatusColor(entry.status, colors), fontSize: 12, fontWeight: '600' }}>
          {t(deliveryStatusKey(entry.status))}
        </Text>
        {entry.error !== undefined && entry.error.length > 0 ? (
          <Text style={{ color: colors.danger, fontSize: 11, lineHeight: 15 }}>{entry.error}</Text>
        ) : null}
      </View>
      {artifactId !== undefined ? <RuleHistoryThumb artifactId={artifactId} /> : null}
    </View>
  )
}

function Loading() {
  const { colors } = useTheme()
  return (
    <View testID="rule-history-loading" style={{ paddingVertical: SPACING['3xl'], alignItems: 'center' }}>
      <ActivityIndicator size="small" color={colors.foregroundSubtle} />
    </View>
  )
}

