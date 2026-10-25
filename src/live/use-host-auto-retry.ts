/**
 * The host's auto-retry loop — shared by both live hosts (WebView and iframe).
 *
 * The operator's requirement was "auto riprovare in ogni caso": a manual retry
 * may make the next attempt happen SOONER, but it is never the only way one
 * happens. So the loop is armed by the state itself — every entry into `error`
 * schedules the next surface rebuild — and the manual control just resets the
 * budget and fires now.
 *
 * Everything it does is logged, at `warn` or above, stamped with the camera.
 * `logger.ts` ships only `warn`/`error` outside DEBUG MODE, so an `info` retry
 * line would never reach the hub; and a line without `deviceId` cannot be
 * grouped per camera, which is the only question ever asked of it ("why is 102
 * worse than 101?"). One choke point (`logRetry`) so a future line cannot
 * forget either.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { log, type LogLevel } from '../lib/logger.js'
import { nextHostRetry } from './host-retry-schedule.js'
import type { PlayerConnectionState } from './live-view-types.js'

/**
 * How long `connecting` may last before the surface is rebuilt.
 *
 * Must OUTLAST the inner loop's own attempts (1.5 s → 15 s), or a reload throws
 * away a session that was about to succeed — the same reasoning that sets the
 * first outer wait. 25 s clears the inner cap with room and is still short
 * enough that a resumed app recovers while the operator is looking at it.
 */
const STUCK_CONNECTING_MS = 25_000

export interface HostAutoRetryInput {
  /** The camera every line of this loop is grouped by. */
  readonly deviceId: number
  /** The player's current lifecycle state — the loop's only trigger. */
  readonly state: PlayerConnectionState
  /** Why it failed, when it did. Carried into the log lines only. */
  readonly reason?: string
  /** Rebuild the player surface (WebView / iframe reload). */
  readonly rebuild: () => void
}

export interface HostAutoRetry {
  /** Retry NOW, resetting the budget. The affordance on the playback bar calls
   *  this; the loop keeps running with or without it. */
  readonly retryNow: () => void
  /**
   * A failure is in its FIRST, fast retry — do not draw it yet.
   *
   * The player reaches `error` the moment signalling fails, and the host used
   * to paint "the live stream could not be loaded" right there, with the first
   * automatic recovery 13-19 s away. Most of those failures are gone in two
   * seconds. So the host holds the CONNECTING presentation while this is true
   * and only shows the error if the fast attempt fails too — an operator sees
   * a spinner blink, not a red card they have to think about.
   *
   * It covers the first attempt ONLY. A second failure is a real one and is
   * shown immediately, retry button and all.
   */
  readonly settling: boolean
}

/** One choke point: every line carries the camera, at a level that ships. */
function logRetry(
  level: Extract<LogLevel, 'warn' | 'error'>,
  deviceId: number,
  msg: string,
  data: Record<string, unknown>,
): void {
  log[level]('live:retry', msg, { deviceId, ...data })
}

export function useHostAutoRetry({
  deviceId,
  state,
  reason,
  rebuild,
}: HostAutoRetryInput): HostAutoRetry {
  const attemptsRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Render-affecting, so state rather than a ref.
  const [settling, setSettling] = useState(false)
  // The mutable pieces ride refs so the scheduling effect keys on `state`
  // alone: a changing `reason` (or a new `rebuild` identity from a re-render)
  // must not restart an in-flight backoff — that would pin the delay at the
  // first step forever.
  const rebuildRef = useRef(rebuild)
  const reasonRef = useRef(reason)
  useEffect(() => {
    rebuildRef.current = rebuild
    reasonRef.current = reason
  }, [rebuild, reason])

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // The scheduler owns `settling` as well as the timer, and both move exactly
  // ONCE per player-state transition — not per render, which is what the
  // cascading-render rule is about. Splitting the flag into its own derived
  // value would mean reading `attemptsRef` during render, which the refs rule
  // forbids for better reasons. Disabled deliberately, at the one call site.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    // A stream that came back restores the full budget — a camera that drops
    // once an hour must never inherit the count from the last outage.
    if (state === 'playing') {
      attemptsRef.current = 0
      setSettling(false)
      clearTimer()
      return undefined
    }
    // `connecting` covers both the cold start and the in-flight rebuild, so it
    // is normally the loop's cue to stand down and let the inner one work.
    //
    // But a STALE `connecting` is exactly the failure this outer loop was
    // written for — "an embed whose script is wedged and therefore cannot retry
    // itself" — and until now it could not see it. The foreground reconnect is
    // a fire-and-forget injection with no ack; if it produces a signalling call
    // that never settles (the embed's own socket is equally suspended, and the
    // call has no timeout), the player sits in `connecting` forever and the
    // inner loop never fires, because it only runs from an ICE failure. That is
    // the operator's "the WebRTC session does not resume".
    //
    // So `connecting` gets a watchdog rather than a clearTimer: long enough to
    // outlast the inner loop's own attempts, short enough to be a recovery.
    if (state === 'connecting') {
      // The rebuild landed and the player is trying again — whatever we were
      // holding back is now a spinner on its own merits.
      setSettling(false)
      if (timerRef.current !== null) return undefined
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        logRetry('warn', deviceId, 'stuck connecting — rebuilding the surface', {
          afterMs: STUCK_CONNECTING_MS,
        })
        rebuildRef.current()
      }, STUCK_CONNECTING_MS)
      return clearTimer
    }
    if (state !== 'error') {
      setSettling(false)
      clearTimer()
      return undefined
    }
    const action = nextHostRetry(attemptsRef.current)
    if (action.kind === 'exhausted') {
      // Never a silent stop: the surface stays on its error state (the host
      // bar renders it, reason and all) and the giving-up is on the record.
      // The manual control still resets the budget from here.
      logRetry('error', deviceId, 'auto-retry exhausted — the player stays in error', {
        attempts: action.attempts,
        reason: reasonRef.current,
      })
      setSettling(false)
      return undefined
    }
    // Only the FIRST attempt is hidden. Attempt 1 onward means the fast retry
    // already failed, so the operator is looking at a real failure and must be
    // told — with the reason and the retry control.
    setSettling(action.attempt === 0)
    logRetry('warn', deviceId, 'auto-retry scheduled', {
      attempt: action.attempt,
      delayMs: action.delayMs,
      reason: reasonRef.current,
    })
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      attemptsRef.current += 1
      logRetry('warn', deviceId, 'auto-retry rebuilding the player surface', {
        attempt: action.attempt,
      })
      rebuildRef.current()
    }, action.delayMs)
    return clearTimer
  }, [state, deviceId, clearTimer])
  /* eslint-enable react-hooks/set-state-in-effect */

  const retryNow = useCallback((): void => {
    clearTimer()
    attemptsRef.current = 0
    setSettling(false)
    logRetry('warn', deviceId, 'manual retry — budget reset, rebuilding now', {
      reason: reasonRef.current,
    })
    rebuildRef.current()
  }, [clearTimer, deviceId])

  return { retryNow, settling }
}
