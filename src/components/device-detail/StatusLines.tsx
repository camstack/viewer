/**
 * The device detail's status line: what the device is doing, and for how long.
 * `RunningStateLine` ("Running for 12 min") and `ContactStateLine` ("Open for
 * 3 min") share one look. An unanswered query draws nothing; a hub that
 * answered "unknown" says so.
 */
import React from 'react'
import { StyleSheet, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useContactStatus, useRunningState, formatElapsed } from '../../data/device-detail-status.js'
import { useNow } from '../../data/use-timed-run.js'
import { useTheme } from '../../theme/theme-provider.js'
import { TYPOGRAPHY } from '../../theme/tokens.js'

interface LineProps {
  readonly text: string
  readonly emphasis: boolean
  readonly testID: string
}

function StatusText({ text, emphasis, testID }: LineProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Text testID={testID} style={[styles.line, { color: emphasis ? colors.foreground : colors.foregroundMuted }]}>
      {text}
    </Text>
  )
}

export interface DeviceCapLineProps {
  readonly deviceId: number
  readonly online: boolean
}

export function RunningStateLine({ deviceId, online }: DeviceCapLineProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const status = useRunningState(deviceId, online)
  const since = status.data?.since ?? null
  const now = useNow(since !== null)
  if (status.data == null) return null
  const { running } = status.data
  if (running === null) return <StatusText testID="device-status-line" emphasis={false} text={t('v2.deviceDetail.stateUnknown')} />
  const key = running ? 'runningFor' : 'idleFor'
  const text = since === null
    ? t(running ? 'v2.deviceDetail.running' : 'v2.deviceDetail.idle')
    : t(`v2.deviceDetail.${key}`, { duration: formatElapsed(now - since) })
  return <StatusText testID="device-status-line" emphasis={running} text={text} />
}

export function ContactStateLine({ deviceId, online }: DeviceCapLineProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const status = useContactStatus(deviceId, online)
  const since = status.data?.since ?? null
  const now = useNow(since !== null)
  if (status.data == null) return null
  const open = status.data.entryOpen
  const text = since === null
    ? t(open ? 'v2.deviceDetail.contactOpenNow' : 'v2.deviceDetail.contactClosedNow')
    : t(open ? 'v2.deviceDetail.contactOpen' : 'v2.deviceDetail.contactClosed', { duration: formatElapsed(now - since) })
  return <StatusText testID="device-status-line" emphasis={open} text={text} />
}

const styles = StyleSheet.create({
  line: { fontSize: TYPOGRAPHY.size.lg, fontWeight: TYPOGRAPHY.weight.medium },
})
