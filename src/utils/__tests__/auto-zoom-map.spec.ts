import { describe, it, expect } from 'vitest'
import {
  beginAutoZoom,
  mapAutoZoomSample,
  targetZoomIndexFromVelocity,
  candidateZoomIndex,
  type AutoZoomState,
} from '../auto-zoom-map'

const T0 = 1_000_000

function drive(
  state: AutoZoomState,
  samples: readonly { velocity: number; at: number }[],
): AutoZoomState {
  for (const s of samples) {
    state = mapAutoZoomSample(state, s.velocity, s.at)
  }
  return state
}

describe('targetZoomIndexFromVelocity — continuous symmetric ladder', () => {
  it('maps slow → 15m (tightest), fling → 12h (widest)', () => {
    expect(targetZoomIndexFromVelocity(0)).toBe(5)
    expect(targetZoomIndexFromVelocity(80)).toBe(5)
    expect(targetZoomIndexFromVelocity(81)).toBe(4)
    expect(targetZoomIndexFromVelocity(160)).toBe(4)
    expect(targetZoomIndexFromVelocity(161)).toBe(3)
    expect(targetZoomIndexFromVelocity(280)).toBe(3)
    expect(targetZoomIndexFromVelocity(281)).toBe(2)
    expect(targetZoomIndexFromVelocity(450)).toBe(2)
    expect(targetZoomIndexFromVelocity(451)).toBe(1)
    expect(targetZoomIndexFromVelocity(700)).toBe(1)
    expect(targetZoomIndexFromVelocity(701)).toBe(0)
    expect(targetZoomIndexFromVelocity(2_500)).toBe(0)
  })

  it('treats non-finite velocity as stopped (tightest)', () => {
    expect(targetZoomIndexFromVelocity(Number.NaN)).toBe(5)
    expect(targetZoomIndexFromVelocity(Number.POSITIVE_INFINITY)).toBe(5)
  })
})

describe('candidateZoomIndex — asymmetric leave-toward-wider', () => {
  it('enters a tighter band on the bare ceiling', () => {
    // At 30m (4), slowing to 80 px/s should offer 15m (5).
    expect(candidateZoomIndex(80, 4)).toBe(5)
  })

  it('holds the current band until velocity clears the exit bias', () => {
    // At 15m (5), ceiling is 80; exit needs 80+40=120.
    expect(candidateZoomIndex(100, 5)).toBe(5)
    expect(candidateZoomIndex(120, 5)).toBe(4)
  })
})

describe('mapAutoZoomSample — settle, hold, freeze semantics', () => {
  it('ignores velocity during the settle window', () => {
    let state = beginAutoZoom(4, T0)
    state = mapAutoZoomSample(state, 2_500, T0 + 50)
    expect(state.zoomIndex).toBe(4)
  })

  it('does not move until the candidate holds', () => {
    let state = beginAutoZoom(4, T0)
    // Past settle, fling candidate — but only 100 ms held.
    state = mapAutoZoomSample(state, 2_500, T0 + 150)
    expect(state.zoomIndex).toBe(4)
    expect(state.candidateIndex).toBe(0)
    state = mapAutoZoomSample(state, 2_500, T0 + 250)
    expect(state.zoomIndex).toBe(4)
    // Hold completes at +150+300 = T0+450.
    state = mapAutoZoomSample(state, 2_500, T0 + 450)
    expect(state.zoomIndex).toBe(0)
  })

  it('slowing continuously tightens — no snap-back to a pre-drag index', () => {
    let state = beginAutoZoom(3, T0) // started on 1h
    // Fling out to 12h and hold.
    state = drive(state, [
      { velocity: 2_500, at: T0 + 150 },
      { velocity: 2_500, at: T0 + 450 },
    ])
    expect(state.zoomIndex).toBe(0)
    // Slow down toward 15m — same mapping, after hold.
    state = drive(state, [
      { velocity: 40, at: T0 + 500 },
      { velocity: 40, at: T0 + 800 },
    ])
    expect(state.zoomIndex).toBe(5)
  })

  it('a reset candidate timer when the band flickers', () => {
    let state = beginAutoZoom(4, T0)
    state = mapAutoZoomSample(state, 2_500, T0 + 150)
    expect(state.candidateIndex).toBe(0)
    // Flicker to a different candidate resets the hold clock.
    state = mapAutoZoomSample(state, 200, T0 + 300)
    expect(state.candidateIndex).toBe(3)
    state = mapAutoZoomSample(state, 200, T0 + 400)
    expect(state.zoomIndex).toBe(4)
    state = mapAutoZoomSample(state, 200, T0 + 600)
    expect(state.zoomIndex).toBe(3)
  })

  it('beginAutoZoom seeds the committed index', () => {
    const state = beginAutoZoom(2, T0)
    expect(state.zoomIndex).toBe(2)
    expect(state.candidateIndex).toBeNull()
  })
})
