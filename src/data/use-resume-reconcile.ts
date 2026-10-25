/**
 * use-resume-reconcile — mount once, above the screens: the app catches up on
 * what it missed while it was away or disconnected.
 *
 * The decision logic (when a pass is worth running, what it touches, whether
 * it landed, how often it may retry) is pure and lives in
 * `resume-reconcile.ts`, with its tests. This file is only the wiring: an
 * `AppState` subscription, the connection state, and the query cache.
 *
 * The react-native import is why the split exists — the vitest suite runs in
 * the `node` environment and cannot parse react-native's Flow syntax, so
 * anything that must be PROVEN correct stays out of this file. Same shape as
 * `AppPhaseTracer` vs `lifecycle-trace`.
 */
import { useCallback, useEffect, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { log } from '../lib/logger.js'
import {
  decideReconcile,
  reconcileLanded,
  INITIAL_RECONCILE_STATE,
  RECONCILE_HEAD_KEY,
  VOLATILE_QUERY_KEYS,
  isVolatileQueryKey,
  type ReconcileState,
  type ReconcileTrigger,
} from './resume-reconcile.js'

/** Scope for every line this hook writes — one grep away, next to the
 *  connection lifecycle lines it correlates with. */
export const RECONCILE_SCOPE = 'data:reconcile'

/** Dispatch one pass and report whether the camera list actually moved.
 *
 *  The head key is awaited; the rest — every other query too, not only the
 *  volatile device keys — is fired and left to settle. Only ACTIVE (mounted)
 *  observers refetch; an unmounted screen is marked stale and refetches on its
 *  own next mount.
 *
 *  `invalidateQueries` cancels an in-flight refetch by default, and that is
 *  wanted here: the fetch a resume races is the one issued microseconds
 *  earlier over a socket that has not survived the suspension, and react-query
 *  would otherwise hand every later caller that same doomed promise instead of
 *  starting a new request. */
async function runReconcilePass(client: QueryClient, startedAtMs: number): Promise<boolean> {
  for (const queryKey of VOLATILE_QUERY_KEYS) {
    if (queryKey === RECONCILE_HEAD_KEY) continue
    void client.invalidateQueries({ queryKey, refetchType: 'active' })
  }
  // …and every other query: the mounted ones refetch now (the visible screen),
  // the rest are marked stale and refetch on their next mount — the page the
  // operator reopens after a resume is never the answer from before it.
  void client.invalidateQueries({
    refetchType: 'active',
    predicate: (query) => !isVolatileQueryKey(query.queryKey),
  })
  await client.invalidateQueries({ queryKey: RECONCILE_HEAD_KEY, refetchType: 'active' })

  const head = client.getQueryCache().find({ queryKey: RECONCILE_HEAD_KEY, exact: true })
  return reconcileLanded({
    dataUpdatedAt: head?.state.dataUpdatedAt,
    startedAtMs,
    observed: (head?.getObserversCount() ?? 0) > 0,
  })
}

/**
 * Reconcile volatile device state on resume and on transport recovery.
 *
 * Renders nothing; must be mounted exactly once, INSIDE `ConnectionProvider`.
 */
export function useResumeReconcile(): void {
  const { state: connState } = useConnection()
  const queryClient = useQueryClient()

  const stateRef = useRef<ReconcileState>(INITIAL_RECONCILE_STATE)
  /** When the app left the foreground; null while it is in front. */
  const awaySinceRef = useRef<number | null>(null)
  /** The connection state as of the last render, read from event callbacks. */
  const connectedRef = useRef<boolean>(connState === 'connected')
  const everConnectedRef = useRef(false)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Self-reference so a retry (and a pass outcome) can re-enter the same
   *  decision path without making the callback depend on itself. */
  const dispatchRef = useRef<(trigger: ReconcileTrigger) => void>(() => undefined)

  const dispatch = useCallback(
    (trigger: ReconcileTrigger): void => {
      const decision = decideReconcile(stateRef.current, trigger)
      stateRef.current = decision.state
      // Every outcome is logged, including the ones that do nothing: a branch
      // that silently drops work reads afterwards as "it never happened".
      log.info(RECONCILE_SCOPE, `${trigger.kind} → ${decision.reason}`, {
        trigger: trigger.kind,
        reason: decision.reason,
        run: decision.run,
        retryInMs: decision.retryInMs,
        attempt: decision.state.attempt,
      })

      if (decision.retryInMs !== null) {
        if (retryTimerRef.current !== undefined) clearTimeout(retryTimerRef.current)
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = undefined
          dispatchRef.current({ kind: 'retry', nowMs: Date.now() })
        }, decision.retryInMs)
      }

      if (!decision.run) return
      // A dispatch replaces the ladder — a `reconnected` that runs while a
      // retry is armed resets `attempt` to 0, and letting the old timer fire
      // afterwards would buy a second pass for a sequence that no longer
      // exists. `retry` runs unconditionally by design, so the only place this
      // can be prevented is here.
      if (retryTimerRef.current !== undefined) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = undefined
      }
      const startedAtMs = Date.now()
      void runReconcilePass(queryClient, startedAtMs).then((landed) => {
        dispatchRef.current({ kind: 'outcome', landed, nowMs: Date.now() })
      })
    },
    [queryClient],
  )
  // Declared BEFORE the two subscriptions below so it is installed first on
  // the initial commit — effects run in declaration order, and the connection
  // effect fires its `first-connect` trigger through this very ref.
  useEffect(() => {
    dispatchRef.current = dispatch
  }, [dispatch])

  // Foreground / background. The away clock starts on the FIRST departure —
  // iOS emits `inactive` then `background`, and restarting it on the second
  // would report ~0 ms away for every real backgrounding.
  useEffect(() => {
    const onChange = (next: AppStateStatus): void => {
      if (next === 'active') {
        const since = awaySinceRef.current
        awaySinceRef.current = null
        dispatchRef.current({
          kind: 'foreground',
          awayMs: since === null ? null : Date.now() - since,
          connected: connectedRef.current,
          nowMs: Date.now(),
        })
        return
      }
      if (awaySinceRef.current === null) awaySinceRef.current = Date.now()
    }
    const sub = AppState.addEventListener('change', onChange)
    return () => {
      sub.remove()
      if (retryTimerRef.current !== undefined) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = undefined
      }
    }
  }, [])

  // Transport recovery. Every event emitted while the socket was down is gone
  // (D8: events are telemetry, and a client that treats them as its only
  // channel is wrong by construction), so the moment it comes back is the
  // moment to re-ask. The FIRST connect of a session is not that moment — a
  // cold launch is already fetching everything.
  useEffect(() => {
    connectedRef.current = connState === 'connected'
    if (connState !== 'connected') return
    if (!everConnectedRef.current) {
      everConnectedRef.current = true
      dispatchRef.current({ kind: 'first-connect', nowMs: Date.now() })
      return
    }
    dispatchRef.current({ kind: 'reconnected', nowMs: Date.now() })
  }, [connState])
}
