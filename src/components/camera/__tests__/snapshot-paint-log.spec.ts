import { describe, it, expect } from 'vitest'
import {
  createPaintLogSampler,
  shouldLogPaint,
  SLOW_PAINT_MS,
  STALE_FRAME_MS,
  FAST_PAINT_SAMPLE_RATE,
} from '../snapshot-paint-log.js'

describe('snapshot paint logging', () => {
  it('logs every slow paint — the tail is never sampled away', () => {
    const sample = createPaintLogSampler()
    for (let i = 0; i < 50; i += 1) {
      expect(sample(SLOW_PAINT_MS, null)).toBe(true)
      expect(sample(SLOW_PAINT_MS + 5_000, null)).toBe(true)
    }
  })

  it('logs every paint of a stale frame regardless of how fast it painted', () => {
    const sample = createPaintLogSampler()
    for (let i = 0; i < 50; i += 1) expect(sample(12, STALE_FRAME_MS)).toBe(true)
  })

  it('logs one in FAST_PAINT_SAMPLE_RATE fast paints — the p50 becomes measurable', () => {
    const sample = createPaintLogSampler()
    let logged = 0
    for (let i = 0; i < FAST_PAINT_SAMPLE_RATE * 100; i += 1) {
      if (sample(40, 1_000)) logged += 1
    }
    // Exact, not approximate: the sampler counts, it does not roll dice.
    expect(logged).toBe(100)
  })

  it('the OLD gate would have logged none of those', () => {
    // The regression this change exists to undo: 1000 fast paints, zero lines.
    const oldGate = (ms: number, frameAgeMs: number | null): boolean =>
      ms >= 1_000 || (frameAgeMs !== null && frameAgeMs >= 30_000)
    let logged = 0
    for (let i = 0; i < 1_000; i += 1) if (oldGate(40, 1_000)) logged += 1
    expect(logged).toBe(0)
  })

  it('slow paints do not consume the fast-paint budget', () => {
    const sample = createPaintLogSampler(10)
    // 9 fast paints (none logged), then a slow one, then the 10th fast paint
    // must still be the one that logs.
    for (let i = 0; i < 9; i += 1) expect(sample(40, null)).toBe(false)
    expect(sample(2_000, null)).toBe(true)
    expect(sample(40, null)).toBe(true)
  })

  it('honours a custom rate and resets its counter after each sampled line', () => {
    const sample = createPaintLogSampler(3)
    expect([sample(1, null), sample(1, null), sample(1, null)]).toEqual([false, false, true])
    expect([sample(1, null), sample(1, null), sample(1, null)]).toEqual([false, false, true])
  })

  it('treats a null frame age as "no opinion", not as stale', () => {
    const sample = createPaintLogSampler(1_000_000)
    expect(sample(40, null)).toBe(false)
  })

  it('boundaries are inclusive on both thresholds', () => {
    const sample = createPaintLogSampler(1_000_000)
    expect(sample(SLOW_PAINT_MS - 1, STALE_FRAME_MS - 1)).toBe(false)
    expect(sample(SLOW_PAINT_MS, null)).toBe(true)
    expect(sample(0, STALE_FRAME_MS)).toBe(true)
  })

  it('exports a shared app-wide sampler', () => {
    expect(typeof shouldLogPaint).toBe('function')
    expect(shouldLogPaint(SLOW_PAINT_MS, null)).toBe(true)
  })
})
