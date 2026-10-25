/**
 * Zoom trace — the numbers behind one gesture, accumulated on the UI thread
 * and rendered once. Pure and RN-free; the hook owns a buffer in a shared
 * value and calls these as worklets.
 *
 * Why it exists: the operator can only say how the zoom FEELS ("scattoso",
 * "torna in avanti"), and every input of the gesture lives inside worklets
 * where a normal log line cannot reach. A per-frame `runOnJS` would itself be
 * the stutter it reports (0d3d1c9 removed exactly that). So samples go into a
 * bounded buffer on the UI thread and cross to JS ONCE, at the end.
 *
 * What one pinch to the maximum must tell, per line, without the code open:
 * live vs committed scale, the pan before and after the clamp and the limit it
 * met, the box the geometry used and the box actually drawn, the instant of
 * the release — and, after it, the box's follow-through.
 */

export type ZoomTracePhase = 'start' | 'update' | 'end' | 'step' | 'box'

export interface ZoomTraceSample {
  /** Milliseconds since the trace began (the gesture's start). */
  readonly t: number
  readonly phase: ZoomTracePhase
  /** `scale.value` — what the picture is drawn with right now. */
  readonly live: number
  /** The scale a gesture left behind — what the box height derives from. */
  readonly committed: number
  readonly pointers?: number
  readonly focalX?: number
  readonly focalY?: number
  /** Pan BEFORE the clamp. */
  readonly rawX?: number
  readonly rawY?: number
  /** Pan AFTER the clamp — what `tx`/`ty` were set to. */
  readonly x: number
  readonly y: number
  readonly limX?: number
  readonly limY?: number
  /** The box the geometry clamped against. */
  readonly boxW: number
  readonly boxH: number
  /** The box height actually applied to the view (the screen's animated value). */
  readonly drawnH?: number
  readonly note?: string
}

export interface ZoomTraceBuffer {
  samples: ZoomTraceSample[]
  /** Wall-clock start of the open trace; 0 when none is open. */
  startedAt: number
  lastUpdateT: number
  lastBoxT: number
}

/** Upper bound on samples per trace: ~13 s of throttled updates. */
export const ZOOM_TRACE_CAP = 400
/** Per-frame samples (`update`, `box`) closer than this are dropped; phase changes never are. */
export const ZOOM_TRACE_UPDATE_MIN_MS = 32

export function newZoomTraceBuffer(): ZoomTraceBuffer {
  return { samples: [], startedAt: 0, lastUpdateT: -ZOOM_TRACE_UPDATE_MIN_MS, lastBoxT: -ZOOM_TRACE_UPDATE_MIN_MS }
}

export function beginZoomTrace(buf: ZoomTraceBuffer, now: number): void {
  'worklet'
  buf.samples = []
  buf.startedAt = now
  buf.lastUpdateT = -ZOOM_TRACE_UPDATE_MIN_MS
  buf.lastBoxT = -ZOOM_TRACE_UPDATE_MIN_MS
}

export function zoomTraceElapsed(buf: ZoomTraceBuffer, now: number): number {
  'worklet'
  return buf.startedAt === 0 ? 0 : now - buf.startedAt
}

export function pushZoomSample(buf: ZoomTraceBuffer, sample: ZoomTraceSample): void {
  'worklet'
  if (sample.phase === 'update') {
    if (sample.t - buf.lastUpdateT < ZOOM_TRACE_UPDATE_MIN_MS) return
    buf.lastUpdateT = sample.t
  } else if (sample.phase === 'box') {
    if (sample.t - buf.lastBoxT < ZOOM_TRACE_UPDATE_MIN_MS) return
    buf.lastBoxT = sample.t
  }
  if (buf.samples.length >= ZOOM_TRACE_CAP) return
  buf.samples.push(sample)
}

/** Hand the samples over and empty the buffer: each is reported exactly once. */
export function takeZoomTrace(buf: ZoomTraceBuffer): ZoomTraceSample[] {
  'worklet'
  const out = buf.samples
  buf.samples = []
  buf.startedAt = 0
  return out
}

const f2 = (n: number): string => n.toFixed(2)
const r = (n: number): string => String(Math.round(n))

function panText(s: ZoomTraceSample): string {
  if (s.rawX === undefined || s.rawY === undefined) return ''
  const clampedX = Math.abs(s.rawX - s.x) > 0.5
  const clampedY = Math.abs(s.rawY - s.y) > 0.5
  const hit = clampedX || clampedY ? ` CLAMPED ${clampedX ? 'x' : ''}${clampedY ? 'y' : ''}` : ''
  return `pan ${r(s.x)},${r(s.y)} (raw ${r(s.rawX)},${r(s.rawY)}${hit})`
}

/** One line per sample; JS side, once per trace. */
export function formatZoomTrace(samples: readonly ZoomTraceSample[]): string {
  return samples
    .map((s) => {
      const parts: string[] = [
        `${`+${r(s.t)}ms`.padStart(7)}  ${s.phase.padEnd(6)}`,
        `live ${f2(s.live)}`,
        `committed ${f2(s.committed)}`,
      ]
      if (s.pointers !== undefined) parts.push(`${s.pointers} fingers`)
      if (s.focalX !== undefined && s.focalY !== undefined) parts.push(`focal ${r(s.focalX)},${r(s.focalY)}`)
      const pan = panText(s)
      if (pan !== '') parts.push(pan)
      if (s.limX !== undefined && s.limY !== undefined) parts.push(`limit ±${r(s.limX)},±${r(s.limY)}`)
      if (s.drawnH !== undefined) parts.push(`drawn ${r(s.drawnH)} of ${r(s.boxH)} asked`)
      parts.push(`box ${r(s.boxW)}x${r(s.boxH)}`)
      if (s.note !== undefined) parts.push(s.note)
      return parts.join('  ')
    })
    .join('\n')
}
