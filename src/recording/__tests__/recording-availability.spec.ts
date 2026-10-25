import { describe, it, expect } from 'vitest'
import { availabilityToCoverage, recordingKnownAt } from '../recording-availability.js'

describe('availabilityToCoverage', () => {
  it('merges per-profile ranges into one sorted non-overlapping coverage', () => {
    const ranges = [
      { profile: 'high', startMs: 0, endMs: 100 },
      { profile: 'low', startMs: 90, endMs: 200 }, // overlaps high → merge
      { profile: 'low', startMs: 300, endMs: 400 }, // disjoint
    ]
    expect(availabilityToCoverage(ranges)).toEqual([
      { startMs: 0, endMs: 200 },
      { startMs: 300, endMs: 400 },
    ])
  })

  it('returns [] for empty input', () => {
    expect(availabilityToCoverage([])).toEqual([])
  })
})

describe('recordingKnownAt — cheap seek-button gating from already-fetched coverage', () => {
  const coverage = [
    { startMs: 1_000, endMs: 2_000 },
    { startMs: 5_000, endMs: 9_000 },
  ]
  const windowFrom = 0
  const windowTo = 10_000

  it("returns 'recorded' for an epoch inside a coverage range", () => {
    expect(recordingKnownAt(coverage, windowFrom, windowTo, 1_500)).toBe('recorded')
    expect(recordingKnownAt(coverage, windowFrom, windowTo, 5_000)).toBe('recorded')
  })

  it("returns 'absent' for an epoch inside the QUERIED window but outside every range", () => {
    expect(recordingKnownAt(coverage, windowFrom, windowTo, 3_000)).toBe('absent')
    expect(recordingKnownAt(coverage, windowFrom, windowTo, 9_500)).toBe('absent')
  })

  it("returns 'unknown' outside the queried window (no data → never hide the button)", () => {
    expect(recordingKnownAt(coverage, windowFrom, windowTo, -100)).toBe('unknown')
    expect(recordingKnownAt(coverage, windowFrom, windowTo, 10_001)).toBe('unknown')
  })

  it("returns 'unknown' when no coverage was loaded at all (fetch pending/failed)", () => {
    // An EMPTY coverage array is ambiguous (still loading vs truly none) —
    // never hide the button on ambiguity.
    expect(recordingKnownAt([], windowFrom, windowTo, 1_500)).toBe('unknown')
  })
})
