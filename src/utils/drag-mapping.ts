/**
 * drag-mapping — velocity-adaptive px→time mapping for the timeline drag.
 *
 * THE MAPPING PROBLEM (measured, 48 h of feeder telemetry): the timeline maps
 * ~8.8 s of media per CSS pixel at default zoom, and the feeder's sweep mode
 * only engages while consecutive drag targets stay within a 4 s window. A slow,
 * careful 3 px move is already a ~26 s target delta — so the path that delivers
 * frame-granular scrub essentially never ran: 102 `mode=jump` pushes vs 3
 * `mode=sweep`, and six drag-ends delivered ZERO access units. The storage
 * layer can serve second-by-second today; the MAPPING was what kept every drag
 * at keyframe granularity.
 *
 * The fix is a jog dial: a drag has two intents, and velocity tells them apart.
 *  - A FAST drag ("take me to this afternoon") keeps the absolute px→time
 *    mapping of the zoom level — reach is preserved, jumps are correct there.
 *  - A SLOW, careful drag ("show me the moment") switches to a FINE per-pixel
 *    scale (default 1 px = 1 s) so every emitted target delta fits the feeder's
 *    sweep window in BOTH directions — forward P-frame flow, backward
 *    IDR+prefix steps. The cursor detaches from the absolute finger position
 *    (that is what a jog dial is); the drag-end commit uses the CURSOR.
 *
 * Hysteresis keeps the mode stable mid-gesture: precision is entered only on a
 * slow sample that the coarse mapping would have thrown past the sweep budget,
 * and left only when the finger speeds up well past the entry threshold.
 *
 * PURE and platform-free: state in, state out. The viewer app (React Native
 * pan responder) and any web timeline drive it identically — this module IS the
 * spec for the viewer half.
 */

/** Tunables, all optional — the defaults encode the measured constants. */
export interface DragMapConfig {
  /** Media ms per CSS px at the CURRENT zoom (absolute timeline mapping). */
  readonly coarseMsPerPx: number
  /** Precision-mode scale (default 1000 — one pixel is one second). */
  readonly fineMsPerPx?: number
  /**
   * Per-sample target-delta cap in precision mode (default 3500). MUST stay
   * under the feeder's 4 000 ms sweep window — the whole point of the mode is
   * that every emitted delta is sweepable; the margin absorbs coalescing (two
   * pointer samples can land in one feeder tick).
   */
  readonly sweepBudgetMs?: number
  /** Velocity at/below which a drag is "careful" (default 80 px/s). */
  readonly enterFinePxPerS?: number
  /** Velocity at/above which precision mode exits (default 240 px/s). */
  readonly exitFinePxPerS?: number
}

export type DragMapMode = 'coarse' | 'fine'

/** The evolving drag state. Immutable — every sample returns a new one. */
export interface DragMapState {
  /** The media-time target to emit for this sample (`scrubTo`, and the LABEL). */
  readonly cursorMs: number
  readonly mode: DragMapMode
}

/** One pointer-move sample: horizontal movement and the time it took. */
export interface DragSample {
  readonly dxPx: number
  readonly dtMs: number
}

const DEFAULT_FINE_MS_PER_PX = 1_000
const DEFAULT_SWEEP_BUDGET_MS = 3_500
const DEFAULT_ENTER_FINE_PX_PER_S = 80
const DEFAULT_EXIT_FINE_PX_PER_S = 240

/** Start a drag anchored at the playhead the finger went down on. */
export function beginDrag(anchorMs: number): DragMapState {
  return { cursorMs: anchorMs, mode: 'coarse' }
}

/**
 * Fold one pointer-move sample into the drag. Returns the next state; its
 * `cursorMs` is BOTH the target to send (`scrubTo`) and the value the timestamp
 * label must render immediately — the label follows the finger, never the
 * frame arrival.
 */
export function mapDragSample(
  state: DragMapState,
  sample: DragSample,
  config: DragMapConfig,
): DragMapState {
  const fineMsPerPx = Math.min(config.fineMsPerPx ?? DEFAULT_FINE_MS_PER_PX, config.coarseMsPerPx)
  const sweepBudgetMs = config.sweepBudgetMs ?? DEFAULT_SWEEP_BUDGET_MS
  const enterFine = config.enterFinePxPerS ?? DEFAULT_ENTER_FINE_PX_PER_S
  const exitFine = config.exitFinePxPerS ?? DEFAULT_EXIT_FINE_PX_PER_S

  const velocityPxPerS = (Math.abs(sample.dxPx) / Math.max(sample.dtMs, 1)) * 1000
  const coarseDeltaMs = sample.dxPx * config.coarseMsPerPx

  let mode: DragMapMode
  if (state.mode === 'coarse') {
    // Precision is entered exactly when the coarse mapping would BREAK a
    // careful gesture: a slow finger whose absolute delta overshoots the sweep
    // budget. A slow drag on a zoomed-in timeline never enters — the coarse
    // mapping is already sweepable there and absolute tracking is preserved.
    mode =
      velocityPxPerS <= enterFine && Math.abs(coarseDeltaMs) > sweepBudgetMs ? 'fine' : 'coarse'
  } else {
    mode = velocityPxPerS >= exitFine ? 'coarse' : 'fine'
  }

  const deltaMs =
    mode === 'fine'
      ? Math.sign(sample.dxPx) * Math.min(Math.abs(sample.dxPx) * fineMsPerPx, sweepBudgetMs)
      : coarseDeltaMs
  return { cursorMs: state.cursorMs + deltaMs, mode }
}
