/**
 * The device detail's History tab: a 24h / 7d / 30d window over the series the
 * device keeps. Boolean / enum series draw as state bands, gauge / counter
 * series as a line, and a washer's runs as bands. A series that did not answer
 * says so; it is never drawn as an empty (or zero) one (D315).
 */
import React, { useMemo, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SegmentedControl } from '../ui/SegmentedControl.js'
import { EmptyState } from '../ui/EmptyState.js'
import { History as HistoryIcon } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../../theme/tokens.js'
import {
  HISTORY_WINDOW_IDS,
  historyWindow,
  lineSegments,
  stateBands,
  valueRange,
  type HistoryWindow,
  type HistoryWindowId,
} from '../../data/device-history-model.js'
import {
  hasDeviceRuns,
  useDeviceRunBands,
  useDeviceSeries,
  useSeriesReadings,
  type SeriesReading,
} from '../../data/use-device-history.js'
import { BandLegend, BandsChart, LineChart, RunsChart, TimeAxis, distinctLabels } from './HistoryCharts.js'

export interface HistoryTabProps {
  readonly deviceId: number
  readonly deviceType: string
}

function formatValue(v: number, unit: string | null): string {
  const text = Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  return unit === null ? text : `${text} ${unit}`
}

function SeriesBlock({ reading, window, windowId }: {
  readonly reading: SeriesReading
  readonly window: HistoryWindow
  readonly windowId: HistoryWindowId
}): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { info, data, loading } = reading
  const testID = `history-series-${info.key}`
  const title = info.unit === null ? info.displayName : `${info.displayName} (${info.unit})`
  const note = (text: string, id: string): React.JSX.Element => (
    <Text testID={id} style={[styles.note, { color: colors.foregroundMuted }]}>{text}</Text>
  )

  let chart: React.JSX.Element
  if (data === null) {
    chart = loading ? <ActivityIndicator color={colors.foregroundMuted} /> : note(t('v2.deviceDetail.history.failed'), `${testID}-failed`)
  } else if (info.kind === 'boolean' || info.kind === 'enum') {
    const bands = stateBands(info.kind, data, window)
    const order = info.values ?? distinctLabels(bands)
    const names: Record<string, string> = { on: t('v2.deviceDetail.history.on'), off: t('v2.deviceDetail.history.off') }
    chart = bands.length === 0 ? note(t('v2.deviceDetail.history.empty'), `${testID}-empty`) : (
      <>
        <BandsChart bands={bands} window={window} order={order} label={title} testID={`${testID}-chart`} />
        <TimeAxis windowId={windowId} />
        <BandLegend labels={distinctLabels(bands)} order={order} names={names} />
      </>
    )
  } else {
    const segments = lineSegments(data, window)
    const range = valueRange(segments)
    chart = range === null ? note(t('v2.deviceDetail.history.empty'), `${testID}-empty`) : (
      <>
        <LineChart segments={segments} window={window} label={title} testID={`${testID}-chart`} />
        <TimeAxis windowId={windowId} />
        <Text style={[styles.note, { color: colors.foregroundMuted }]} testID={`${testID}-range`}>
          {t('v2.deviceDetail.history.range', { min: formatValue(range.min, info.unit), max: formatValue(range.max, info.unit) })}
        </Text>
      </>
    )
  }
  return (
    <View testID={testID} style={styles.block}>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {chart}
    </View>
  )
}

function RunsBlock({ deviceId, window, windowId }: {
  readonly deviceId: number
  readonly window: HistoryWindow
  readonly windowId: HistoryWindowId
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const runs = useDeviceRunBands(deviceId, true, window, windowId)
  if (runs.data == null) return null
  return (
    <View testID="history-runs" style={styles.block}>
      <Text style={[styles.title, { color: colors.foreground }]}>{t('v2.deviceDetail.history.runs')}</Text>
      {runs.data.length === 0 ? (
        <Text testID="history-runs-empty" style={[styles.note, { color: colors.foregroundMuted }]}>{t('v2.deviceDetail.history.noRuns')}</Text>
      ) : (
        <>
          <RunsChart runs={runs.data} window={window} label={t('v2.deviceDetail.history.runs')} testID="history-runs-chart" />
          <TimeAxis windowId={windowId} />
        </>
      )}
    </View>
  )
}

export function HistoryTab({ deviceId, deviceType }: HistoryTabProps): React.JSX.Element {
  const { t } = useTranslation()
  const [windowId, setWindowId] = useState<HistoryWindowId>('24h')
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the window is fixed per selection, not per render
  const window = useMemo(() => historyWindow(windowId, Date.now()), [windowId])
  const series = useDeviceSeries(deviceId, true)
  const readings = useSeriesReadings(deviceId, series.data ?? [], window, windowId)

  let body: React.JSX.Element
  if (series.isLoading) {
    body = <ActivityIndicator testID="history-loading" />
  } else if (series.data == null) {
    body = <EmptyState icon={HistoryIcon} tone="danger" title={t('v2.deviceDetail.history.unavailable')} fill={false} testID="history-error" />
  } else if (series.data.length === 0 && !hasDeviceRuns(deviceType)) {
    body = <EmptyState icon={HistoryIcon} title={t('v2.deviceDetail.history.none')} fill={false} testID="history-none" />
  } else {
    body = (
      <>
        {hasDeviceRuns(deviceType) ? <RunsBlock deviceId={deviceId} window={window} windowId={windowId} /> : null}
        {readings.map((r) => (
          <SeriesBlock key={`${r.info.key}:${r.info.scope}`} reading={r} window={window} windowId={windowId} />
        ))}
      </>
    )
  }

  return (
    <View testID="device-tab-history" style={styles.root}>
      <SegmentedControl
        options={HISTORY_WINDOW_IDS.map((id) => ({ value: id, label: t(`v2.deviceDetail.history.window.${id}`) }))}
        value={windowId}
        onChange={setWindowId}
      />
      {body}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { gap: SPACING.xl },
  block: { gap: SPACING.md },
  title: { fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.medium },
  note: { fontSize: TYPOGRAPHY.size.sm },
})
