import type { RetrainFrame } from '@camstack/types'
import { describe, expect, it } from 'vitest'
import { summarizeFrameReview } from '../frame-review-chips.js'

type Review = NonNullable<RetrainFrame['review']>
const bbox = { x: 0, y: 0, w: 1, h: 1 }
const box = (
  status: Review['boxes'][number]['status'],
  macroClass?: 'animal' | 'person' | 'vehicle',
  approximate = false,
): Review['boxes'][number] => ({
  ref: Math.random().toString(),
  status,
  approximate,
  ...(macroClass ? { origin: { source: 'pipeline', ref: 'r', bbox, macroClass } } : {}),
})
const review = (boxes: Review['boxes']): Review =>
  ({
    boxes,
    summary: { counts: {}, total: boxes.length, changed: boxes.length, approximate: false },
  }) as Review

describe('summarizeFrameReview', () => {
  it('groups by state and class, counted, in the strip order', () => {
    const out = summarizeFrameReview(
      review([
        box('reclassified', 'animal'),
        box('reclassified', 'animal'),
        box('added'),
        box('removed', 'vehicle'),
        box('unchanged', 'person'),
      ]),
    )
    expect(out.shown.map((c) => [c.kind, c.macroClass, c.count])).toEqual([
      ['added', null, 1],
      ['removed', 'vehicle', 1],
      ['reclassified', 'animal', 2],
    ])
    expect(out.more).toBe(0)
  })
  it('uses the CURRENT class when the hub sends it, the origin otherwise', () => {
    const now = { ...box('reclassified', 'animal'), macroClass: 'person' as const }
    const added = { ...box('added'), macroClass: 'vehicle' as const }
    const out = summarizeFrameReview(review([added, now, box('adjusted', 'animal')]))
    expect(out.shown.map((c) => [c.kind, c.macroClass])).toEqual([
      ['added', 'vehicle'],
      ['reclassified', 'person'],
      ['adjusted', 'animal'],
    ])
  })
  it('keeps approximate verdicts apart', () => {
    const out = summarizeFrameReview(
      review([box('adjusted', 'person'), box('adjusted', 'person', true)]),
    )
    expect(out.shown.map((c) => c.approximate)).toEqual([false, true])
  })
  it('folds chips past the cap into +n', () => {
    const out = summarizeFrameReview(
      review([
        box('added', 'person'),
        box('added', 'animal'),
        box('removed', 'person'),
        box('adjusted', 'animal'),
        box('model-error'),
      ]),
      3,
    )
    expect(out.shown).toHaveLength(3)
    expect(out.more).toBe(2)
  })
  it('is empty without a review', () => {
    expect(summarizeFrameReview(undefined)).toEqual({ shown: [], more: 0 })
  })
})
