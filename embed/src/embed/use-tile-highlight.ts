/**
 * useTileHighlight — computes the active highlight for one grid tile from live
 * motion / audio / object-detection signals, per the grid's highlight settings.
 *
 * Mirrors V1's per-camera highlight (motion / audio sensor|level / detection)
 * but driven per-grid. Priority when several fire at once: detection > audio >
 * motion. Returns the winning type (→ the tile draws a colored border) or null.
 *
 * Signals:
 *   • motion + detection — via ui-library's `useDeviceDetections` (already
 *     debounced/faded), with an extra configurable hold for detection.
 *   • audio — `pipeline.audio-inference-result` events: 'sensor' = any audio
 *     detection in the window; 'level' = window dBFS ≥ threshold; held for
 *     `audioHoldSec`.
 */
import { useEffect, useRef, useState } from 'react'
import { useDeviceDetections, useLiveEvent } from '@camstack/ui-library'
import type { System } from '@camstack/sdk'
import { EventCategory } from '@camstack/types/enums'
import type { PipelineAudioInferenceResultPayload } from '@camstack/types'
import type { GridHighlightConfig } from './embed-grid-config'
import { paintKind, type PaletteView } from '../../../shared/palette'

export type HighlightType = 'motion' | 'audio' | 'detection' | null

/** How often to re-evaluate hold windows so a highlight clears on time. */
const TICK_MS = 500

export function useTileHighlight(
  system: System,
  deviceId: number,
  cfg: GridHighlightConfig | undefined,
): HighlightType {
  const { motion, detection } = useDeviceDetections(system.trpcClient, deviceId)
  const audioUntil = useRef(0)
  const detUntil = useRef(0)
  const motionUntil = useRef(0)
  const motionWasActive = useRef(false)
  const [, force] = useState(0)

  const audioMode = cfg?.audio ?? 'off'
  const audioDb = cfg?.audioDb ?? -30
  const audioHoldSec = cfg?.audioHoldSec ?? 5
  // 0/absent = clear the instant motion goes null (the pre-hold behaviour —
  // admin-ui grids don't send this). The viewer forwards its configurable
  // `grid.motionHoldSec` so the tile lingers N s after the LAST active signal.
  const motionHoldSec = cfg?.motionHoldSec ?? 0
  const detectionHoldSec = cfg?.detectionHoldSec ?? 3
  const detectionClasses = cfg?.detectionClasses ?? []
  const classesKey = detectionClasses.join(',')

  // NATIVE camera motion (`motion.on-motion-changed`) — the signal cameras
  // report themselves (reolink/hikvision VMD). The pipeline's
  // `detection.motion-analysis` stream (via useDeviceDetections below) only
  // exists while a DECODE session runs the wasm motion step, so a camera on
  // native motion NEVER produced it → the motion highlight never fired while
  // detection (riding inference events) worked (live-reported 2026-07-17).
  // Both sources now feed the same hold window.
  useLiveEvent<{ deviceId?: number; detected?: boolean }>(
    EventCategory.MotionOnMotionChanged,
    (evt) => {
      const p = evt.data
      if (!p || p.deviceId !== deviceId || !cfg?.motion) return
      if (p.detected === true) {
        // Held at least 1s even with motionHoldSec=0 — a rising edge must be
        // visible until the falling edge (or the hold) clears it.
        motionUntil.current = Date.now() + Math.max(1, motionHoldSec) * 1000
        motionWasActive.current = true
        force((v) => v + 1)
      } else if (p.detected === false && motionWasActive.current) {
        // Falling edge: re-arm the linger from NOW, mirroring the
        // pipeline-motion falling-edge behaviour further down.
        motionUntil.current = Date.now() + motionHoldSec * 1000
        motionWasActive.current = false
        force((v) => v + 1)
      }
    },
  )

  // Audio events (all devices on the category) — filter to this tile.
  useLiveEvent<PipelineAudioInferenceResultPayload>(
    EventCategory.PipelineAudioInferenceResult,
    (evt) => {
      const p = evt.data
      if (!p || p.deviceId !== deviceId || audioMode === 'off') return
      const on =
        audioMode === 'sensor'
          ? p.frame.detections.length > 0
          : (p.frame.level?.dbfs ?? Number.NEGATIVE_INFINITY) >= audioDb
      if (on) {
        audioUntil.current = Date.now() + audioHoldSec * 1000
        force((v) => v + 1)
      }
    },
  )

  // Extend the detection hold whenever a fresh (matching-class) detection arrives.
  useEffect(() => {
    if (!detection) return
    const match = detection.detections.some(
      (d) => detectionClasses.length === 0 || detectionClasses.includes(d.macroClass),
    )
    if (match) {
      detUntil.current = Date.now() + detectionHoldSec * 1000
      force((v) => v + 1)
    }
  }, [detection, detectionHoldSec, classesKey])

  // Motion hold: refresh the deadline while motion is ACTIVE and re-arm it at
  // the falling edge (active → null), so the highlight stays on for the full
  // `motionHoldSec` after the LAST active signal — never a stale deadline set
  // by an old event. Mirrors the detection hold above.
  useEffect(() => {
    const active = motion !== null
    if (active || motionWasActive.current) {
      motionUntil.current = Date.now() + motionHoldSec * 1000
      if (!active) force((v) => v + 1)
    }
    motionWasActive.current = active
  }, [motion, motionHoldSec])

  // Periodic re-eval so holds expire even with no new events.
  //
  // Gated on `cfg.enabled` — the same condition the body below returns `null`
  // for unconditionally. With the highlight OFF the tick could not change what
  // this hook returns, so every one of these was a wasted render of a tile,
  // twice a second, once per tile on the wall, for the life of the page. A
  // 16-camera wall spent 32 renders/s deciding nothing.
  const enabled = cfg?.enabled === true
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => force((v) => v + 1), TICK_MS)
    return () => clearInterval(t)
  }, [enabled])

  if (!cfg?.enabled) return null
  const now = Date.now()
  if (cfg.detection && now < detUntil.current) return 'detection'
  if (audioMode !== 'off' && now < audioUntil.current) return 'audio'
  if (cfg.motion && (motion !== null || now < motionUntil.current)) return 'motion'
  return null
}

/** Border colour when the share URL does not carry an operator override. */
export function highlightFallback(
  type: Exclude<HighlightType, null>,
  view: PaletteView,
): string {
  return paintKind(view, type)
}
