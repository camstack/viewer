/**
 * useDetections — live object-detection overlay feed for one camera.
 *
 * Subscribes to the system live-event bus for `detection.result` events (the
 * pipeline emits these; the `native-object-detection` cap does NOT carry
 * coordinates), filters to the target device, and exposes the latest frame's
 * boxes normalized to 0..1. The state auto-clears after a short idle window so
 * stale boxes fade when motion ends.
 *
 * Wire shape: the live `detection.result` payload is `data.frame =
 * { width, height, detections: ObjectDetection[] }`, where each detection is
 * `{ macroClass|class, score, bbox: { x, y, width, height } }` in PIXEL
 * coordinates (the admin-ui `DetectionCanvas` divides by frame width/height).
 * The SDK's `DetectionData` shape (`{ label, boundingBox: {x1,y1,x2,y2} }`) is
 * the NVR event-attached shape — NOT this live frame. We narrow defensively to
 * accept either box form and emit a single normalized 0..1 box.
 *
 * A second, parallel subscription listens for `pipeline-analytics.frame-tracked`
 * — the post-analysis addon's enriched re-injection carrying recognized names
 * (`labels[0].label`) and detail (face/plate) boxes tagged `kind: 'detail'`,
 * matched on `data.deviceId` (the event source is the addon, not the device).
 * While an enriched frame is fresh, the raw `detection.result` handler defers
 * to it so plain boxes don't clobber names. The suppression window reuses
 * `DETECTION_FADE_MS` itself (`shouldSuppressRaw`) — there is deliberately no
 * second "hold" constant. A separate, longer hold would let the enriched
 * display fade at `DETECTION_FADE_MS` while raw events stayed suppressed
 * past that point, producing a blank overlay gap until the hold expired.
 * Sharing one constant makes raw fallback resume exactly when the enriched
 * boxes fade, by construction.
 *
 * The window is not the whole gate: both planes carry their SOURCE frame's
 * timestamp, and a raw frame NEWER than the enriched one on screen is accepted
 * immediately. Post-analysis re-injects the frame it finished, so a lagging or
 * stalled enrichment plane would otherwise re-arm the window with every late
 * arrival and freeze the survivor boxes on an old frame — while the discarded
 * ghosts, which never pass this gate, kept tracking the subject. Same picture,
 * two layers, seconds apart.
 *
 * The subscription is torn down on unmount / deviceId change / disable — the
 * `subscribeEvent` helper returns an unsubscribe fn we always call on cleanup.
 */
import { useEffect, useRef, useState } from 'react'
import { useConnection } from '../connection/ConnectionProvider.js'

/** Live-event category carrying per-frame detection boxes. */
export const DETECTION_CATEGORY = 'detection.result'

/** Enriched overlay frames from post-analysis (two-plane re-injection). */
export const FRAME_TRACKED_CATEGORY = 'pipeline-analytics.frame-tracked'

/** Clear boxes after this idle gap so they fade once detection stops. Also
 *  the raw-suppression window: reused (not a second constant) so raw
 *  fallback resumes exactly when the enriched display fades. */
export const DETECTION_FADE_MS = 2_500

/** A single detection box, normalized 0..1 to the source frame. */
export interface DetectionBox {
  readonly label: string
  /** Confidence 0..1. */
  readonly score: number
  /** Normalized edges 0..1 (x1<=x2, y1<=y2). */
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  /** Enrichment name (recognized identity / plate text), when known. */
  readonly name?: string
  /** True for synthesized/real detail boxes (face/plate) — inner boxes. */
  readonly detail?: boolean
}

export interface DetectionState {
  readonly boxes: readonly DetectionBox[]
  /** Source frame width in px (for reference / aspect reasoning). */
  readonly frameWidth: number
  /** Source frame height in px. */
  readonly frameHeight: number
}

const EMPTY: DetectionState = { boxes: [], frameWidth: 0, frameHeight: 0 }

/** True when `value` is an object we can index without throwing. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Normalize a detection's bbox to 0..1 edges, accepting either the live
 *  pixel shape `{x,y,width,height}` or the NVR normalized shape
 *  `{x1,y1,x2,y2}`. Returns null when neither is well-formed. */
function normalizeBox(
  bbox: unknown,
  frameW: number,
  frameH: number,
): Pick<DetectionBox, 'x1' | 'y1' | 'x2' | 'y2'> | null {
  if (!isRecord(bbox)) return null

  // Pixel form: { x, y, width, height } (live ObjectDetection).
  const x = num(bbox.x)
  const y = num(bbox.y)
  const w = num(bbox.width)
  const h = num(bbox.height)
  if (x !== null && y !== null && w !== null && h !== null && frameW > 0 && frameH > 0) {
    return { x1: x / frameW, y1: y / frameH, x2: (x + w) / frameW, y2: (y + h) / frameH }
  }

  // Normalized form: { x1, y1, x2, y2 } (NVR DetectionData).
  const x1 = num(bbox.x1)
  const y1 = num(bbox.y1)
  const x2 = num(bbox.x2)
  const y2 = num(bbox.y2)
  if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
    return { x1, y1, x2, y2 }
  }

  return null
}

/** Read a detection's display class label across shapes (`macroClass`, then
 *  `class`, then `label`). */
function readLabel(det: Record<string, unknown>): string {
  if (typeof det.macroClass === 'string' && det.macroClass) return det.macroClass
  if (typeof det.class === 'string' && det.class) return det.class
  if (typeof det.label === 'string' && det.label) return det.label
  return 'object'
}

/** The parsed live detection frame: device id + normalized boxes. */
export interface ParsedDetectionFrame {
  readonly sourceId: string | number
  readonly boxes: DetectionBox[]
  readonly width: number
  readonly height: number
  /** `FrameResult.timestamp` — when the SOURCE frame was captured, not when
   *  the event landed. 0 when the provider omitted it. Compared against the
   *  enriched frame's stamp by `shouldSuppressRaw`. */
  readonly timestamp: number
}

/** Narrow the raw live-event payload to `{ source.id, frame }`, returning the
 *  device match + parsed boxes, or null when it doesn't apply. Exported pure
 *  for unit testing the shape-narrowing. */
export function parseDetectionEvent(event: unknown): ParsedDetectionFrame | null {
  if (!isRecord(event)) return null

  const source = event.source
  if (!isRecord(source)) return null
  const sourceId = source.id
  if (typeof sourceId !== 'string' && typeof sourceId !== 'number') return null

  const data = event.data
  if (!isRecord(data)) return null
  const frame = data.frame
  if (!isRecord(frame)) return null

  const width = num(frame.width) ?? 0
  const height = num(frame.height) ?? 0
  const timestamp = num(frame.timestamp) ?? 0
  const detections = frame.detections
  if (!Array.isArray(detections)) return null

  const boxes: DetectionBox[] = []
  for (const det of detections) {
    if (!isRecord(det)) continue
    const score = num(det.score)
    if (score === null) continue
    const norm = normalizeBox(det.bbox ?? det.boundingBox ?? det.region, width, height)
    if (!norm) continue
    boxes.push({ label: readLabel(det), score, ...norm })
  }

  return { sourceId, boxes, width, height, timestamp }
}

/** The parsed enriched frame: device id + normalized boxes (first-level + detail). */
export interface ParsedFrameTracked {
  readonly deviceId: number
  readonly boxes: DetectionBox[]
  readonly width: number
  readonly height: number
  /** The SOURCE frame this enrichment describes — post-analysis passes
   *  `FrameResult.timestamp` straight through, so it is the same clock the
   *  raw frames carry. 0 when absent. */
  readonly timestamp: number
}

/** Narrow a `pipeline-analytics.frame-tracked` payload. Match is on
 *  data.deviceId (the event source is the addon, not the device). */
export function parseFrameTrackedEvent(event: unknown): ParsedFrameTracked | null {
  if (!isRecord(event)) return null
  const data = event.data
  if (!isRecord(data)) return null
  const deviceId = num(data.deviceId)
  const width = num(data.frameWidth) ?? 0
  const height = num(data.frameHeight) ?? 0
  const timestamp = num(data.timestamp) ?? 0
  const detections = data.detections
  if (deviceId === null || !Array.isArray(detections)) return null

  const boxes: DetectionBox[] = []
  for (const det of detections) {
    if (!isRecord(det)) continue
    const score = num(det.score)
    if (score === null) continue
    const norm = normalizeBox(det.bbox, width, height)
    if (!norm) continue
    const labels = Array.isArray(det.labels) ? det.labels : []
    const first = labels.find(
      (l): l is Record<string, unknown> => isRecord(l) && typeof l.label === 'string',
    )
    const name = typeof first?.label === 'string' && first.label.length > 0 ? first.label : undefined
    boxes.push({
      label: readLabel(det),
      score,
      ...norm,
      ...(name !== undefined ? { name } : {}),
      ...(det.kind === 'detail' ? { detail: true } : {}),
    })
  }
  return { deviceId, boxes, width, height, timestamp }
}

/** Everything the raw-suppression decision needs. All times are ms. */
export interface RawSuppressionInput {
  /** Wall-clock when the last enriched frame was RECEIVED. 0 = never seen. */
  readonly lastEnrichedAtMs: number
  /** SOURCE-frame stamp of that enriched frame (`FrameResult.timestamp`, passed
   *  through by post-analysis). 0 when it carried none. */
  readonly lastEnrichedFrameMs: number
  /** SOURCE-frame stamp of the raw frame under consideration. 0 when absent. */
  readonly rawFrameMs: number
  /** Now. */
  readonly nowMs: number
}

/**
 * True when a raw `detection.result` frame should be discarded in favour of a
 * still-fresh enriched frame.
 *
 * Two conditions, both required:
 *
 * 1. The enriched frame is fresh — within `DETECTION_FADE_MS` of arriving.
 *    Reuses that constant (never a second one) so raw fallback resumes at the
 *    exact instant the enriched boxes fade; see the module doc.
 * 2. The raw frame is NOT newer than the enriched one. The window alone
 *    assumed the enriched plane keeps up, and it does not have to: post-analysis
 *    re-injects the frame it finished, so while it lags, each late arrival
 *    re-arms the window and every live frame inside it is dropped. The survivor
 *    boxes then freeze on a stale frame while the discarded ghosts — which come
 *    straight off `detection.result` and never pass this gate — keep tracking
 *    the subject. Comparing the frames' own stamps ends that desync while still
 *    protecting the names/detail boxes from an OLDER raw frame.
 *
 * A 0 stamp means "unknown", never "epoch": if either side lacks one, the time
 * window decides alone. Exported pure for unit testing.
 */
export function shouldSuppressRaw(input: RawSuppressionInput): boolean {
  if (input.nowMs - input.lastEnrichedAtMs >= DETECTION_FADE_MS) return false
  const bothStamped = input.rawFrameMs > 0 && input.lastEnrichedFrameMs > 0
  if (bothStamped && input.rawFrameMs > input.lastEnrichedFrameMs) return false
  return true
}

/**
 * Subscribe to live detections for `deviceId`. When `enabled` is false (toggle
 * off), no subscription is opened and the returned state stays empty.
 */
export function useDetections(deviceId: number, enabled: boolean): DetectionState {
  const { controller, state: connState } = useConnection()
  const [state, setState] = useState<DetectionState>(EMPTY)
  const fadeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!enabled || connState !== 'connected') {
      setState(EMPTY)
      return
    }

    const system = controller.getSystem()
    if (!system) return

    const clearFade = (): void => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current)
      fadeTimer.current = undefined
    }

    // Reset per-subscription. While enriched frames stay fresh (per
    // shouldSuppressRaw / DETECTION_FADE_MS) the raw handler below defers to
    // them, so a stale unenriched frame never clobbers names/detail boxes
    // mid-hold and raw resumes exactly when the enriched display would fade.
    // The enriched frame's OWN stamp is kept beside its arrival time: a raw
    // frame newer than what is on screen is accepted immediately, so a lagging
    // or stalled post-analysis plane can no longer freeze the survivor boxes
    // while the discarded ghosts keep moving.
    const lastEnrichedAt = { current: 0 }
    const lastEnrichedFrameAt = { current: 0 }

    const unsubscribe = system.subscribeEvent(DETECTION_CATEGORY, (event: unknown) => {
      const parsed = parseDetectionEvent(event)
      if (!parsed) return
      // `source.id` may be string or number across providers; compare loosely.
      if (Number(parsed.sourceId) !== deviceId) return
      if (
        shouldSuppressRaw({
          lastEnrichedAtMs: lastEnrichedAt.current,
          lastEnrichedFrameMs: lastEnrichedFrameAt.current,
          rawFrameMs: parsed.timestamp,
          nowMs: Date.now(),
        })
      ) {
        return
      }

      setState({ boxes: parsed.boxes, frameWidth: parsed.width, frameHeight: parsed.height })

      clearFade()
      fadeTimer.current = setTimeout(() => setState(EMPTY), DETECTION_FADE_MS)
    })

    const unsubscribeEnriched = system.subscribeEvent(FRAME_TRACKED_CATEGORY, (event: unknown) => {
      const parsed = parseFrameTrackedEvent(event)
      if (!parsed || parsed.deviceId !== deviceId) return
      if (parsed.boxes.length === 0) return
      lastEnrichedAt.current = Date.now()
      lastEnrichedFrameAt.current = parsed.timestamp
      setState({ boxes: parsed.boxes, frameWidth: parsed.width, frameHeight: parsed.height })
      clearFade()
      fadeTimer.current = setTimeout(() => setState(EMPTY), DETECTION_FADE_MS)
    })

    return () => {
      unsubscribe()
      unsubscribeEnriched()
      clearFade()
      setState(EMPTY)
    }
  }, [controller, connState, deviceId, enabled])

  return state
}
