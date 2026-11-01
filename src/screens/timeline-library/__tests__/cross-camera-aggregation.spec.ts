import { describe, expect, it } from 'vitest'

import { filterDetectionsByKind } from '../../../components/camera/theater/event-highlights.js'
import { fuseDensityRows, fuseRanges } from '../../../data/use-timeline-activity.js'
import { unionDaySets } from '../../../components/camera/theater/timeline-scope.js'

describe('events and coverage across cameras', () => {
  it('coverage bands of two cameras fuse into one union, and an unreadable camera adds none', () => {
    const answer = [
      { deviceId: 1, read: 'read', ranges: [{ startMs: 0, endMs: 100 }, { startMs: 300, endMs: 400 }] },
      { deviceId: 2, read: 'read', ranges: [{ startMs: 90, endMs: 200 }, { startMs: 400, endMs: 450 }] },
      { deviceId: 3, read: 'unreadable', ranges: [{ startMs: 1000, endMs: 2000 }] },
    ]
    expect(fuseRanges(answer)).toEqual([
      { startMs: 0, endMs: 200 },
      { startMs: 300, endMs: 450 },
    ])
  })

  it('density of two cameras is summed per bucket, so the band covers both', () => {
    const answer = [
      { deviceId: 1, read: 'read', buckets: [{ bucketStart: 0, motion: 2 }, { bucketStart: 60, motion: 1 }] },
      { deviceId: 2, read: 'read', buckets: [{ bucketStart: 60, motion: 4 }, { bucketStart: 120, motion: 3 }] },
    ]
    expect(fuseDensityRows(answer).map((r) => [r.bucketStart, r.motion])).toEqual([
      [0, 2],
      [60, 5],
      [120, 3],
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
