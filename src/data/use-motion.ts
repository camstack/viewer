/**
 * useMotion — live "is this camera seeing motion right now" state for one device.
 *
 * Two complementary sources, merged:
 *  1. A slow react-query poll of the `motion` cap's auto-injected
 *     `getStatus({ deviceId })` — seeds the initial state and self-heals if an
 *     event is missed. The `motion` cap declares `status: { kind: 'push' }`,
 *     so codegen injects `getStatus` returning `MotionStatus`
 *     (`{ detected, lastDetectedAt, autoClearAfterMs }`).
 *  2. The live event `motion.onMotionChanged` (payload
 *     `{ deviceId, detected, timestamp, source, regions? }`) for instant flips
 *     between polls. We subscribe via `system.subscribeEvent`, type-guard the
 *     payload, filter by `deviceId`, and always tear down the unsubscribe on
 *     cleanup (mirrors `use-detections.ts`).
 *
 * Graceful when the cap isn't registered for a device: `getStatus` rejects
 * (e.g. "not registered") and we treat the camera as inactive — no throw, no
 * badge. The event subscription for a category nothing emits is simply silent.
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useSettingsStore } from '../store/settings-store.js'
import { RECONCILE_MS } from './reconcile.js'

/**
 * Live-event bus category carrying motion start/stop transitions.
 *
 * This MUST equal the hub's `EventCategory.MotionOnMotionChanged` bus value —
 * `'motion.on-motion-changed'` (kebab-case). The cap's tRPC event surface is
 * `motion.onMotionChanged` (camelCase), but `subscribeEvent` filters on the BUS
 * category, not the method name (see `use-detections` → `'detection.result'`
 * and `use-audio` → `'pipeline.audio-inference-result'`, both kebab bus values).
 * The previous camelCase value `'motion.onMotionChanged'` matched nothing on the
 * bus, so the live event NEVER fired and motion state only updated on the slow
 * poll below — brief motion was missed entirely ("motion highlight non parte").
 * Exported so a regression test pins it to the hub's kebab-case bus value.
 */
export const MOTION_CATEGORY = 'motion.on-motion-changed'

/** Per-analysed-frame motion result — the regions PLUS the frame dimensions
 *  they are expressed in. `EventCategory.MotionAnalysis` in `@camstack/types`
 *  (`packages/types/src/enums/event-category.ts`). */
export const MOTION_ANALYSIS_CATEGORY = 'detection.motion-analysis'


/** What the hook returns: a single boolean the UI keys its indicator off. */
export interface MotionState {
  readonly active: boolean
}

/** True when `value` is an object we can index without throwing. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Narrow an unknown `getStatus` result to its `detected` flag, defaulting
 *  false when the shape is unexpected. */
function readDetected(status: unknown): boolean {
  return isRecord(status) && typeof status.detected === 'boolean' ? status.detected : false
}

/**
 * One moving area, as the detector found it.
 *
 * NORMALISED 0..1 here, but that is this module's doing: the wire carries
 * `BoundingBoxSchema` — `{ x, y, w, h }` in PIXELS of the analysis frame (see
 * `motion-wasm/zone-gate.ts`, which divides by `frameWidth` for exactly this
 * reason). The frame dimensions travel on the same event, so the conversion
 * happens once, here, and every consumer gets a space it can draw in without
 * knowing the analyser's resolution.
 *
 * Both halves of that sentence were wrong in the first implementation: it
 * expected `x1,y1,x2,y2` and treated the numbers as already normalised, so
 * every region was rejected by the parser and nothing was ever drawn.
 */
export interface MotionRegion {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** Changed pixels in the region — drives the opacity ramp. */
  readonly pixelCount: number
  readonly intensity: number
}

/** The parsed motion TRANSITION event: device id + detected flag. It carries
 *  regions too, but only for the instant motion flipped — see
 *  {@link parseMotionAnalysis} for the per-frame source an overlay needs. */
export interface ParsedMotionEvent {
  readonly deviceId: number
  readonly detected: boolean
}

function parseRegion(raw: unknown, frameW: number, frameH: number): MotionRegion | null {
  if (!isRecord(raw) || frameW <= 0 || frameH <= 0) return null
  const bbox = raw.bbox
  if (!isRecord(bbox)) return null
  const { x, y, w, h } = bbox
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof w !== 'number' ||
    typeof h !== 'number'
  ) {
    return null
  }
  if (!(w > 0) || !(h > 0)) return null
  return {
    x: x / frameW,
    y: y / frameH,
    w: w / frameW,
    h: h / frameH,
    pixelCount: typeof raw.pixelCount === 'number' ? raw.pixelCount : 0,
    intensity: typeof raw.intensity === 'number' ? raw.intensity : 0,
  }
}

/**
 * Narrow a `detection.motion-analysis` payload into normalised regions.
 *
 * This is the event a live overlay needs, and NOT the one the first
 * implementation used. `motion.onMotionChanged` fires only on TRANSITIONS
 * (`pipeline-runner/index.ts` emits it under `detected !== prevDetected`), so
 * an overlay fed from it would freeze on the geometry of the instant motion
 * began. `detection.motion-analysis` fires per analysed frame AND carries
 * `frameWidth`/`frameHeight`, without which pixel bboxes cannot be placed.
 */
export function parseMotionAnalysis(event: unknown): ParsedMotionAnalysis | null {
  if (!isRecord(event)) return null
  const data = isRecord(event.data) ? event.data : event
  const src = isRecord(event.source) ? event.source : null
  const deviceId = typeof data.deviceId === 'number' ? data.deviceId : src?.deviceId
  if (typeof deviceId !== 'number') return null
  const frameW = typeof data.frameWidth === 'number' ? data.frameWidth : 0
  const frameH = typeof data.frameHeight === 'number' ? data.frameHeight : 0
  const raw = data.regions
  const regions = Array.isArray(raw)
    ? raw
        .map((r) => parseRegion(r, frameW, frameH))
        .filter((r): r is MotionRegion => r !== null)
    : []
  return { deviceId, detected: data.detected === true, regions }
}

/** A parsed `detection.motion-analysis` frame. */
export interface ParsedMotionAnalysis {
  readonly deviceId: number
  readonly detected: boolean
  readonly regions: readonly MotionRegion[]
}

/**
 * Narrow the raw `motion.onMotionChanged` payload.
 *
 * `regions` was parsed away until 2026-08-01 — the payload carries it
 * (`MotionRegionSchema`: bbox + pixelCount + intensity, and the analysis result
 * documents `rawRegions` as being "used for UI debug overlay"), but the viewer
 * kept only `detected`, so there was nothing for a motion-region overlay to
 * draw. `optional` on the wire: a provider that reports motion without regions
 * yields an empty list rather than a dropped event.
 */
export function parseMotionEvent(event: unknown): ParsedMotionEvent | null {
  const payload = motionEventPayload(event)
  if (payload === null) return null
  const deviceId = payload.deviceId
  const detected = payload.detected
  if (typeof deviceId !== 'number' || typeof detected !== 'boolean') return null
  return { deviceId, detected }
}

/**
 * The `MotionOnMotionChanged` payload of a `live.onEvent` push.
 *
 * `subscribeEvent` hands over the hub's ENVELOPE — `{ id, timestamp, source,
 * category, data }` — and `deviceId` / `detected` / `timestamp` live in `data`.
 * This parser read them off the envelope itself until 2026-10-06, so every
 * live motion event was dropped: the motion border, the haptics and the
 * Cameras page's Motion order all ran on the `getStatus` poll alone. A bare
 * payload (no `data`) is read as itself, as `parseMotionAnalysis` does.
 */
export function motionEventPayload(event: unknown): Record<string, unknown> | null {
  if (!isRecord(event)) return null
  return isRecord(event.data) ? event.data : event
}

/**
 * Live motion state for `deviceId`. When `enabled` is false, no poll and no
 * subscription run and the state stays inactive. Returns `{ active }`.
 */
export function useMotion(deviceId: number, enabled: boolean): MotionState {
  const { controller, state: connState } = useConnection()
  const connected = enabled && connState === 'connected'

  // 1) Poll `getStatus` — seeds + self-heals. Rejects (cap not registered) →
  //    inactive, no throw.
  const { data: polled = false } = useQuery<boolean>({
    queryKey: ['v2', 'motion', deviceId],
    enabled: connected,
    // Paired with the interval on purpose: without it the global 5s
    // default makes this stale long before its own cadence, so every
    // remount refetches and the reconcile design does nothing.
    staleTime: RECONCILE_MS,
    refetchInterval: RECONCILE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return false
      try {
        const status = await system.trpcClient.motion.getStatus.query({ deviceId })
        return readDetected(status)
      } catch {
        return false
      }
    },
  })

  // 2) Live event → instant flips. The subscription overrides the polled seed
  //    until the next poll reconciles.
  const [live, setLive] = useState<boolean | null>(null)

  useEffect(() => {
    if (!connected) {
      setLive(null)
      return
    }
    const system = controller.getSystem()
    if (!system) return

    const unsubscribe = system.subscribeEvent(MOTION_CATEGORY, (event: unknown) => {
      const parsed = parseMotionEvent(event)
      if (!parsed || parsed.deviceId !== deviceId) return
      setLive(parsed.detected)
    })

    return () => {
      unsubscribe()
      setLive(null)
    }
  }, [controller, connected, deviceId])

  // Live event wins when present (most recent truth); otherwise the poll.
  return { active: live ?? polled }
}

/**
 * The moving AREAS, for the motion-region overlay.
 *
 * Separate from {@link useMotion} on purpose. That hook is mounted by the card,
 * the grid tile and the highlight border — everything that only needs a
 * boolean — and giving it an array would make every one of them re-render on
 * each motion frame for a value they never read.
 *
 * Regions arrive only on the event; there is no poll, because a region set has
 * no meaningful "current" value between frames. They are cleared when motion
 * drops, so the overlay empties instead of freezing on the last shape.
 */
export function useMotionRegions(
  deviceId: number,
  enabled: boolean,
): readonly MotionRegion[] {
  const { controller, state: connState } = useConnection()
  const connected = enabled && connState === 'connected'
  const [regions, setRegions] = useState<readonly MotionRegion[]>([])

  useEffect(() => {
    if (!connected) {
      setRegions([])
      return
    }
    const system = controller.getSystem()
    if (!system) return
    // `detection.motion-analysis`, NOT `motion.onMotionChanged`: the latter
    // fires only when motion STARTS or STOPS, so the overlay would freeze on
    // the geometry of that one instant. This one fires per analysed frame and
    // carries the frame dimensions the pixel bboxes need.
    const unsubscribe = system.subscribeEvent(MOTION_ANALYSIS_CATEGORY, (event: unknown) => {
      const parsed = parseMotionAnalysis(event)
      if (!parsed || parsed.deviceId !== deviceId) return
      setRegions(parsed.detected ? parsed.regions : [])
    })
    return () => {
      unsubscribe()
      setRegions([])
    }
  }, [controller, connected, deviceId])

  return regions
}

// ── Configurable linger (grid highlight persistence) ──────────────────────────
// The motion highlight stays ON while motion is active AND for a configurable
// number of seconds AFTER the last active signal (the LONGER of the two). Motion
// is a brief transition, so without a linger the highlight would flicker off the
// instant the runner reports `detected: false`. The hold seconds live in the
// settings-store (`grid.motionHoldSec`). The decision is expressed as two pure,
// clock-injectable helpers (mirroring `use-detections`' `shouldSuppressRaw`) so
// the linger logic is unit-tested in isolation; the hook is thin glue over them.

/**
 * The "on-until" deadline set the moment motion goes inactive: keep the
 * highlight lit until `dropAt + holdMs`. Pure — `dropAt`/`holdMs` injected.
 */
export function motionHoldDeadline(dropAt: number, holdMs: number): number {
  return dropAt + Math.max(0, holdMs)
}

/**
 * Whether the motion highlight should render right now: ON while motion is
 * `active`, otherwise ON until the `deadline` set by {@link motionHoldDeadline}
 * elapses. Pure — `now` injected for unit testing.
 */
export function isMotionHoldOn(active: boolean, deadline: number, now: number): boolean {
  return active || now < deadline
}

/**
 * Live motion highlight state for `deviceId`, WITH the configurable linger:
 * `true` while motion is active and for `grid.motionHoldSec` seconds after the
 * last active signal. Thin glue over {@link useMotion} + the pure helpers above;
 * this is the single source every surface (grid tile, card, detail) keys its
 * motion indicator off, so the behaviour is identical everywhere.
 */
export function useMotionHighlight(deviceId: number, enabled: boolean): boolean {
  const { active } = useMotion(deviceId, enabled)
  const holdMs = useSettingsStore((s) => s.settings.grid.motionHoldSec) * 1000
  // Held in state (never derived from a ref during render) so the value is
  // lint-clean and re-renders exactly when it flips — mirrors `useHeld`.
  const [on, setOn] = useState(false)
  // Linger only follows a REAL active→inactive transition. Without this, the
  // mount-time run of the effect (active=false, never was active) started a
  // full linger window → every card/detail showed a phantom "Motion" badge for
  // motionHoldSec seconds while (re)loading.
  const wasActiveRef = useRef(false)

  useEffect(() => {
    // Active → lit immediately (and stays lit while active). On the
    // active→inactive transition, start the linger from NOW: the highlight
    // stays on until the deadline, and a single timer clears it when the window
    // elapses (no further events needed). A fresh active flip re-runs this
    // effect, clearing the pending timer and resetting the linger window.
    if (active) {
      wasActiveRef.current = true
      setOn(true)
      return
    }
    if (!wasActiveRef.current) {
      // Never active in this mount — nothing to linger.
      setOn(false)
      return
    }
    wasActiveRef.current = false
    const now = Date.now()
    const deadline = motionHoldDeadline(now, holdMs)
    setOn(isMotionHoldOn(false, deadline, now))
    const remaining = deadline - now
    if (remaining <= 0) return
    const timer = setTimeout(() => setOn(false), remaining)
    return () => clearTimeout(timer)
  }, [active, holdMs])

  return on
}
