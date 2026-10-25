/**
 * useAudioActive — live "is this camera's audio above threshold right now" for
 * one device, used by the per-camera highlight in the detail view.
 *
 * Subscribes to the pipeline's `pipeline.audio-inference-result` live events
 * (payload `{ deviceId, frame: { level?: { dbfs }, detections[] } }`), filters
 * to the target device, and returns an INSTANTANEOUS boolean:
 *   • 'sensor' → any audio detection in the window
 *   • 'level'  → window dBFS ≥ the threshold
 * The caller applies the configurable hold (see `useHeld`).
 *
 * Mirrors `use-detections` / `use-motion`: subscribe via the connection
 * controller's System, type-guard the payload, tear down on cleanup. No-op (and
 * returns false) when the mode is 'off' or the link isn't connected.
 */
import { useEffect, useState } from 'react'
import { useConnection } from '../connection/ConnectionProvider.js'

/** Live-event category carrying per-window audio inference results. */
export const AUDIO_CATEGORY = 'pipeline.audio-inference-result'

export type AudioHighlightMode = 'off' | 'sensor' | 'level'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

interface ParsedAudio {
  readonly deviceId: number
  readonly dbfs: number | null
  readonly hasDetection: boolean
}

/** Narrow the raw live-event payload to the device id + level + detection
 *  presence, or null when it doesn't apply. Exported pure for unit testing. */
export function parseAudioEvent(event: unknown): ParsedAudio | null {
  if (!isRecord(event)) return null
  const data = event.data
  if (!isRecord(data)) return null
  const frame = data.frame
  if (!isRecord(frame)) return null

  const deviceId = typeof data.deviceId === 'number'
    ? data.deviceId
    : typeof frame.deviceId === 'number'
      ? frame.deviceId
      : null
  if (deviceId === null) return null

  const level = frame.level
  const dbfs = isRecord(level) && typeof level.dbfs === 'number' ? level.dbfs : null
  const detections = frame.detections
  const hasDetection = Array.isArray(detections) && detections.length > 0

  return { deviceId, dbfs, hasDetection }
}

/**
 * useAudioLevel — the live instantaneous dBFS for one device, driven by the same
 * `pipeline.audio-inference-result` stream `useAudioActive` uses. Returns `null`
 * when disabled / disconnected / before the first reading. Powers the player's
 * 5-step audio-level meter overlay (mirrors the detection-box overlay: event-fed,
 * gated by a view-options toggle).
 */
export function useAudioLevel(deviceId: number, enabled: boolean): number | null {
  const { controller, state: connState } = useConnection()
  const [dbfs, setDbfs] = useState<number | null>(null)

  useEffect(() => {
    if (!enabled || connState !== 'connected') {
      setDbfs(null)
      return
    }
    const system = controller.getSystem()
    if (!system) return

    const unsubscribe = system.subscribeEvent(AUDIO_CATEGORY, (event: unknown) => {
      const parsed = parseAudioEvent(event)
      if (!parsed || parsed.deviceId !== deviceId) return
      setDbfs(parsed.dbfs)
    })

    return () => {
      unsubscribe()
      setDbfs(null)
    }
  }, [controller, connState, deviceId, enabled])

  return dbfs
}

export function useAudioActive(deviceId: number, mode: AudioHighlightMode, db: number): boolean {
  const { controller, state: connState } = useConnection()
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (mode === 'off' || connState !== 'connected') {
      setActive(false)
      return
    }
    const system = controller.getSystem()
    if (!system) return

    const unsubscribe = system.subscribeEvent(AUDIO_CATEGORY, (event: unknown) => {
      const parsed = parseAudioEvent(event)
      if (!parsed || parsed.deviceId !== deviceId) return
      const on = mode === 'sensor'
        ? parsed.hasDetection
        : (parsed.dbfs ?? Number.NEGATIVE_INFINITY) >= db
      setActive(on)
    })

    return () => {
      unsubscribe()
      setActive(false)
    }
  }, [controller, connState, deviceId, mode, db])

  return active
}
