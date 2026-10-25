import { describe, it, expect } from 'vitest'
import { mergeRanges, isCovered, nearestCoveredEdge, type TimeRange } from '../coverage.js'

const r = (startMs: number, endMs: number): TimeRange => ({ startMs, endMs })

describe('mergeRanges', () => {
  it('merges overlapping and adjacent ranges, sorted, ignoring profile origin', () => {
    expect(mergeRanges([r(30, 40), r(0, 10), r(10, 20), r(15, 35)])).toEqual([r(0, 40)])
  })

  it('keeps disjoint ranges separate and sorted', () => {
    expect(mergeRanges([r(100, 110), r(0, 10)])).toEqual([r(0, 10), r(100, 110)])
  })

  it('returns [] for no ranges', () => {
    expect(mergeRanges([])).toEqual([])
  })
})

describe('isCovered', () => {
  const merged = [r(0, 10), r(100, 110)]
  it('is true inside a range (inclusive start, exclusive end)', () => {
    expect(isCovered(0, merged)).toBe(true)
    expect(isCovered(9, merged)).toBe(true)
    expect(isCovered(10, merged)).toBe(false)
  })
  it('is false in a gap', () => {
    expect(isCovered(50, merged)).toBe(false)
  })
})

describe('nearestCoveredEdge', () => {
  const merged = [r(0, 10), r(100, 110)]
  it('returns the closest range edge to a gap time', () => {
    expect(nearestCoveredEdge(40, merged)).toBe(10)
    expect(nearestCoveredEdge(70, merged)).toBe(100)
  })
  it('returns the time itself when already covered', () => {
    expect(nearestCoveredEdge(5, merged)).toBe(5)
  })
  it('returns null when there is no coverage', () => {
    expect(nearestCoveredEdge(5, [])).toBeNull()
  })
})
