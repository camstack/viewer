/**
 * A card never shows an internal identifier.
 *
 * The operator: *"continuo a ricevere le clip con label 'native'"*. `native`
 * is `Clip.kind`'s "this row has no kind of its own, read the labels" value —
 * the server sets it deliberately the moment a real class is present — and two
 * card builders put it straight into the event-class vocabulary, where it has
 * no entry and rendered as itself.
 *
 * Live counts the same day: on 592, 109 of 285 rows were `kind: native` and
 * 102 of those HAD labels; on 3628, all 23 did.
 */
import { describe, expect, it } from 'vitest'
import { clipChipClass, clipChipClasses } from '../clip-chip-classes.js'
import type { Clip } from '../clip-model.js'

const clip = (patch: Partial<Clip>): Clip =>
  ({
    clipId: 'native:reolink:onboard:0:abc',
    deviceId: 107,
    startMs: 1,
    endMs: 2,
    kind: 'native',
    ...patch,
  }) as Clip

describe('clipChipClasses', () => {
  it('shows the LABELS when the row has any, dominant first', () => {
    // The exact shape of 26 rows on 592 and 2 on 3628.
    expect(clipChipClasses(clip({ kind: 'native', labels: ['person', 'animal'] }))).toEqual([
      'person',
      'animal',
    ])
  })

  it('never shows `native` — it falls back to motion', () => {
    // The operator's rule: "native non ha senso. Si deve mostrare solamente le
    // classi, motion se altro." A file the camera chose to record is a file
    // something happened in.
    for (const labels of [undefined, []]) {
      expect(clipChipClasses(clip({ kind: 'native', ...(labels ? { labels } : {}) }))).toEqual([
        'motion',
      ])
    }
  })

  it('keeps AUDIO as itself — a cry is not motion', () => {
    // The one judgement call: calling an audio detection "motion" would be the
    // same crime in the other direction, an answer the row does not support.
    expect(clipChipClasses(clip({ kind: 'audio' }))).toEqual(['audio'])
  })

  it('shows motion when that is all the row has', () => {
    expect(clipChipClasses(clip({ kind: 'motion', labels: [] }))).toEqual(['motion'])
  })

  it('is NEVER empty — a card with no pill reads as one still loading', () => {
    for (const kind of ['native', 'motion', 'object', 'audio'] as const) {
      expect(clipChipClasses(clip({ kind, labels: [] })).length).toBeGreaterThan(0)
    }
  })

  it('prefers the labels over the kind — the kind is how it was noticed', () => {
    // `md,people` → labels ['person'], kind demoted to native. But even a row
    // that kept `motion` should chip as what it SAW.
    expect(clipChipClasses(clip({ kind: 'motion', labels: ['person'] }))).toEqual(['person'])
  })

  it('keeps an unknown: label rather than dropping it — a new firmware stays visible', () => {
    expect(clipChipClasses(clip({ kind: 'native', labels: ['unknown:wildfire'] }))).toEqual([
      'unknown:wildfire',
    ])
  })
})

describe('clipChipClass — the single-class slot', () => {
  it('is the dominant label', () => {
    expect(clipChipClass(clip({ labels: ['person', 'animal'] }))).toBe('person')
  })

  it('is motion for a row that resolved nothing — never `native`', () => {
    // A `sched` row: 7 of 285 on 592.
    expect(clipChipClass(clip({ kind: 'native', labels: [] }))).toBe('motion')
  })
})
