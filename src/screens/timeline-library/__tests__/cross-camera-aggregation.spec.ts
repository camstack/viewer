import { describe, expect, it } from 'vitest'

import { filterDetectionsByKind } from '../../../components/camera/theater/event-highlights.js'
import { mergeRanges } from '../../../timeline/coverage.js'
import { unionDaySets } from '../../../components/camera/theater/timeline-scope.js'

describe('events and coverage across cameras', () => {
  it('coverage bands of two cameras merge into one union', () => {
    const front = [{ startMs: 0, endMs: 100 }, { startMs: 300, endMs: 400 }]
    const garage = [{ startMs: 90, endMs: 200 }, { startMs: 400, endMs: 450 }]
    expect(mergeRanges([...front, ...garage])).toEqual([
      { startMs: 0, endMs: 200 },
      { startMs: 300, endMs: 450 },
    ])
  })

  it('recording days of two cameras union', () => {
    expect([...unionDaySets([new Set([1, 2]), new Set([2, 3])])].sort()).toEqual([1, 2, 3])
  })

  it('one class filter applies to the events of every camera at once', () => {
    const events = [
      { deviceId: 1, className: 'person', classes: ['person'] },
      { deviceId: 2, className: 'car', classes: ['car'] },
      { deviceId: 2, className: 'person', classes: ['person'] },
    ]
    const kept = filterDetectionsByKind(events, new Set(['motion']), new Set(['person']))
    expect(kept.map((e) => e.deviceId)).toEqual([1, 2])
    expect(kept.every((e) => e.className === 'person')).toBe(true)
  })
})
