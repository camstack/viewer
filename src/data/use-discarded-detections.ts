/**
 * useDiscardedDetections — the DIAGNOSTIC feed: what the model saw that the
 * pipeline threw away before the overlay could draw it.
 *
 * ## Why this exists
 *
 * The live overlay draws `detection.result`, which is POST-pipeline: between
 * the model and the screen sit NMS (in the postprocessor), the step's
 * per-macro `minConfidence` filter, the full-frame phantom guard, and the
 * zone-rule gate. An operator watching a busy scene with two boxes on screen
 * has no way to tell "the model saw two" from "the model saw nine and seven
 * were dropped". This module makes that gap legible.
 *
 * ## What the wire offers
 *
 * - `detection.result` carries the dropped boxes as `FrameResult.discarded[]`
 *   on every frame that dropped at least one (since 2026-08-01) — absent means
 *   "nothing dropped", never "not implemented".
 * - `pipeline.trace` is emitted per live frame (summary verbosity): each step
 *   carries `outputCount` — for the root detector that is the post-NMS model
 *   output BEFORE the confidence / class / full-frame filters — and the trace
 *   carries `detectionCount`, the survivor count. The difference is the count
 *   gap the pill shows (zone-gate drops happen after the trace is built and are
 *   NOT in it).
 * - An overload shed rides the trace as a step `error: 'shed:<reason>'` —
 *   the frame was deliberately not inferred, which is a different fact from
 *   "the model saw nothing" and is surfaced separately.
 *
 * ## Coordinate spaces (they differ per shape — see use-detections.ts)
 *
 * Survivor boxes on `detection.result` arrive as `{x,y,width,height}` in
 * PIXELS of the analysis frame. The executor's drop sites hold `AbsoluteBbox`
 * TUPLES `[x1,y1,x2,y2]`, also in analysis-frame pixels. Both are normalised
 * here against `frame.width`/`frame.height` from the same event; an
 * `{x1,y1,x2,y2}` OBJECT is treated as already normalised (the NVR shape),
 * mirroring `use-detections.ts`.
 */
import { useEffect, useRef, useState } from 'react'
import { useConnection } from '../connection/ConnectionProvider.js'
import { DETECTION_FADE_MS } from './use-detections.js'

/** The discarded boxes ride the same live event as the survivors. */
export const DISCARDED_CATEGORY = 'detection.result'

/** Per-frame execution trace — emitted live at summary verbosity. */
export const PIPELINE_TRACE_CATEGORY = 'pipeline.trace'

/** One box the pipeline dropped, normalised 0..1 to the source frame. */
export interface DiscardedBox {
  readonly label: string
  /** Detector confidence 0..1. */
  readonly score: number
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  /** Server drop-reason code (e.g. `'full-frame-guard'`). Absent when the
   *  server did not say — never fabricated client-side. */
  readonly reason?: string
}

/** The per-frame count gap derived from `pipeline.trace`. */
export interface TraceDiagnostics {
  readonly deviceId: number
  /** Post-NMS root-detector output count — what the model saw on the frame. */
  readonly modelSaw: number
  /** Survivors after the executor's filters (pre zone-gate). */
  readonly kept: number
  /** Present when the frame was overload-shed (`shed:<reason>` step error). */
  readonly shedReason?: string
}

export interface DiscardedState {
  readonly boxes: readonly DiscardedBox[]
  readonly frameWidth: number
  readonly frameHeight: number
  /** Latest fresh trace numbers, or null when none arrived / faded. */
  readonly trace: TraceDiagnostics | null
}

const EMPTY: DiscardedState = { boxes: [], frameWidth: 0, frameHeight: 0, trace: null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Normalise a discarded entry's bbox to 0..1 edges. Accepts the executor's
 *  absolute-pixel tuple `[x1,y1,x2,y2]`, the survivor-style pixel object
 *  `{x,y,width,height}`, and the already-normalised `{x1,y1,x2,y2}` object. */
function normalizeDiscardedBbox(
  bbox: unknown,
  frameW: number,
  frameH: number,
): Pick<DiscardedBox, 'x1' | 'y1' | 'x2' | 'y2'> | null {
  // Executor tuple: [x1, y1, x2, y2] in absolute source-frame pixels.
  if (Array.isArray(bbox) && bbox.length === 4 && frameW > 0 && frameH > 0) {
    const x1 = num(bbox[0])
    const y1 = num(bbox[1])
    const x2 = num(bbox[2])
    const y2 = num(bbox[3])
    if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
      return { x1: x1 / frameW, y1: y1 / frameH, x2: x2 / frameW, y2: y2 / frameH }
    }
    return null
  }

  if (!isRecord(bbox)) return null

  // Pixel object: { x, y, width, height } (survivor DetectionBoundingBox).
  const x = num(bbox.x)
  const y = num(bbox.y)
  const w = num(bbox.width)
  const h = num(bbox.height)
  if (x !== null && y !== null && w !== null && h !== null && frameW > 0 && frameH > 0) {
    return { x1: x / frameW, y1: y / frameH, x2: (x + w) / frameW, y2: (y + h) / frameH }
  }

  // Normalised object: { x1, y1, x2, y2 } (NVR shape) — taken as-is.
  const nx1 = num(bbox.x1)
  const ny1 = num(bbox.y1)
  const nx2 = num(bbox.x2)
  const ny2 = num(bbox.y2)
  if (nx1 !== null && ny1 !== null && nx2 !== null && ny2 !== null) {
    return { x1: nx1, y1: ny1, x2: nx2, y2: ny2 }
  }

  return null
}

function readLabel(det: Record<string, unknown>): string {
  if (typeof det.macroClass === 'string' && det.macroClass) return det.macroClass
  if (typeof det.class === 'string' && det.class) return det.class
  if (typeof det.label === 'string' && det.label) return det.label
  return 'object'
}

/** The parsed discarded set of one live frame. */
export interface ParsedDiscardedFrame {
  readonly sourceId: string | number
  readonly boxes: DiscardedBox[]
  readonly width: number
  readonly height: number
}

/**
 * Narrow a `detection.result` envelope to its `frame.discarded[]`, or null
 * when the frame dropped nothing (the server omits the field entirely then).
 * Null — not an empty frame — so a subscriber ignores the event rather than
 * clearing state on every frame that happened to drop nothing.
 * Exported pure for unit testing.
 */
export function parseDiscardedEvent(event: unknown): ParsedDiscardedFrame | null {
  if (!isRecord(event)) return null

  const source = event.source
  if (!isRecord(source)) return null
  const sourceId = source.id
  if (typeof sourceId !== 'string' && typeof sourceId !== 'number') return null

  const data = event.data
  if (!isRecord(data)) return null
  const frame = data.frame
  if (!isRecord(frame)) return null

  const discarded = frame.discarded
  if (!Array.isArray(discarded)) return null

  const width = num(frame.width) ?? 0
  const height = num(frame.height) ?? 0

  const boxes: DiscardedBox[] = []
  for (const det of discarded) {
    if (!isRecord(det)) continue
    const score = num(det.score)
    if (score === null) continue
    const norm = normalizeDiscardedBbox(det.bbox, width, height)
    if (!norm) continue
    const reason = typeof det.reason === 'string' && det.reason.length > 0 ? det.reason : undefined
    boxes.push({
      label: readLabel(det),
      score,
      ...norm,
      ...(reason !== undefined ? { reason } : {}),
    })
  }

  return { sourceId, boxes, width, height }
}

const SHED_PREFIX = 'shed:'

/**
 * Narrow a live `pipeline.trace` envelope to the count gap. `modelSaw` sums
 * `outputCount` over FULL-FRAME DETECTIONS steps only — a classifier's class
 * count or a crop-roi detail step is not "what the detector saw on the
 * frame" and would inflate the gap. Exported pure for unit testing.
 */
export function parseTraceEvent(event: unknown): TraceDiagnostics | null {
  if (!isRecord(event)) return null
  const data = event.data
  if (!isRecord(data)) return null
  const deviceId = num(data.deviceId)
  if (deviceId === null) return null
  const steps = Array.isArray(data.steps) ? data.steps : []

  let modelSaw = 0
  let shedReason: string | undefined
  for (const step of steps) {
    if (!isRecord(step)) continue
    if (step.inputType === 'full-frame' && step.outputKind === 'detections') {
      modelSaw += num(step.outputCount) ?? 0
    }
    if (typeof step.error === 'string' && step.error.startsWith(SHED_PREFIX)) {
      shedReason = step.error.slice(SHED_PREFIX.length) || 'overload'
    }
  }

  const kept = num(data.detectionCount) ?? 0
  return { deviceId, modelSaw, kept, ...(shedReason !== undefined ? { shedReason } : {}) }
}

/** Known server drop-reason codes → i18n label keys. Null for an unknown
 *  code, so the UI shows the raw code verbatim rather than mislabelling it. */
export function discardReasonKey(reason: string): string | null {
  switch (reason) {
    case 'below-threshold':
    case 'confidence':
      return 'v2.overlay.reasonThreshold'
    case 'full-frame-guard':
      return 'v2.overlay.reasonFullFrame'
    case 'nms':
      return 'v2.overlay.reasonNms'
    case 'class-filter':
      return 'v2.overlay.reasonClassFilter'
    case 'zone-gate':
      return 'v2.overlay.reasonZoneGate'
    default:
      return null
  }
}

/**
 * The drop reasons the `all` rung actually DRAWS — the middle ground between
 * "survivors only" and "every box the model emitted".
 *
 * The server's `DiscardReason` union has four members and they split cleanly
 * into two kinds of fact:
 *
 * - **The subject was relevant, the pipeline said no anyway.**
 *   `below-threshold` (an enabled class that missed its `minConfidence`) and
 *   `zone-gate` (the right subject, standing outside a zone rule). These are
 *   exactly the boxes an operator wants back: they are what makes a walking
 *   person's boxes flicker instead of running continuously.
 * - **The subject was never relevant.** `class-filter` (a class the operator
 *   did not enable, or one the `classMap` does not map — the chairs and the
 *   TVs) and `full-frame-guard` (the whole-frame phantom). Drawing these is
 *   what made the rung unusable: a busy scene turned into a wall of dashed
 *   red that hid the two boxes that mattered.
 *
 * `confidence` is here because {@link discardReasonKey} already labels it
 * "below threshold": one fact, one label, one draw decision. An unknown or
 * missing code is NOT drawn — the server always sets a reason, so a box
 * without one is from a provider whose relevance we cannot assert, and the
 * pill still counts it.
 */
export const RELEVANT_DISCARD_REASONS: readonly string[] = Object.freeze([
  'below-threshold',
  'confidence',
  'zone-gate',
])

/** True when a dropped box is a near-miss or out-of-zone subject worth drawing. */
export function isRelevantDiscard(box: DiscardedBox): boolean {
  return box.reason !== undefined && RELEVANT_DISCARD_REASONS.includes(box.reason)
}

/**
 * The subset of one frame's discarded boxes the overlay draws.
 *
 * The hook deliberately does NOT apply this: `useDiscardedDetections` stays the
 * unfiltered diagnostic feed so the count pill can keep reporting the whole
 * model-saw/kept gap. Filtering is a DRAWING decision and belongs at the draw
 * site. Pure, so it is testable without a renderer.
 */
export function filterRelevantDiscards(
  boxes: readonly DiscardedBox[],
): readonly DiscardedBox[] {
  return boxes.filter(isRelevantDiscard)
}

/**
 * Subscribe to the diagnostic feed for `deviceId`. When `enabled` is false no
 * subscription is opened and the state stays empty. Boxes and the trace pill
 * fade independently after `DETECTION_FADE_MS` (the same window the survivor
 * overlay uses, so the two layers appear and disappear together).
 */
export function useDiscardedDetections(deviceId: number, enabled: boolean): DiscardedState {
  const { controller, state: connState } = useConnection()
  const [state, setState] = useState<DiscardedState>(EMPTY)
  const boxFade = useRef<ReturnType<typeof setTimeout>>(undefined)
  const traceFade = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!enabled || connState !== 'connected') {
      setState(EMPTY)
      return
    }

    const system = controller.getSystem()
    if (!system) return

    const clearTimer = (ref: { current: ReturnType<typeof setTimeout> | undefined }): void => {
      if (ref.current) clearTimeout(ref.current)
      ref.current = undefined
    }

    const unsubscribeDiscarded = system.subscribeEvent(DISCARDED_CATEGORY, (event: unknown) => {
      const parsed = parseDiscardedEvent(event)
      if (!parsed) return
      // `source.id` may be string or number across providers; compare loosely.
      if (Number(parsed.sourceId) !== deviceId) return

      setState((prev) => ({
        ...prev,
        boxes: parsed.boxes,
        frameWidth: parsed.width,
        frameHeight: parsed.height,
      }))
      clearTimer(boxFade)
      boxFade.current = setTimeout(
        () => setState((prev) => ({ ...prev, boxes: [], frameWidth: 0, frameHeight: 0 })),
        DETECTION_FADE_MS,
      )
    })

    const unsubscribeTrace = system.subscribeEvent(PIPELINE_TRACE_CATEGORY, (event: unknown) => {
      const parsed = parseTraceEvent(event)
      if (!parsed || parsed.deviceId !== deviceId) return

      setState((prev) => ({ ...prev, trace: parsed }))
      clearTimer(traceFade)
      traceFade.current = setTimeout(
        () => setState((prev) => ({ ...prev, trace: null })),
        DETECTION_FADE_MS,
      )
    })

    return () => {
      unsubscribeDiscarded()
      unsubscribeTrace()
      clearTimer(boxFade)
      clearTimer(traceFade)
      setState(EMPTY)
    }
  }, [controller, connState, deviceId, enabled])

  return state
}
