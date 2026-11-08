/**
 * TimedRunControl — the one-tap "quick run" pill for a device with the
 * `timed-run` cap (a heater, a pet fountain).
 *
 * Idle: "Run 30 min". Armed: one group, [Stop] 12:03 [Restart] — Stop forgets
 * the pending off, Restart runs the quick run again from now. A refusal from the hub is said in words (notice), never swallowed.
 * Renders nothing unless the status ANSWERED with a quick run (`quickRun: null`
 * = device gone / type without a timed run).
 */
import React, { useCallback, useEffect, useRef } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { RotateCcw, Square, Timer } from '../../../lib/icons.js'
import { useNotice } from '../../ui/confirm.js'
import { useTimedRunActions, useNow, useTimedRunStatus } from '../../../data/use-timed-run.js'
import {
  formatRemaining, quickRunToShow, refusalMessageKey, remainingSeconds, type TimedRunQuickRun,
} from '../../../data/timed-run.js'
import { SPACING, TABULAR } from '../../../theme/tokens.js'
import { useTheme } from '../../../theme/theme-provider.js'
import { PillButton } from './control-atoms.js'

export interface TimedRunControlProps {
  readonly deviceId: number
  readonly online: boolean
}

export interface TimedRunController {
  /** The quick run to offer; null = nothing to show (loading, errored, no quick run). */
  readonly quickRun: TimedRunQuickRun | null
  /** Whole seconds left while a run is armed; null when idle (an expired deadline is idle). */
  readonly left: number | null
  readonly busy: boolean
  readonly start: () => Promise<void>
  readonly stop: () => Promise<void>
  /** Runs the quick run again from now; the hub replaces the armed deadline. */
  readonly restart: () => Promise<void>
}

/** The one owner of the countdown and the start / stop / restart calls. */
export function useTimedRunController(deviceId: number, online: boolean): TimedRunController {
  const { t } = useTranslation()
  const notice = useNotice()
  const status = useTimedRunStatus(deviceId, online)
  const refetch = useCallback(() => void status.refetch(), [status])
  const actions = useTimedRunActions(deviceId, refetch)
  const activeUntil = status.data?.activeUntil ?? null
  const now = useNow(activeUntil !== null)
  const quickRun = quickRunToShow(status.data)

  // One call at a time: a second tap before the first answered is dropped.
  const inFlight = useRef(false)

  const start = useCallback(async () => {
    if (inFlight.current || quickRun === null) return
    inFlight.current = true
    try {
      const outcome = await actions.run(quickRun)
      if (!outcome.ok) {
        notice({
          title: t('v2.accessories.timedRun.refusedTitle'),
          message: t(refusalMessageKey(outcome.reason)),
        })
      }
    } finally {
      inFlight.current = false
    }
  }, [actions, notice, quickRun, t])

  const stop = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      if (!(await actions.cancel())) {
        notice({
          title: t('v2.accessories.timedRun.cancelFailedTitle'),
          message: t('v2.accessories.timedRun.cancelFailed'),
        })
      }
    } finally {
      inFlight.current = false
    }
  }, [actions, notice, t])

  const rawLeft = remainingSeconds(activeUntil, now)
  // The deadline passed but the status still says armed: one refresh, idle meanwhile.
  const expired = rawLeft !== null && rawLeft <= 0
  useEffect(() => {
    if (expired) refetch()
  }, [expired, refetch])

  return {
    quickRun,
    left: rawLeft !== null && !expired ? rawLeft : null,
    busy: !online || actions.pending,
    start,
    stop,
    restart: start,
  }
}

export interface TimedRunArmedGroupProps {
  readonly left: number
  readonly disabled: boolean
  readonly onStop: () => void
  readonly onRestart: () => void
}

/** [Stop] · time left · [Restart] — the armed state, shared by every surface that shows it. */
export function TimedRunArmedGroup({ left, disabled, onStop, onRestart }: TimedRunArmedGroupProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View style={styles.group}>
      <PillButton label={t('v2.accessories.timedRun.stop')} icon={Square} active disabled={disabled} onPress={onStop} />
      <Text style={[styles.time, TABULAR, { color: colors.foreground }]} numberOfLines={1}>
        {formatRemaining(left)}
      </Text>
      <PillButton label={t('v2.accessories.timedRun.restart')} icon={RotateCcw} disabled={disabled} haptic="action" onPress={onRestart} />
    </View>
  )
}

export function TimedRunControl({ deviceId, online }: TimedRunControlProps) {
  const { t } = useTranslation()
  const { quickRun, left, busy, start, stop, restart } = useTimedRunController(deviceId, online)

  // The control is optional: nothing while the status loads, errors or has no quick run.
  if (quickRun === null) return null

  if (left !== null) {
    return <TimedRunArmedGroup left={left} disabled={busy} onStop={() => void stop()} onRestart={() => void restart()} />
  }
  return (
    <PillButton
      label={t('v2.accessories.timedRun.quickRun', {
        duration: quickRun.duration,
        unit: t(`v2.accessories.timedRun.unit.${quickRun.unit}`),
      })}
      icon={Timer}
      disabled={busy}
      haptic="action"
      onPress={() => void start()}
    />
  )
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  time: { fontSize: 13, fontWeight: '600' },
})
