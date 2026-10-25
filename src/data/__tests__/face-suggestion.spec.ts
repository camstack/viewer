import { describe, it, expect } from 'vitest'
import {
  shouldShowSuggestion,
  resolveSuggestedName,
  type SuggestionIdentity,
} from '../face-suggestion.js'

const IDENTITIES: readonly SuggestionIdentity[] = [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
]

describe('shouldShowSuggestion — visibility predicate', () => {
  it('shows when there is no person, a suggested id, and no dismissal', () => {
    expect(
      shouldShowSuggestion({
        hasPerson: false,
        suggestedIdentityId: 'p1',
        dismissedFaceIds: new Set(),
        faceId: 'f1',
      }),
    ).toBe(true)
  })

  it('hides when the face already links to a person (auto or manual)', () => {
    expect(
      shouldShowSuggestion({
        hasPerson: true,
        suggestedIdentityId: 'p1',
        dismissedFaceIds: new Set(),
        faceId: 'f1',
      }),
    ).toBe(false)
  })

  it('hides when there is no suggested identity (undefined or empty)', () => {
    expect(
      shouldShowSuggestion({
        hasPerson: false,
        suggestedIdentityId: undefined,
        dismissedFaceIds: new Set(),
        faceId: 'f1',
      }),
    ).toBe(false)
    expect(
      shouldShowSuggestion({
        hasPerson: false,
        suggestedIdentityId: '',
        dismissedFaceIds: new Set(),
        faceId: 'f1',
      }),
    ).toBe(false)
  })

  it('hides when THIS face was locally dismissed', () => {
    expect(
      shouldShowSuggestion({
        hasPerson: false,
        suggestedIdentityId: 'p1',
        dismissedFaceIds: new Set(['f1']),
        faceId: 'f1',
      }),
    ).toBe(false)
  })

  it('still shows when a DIFFERENT face was dismissed (per-faceId set)', () => {
    expect(
      shouldShowSuggestion({
        hasPerson: false,
        suggestedIdentityId: 'p1',
        dismissedFaceIds: new Set(['other']),
        faceId: 'f1',
      }),
    ).toBe(true)
  })
})

describe('resolveSuggestedName — name lookup with neutral fallback', () => {
  it('resolves the display name from the loaded identities', () => {
    expect(resolveSuggestedName(IDENTITIES, 'p1', 'Unknown')).toBe('Alice')
    expect(resolveSuggestedName(IDENTITIES, 'p2', 'Unknown')).toBe('Bob')
  })

  it('falls back to the neutral label when the identity no longer exists', () => {
    expect(resolveSuggestedName(IDENTITIES, 'gone', 'Unknown')).toBe('Unknown')
  })

  it('falls back to the neutral label against an empty identities list', () => {
    expect(resolveSuggestedName([], 'p1', 'Unknown')).toBe('Unknown')
  })

  it('falls back when the matched identity carries an empty name', () => {
    expect(resolveSuggestedName([{ id: 'p1', name: '' }], 'p1', 'Unknown')).toBe('Unknown')
  })
})
