/**
 * useDoorbell — live "did this doorbell just ring / when did it last ring" state
 * for one device. Mirrors `use-motion.ts`: seed from a slow poll of the cap's
 * auto-injected `getStatus`, then flip instantly off the live event.
 *
 * Two complementary sources, merged:
 *  1. A slow react-query poll of the `doorbell` cap's auto-injected
 *     `getStatus({ deviceId })` — seeds `lastPressedAt` + `pressCount` and
 *     self-heals if an event is missed. The `doorbell` cap declares
 *     `status: { kind: 'push' }`, so codegen injects `getStatus` returning
 *     `DoorbellStatus` (`{ lastPressedAt, pressCountSinceStart }`). Reolink also
 *     mirrors every press into the kernel `doorbell` runtimeState slice, so the
 *     poll reflects the last ring even across a reconnect.
 *  2. The live event `doorbell.onPressed` (bus category
 *     `EventCategory.DoorbellOnPressed = 'doorbell.onPressed'`, payload
 *     `{ deviceId, timestamp }`) for the instant "ringing NOW" flip. On a press
 *     we set `ringingNow = true` for a short window (`RING_WINDOW_MS`) then
 *     auto-clear via a single timer, and update `lastPressedAt` immediately.
 *
 * Graceful when the cap isn't registered for a device: `getStatus` rejects and
 * we treat it as "never rang" — no throw, no badge. Callers should still gate
 * `enabled` on the `doorbell-button` device feature (like `useBattery` gates on
 * `battery-operated`) so non-doorbell cams never poll/subscribe at all.
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { RECONCILE_MS } from './reconcile.js'

/**
 * Live-event bus category carrying doorbell presses.
 *
 * This MUST equal the hub's `EventCategory.DoorbellOnPressed` bus value —
 * `'doorbell.onPressed'`. Unlike `motion` (whose enum value is kebab-case
 * `'motion.on-motion-changed'`), the doorbell enum value is camelCase, and
 * `subscribeEvent` filters on the BUS category verbatim (the SDK forwards the
 * value to `live.onEvent`). Exported so a regression test pins it to the hub's
 * enum value.
 */
export const DOORBELL_CATEGORY = 'doorbell.onPressed'

/** How long after a press the badge shows the "ringing now" highlight before
 *  auto-clearing back to the subtle "last ring …" state. A press is a pulse
 *  (no release), so the window is purely presentational. */
export const RING_WINDOW_MS = 8_000


/** What the hook returns: the two durable facts plus the transient ring flag. */
export interface DoorbellState {
  /** Ms epoch of the last observed press, or null if never observed. */
  readonly lastPressedAt: number | null
  /** Lifetime press counter since the provider started (diagnostic). */
  readonly pressCount: number
  /** True for `RING_WINDOW_MS` after a press — drives the badge's ring animation. */
  readonly ringingNow: boolean
}

/** True when `value` is an object we can index without throwing. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** The polled `getStatus` result narrowed to the two fields the UI consumes. */
export interface DoorbellStatusSnapshot {
  readonly lastPressedAt: number | null
  readonly pressCount: number
}

/** Narrow an unknown `doorbell.getStatus` result to `{ lastPressedAt, pressCount }`,
 *  defaulting to "never rang" when the shape is unexpected. Exported pure. */
export function readDoorbellStatus(status: unknown): DoorbellStatusSnapshot {
  if (!isRecord(status)) return { lastPressedAt: null, pressCount: 0 }
  const lastPressedAt = typeof status.lastPressedAt === 'number' ? status.lastPressedAt : null
  const pressCount = typeof status.pressCountSinceStart === 'number' ? status.pressCountSinceStart : 0
  return { lastPressedAt, pressCount }
}

/** The parsed doorbell press event: device id + press timestamp. Exported pure
 *  for unit testing the shape-narrowing. */
export interface ParsedDoorbellEvent {
  readonly deviceId: number
  readonly timestamp: number
}

/** Narrow the raw `doorbell.onPressed` payload to `{ deviceId, timestamp }`,
 *  returning null when it doesn't apply. */
export function parseDoorbellEvent(event: unknown): ParsedDoorbellEvent | null {
  if (!isRecord(event)) return null
  const deviceId = event.deviceId
  const timestamp = event.timestamp
  if (typeof deviceId !== 'number' || typeof timestamp !== 'number') return null
  return { deviceId, timestamp }
}

/**
 * Compact relative age of the last ring, e.g. `now`, `5m`, `2h`, `3d`. Pure —
 * `now` injected for unit testing. Returns null when there was no ring so the
 * caller can hide the badge entirely.
 */
export function formatRingAgo(lastPressedAt: number | null, now: number): string | null {
  if (lastPressedAt === null) return null
  const deltaSec = Math.max(0, Math.floor((now - lastPressedAt) / 1000))
  if (deltaSec < 60) return 'now'
  const deltaMin = Math.floor(deltaSec / 60)
  if (deltaMin < 60) return `${deltaMin}m`
  const deltaHr = Math.floor(deltaMin / 60)
  if (deltaHr < 24) return `${deltaHr}h`
  const deltaDay = Math.floor(deltaHr / 24)
  return `${deltaDay}d`
}

/**
 * Live doorbell state for `deviceId`. When `enabled` is false (camera has no
 * `doorbell-button` feature, or disconnected) no poll and no subscription run
 * and the state stays empty. Returns `{ lastPressedAt, pressCount, ringingNow }`.
 */
export function useDoorbell(deviceId: number, enabled: boolean): DoorbellState {
  const { controller, state: connState } = useConnection()
  const connected = enabled && connState === 'connected'

  // 1) Poll `getStatus` — seeds `lastPressedAt`/`pressCount` and self-heals a
  //    missed event. Rejects (cap not registered) → "never rang", no throw.
  const { data: polled = { lastPressedAt: null, pressCount: 0 } } = useQuery<DoorbellStatusSnapshot>({
    queryKey: ['v2', 'doorbell', deviceId],
    enabled: connected,
    // Paired with the interval on purpose: without it the global 5s
    // default makes this stale long before its own cadence, so every
    // remount refetches and the reconcile design does nothing.
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return { lastPressedAt: null, pressCount: 0 }
      try {
        const status = await system.trpcClient.doorbell.getStatus.query({ deviceId })
        return readDoorbellStatus(status)
      } catch {
        return { lastPressedAt: null, pressCount: 0 }
      }
    },
  })

  // 2) Live event → instant "ringing now" + immediate lastPressedAt. The event
  //    press timestamp wins over the poll until the next poll reconciles.
  const [ringingNow, setRingingNow] = useState(false)
  const [liveLastPressedAt, setLiveLastPressedAt] = useState<number | null>(null)
  // Hold the auto-clear timer so a fresh ring resets the window instead of
  // stacking timers (a double-press extends the highlight from the LATER press).
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!connected) {
      setRingingNow(false)
      setLiveLastPressedAt(null)
      return
    }
    const system = controller.getSystem()
    if (!system) return

    const unsubscribe = system.subscribeEvent(DOORBELL_CATEGORY, (event: unknown) => {
      const parsed = parseDoorbellEvent(event)
      if (!parsed || parsed.deviceId !== deviceId) return
      // Ring → light up now, remember the timestamp, and (re)arm the auto-clear.
      setLiveLastPressedAt(parsed.timestamp)
      setRingingNow(true)
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      clearTimerRef.current = setTimeout(() => {
        setRingingNow(false)
        clearTimerRef.current = null
      }, RING_WINDOW_MS)
    })

    return () => {
      unsubscribe()
      if (clearTimerRef.current) {
        clearTimeout(clearTimerRef.current)
        clearTimerRef.current = null
      }
      setRingingNow(false)
    }
  }, [controller, connected, deviceId])

  // The most recent press wins (live event is newer within a poll interval;
  // otherwise the poll's seed). pressCount comes from the poll (diagnostic).
  const lastPressedAt =
    liveLastPressedAt !== null && (polled.lastPressedAt === null || liveLastPressedAt > polled.lastPressedAt)
      ? liveLastPressedAt
      : polled.lastPressedAt

  return { lastPressedAt, pressCount: polled.pressCount, ringingNow }
}
