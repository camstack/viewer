/**
 * auto-zoom-map — velocity → timeline zoomIndex while Auto is engaged.
 *
 * Companion to `drag-mapping.ts`. That module owns px → cursor epoch (fine vs
 * coarse). This one owns velocity → how much wall-clock the column shows.
 * Same stream (`velocityPxPerS` from use-timeline-scrub); no second meter.
 *
 * PURE and platform-free: state in, state out. Symmetric continuous mapping:
 * slower → tighter, faster → wider. Lift freezes the effective index (the host
 * simply stops calling). No snap-back to a pre-drag index.
 *
 * Hysteresis: settle window at gesture start, hold before committing a band
 * change, asymmetric enter/exit on band edges — mirrors fine/coarse.
 */

/** Tunables — defaults sit next to the drag-map velocity constants. */
export interface AutoZoomConfig {
  /**
   * Ascending velocity ceilings (px/s), one per zoom index from TIGHTEST to
   * one-before-widest. Velocity above the last ceiling maps to the widest
   * index (0). Length must be `tightestIndex` (= ZOOM_LEVELS.length − 1).
   *
   * Default (six levels, tightest = 5 → 15m):
   *   ≤80 → 5, ≤160 → 4, ≤280 → 3, ≤450 → 2, ≤700 → 1, else → 0.
   */
  readonly bandCeilingsPxPerS?: readonly number[]
  /** Widest zoom index (always 0 with the current ladder). */
  readonly widestIndex?: number
  /** Tightest Auto may go (default 5 = 15m). */
  readonly tightestIndex?: number
  /** Ignore velocity for this long after gesture begin (default 100 ms). */
  readonly settleMs?: number
  /** Candidate band must hold this long before the index moves (default 300). */
  readonly holdMs?: number
  /**
   * Extra px/s required to LEAVE a band toward a WIDER span (default 40).
   * Entering a tighter band uses the bare ceiling.
   */
  readonly exitBiasPxPerS?: number
}

export interface AutoZoomState {
  readonly zoomIndex: number
  /** Band the recent samples point at; null until the first post-settle sample. */
  readonly candidateIndex: number | null
  readonly candidateSinceMs: number
  readonly gestureStartedAtMs: number
}

const DEFAULT_WIDEST = 0
const DEFAULT_TIGHTEST = 5
/** Ceilings for indices 5 → 1; above the last → index 0. */
const DEFAULT_CEILINGS: readonly number[] = [80, 160, 280, 450, 700]
const DEFAULT_SETTLE_MS = 100
const DEFAULT_HOLD_MS = 300
const DEFAULT_EXIT_BIAS = 40

function resolveConfig(config: AutoZoomConfig | undefined): {
  readonly ceilings: readonly number[]
  readonly widest: number
  readonly tightest: number
  readonly settleMs: number
  readonly holdMs: number
  readonly exitBias: number
} {
  const tightest = config?.tightestIndex ?? DEFAULT_TIGHTEST
  const widest = config?.widestIndex ?? DEFAULT_WIDEST
  const ceilings = config?.bandCeilingsPxPerS ?? DEFAULT_CEILINGS
  return {
    ceilings,
    widest,
    tightest,
    settleMs: config?.settleMs ?? DEFAULT_SETTLE_MS,
    holdMs: config?.holdMs ?? DEFAULT_HOLD_MS,
    exitBias: config?.exitBiasPxPerS ?? DEFAULT_EXIT_BIAS,
  }
}

/**
 * Map a sustained velocity onto a zoom index using the bare band ceilings
 * (no hysteresis). Index order: higher velocity → lower index (wider span).
 */
export function targetZoomIndexFromVelocity(
  velocityPxPerS: number,
  config?: AutoZoomConfig,
): number {
  const { ceilings, widest, tightest } = resolveConfig(config)
  const v = Number.isFinite(velocityPxPerS) ? Math.max(0, velocityPxPerS) : 0
  // ceilings[0] gates tightest, ceilings[i] gates tightest − i.
  for (let i = 0; i < ceilings.length; i++) {
    const index = tightest - i
    if (index <= widest) break
    if (v <= ceilings[i]) return index
  }
  return widest
}

/**
 * Velocity → candidate with asymmetric leave-toward-wider hysteresis relative
 * to the CURRENT committed index.
 */
export function candidateZoomIndex(
  velocityPxPerS: number,
  currentIndex: number,
  config?: AutoZoomConfig,
): number {
  const { ceilings, tightest, exitBias } = resolveConfig(config)
  const raw = targetZoomIndexFromVelocity(velocityPxPerS, config)
  if (raw >= currentIndex) {
    // Same band or tighter — enter on the bare ceiling.
    return raw
  }
  // Toward wider: require velocity above the current band's ceiling + bias.
  // ceilings index for `currentIndex` is (tightest − currentIndex).
  const ceilingIdx = tightest - currentIndex
  if (ceilingIdx < 0 || ceilingIdx >= ceilings.length) return raw
  const leaveAt = ceilings[ceilingIdx] + exitBias
  if (velocityPxPerS < leaveAt) return currentIndex
  // Past the leave gate — accept the raw (possibly multi-band) target.
  return raw
}

/** Start a scrub gesture anchored at the zoom Auto currently shows. */
export function beginAutoZoom(zoomIndex: number, nowMs: number): AutoZoomState {
  const index = Number.isFinite(zoomIndex) ? Math.floor(zoomIndex) : DEFAULT_TIGHTEST
  return {
    zoomIndex: index,
    candidateIndex: null,
    candidateSinceMs: nowMs,
    gestureStartedAtMs: nowMs,
  }
}

/**
 * Fold one velocity sample. Returns the next state; its `zoomIndex` is what
 * the timeline should show (unchanged until hold/settle allow a move).
 */
export function mapAutoZoomSample(
  state: AutoZoomState,
  velocityPxPerS: number,
  nowMs: number,
  config?: AutoZoomConfig,
): AutoZoomState {
  const { settleMs, holdMs, widest, tightest } = resolveConfig(config)
  const clampedCurrent = Math.min(tightest, Math.max(widest, state.zoomIndex))

  if (nowMs - state.gestureStartedAtMs < settleMs) {
    return state.zoomIndex === clampedCurrent
      ? state
      : { ...state, zoomIndex: clampedCurrent }
  }

  const candidate = candidateZoomIndex(velocityPxPerS, clampedCurrent, config)

  if (state.candidateIndex !== candidate) {
    return {
      zoomIndex: clampedCurrent,
      candidateIndex: candidate,
      candidateSinceMs: nowMs,
      gestureStartedAtMs: state.gestureStartedAtMs,
    }
  }

  if (candidate === clampedCurrent) {
    return state.zoomIndex === clampedCurrent
      ? state
      : { ...state, zoomIndex: clampedCurrent }
  }

  if (nowMs - state.candidateSinceMs < holdMs) {
    return state.zoomIndex === clampedCurrent
      ? state
      : { ...state, zoomIndex: clampedCurrent }
  }

  return {
    zoomIndex: candidate,
    candidateIndex: candidate,
    candidateSinceMs: state.candidateSinceMs,
    gestureStartedAtMs: state.gestureStartedAtMs,
  }
}
