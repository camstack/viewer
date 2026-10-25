import { describe, it, expect } from 'vitest'
import { planTrackNavigation } from '../track-navigation.js'

describe('planTrackNavigation — prev/next over an ordered track collection', () => {
  const ids = ['t1', 't2', 't3'] as const

  it('plans a middle position with both neighbours', () => {
    expect(planTrackNavigation(ids, 't2')).toEqual({
      index: 1,
      count: 3,
      hasPrev: true,
      hasNext: true,
      prevId: 't1',
      nextId: 't3',
    })
  })

  it('the first item has no prev, the last no next', () => {
    expect(planTrackNavigation(ids, 't1')).toMatchObject({
      index: 0, hasPrev: false, hasNext: true, prevId: null, nextId: 't2',
    })
    expect(planTrackNavigation(ids, 't3')).toMatchObject({
      index: 2, hasPrev: true, hasNext: false, prevId: 't2', nextId: null,
    })
  })

  it('returns null when the current track is not in the collection (deep link, stale list)', () => {
    expect(planTrackNavigation(ids, 'unknown')).toBeNull()
    expect(planTrackNavigation(ids, null)).toBeNull()
  })

  it('returns null for a collection navigation cannot move within', () => {
    // Zero or one item → arrows would be dead weight, not controls.
    expect(planTrackNavigation([], 't1')).toBeNull()
    expect(planTrackNavigation(['t1'], 't1')).toBeNull()
  })

  it('a duplicated id resolves to its FIRST occurrence', () => {
    expect(planTrackNavigation(['a', 'b', 'a', 'c'], 'a')).toMatchObject({
      index: 0, hasPrev: false, nextId: 'b',
    })
  })
})
