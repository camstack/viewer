/**
 * Timed run hooks — the status read (push cap: `['v2','cap-status']` is
 * invalidated by `device.state-changed`, the interval is only the reconcile),
 * the tick that drives the countdown, and the run / cancel calls.
 */
import { useCallback, useEffect, useState } from 'react'
import { type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useCapStatusParsed } from './use-cap-status.js'
import { resolveMutate } from './use-accessory-controls.js'
import {
  toTimedRunOutcome, toTimedRunStatus, type TimedRunOutcome, type TimedRunQuickRun, type TimedRunStatus,
} from './timed-run.js'

const CAP_KEY = 'timedRun'

export function useTimedRunStatus(deviceId: number, enabled: boolean): UseQueryResult<TimedRunStatus | null> {
  return useCapStatusParsed(CAP_KEY, deviceId, toTimedRunStatus, enabled)
}

/** `Date.now()`, refreshed every second while `active`. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

export interface TimedRunActions {
  readonly pending: boolean
  /** Starts the device's quick run; a refusal comes back as its typed reason. */
  readonly run: (quickRun: TimedRunQuickRun) => Promise<TimedRunOutcome>
  /** False when the hub refused or could not be reached. */
  readonly cancel: () => Promise<boolean>
}

export function useTimedRunActions(deviceId: number, refetch: () => void): TimedRunActions {
  const { controller } = useConnection()
  const [pending, setPending] = useState(false)

  const call = useCallback(
    async (method: 'runFor' | 'cancel', args: Record<string, unknown>): Promise<unknown> => {
      const system = controller.getSystem()
      if (!system) throw new Error('not connected')
      const fn = resolveMutate((system.trpcClient as Record<string, unknown>)[CAP_KEY], method)
      if (!fn) throw new Error(`timedRun.${method} is not available on this hub`)
      return fn({ deviceId, ...args })
    },
    [controller, deviceId],
  )

  const run = useCallback(
    async (quickRun: TimedRunQuickRun): Promise<TimedRunOutcome> => {
      setPending(true)
      try {
        return toTimedRunOutcome(await call('runFor', { duration: quickRun.duration, unit: quickRun.unit }))
      } catch {
        return { ok: false, reason: 'command-failed' }
      } finally {
        setPending(false)
        refetch()
      }
    },
    [call, refetch],
  )

  const cancel = useCallback(async (): Promise<boolean> => {
    setPending(true)
    try {
      await call('cancel', {})
      return true
    } catch {
      return false
    } finally {
      setPending(false)
      refetch()
    }
  }, [call, refetch])

  return { pending, run, cancel }
}
