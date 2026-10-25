import { describe, it, expect } from 'vitest'
import { addDismissedEntry, parseDismissed } from '../face-suggestion-dismiss-store.js'

describe('addDismissedEntry — immutable add', () => {
  it('adds a faceId to a new set without mutating the input', () => {
    const before = new Set<string>(['a'])
    const after = addDismissedEntry(before, 'b')
    expect([...after].sort()).toEqual(['a', 'b'])
    expect([...before]).toEqual(['a']) // input untouched
  })

  it('is idempotent for an already-dismissed id', () => {
    const after = addDismissedEntry(new Set(['a']), 'a')
    expect([...after]).toEqual(['a'])
  })

  it('ignores an empty faceId', () => {
    const after = addDismissedEntry(new Set(['a']), '')
    expect([...after]).toEqual(['a'])
  })
})

describe('parseDismissed — storage-boundary parsing', () => {
  it('parses a stored string array into a set', () => {
    expect([...parseDismissed('["f1","f2"]')].sort()).toEqual(['f1', 'f2'])
  })

  it('degrades null / empty storage to an empty set', () => {
    expect(parseDismissed(null).size).toBe(0)
    expect(parseDismissed('').size).toBe(0)
  })

  it('degrades corrupt JSON to an empty set (never throws)', () => {
    expect(parseDismissed('{not json').size).toBe(0)
  })

  it('degrades a non-array payload to an empty set', () => {
    expect(parseDismissed('{"a":1}').size).toBe(0)
  })

  it('drops non-string and empty entries', () => {
    expect([...parseDismissed('["f1",2,null,"",true,"f2"]')].sort()).toEqual(['f1', 'f2'])
  })
})
