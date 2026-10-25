import { describe, it, expect } from 'vitest'
import { beginDrag, mapDragSample, type DragMapState } from '../drag-mapping'

/**
 * The measured field constants this module exists for: ~8.8 s per px at the
 * default zoom, and a careful drag of ~3 px per pointer sample (~50 px/s) —
 * the exact gesture that produced 102 jumps vs 3 sweeps over 48 h.
 */
const DEFAULT_ZOOM = { coarseMsPerPx: 8_800 }
const SWEEP_WINDOW_MS = 4_000

function drive(
  state: DragMapState,
  samples: Array<{ dxPx: number; dtMs: number }>,
): { deltas: number[]; state: DragMapState } {
  const deltas: number[] = []
  for (const s of samples) {
    const next = mapDragSample(state, s, DEFAULT_ZOOM)
    deltas.push(next.cursorMs - state.cursorMs)
    state = next
  }
  return { deltas, state }
}

describe('drag-mapping — velocity-adaptive px→time', () => {
  it('a slow careful drag at default zoom emits ONLY sweepable deltas (≤ 4 s each)', () => {
    // 3 px per 60 ms = 50 px/s — the operator's complaint velocity. Under the
    // raw zoom mapping each sample is a ~26.4 s delta; under the adaptive
    // mapping every one must fit the feeder's sweep window.
    const samples = Array.from({ length: 20 }, () => ({ dxPx: 3, dtMs: 60 }))
    const { deltas } = drive(beginDrag(1_000_000), samples)
    for (const d of deltas) {
      expect(d).toBeGreaterThan(0)
      expect(d).toBeLessThanOrEqual(SWEEP_WINDOW_MS)
    }
  })

  it('a slow BACKWARD drag emits sweepable negative deltas — stepping works both ways', () => {
    const samples = Array.from({ length: 20 }, () => ({ dxPx: -3, dtMs: 60 }))
    const { deltas } = drive(beginDrag(1_000_000), samples)
    for (const d of deltas) {
      expect(d).toBeLessThan(0)
      expect(-d).toBeLessThanOrEqual(SWEEP_WINDOW_MS)
    }
  })

  it('one pixel is one second in precision mode — second-by-second is reachable', () => {
    const state = beginDrag(1_000_000)
    const slow = mapDragSample(state, { dxPx: 2, dtMs: 60 }, DEFAULT_ZOOM) // enters fine
    const oneMore = mapDragSample(slow, { dxPx: 1, dtMs: 60 }, DEFAULT_ZOOM)
    expect(oneMore.cursorMs - slow.cursorMs).toBe(1_000)
  })

  it('a fling keeps the absolute zoom mapping — reach across the timeline is preserved', () => {
    // 40 px in 16 ms = 2 500 px/s: the "take me to this afternoon" gesture.
    const state = beginDrag(1_000_000)
    const next = mapDragSample(state, { dxPx: 40, dtMs: 16 }, DEFAULT_ZOOM)
    expect(next.mode).toBe('coarse')
    expect(next.cursorMs - state.cursorMs).toBe(40 * 8_800)
  })

  it('hysteresis: a medium-speed sample mid-precision stays fine; a fast one exits', () => {
    let state = beginDrag(1_000_000)
    state = mapDragSample(state, { dxPx: 3, dtMs: 60 }, DEFAULT_ZOOM)
    expect(state.mode).toBe('fine')
    // 120 px/s is above the 80 px/s entry gate but below the 240 px/s exit.
    state = mapDragSample(state, { dxPx: 6, dtMs: 50 }, DEFAULT_ZOOM)
    expect(state.mode).toBe('fine')
    state = mapDragSample(state, { dxPx: 20, dtMs: 50 }, DEFAULT_ZOOM) // 400 px/s
    expect(state.mode).toBe('coarse')
  })

  it('a zoomed-in timeline never enters precision — absolute tracking is preserved where it already sweeps', () => {
    // 200 ms/px: a slow 3 px sample is 600 ms — sweepable under the zoom
    // mapping itself, so the cursor must keep tracking the finger absolutely.
    let state = beginDrag(1_000_000)
    state = mapDragSample(state, { dxPx: 3, dtMs: 60 }, { coarseMsPerPx: 200 })
    expect(state.mode).toBe('coarse')
    expect(state.cursorMs).toBe(1_000_600)
  })

  it('fine scale never exceeds the zoom scale (a hyper-zoomed timeline stays finer than 1 s/px)', () => {
    let state = beginDrag(1_000_000)
    // 100 ms/px zoom: even if precision were entered, 1 px must move 100 ms.
    state = { ...state, mode: 'fine' }
    const next = mapDragSample(state, { dxPx: 1, dtMs: 60 }, { coarseMsPerPx: 100 })
    expect(next.cursorMs - state.cursorMs).toBe(100)
  })
})
