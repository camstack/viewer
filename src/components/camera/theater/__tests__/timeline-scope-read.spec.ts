import { describe, it, expect } from 'vitest'
import {
  TIMELINE_SCOPE_BATCH_MAX,
  planScopeAsk,
  resolveScopeKnowledge,
  type ScopeReadRow,
} from '../timeline-scope-read.js'

describe('planScopeAsk — the ceiling is respected, and the excess is REPORTED', () => {
  it('asks for every camera when the scope fits under the ceiling', () => {
    expect(planScopeAsk([7, 3, 9])).toEqual({ asked: [7, 3, 9], overflow: [] })
  })

  it('keeps the caller order, so the primary is never the id that gets dropped', () => {
    const ids = Array.from({ length: TIMELINE_SCOPE_BATCH_MAX + 5 }, (_, i) => i + 1)
    const ask = planScopeAsk(ids)
    expect(ask.asked[0]).toBe(1)
    expect(ask.asked).toHaveLength(TIMELINE_SCOPE_BATCH_MAX)
  })

  it('names the cameras it could NOT ask for instead of truncating in silence', () => {
    const ids = Array.from({ length: TIMELINE_SCOPE_BATCH_MAX + 3 }, (_, i) => i + 1)
    const ask = planScopeAsk(ids)
    expect(ask.overflow).toEqual([
      TIMELINE_SCOPE_BATCH_MAX + 1,
      TIMELINE_SCOPE_BATCH_MAX + 2,
      TIMELINE_SCOPE_BATCH_MAX + 3,
    ])
    expect(ask.asked.length + ask.overflow.length).toBe(ids.length)
  })

  it('drops duplicates and non-finite ids before counting against the ceiling', () => {
    expect(planScopeAsk([5, 5, Number.NaN, 8])).toEqual({ asked: [5, 8], overflow: [] })
  })

  it('matches the ceiling both hub schemas carry', () => {
    expect(TIMELINE_SCOPE_BATCH_MAX).toBe(200)
  })
})

describe('resolveScopeKnowledge — unreadable is not empty', () => {
  const rows = (entries: readonly ScopeReadRow[]): readonly ScopeReadRow[] => entries

  it('reports complete knowledge when every asked camera answered', () => {
    const k = resolveScopeKnowledge({
      ask: { asked: [1, 2], overflow: [] },
      rows: rows([
        { deviceId: 1, read: 'read' },
        { deviceId: 2, read: 'read' },
      ]),
    })
    expect(k).toEqual({ readIds: [1, 2], unknownIds: [], overflowIds: [], verdict: 'complete' })
  })

  it('a camera whose row says `unreadable` is UNKNOWN — never a camera with nothing', () => {
    const k = resolveScopeKnowledge({
      ask: { asked: [1, 2], overflow: [] },
      rows: rows([
        { deviceId: 1, read: 'read' },
        { deviceId: 2, read: 'unreadable' },
      ]),
    })
    expect(k.readIds).toEqual([1])
    expect(k.unknownIds).toEqual([2])
    expect(k.verdict).toBe('partial')
  })

  it('an asked camera with NO row at all is unknown too — a short answer is not a complete one', () => {
    const k = resolveScopeKnowledge({
      ask: { asked: [1, 2, 3], overflow: [] },
      rows: rows([{ deviceId: 1, read: 'read' }]),
    })
    expect(k.unknownIds).toEqual([2, 3])
    expect(k.verdict).toBe('partial')
  })

  it('a row for a camera nobody asked about cannot make it "read"', () => {
    const k = resolveScopeKnowledge({
      ask: { asked: [1], overflow: [] },
      rows: rows([
        { deviceId: 1, read: 'read' },
        { deviceId: 99, read: 'read' },
      ]),
    })
    expect(k.readIds).toEqual([1])
  })

  it('carries the over-ceiling cameras into the unknowns, after the asked ones', () => {
    const k = resolveScopeKnowledge({
      ask: { asked: [1, 2], overflow: [50, 51] },
      rows: rows([
        { deviceId: 1, read: 'read' },
        { deviceId: 2, read: 'unreadable' },
      ]),
    })
    expect(k.unknownIds).toEqual([2, 50, 51])
    expect(k.overflowIds).toEqual([50, 51])
    expect(k.verdict).toBe('partial')
  })

  it('a call that REJECTED knows nothing about any camera it asked for', () => {
    const k = resolveScopeKnowledge({
      ask: { asked: [1, 2], overflow: [] },
      rows: [],
      failed: true,
    })
    expect(k.readIds).toEqual([])
    expect(k.unknownIds).toEqual([1, 2])
    expect(k.verdict).toBe('none')
  })

  it('a failed call cannot be rescued by rows that arrived before it', () => {
    const k = resolveScopeKnowledge({
      ask: { asked: [1, 2], overflow: [] },
      rows: rows([{ deviceId: 1, read: 'read' }]),
      failed: true,
    })
    expect(k.readIds).toEqual([])
    expect(k.verdict).toBe('none')
  })

  it('an empty scope claims nothing and knows nothing missing', () => {
    const k = resolveScopeKnowledge({ ask: { asked: [], overflow: [] }, rows: [] })
    expect(k.verdict).toBe('complete')
    expect(k.unknownIds).toEqual([])
  })

  it('the single-camera unreadable case is `none`, not `partial`', () => {
    const k = resolveScopeKnowledge({
      ask: { asked: [7], overflow: [] },
      rows: rows([{ deviceId: 7, read: 'unreadable' }]),
    })
    expect(k.verdict).toBe('none')
    expect(k.unknownIds).toEqual([7])
  })
})
