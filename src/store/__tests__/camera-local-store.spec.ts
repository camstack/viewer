/**
 * camera-local — the per-camera state that stays on THIS device: stream tier,
 * audio memory and (in memory only) the theater-timeline filters. Moved out of
 * camera-prefs when the account half was split off; the reducers kept their
 * semantics.
 */
import { describe, it, expect } from 'vitest'
import {
  normalizeTimelineClasses,
  normalizeTimelineKinds,
  parseCameraLocal,
  resetCameraLocalEntry,
  setCameraQualityEntry,
  setCameraTimelineClassesEntry,
  setCameraTimelineKindsEntry,
  toggleCameraTimelineClassEntry,
  toggleCameraTimelineKindEntry,
  type AppCameraLocal,
} from '../camera-local-store.js'

describe('setCameraTimelineKindsEntry / normalizeTimelineKinds', () => {
  const base: AppCameraLocal = resetCameraLocalEntry()

  it('stores a partial selection in display order, immutably', () => {
    const next = setCameraTimelineKindsEntry(base, 4, ['audio'])
    expect(next.byId[4]?.timelineKinds).toEqual(['audio'])
    expect(next).not.toBe(base)
    expect(base.byId[4]).toBeUndefined()
  })

  it('normalises "all kinds" (and empty) back to absence — the default', () => {
    const partial = setCameraTimelineKindsEntry(base, 4, ['motion'])
    expect(setCameraTimelineKindsEntry(partial, 4, ['audio', 'motion']).byId[4]).toBeUndefined()
    expect(setCameraTimelineKindsEntry(partial, 4, []).byId[4]).toBeUndefined()
  })

  it('keeps sibling state when the filter resets to all', () => {
    const tier = setCameraQualityEntry(base, 4, 'high')
    const filtered = setCameraTimelineKindsEntry(tier, 4, ['motion'])
    const reset = setCameraTimelineKindsEntry(filtered, 4, ['motion', 'audio'])
    expect(reset.byId[4]).toEqual({ quality: 'high' })
  })

  it('normalizeTimelineKinds dedupes and orders against the vocab', () => {
    expect(normalizeTimelineKinds(['audio', 'audio', 'motion'])).toBeUndefined() // covers all
    expect(normalizeTimelineKinds(['audio', 'audio'])).toEqual(['audio'])
  })
})

describe('setCameraTimelineClassesEntry / normalizeTimelineClasses', () => {
  const base: AppCameraLocal = resetCameraLocalEntry()

  it('stores a class selection immutably', () => {
    const next = setCameraTimelineClassesEntry(base, 4, ['person', 'car'])
    expect(next.byId[4]?.timelineClasses).toEqual(['person', 'car'])
    expect(next).not.toBe(base)
    expect(base.byId[4]).toBeUndefined()
  })

  it('normalises an empty selection back to absence — "all classes"', () => {
    const partial = setCameraTimelineClassesEntry(base, 4, ['person'])
    expect(partial.byId[4]?.timelineClasses).toEqual(['person'])
    expect(setCameraTimelineClassesEntry(partial, 4, []).byId[4]).toBeUndefined()
  })

  it('keeps sibling prefs (kinds) when the class filter resets to all', () => {
    const kinds = setCameraTimelineKindsEntry(base, 4, ['audio'])
    const both = setCameraTimelineClassesEntry(kinds, 4, ['dog'])
    expect(both.byId[4]).toEqual({ timelineKinds: ['audio'], timelineClasses: ['dog'] })
    const reset = setCameraTimelineClassesEntry(both, 4, [])
    expect(reset.byId[4]).toEqual({ timelineKinds: ['audio'] })
  })

  it('normalizeTimelineClasses trims, drops empties, dedupes (first wins)', () => {
    expect(normalizeTimelineClasses([' person ', 'person', '', '  ', 'car'])).toEqual([
      'person',
      'car',
    ])
    expect(normalizeTimelineClasses([])).toBeUndefined()
    expect(normalizeTimelineClasses(['', '   '])).toBeUndefined()
  })
})

describe('toggleCameraTimelineClassEntry (multi-select — Task 4)', () => {
  const base: AppCameraLocal = resetCameraLocalEntry()

  it('ACCUMULATES: tapping a second class keeps the first (union, not reset)', () => {
    // The regression: reading a stale render-time set made the 2nd tap overwrite
    // the 1st. The reducer reads the LATEST stored set, so both accumulate.
    const one = toggleCameraTimelineClassEntry(base, 4, 'person')
    expect(one.byId[4]?.timelineClasses).toEqual(['person'])
    const two = toggleCameraTimelineClassEntry(one, 4, 'car')
    expect(two.byId[4]?.timelineClasses).toEqual(['person', 'car'])
  })

  it('toggling an active class off removes only it; last one off → absence (all)', () => {
    const both = toggleCameraTimelineClassEntry(
      toggleCameraTimelineClassEntry(base, 4, 'person'),
      4,
      'car',
    )
    const offCar = toggleCameraTimelineClassEntry(both, 4, 'car')
    expect(offCar.byId[4]?.timelineClasses).toEqual(['person'])
    const offAll = toggleCameraTimelineClassEntry(offCar, 4, 'person')
    expect(offAll.byId[4]).toBeUndefined()
  })

  it('does not mutate its input', () => {
    const next = toggleCameraTimelineClassEntry(base, 4, 'dog')
    expect(next).not.toBe(base)
    expect(base.byId[4]).toBeUndefined()
  })
})

describe('toggleCameraTimelineKindEntry (Task 4)', () => {
  const base: AppCameraLocal = resetCameraLocalEntry()

  it('isolates from the "all" default on the first tap, then toggles', () => {
    const one = toggleCameraTimelineKindEntry(base, 4, 'motion')
    expect(one.byId[4]?.timelineKinds).toEqual(['motion'])
    // Re-selecting the other kind covers all → stored as absence ("all").
    const both = toggleCameraTimelineKindEntry(one, 4, 'audio')
    expect(both.byId[4]).toBeUndefined()
  })

  it('toggling the only selected kind off falls back to "all" (absence)', () => {
    const one = toggleCameraTimelineKindEntry(base, 4, 'audio')
    const off = toggleCameraTimelineKindEntry(one, 4, 'audio')
    expect(off.byId[4]).toBeUndefined()
  })
})

describe('parseCameraLocal', () => {
  it('returns an empty document for null / invalid JSON', () => {
    expect(parseCameraLocal(null)).toEqual({ byId: {} })
    expect(parseCameraLocal('not json')).toEqual({ byId: {} })
    expect(parseCameraLocal('[]')).toEqual({ byId: {} })
  })

  it('round-trips a full document', () => {
    const doc = setCameraTimelineClassesEntry(
      setCameraTimelineKindsEntry(setCameraQualityEntry(resetCameraLocalEntry(), 7, 'low'), 7, ['audio']),
      7,
      ['person', 'car'],
    )
    expect(parseCameraLocal(JSON.stringify(doc))).toEqual(doc)
  })

  it('drops a retired tier rather than keeping a word nothing else says', () => {
    const parsed = parseCameraLocal(JSON.stringify({ byId: { '3': { quality: 'medium' } } }))
    expect(parsed.byId[3]).toBeUndefined()
  })

  it('sanitises persisted timelineClasses (non-strings dropped, empty → absent)', () => {
    const parsed = parseCameraLocal(
      JSON.stringify({
        byId: {
          '1': { timelineClasses: ['person', 42, '', ' car '] },
          '2': { timelineClasses: [] },
          '3': { timelineClasses: 'person' },
        },
      }),
    )
    expect(parsed.byId[1]).toEqual({ timelineClasses: ['person', 'car'] })
    expect(parsed.byId[2]).toBeUndefined()
    expect(parsed.byId[3]).toBeUndefined()
  })

  it('sanitises persisted timelineKinds (unknown values dropped, "all" → absent)', () => {
    const parsed = parseCameraLocal(
      JSON.stringify({
        byId: {
          '1': { timelineKinds: ['audio', 'bogus'] },
          '2': { timelineKinds: ['motion', 'audio'] },
          '3': { timelineKinds: 'motion' },
        },
      }),
    )
    expect(parsed.byId[1]).toEqual({ timelineKinds: ['audio'] })
    expect(parsed.byId[2]).toBeUndefined()
    expect(parsed.byId[3]).toBeUndefined()
  })

})
