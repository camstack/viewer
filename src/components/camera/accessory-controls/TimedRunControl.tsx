/**
 * TimedRunControl — the one-tap "quick run" pill for a device with the
 * `timed-run` cap (a heater, a pet fountain).
 *
 * Idle: "Run 30 min". Armed: "Cancel · 12:03 left" — one tap forgets the pending
 * off. A refusal from the hub is said in words (notice), never swallowed.
 * Renders nothing unless the status ANSWERED with a quick run (`quickRun: null`
 * = device gone / type without a timed run).
 */
import React, { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Timer } from '../../../lib/icons.js'
import { useNotice } from '../../ui/confirm.js'
import { useTimedRunActions, useNow, useTimedRunStatus } from '../../../data/use-timed-run.js'
import {
  formatRemaining, quickRunToShow, refusalMessageKey, remainingSeconds, type TimedRunQuickRun,
} from '../../../data/timed-run.js'
import { PillButton } from './control-atoms.js'

export interface TimedRunControlProps {
  readonly deviceId: number
  readonly online: boolean
}

export function TimedRunControl({ deviceId, online }: TimedRunControlProps) {
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

  const start = useCallback(
    async (q: TimedRunQuickRun) => {
      if (inFlight.current) return
      inFlight.current = true
      try {
        const outcome = await actions.run(q)
        if (!outcome.ok) {
          notice({
            title: t('v2.accessories.timedRun.refusedTitle'),
            message: t(refusalMessageKey(outcome.reason)),
          })
        }
      } finally {
        inFlight.current = false
      }
    },
    [actions, notice, t],
  )

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

  const left = remainingSeconds(activeUntil, now)
  // The deadline passed but the status still says armed: one refresh, idle meanwhile.
  const expired = left !== null && left <= 0
  useEffect(() => {
    if (expired) refetch()
  }, [expired, refetch])

  // The pill is optional: nothing while the status loads, errors or has no quick run.
  if (quickRun === null) return null

  if (left !== null && !expired) {
    return (
      <PillButton
        label={t('v2.accessories.timedRun.cancelWithTime', { time: formatRemaining(left) })}
        icon={Timer}
        active
        disabled={!online || actions.pending}
        onPress={() => void stop()}
      />
    )
  }
  return (
    <PillButton
      label={t('v2.accessories.timedRun.quickRun', {
        duration: quickRun.duration,
        unit: t(`v2.accessories.timedRun.unit.${quickRun.unit}`),
      })}
      icon={Timer}
      disabled={!online || actions.pending}
      haptic="action"
      onPress={() => void start(quickRun)}
    />
  )
}
