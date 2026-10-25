import { describe, it, expect } from 'vitest'
import {
  isAuthoredEmptyScope,
  isAuthoredEmptyScopeKey,
  parseRecognitionMode,
  plateScopeMode,
  plateScopeValue,
  ruleHasRecognitionScope,
} from '../recognition-scope.js'

describe('plate scope', () => {
  it('maps a value to its mode', () => {
    expect(plateScopeMode(undefined)).toBe('off')
    expect(plateScopeMode({ values: [], maxDistance: 1 })).toBe('anyKnown')
    expect(plateScopeMode({ values: ['AB123CD'], maxDistance: 1 })).toBe('specific')
  })

  it('carries the fuzzy tolerance across a mode change', () => {
    expect(plateScopeValue('anyKnown', ['AB123CD'], 3)).toEqual({ values: [], maxDistance: 3 })
    expect(plateScopeValue('specific', ['AB123CD'], 3)).toEqual({ values: ['AB123CD'], maxDistance: 3 })
    expect(plateScopeValue('off', ['AB123CD'], 3)).toBeUndefined()
  })
})

describe('parseRecognitionMode', () => {
  it('narrows a known mode and rejects anything else', () => {
    expect(parseRecognitionMode('anyKnown')).toBe('anyKnown')
    expect(parseRecognitionMode('nonsense')).toBeUndefined()
    expect(parseRecognitionMode('')).toBeUndefined()
  })
})

describe('isAuthoredEmptyScope — the exception the save path consults', () => {
  it('is true only for an EMPTY identities / plates value', () => {
    expect(isAuthoredEmptyScope('identities', [])).toBe(true)
    expect(isAuthoredEmptyScope('plates', { values: [], maxDistance: 1 })).toBe(true)
    expect(isAuthoredEmptyScope('identities', ['uuid-1'])).toBe(false)
    expect(isAuthoredEmptyScope('plates', { values: ['AB'], maxDistance: 1 })).toBe(false)
  })

  it('is false for every other key, empty or not', () => {
    expect(isAuthoredEmptyScope('classes', [])).toBe(false)
    // Empty and absent genuinely agree for the exclude list ("exclude nobody"),
    // so it is NOT an authored-empty key.
    expect(isAuthoredEmptyScope('identitiesExclude', [])).toBe(false)
    expect(isAuthoredEmptyScopeKey('identitiesExclude')).toBe(false)
    expect(isAuthoredEmptyScopeKey('identities')).toBe(true)
  })

  it('is false for a malformed value, so it falls through to the ordinary prune', () => {
    expect(isAuthoredEmptyScope('identities', undefined)).toBe(false)
    expect(isAuthoredEmptyScope('plates', undefined)).toBe(false)
    expect(isAuthoredEmptyScope('plates', null)).toBe(false)
    expect(isAuthoredEmptyScope('plates', {})).toBe(false)
    expect(isAuthoredEmptyScope('plates', { values: 'AB' })).toBe(false)
  })
})

describe('ruleHasRecognitionScope — the grouping hints show only where they apply', () => {
  it('is true when the rule PRESENTS a face or plate scope, empty included', () => {
    expect(ruleHasRecognitionScope({ identities: [] })).toBe(true)
    expect(ruleHasRecognitionScope({ identities: ['uuid-1'] })).toBe(true)
    expect(ruleHasRecognitionScope({ plates: { values: [], maxDistance: 1 } })).toBe(true)
  })

  it('is false when nothing in the rule depends on a name', () => {
    expect(ruleHasRecognitionScope({ classes: ['person'] })).toBe(false)
    expect(ruleHasRecognitionScope({})).toBe(false)
    // An exclusion list alone does not make the match wait for a name.
    expect(ruleHasRecognitionScope({ identitiesExclude: ['uuid-1'] })).toBe(false)
  })
})
