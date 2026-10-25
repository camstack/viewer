import { describe, it, expect } from 'vitest'
import { resolveScopeNotice, unionUnknownIds } from '../timeline-scope-notice.js'

describe('resolveScopeNotice', () => {
  it('says nothing when every camera in the view answered', () => {
    expect(resolveScopeNotice({ unknownIds: [], overflowIds: [] })).toEqual({
      kind: 'none',
      unreadableCount: 0,
      overflowCount: 0,
    })
  })

  it('counts cameras the hub could not read', () => {
    expect(resolveScopeNotice({ unknownIds: [4, 9], overflowIds: [] })).toEqual({
      kind: 'unreadable',
      unreadableCount: 2,
      overflowCount: 0,
    })
  })

  it('tells an over-ceiling camera apart from an unreadable one — the remedies differ', () => {
    expect(resolveScopeNotice({ unknownIds: [7, 8], overflowIds: [7, 8] })).toEqual({
      kind: 'overflow',
      unreadableCount: 0,
      overflowCount: 2,
    })
  })

  it('reports both causes at once rather than letting one hide the other', () => {
    const notice = resolveScopeNotice({ unknownIds: [1, 2, 30], overflowIds: [30] })
    expect(notice).toEqual({ kind: 'both', unreadableCount: 2, overflowCount: 1 })
  })

  it('counts CAMERAS, not reads — the same camera missed twice is one camera', () => {
    const unknown = unionUnknownIds([4, 9], [9, 11])
    expect(unknown).toEqual([4, 9, 11])
    expect(resolveScopeNotice({ unknownIds: unknown, overflowIds: [] }).unreadableCount).toBe(3)
  })

  it('ignores an overflow id nothing reported as unknown — it is not in this view', () => {
    expect(resolveScopeNotice({ unknownIds: [], overflowIds: [99] })).toEqual({
      kind: 'none',
      unreadableCount: 0,
      overflowCount: 0,
    })
  })
})

describe('unionUnknownIds', () => {
  it('is empty when every read was complete', () => {
    expect(unionUnknownIds([], [])).toEqual([])
  })

  it('keeps first-seen order so the notice is stable across refetches', () => {
    expect(unionUnknownIds([5], [2, 5], [9])).toEqual([5, 2, 9])
  })
})
