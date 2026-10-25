/**
 * useMotionRecency — when did each camera last start seeing motion, applied to
 * the list at most once per {@link MOTION_REORDER_INTERVAL_MS}.
 *
 * Two sources, the same two `useMotion` uses for one camera:
 *  1. A one-shot seed: `motion.getStatus({ deviceId })` per listed camera,
 *     read for `lastDetectedAt`, so the order is meaningful the moment the
 *     Motion chip is pressed rather than only after the next motion event.
 *  2. The live `motion.on-motion-changed` bus event — ONE subscription for the
 *     whole list (never one per camera; see `use-live-invalidation.ts` on why a
 *     per-card subscription is a tRPC subscription each).
 *
 * Updates land in a ref immediately and are APPLIED (state, hence a re-order)
 * at most once per window: the first one goes through at once, every later one
 * inside the window is coalesced into a single trailing application carrying
 * the newest recency. Nothing runs while `enabled` is false — the Motion chip
 * not being selected costs nothing.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useConnection } from '../connection/ConnectionProvider.js'
import { RECONCILE_MS } from './reconcile.js'
import { MOTION_CATEGORY } from './use-motion.js'
import {
  MOTION_REORDER_INTERVAL_MS,
  mergeMotionRecency,
  motionEdgesFromStatuses,
  motionRisingEdge,
  motionStartFromStatus,
  reorderDelay,
  type MotionEdgeState,
  type MotionRecency,
  type MotionStart,
} from './motion-recency.js'

/** One camera's seed: its last start (if any) and whether it is moving now. */
interface MotionSeedRow {
  readonly deviceId: number
  readonly start: MotionStart | null
  readonly detected: boolean
}

function readDetectedFlag(status: unknown): boolean {
  return typeof status === 'object' && status !== null && 'detected' in status && status.detected === true
}

const EMPTY_RECENCY: MotionRecency = new Map()

/**
 * The coalescing half, separated from the sources so it can be driven directly
 * under fake timers. `push` folds starts into the pending recency; the returned
 * `applied` changes at most once per `intervalMs`.
 */
export function useCoalescedRecency(
  enabled: boolean,
  intervalMs: number = MOTION_REORDER_INTERVAL_MS,
): { readonly applied: MotionRecency; readonly push: (starts: readonly MotionStart[]) => void } {
  const [applied, setApplied] = useState<MotionRecency>(EMPTY_RECENCY)
  const latestRef = useRef<MotionRecency>(EMPTY_RECENCY)
  const lastAppliedAtRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const apply = useCallback((): void => {
    timerRef.current = null
    lastAppliedAtRef.current = Date.now()
    setApplied(latestRef.current)
  }, [])

  const push = useCallback(
    (starts: readonly MotionStart[]): void => {
      if (starts.length === 0) return
      latestRef.current = mergeMotionRecency(latestRef.current, starts)
      // A trailing application is already scheduled — it will read the ref,
      // so this update rides it rather than adding a second reshuffle.
      if (timerRef.current !== null) return
      const delay = reorderDelay(Date.now(), lastAppliedAtRef.current, intervalMs)
      if (delay === 0) apply()
      else timerRef.current = setTimeout(apply, delay)
    },
    [apply, intervalMs],
  )

  // Leaving the Motion order forgets it: re-entering re-seeds from the hub, and
  // a pending timer must not fire into a list that is no longer ordered by it.
  // The applied state is cleared DURING render (React's "adjust state when a
  // prop changes" idiom), so re-entering never paints the previous session's
  // order; the refs and the timer are cleared in the effect.
  const [wasEnabled, setWasEnabled] = useState(enabled)
  if (enabled !== wasEnabled) {
    setWasEnabled(enabled)
    if (!enabled) setApplied(EMPTY_RECENCY)
  }
  useEffect(() => {
    if (enabled) return
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
    latestRef.current = EMPTY_RECENCY
    lastAppliedAtRef.current = null
  }, [enabled])

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  return { applied, push }
}

/**
 * Last-motion recency for `deviceIds`, re-applied at most once per
 * {@link MOTION_REORDER_INTERVAL_MS}. Empty while `enabled` is false.
 */
export function useMotionRecency(
  deviceIds: readonly number[],
  enabled: boolean,
): MotionRecency {
  const { controller, state: connState } = useConnection()
  const live = enabled && connState === 'connected'
  const { applied, push } = useCoalescedRecency(enabled)

  // 1) Seed. Keyed on the id set, sorted, so a reorder of the same cameras is
  //    not a new fetch. A camera without the `motion` cap rejects — it simply
  //    has no recency and stays at the end.
  const idsKey = [...deviceIds].sort((a, b) => a - b).join(',')
  const { data: seed } = useQuery<readonly MotionSeedRow[]>({
    queryKey: ['v2', 'motion-recency-seed', idsKey],
    enabled: live && deviceIds.length > 0,
    staleTime: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return []
      const results = await Promise.allSettled(
        deviceIds.map(async (deviceId): Promise<MotionSeedRow> => {
          const status: unknown = await system.trpcClient.motion.getStatus.query({ deviceId })
          return {
            deviceId,
            start: motionStartFromStatus(deviceId, status),
            detected: readDetectedFlag(status),
          }
        }),
      )
      return results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []))
    },
  })

  // The last state seen per camera, so only a RISING edge of the live stream
  // counts as a start (heartbeats re-send `true` every second). Seeded from
  // getStatus so a camera already moving when the list opens is not re-started.
  const edgesRef = useRef<MotionEdgeState>(new Map())
  useEffect(() => {
    if (!enabled) {
      edgesRef.current = new Map()
      return
    }
    if (seed === undefined) return
    edgesRef.current = new Map([...motionEdgesFromStatuses(seed), ...edgesRef.current])
    push(seed.flatMap((row) => (row.start !== null ? [row.start] : [])))
  }, [enabled, seed, push])

  // 2) Live motion starts, one subscription for the whole list.
  useEffect(() => {
    if (!live) return
    const system = controller.getSystem()
    if (!system) return
    return system.subscribeEvent(MOTION_CATEGORY, (event: unknown) => {
      const { edges, start } = motionRisingEdge(edgesRef.current, event, Date.now())
      edgesRef.current = edges
      if (start !== null) push([start])
    })
  }, [controller, live, push])

  return applied
}
