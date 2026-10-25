import { describe, it, expect } from 'vitest'
import { dayFractionToEpoch, epochToDayFraction, pointerFraction } from '../heatmap-scrub.js'

const DAY_MS = 24 * 60 * 60 * 1000
// Local-midnight-like anchor (value is arbitrary for the pure math).
const DAY_FROM = 1_700_000_000_000
const DAY_TO = DAY_FROM + DAY_MS

describe('dayFractionToEpoch', () => {
  it('maps 0 → day start and 1 → day end', () => {
    expect(dayFractionToEpoch(0, DAY_FROM, DAY_TO)).toBe(DAY_FROM)
    expect(dayFractionToEpoch(1, DAY_FROM, DAY_TO)).toBe(DAY_TO)
  })
  it('maps the midpoint to noon', () => {
    expect(dayFractionToEpoch(0.5, DAY_FROM, DAY_TO)).toBe(DAY_FROM + DAY_MS / 2)
  })
  it('clamps out-of-range fractions to the day edges', () => {
    expect(dayFractionToEpoch(-0.3, DAY_FROM, DAY_TO)).toBe(DAY_FROM)
    expect(dayFractionToEpoch(1.7, DAY_FROM, DAY_TO)).toBe(DAY_TO)
  })
})

describe('epochToDayFraction', () => {
  it('is the inverse at the edges and middle', () => {
    expect(epochToDayFraction(DAY_FROM, DAY_FROM, DAY_TO)).toBe(0)
    expect(epochToDayFraction(DAY_TO, DAY_FROM, DAY_TO)).toBe(1)
    expect(epochToDayFraction(DAY_FROM + DAY_MS / 2, DAY_FROM, DAY_TO)).toBeCloseTo(0.5, 12)
  })
  it('clamps epochs outside the day to [0,1]', () => {
    expect(epochToDayFraction(DAY_FROM - DAY_MS, DAY_FROM, DAY_TO)).toBe(0)
    expect(epochToDayFraction(DAY_TO + DAY_MS, DAY_FROM, DAY_TO)).toBe(1)
  })
  it('returns 0 for a degenerate (non-positive span) window', () => {
    expect(epochToDayFraction(DAY_FROM, DAY_FROM, DAY_FROM)).toBe(0)
  })
})

describe('fraction ↔ epoch round-trip (the tap-lands-where-shown invariant)', () => {
  it('epochToDayFraction(dayFractionToEpoch(f)) ≈ f across the whole day', () => {
    // 1ms rounding over an 86.4M-ms day → error bound well under 1e-7.
    const tolerance = 1 / DAY_MS
    for (let i = 0; i <= 100; i++) {
      const f = i / 100
      const epoch = dayFractionToEpoch(f, DAY_FROM, DAY_TO)
      const back = epochToDayFraction(epoch, DAY_FROM, DAY_TO)
      expect(Math.abs(back - f)).toBeLessThanOrEqual(tolerance)
    }
  })
  it('dayFractionToEpoch(epochToDayFraction(e)) ≈ e for epochs inside the day', () => {
    for (let i = 0; i <= 100; i++) {
      const epoch = DAY_FROM + Math.round((i / 100) * DAY_MS)
      const f = epochToDayFraction(epoch, DAY_FROM, DAY_TO)
      expect(dayFractionToEpoch(f, DAY_FROM, DAY_TO)).toBe(epoch)
    }
  })
})

describe('pointerFraction', () => {
  it('maps a valid offset to a clamped fraction', () => {
    expect(pointerFraction(0, 200)).toBe(0)
    expect(pointerFraction(100, 200)).toBe(0.5)
    expect(pointerFraction(200, 200)).toBe(1)
    expect(pointerFraction(260, 200)).toBe(1) // over-travel clamps
    expect(pointerFraction(-10, 200)).toBe(0)
  })
  it('returns null for an unmeasured / degenerate width (skip, do not midnight-seek)', () => {
    expect(pointerFraction(120, 0)).toBeNull()
    expect(pointerFraction(120, -5)).toBeNull()
    expect(pointerFraction(Number.NaN, 200)).toBeNull()
    expect(pointerFraction(120, Number.NaN)).toBeNull()
  })
})
