/**
 * useActiveDevices — grid-level set of devices currently "active" for the
 * active-cameras-only mode. A device is active when one of the grid's highlight
 * triggers fires (the SAME settings as the highlight borders): hardware/ML
 * motion, audio (presence or dBFS level), or object detection. Each trigger
 * keeps a device active for a hold window so the grid doesn't flicker.
 *
 * Subscribes ONCE per category at the grid level (not per tile) and tracks a
 * per-device "active until" timestamp. Returns the set of the given deviceIds
 * that are active right now.
 */
import { useEffect, useRef, useState } from 'react'
import { useLiveEvent } from '@camstack/ui-library'
import { EventCategory } from '@camstack/types/enums'
import type {
  MotionOnMotionChangedData,
  DetectionResultPayload,
  PipelineAudioInferenceResultPayload,
} from '@camstack/types'
import type { GridHighlightConfig } from './embed-grid-config'

/** Motion has no explicit hold setting; keep a tile up briefly so a momentary
 *  motion blip doesn't drop it straight out of an active-only grid. */
const MOTION_HOLD_MS = 6000
const TICK_MS = 500

export function useActiveDevices(
  deviceIds: readonly number[],
  cfg: GridHighlightConfig | undefined,
): ReadonlySet<number> {
  const until = useRef<Map<number, number>>(new Map())
  const [, force] = useState(0)

  const motionOn = cfg?.motion ?? false
  const audioMode = cfg?.audio ?? 'off'
  const audioDb = cfg?.audioDb ?? -30
  const audioHoldSec = cfg?.audioHoldSec ?? 5
  const detectionOn = cfg?.detection ?? false
  const detectionHoldSec = cfg?.detectionHoldSec ?? 3
  const detectionClasses = cfg?.detectionClasses ?? []

  const bump = (deviceId: number, ms: number): void => {
    until.current.set(deviceId, Date.now() + ms)
    force((v) => v + 1)
  }

  useLiveEvent<MotionOnMotionChangedData>(EventCategory.MotionOnMotionChanged, (evt) => {
    if (!motionOn) return
    const p = evt.data
    if (p && p.detected) bump(p.deviceId, MOTION_HOLD_MS)
  })

  useLiveEvent<PipelineAudioInferenceResultPayload>(
    EventCategory.PipelineAudioInferenceResult,
    (evt) => {
      if (audioMode === 'off') return
      const p = evt.data
      if (!p) return
      const on =
        audioMode === 'sensor'
          ? p.frame.detections.length > 0
          : (p.frame.level?.dbfs ?? Number.NEGATIVE_INFINITY) >= audioDb
      if (on) bump(p.deviceId, audioHoldSec * 1000)
    },
  )

  useLiveEvent<DetectionResultPayload>(EventCategory.DetectionResult, (evt) => {
    if (!detectionOn) return
    const p = evt.data
    if (!p) return
    const match = p.frame.detections.some(
      (d) => detectionClasses.length === 0 || detectionClasses.includes(d.macroClass),
    )
    if (match) bump(p.frame.deviceId, detectionHoldSec * 1000)
  })

  useEffect(() => {
    const t = setInterval(() => force((v) => v + 1), TICK_MS)
    return () => clearInterval(t)
  }, [])

  const now = Date.now()
  const active = new Set<number>()
  for (const id of deviceIds) {
    const u = until.current.get(id)
    if (u !== undefined && now < u) active.add(id)
  }
  return active
}
