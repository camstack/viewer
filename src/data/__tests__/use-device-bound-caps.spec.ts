import { describe, expect, it } from 'vitest'
import { parseBoundCaps } from '../use-device-bound-caps.js'

describe('parseBoundCaps — an unreadable answer is unknown, never "binds nothing" (D315)', () => {
  it('reads the cap names, de-duplicated', () => {
    expect(parseBoundCaps({ entries: [{ capName: 'switch' }, { capName: 'switch' }, { capName: 'battery' }] })).toEqual([
      'switch',
      'battery',
    ])
  })
  it('an answered empty list is empty', () => {
    expect(parseBoundCaps({ entries: [] })).toEqual([])
  })
  it('a malformed payload is null', () => {
    expect(parseBoundCaps(null)).toBeNull()
    expect(parseBoundCaps([])).toBeNull()
    expect(parseBoundCaps({})).toBeNull()
    expect(parseBoundCaps({ entries: 'x' })).toBeNull()
    expect(parseBoundCaps('switch')).toBeNull()
  })
})
