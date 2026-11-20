/**
 * useWallGateCameras — the per-camera facts the wall's sleeping gate needs,
 * from ONE request.
 *
 * A wall of N battery cameras asking `useBattery` per tile would be N messages
 * on the single WebSocket that also carries WebRTC signalling. The camera
 * badges aggregate (`useCameraBadges`) returns the same battery status for a
 * list of devices in one call, so the wall asks that, for its battery cameras
 * only. A hub without the batch procedure answers `supported: false`, which
 * leaves every sleep state unknown, and unknown HOLDS — the safe side.
 *
 * The first known state per camera is latched (`firstKnownSleeping`): a camera
 * that falls asleep while its tile streams is not re-held, so the wall never
 * tears a running stream down on a sleep flip.
 */
import { useMemo, useState } from 'react'

import { FEATURE, type CameraInfo } from '../data/use-cameras.js'
import { useCameraBadges } from '../data/use-camera-badges.js'
import { firstKnownSleeping, type GateCamera } from './battery-stream-gate.js'

export function useWallGateCameras(
  cameras: readonly CameraInfo[],
  enabled: boolean,
): readonly GateCamera[] {
  const batteryIds = useMemo(
    () => cameras.filter((c) => c.features.includes(FEATURE.battery)).map((c) => c.id),
    [cameras],
  )
  const { data, isStale, isPlaceholderData } = useCameraBadges(batteryIds, enabled && batteryIds.length > 0)
  // An answer older than its stale window (a cache entry from minutes ago) or
  // a placeholder from another id set is NOT a known state: an "awake" read
  // minutes ago must never auto-dial a camera that has since gone to sleep.
  const trusted = !isStale && !isPlaceholderData
  const known = useMemo(() => {
    const out: Record<number, boolean | null> = {}
    for (const id of batteryIds) {
      out[id] = trusted && data?.supported === true ? (data.byId[id]?.battery?.sleeping ?? null) : null
    }
    return out
  }, [batteryIds, data, trusted])
  const [latched, setLatched] = useState<Readonly<Record<number, boolean>>>({})
  const nextLatched = firstKnownSleeping(latched, known)
  if (nextLatched !== latched) setLatched(nextLatched)
  return useMemo(
    () =>
      cameras.map((c) => {
        const batteryPowered = c.features.includes(FEATURE.battery)
        return { id: c.id, batteryPowered, sleeping: batteryPowered ? (nextLatched[c.id] ?? null) : null }
      }),
    [cameras, nextLatched],
  )
}
