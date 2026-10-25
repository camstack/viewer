import type { RetrainAnnotation } from '@camstack/types'
import { describe, expect, it } from 'vitest'
import { deleteBox, seedEditor } from '../editor.js'
import { frameNav } from '../frame-nav.js'
import { liveReview } from '../live-review.js'
import { buildRows, summaryEntries } from '../rows.js'
import { annotationsAreValid, tierError } from '../validate.js'

function saved(over: Partial<RetrainAnnotation> = {}): RetrainAnnotation {
  return {
    id: 'a1',
    trackId: 't',
    deviceId: 1,
    mediaKey: 'f',
    bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.4 },
    macroClass: 'person',
    kind: 'subject',
    source: 'pipeline',
    origin: {
      source: 'pipeline',
      ref: 'pipeline:t1',
      bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.4 },
      macroClass: 'person',
    },
    createdAt: 1,
    ...over,
  }
}

describe('buildRows', () => {
  it('lists live boxes first and the removed proposals only under the switch', () => {
    const editor = deleteBox(seedEditor([saved()], []), 'b0')
    const review = liveReview(editor, [])
    expect(buildRows(editor, review, true).map((r) => r.type)).toEqual(['removed'])
    expect(buildRows(editor, review, false)).toEqual([])
  })

  it('summaryEntries drops empty kinds and keeps the strip order', () => {
    const editor = seedEditor([saved()], [])
    const entries = summaryEntries(liveReview(editor, []).counts)
    expect(entries).toEqual([{ kind: 'unchanged', count: 1 }])
  })
})

describe('frameNav', () => {
  it('reports position and neighbours, none at the ends or when unknown', () => {
    const ids = ['a', 'b', 'c']
    expect(frameNav(ids, 'b')).toEqual({ index: 1, total: 3, prevId: 'a', nextId: 'c' })
    expect(frameNav(ids, 'a').prevId).toBeNull()
    expect(frameNav(ids, 'c').nextId).toBeNull()
    expect(frameNav(ids, 'zz')).toEqual({ index: -1, total: 3, prevId: null, nextId: null })
  })
})

describe('tier guard', () => {
  it('refuses a macro class as a label, accepts a proper label', () => {
    expect(tierError(' Person ')).toBe('person')
    expect(tierError('postman')).toBeNull()
    expect(tierError(undefined)).toBeNull()
  })

  it('blocks a save on a confirmed box, never on a draft', () => {
    const confirmed = seedEditor([saved({ label: 'person' })], [])
    expect(annotationsAreValid(confirmed.boxes)).toBe(false)
    const draft = seedEditor([], [
      {
        bbox: { x: 0, y: 0, w: 0.2, h: 0.2 },
        macroClass: 'person',
        label: 'person',
        trackId: 't9',
        basis: 'subject-box',
        deltaMs: 0,
      },
    ])
    expect(annotationsAreValid(draft.boxes)).toBe(true)
  })
})
