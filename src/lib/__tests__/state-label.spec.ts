import { describe, expect, it } from 'vitest'
import { stateLabelFor, stateLabelLocale } from '../state-label.js'

describe('stateLabelLocale', () => {
  it('Italian for any it* tag, English otherwise', () => {
    expect(stateLabelLocale('it')).toBe('it')
    expect(stateLabelLocale('it-IT')).toBe('it')
    expect(stateLabelLocale('en-GB')).toBe('en')
    expect(stateLabelLocale(undefined)).toBe('en')
  })
})

describe('stateLabelFor — the shared dictionary, in the app language', () => {
  it('labels a known state word in each language', () => {
    expect(stateLabelFor('armed_away', 'it-IT')).toBe('Inserito (fuori casa)')
    expect(stateLabelFor('armed_away', 'en')).toBe('Armed (away)')
    expect(stateLabelFor('matched', 'en')).toBe('Matched (as captured)')
  })

  it('an unknown word is shown as it is stored, never throws', () => {
    expect(stateLabelFor('some_new_state', 'it')).toBe('some_new_state')
  })
})
