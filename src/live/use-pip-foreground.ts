/**
 * usePipForeground — what a return from the background does to the live peer
 * while the video may still be in system PiP (see `pip-foreground.ts` for the
 * rule and the failure it prevents).
 *
 * The AppState subscription is made ONCE per device. The callbacks it calls
 * (`reconnect`, `onPeerReconnect`, `exitPip`) change identity with their
 * owners' state (`onPeerReconnect` is keyed on the screen's live target), so
 * they are read through refs: a re-subscription that cleared the pending
 * restore timers would drop the deferred reconnect for good, and nothing would
 * re-arm it. The timers are cleared on unmount only.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import { log } from '../lib/logger.js'
import {
  decideForeground,
  needsReconnectAfterPipExit,
  PIP_MODE_ACTIVE,
  PIP_RESTORE_FALLBACK_MS,
  PIP_RESTORE_SETTLE_MS,
} from './pip-foreground.js'

export interface PipForegroundInput {
  readonly deviceId: number
  /** The player's current connection state (`playing`, `connecting`, ...). */
  readonly playerState: string
  readonly reconnect: () => void
  readonly onPeerReconnect: (() => void) | undefined
  /** Ask the page to leave PiP. */
  readonly exitPip: () => void
  /** A return from the background that will act (reconnect now or later). */
  readonly onReturn?: () => void
}

export interface PipForegroundHandle {
  /** The page reported its presentation mode (every `pipmode` message). */
  readonly noteMode: (mode: string) => void
  /** The page is gone or reloading: its last mode no longer means anything. */
  readonly resetMode: () => void
}

interface PendingRestore {
  settle: ReturnType<typeof setTimeout> | null
  readonly fallback: ReturnType<typeof setTimeout>
}

export function usePipForeground(input: PipForegroundInput): PipForegroundHandle {
  const { deviceId } = input
  const backgroundedRef = useRef<boolean>(AppState.currentState === 'background')
  const lastPipModeRef = useRef<string | null>(null)
  const pendingRef = useRef<PendingRestore | null>(null)

  const playerStateRef = useRef(input.playerState)
  const reconnectRef = useRef(input.reconnect)
  const peerReconnectRef = useRef(input.onPeerReconnect)
  const exitPipRef = useRef(input.exitPip)
  const onReturnRef = useRef(input.onReturn)
  playerStateRef.current = input.playerState
  reconnectRef.current = input.reconnect
  peerReconnectRef.current = input.onPeerReconnect
  exitPipRef.current = input.exitPip
  onReturnRef.current = input.onReturn

  const clearPending = useCallback((): void => {
    const pending = pendingRef.current
    if (pending === null) return
    if (pending.settle !== null) clearTimeout(pending.settle)
    clearTimeout(pending.fallback)
    pendingRef.current = null
  }, [])

  const finish = useCallback(
    (how: 'inline' | 'fallback'): void => {
      clearPending()
      const needs = needsReconnectAfterPipExit(playerStateRef.current)
      log.info('live:pip', needs ? 'deferred reconnect fired' : 'deferred reconnect skipped — stream still playing', {
        tags: { deviceId },
        how,
        playerState: playerStateRef.current,
      })
      if (needs) reconnectRef.current()
      peerReconnectRef.current?.()
    },
    [clearPending, deviceId],
  )

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      log.info('live:pip', 'app state', {
        tags: { deviceId },
        next,
        backgrounded: backgroundedRef.current,
        lastPipMode: lastPipModeRef.current,
      })
      if (next === 'background') {
        backgroundedRef.current = true
        return
      }
      if (next !== 'active') return
      const action = decideForeground({
        backgrounded: backgroundedRef.current,
        lastPipMode: lastPipModeRef.current,
      })
      if (action === 'none') return
      backgroundedRef.current = false
      onReturnRef.current?.()
      if (action === 'reconnect') {
        log.info('live', 'foreground → reconnect', { tags: { deviceId } })
        reconnectRef.current()
        peerReconnectRef.current?.()
        return
      }
      log.info('live:pip', 'foreground in PiP — reconnect deferred, asking the page to leave PiP', {
        tags: { deviceId },
      })
      clearPending()
      pendingRef.current = {
        settle: null,
        fallback: setTimeout(() => {
          log.warn('live:pip', 'PiP never reported inline — fallback', { tags: { deviceId } })
          finish('fallback')
        }, PIP_RESTORE_FALLBACK_MS),
      }
      exitPipRef.current()
    })
    return () => sub.remove()
  }, [deviceId, clearPending, finish])

  // Timers die with the component, never with a dependency change; the page's
  // last mode goes with it.
  useEffect(
    () => () => {
      clearPending()
      lastPipModeRef.current = null
    },
    [clearPending],
  )

  const noteMode = useCallback(
    (mode: string): void => {
      lastPipModeRef.current = mode
      const pending = pendingRef.current
      if (mode !== PIP_MODE_ACTIVE && pending !== null && pending.settle === null) {
        pending.settle = setTimeout(() => finish('inline'), PIP_RESTORE_SETTLE_MS)
      }
    },
    [finish],
  )

  const resetMode = useCallback((): void => {
    lastPipModeRef.current = null
  }, [])

  return useMemo(() => ({ noteMode, resetMode }), [noteMode, resetMode])
}
