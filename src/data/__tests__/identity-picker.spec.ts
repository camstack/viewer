/**
 * The rule behind the person picker that replaced the chip rows.
 *
 * The review tab used to offer the whole gallery as chips — one row per
 * surface, re-rendered per analyze group — and the operator's report
 * (2026-09-13) is that it does not scale: *"il selettore li crescerebbe
 * troppo, serve una alternativa"*. The alternative is the app's existing
 * language for a long list (the Events camera facet): a search field over a
 * scrolling list. This is that field's rule, and nothing else.
 */
import { describe, expect, it } from 'vitest'

import { filterIdentities } from '../identity-picker.js'
import type { PersonIdentity } from '../use-face-gallery.js'

function person(name: string): PersonIdentity {
  return { id: name.toLowerCase(), name, sampleCount: 1, coverMediaId: undefined, coverBase64: undefined }
}

const PEOPLE: readonly PersonIdentity[] = [
  person('Bob'),
  person('Dave'),
  person('Niccolò'),
  person('Alice'),
]

describe('filterIdentities', () => {
  // An empty field is not a filter. It must hand back the SAME array, so a
  // memo above it does not re-render the list on every keystroke that leaves
  // the query blank.
  it('hands the list straight back when nothing is typed', () => {
    expect(filterIdentities(PEOPLE, '')).toBe(PEOPLE)
    expect(filterIdentities(PEOPLE, '   ')).toBe(PEOPLE)
  })

  it('matches anywhere in the name, not only at the start', () => {
    expect(filterIdentities(PEOPLE, 'dav').map((p) => p.name)).toEqual(['Dave'])
  })

  it('ignores case', () => {
    expect(filterIdentities(PEOPLE, 'BOB').map((p) => p.name)).toEqual(['Bob'])
  })

  // ⚠ LOAD-BEARING for an Italian gallery. A picker that cannot find "Niccolò"
  // from `niccolo` is a picker the operator stops using — and the accented
  // letter is on the NAME, which is the half they cannot retype quickly.
  it('ignores accents, in both directions', () => {
    expect(filterIdentities(PEOPLE, 'niccolo').map((p) => p.name)).toEqual(['Niccolò'])
    expect(filterIdentities(PEOPLE, 'Niccolò').map((p) => p.name)).toEqual(['Niccolò'])
  })

  it('answers nothing when nothing matches, never the whole list', () => {
    expect(filterIdentities(PEOPLE, 'zzz')).toEqual([])
  })

  it('keeps the order it was given', () => {
    expect(filterIdentities(PEOPLE, 'a').map((p) => p.name)).toEqual([
      'Dave',
      'Alice',
    ])
  })
})
