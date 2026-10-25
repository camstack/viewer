import { describe, it, expect } from 'vitest'
import {
  initTimelineScope,
  scopeQueryKey,
  unionDaySets,
} from '../timeline-scope.js'

describe('initTimelineScope', () => {
  it('uses the seeded camera ids (grid members) as the starting scope', () => {
    expect(initTimelineScope([12, 7, 12], 1)).toEqual([12, 7])
  })

  it('falls back to the primary device when the seed is empty', () => {
    expect(initTimelineScope([], 9)).toEqual([9])
  })
})



describe('scopeQueryKey', () => {
  it('keeps a single-camera key numeric so the existing cache still hits', () => {
    expect(scopeQueryKey([7])).toBe(7)
    expect(scopeQueryKey([7, 7])).toBe(7)
  })

  it('is order-independent for a multi-camera scope', () => {
    expect(scopeQueryKey([9, 2, 4])).toBe(scopeQueryKey([4, 9, 2]))
    expect(scopeQueryKey([9, 2, 4])).toBe('2,4,9')
  })
})

describe('unionDaySets', () => {
  it('unions recording-day dots across cameras', () => {
    const a = new Set([100, 200])
    const b = new Set([200, 300])
    expect(unionDaySets([a, b])).toEqual(new Set([100, 200, 300]))
  })

  it('returns an empty set when nothing has footage', () => {
    expect(unionDaySets([])).toEqual(new Set())
    expect(unionDaySets([new Set(), new Set()])).toEqual(new Set())
  })
})
