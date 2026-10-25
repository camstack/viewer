/**
 * The two ways a `kind → macro` / `kind → glyph` map is built — from the raw
 * `listEventKindsBatch` payload (the embed) and from already-parsed descriptors
 * (the app's `useEventKinds`) — must be ONE rule. A second spelling is how the
 * class filter comes to mean different things in the app and the iframe.
 */
import { describe, expect, it } from 'vitest'
import {
  buildClassToMacro,
  buildKindIconIds,
  classToMacroFromKinds,
  iconIdsFromKinds,
} from '../events-taxonomy.js'

const KINDS = [
  { kind: 'vehicle', parentKind: null, iconId: 'vehicle' },
  { kind: 'van', parentKind: 'vehicle', iconId: 'truck' },
  { kind: 'person', iconId: 'person' },
  { kind: '', parentKind: 'x', iconId: 'y' },
  { kind: 'bare' },
]

describe('classToMacroFromKinds', () => {
  it('maps a sub to its macro and a macro (or a parentless kind) to itself', () => {
    const map = classToMacroFromKinds(KINDS)
    expect(map.get('van')).toBe('vehicle')
    expect(map.get('vehicle')).toBe('vehicle')
    expect(map.get('person')).toBe('person')
    expect(map.get('bare')).toBe('bare')
  })

  it('skips a descriptor with no kind rather than inventing an entry', () => {
    expect(classToMacroFromKinds(KINDS).has('')).toBe(false)
  })
})

describe('iconIdsFromKinds', () => {
  it('maps each kind to its declared glyph id, and skips a kind that declares none', () => {
    const map = iconIdsFromKinds(KINDS)
    expect(map.get('van')).toBe('truck')
    expect(map.has('bare')).toBe(false)
  })
})

describe('the raw payload and the parsed descriptors agree', () => {
  const RAW = [{ deviceId: 1, kinds: KINDS }, { deviceId: 2, kinds: [{ kind: 'dog', parentKind: 'animal', iconId: 'dog' }] }]

  it('builds the same macro map from both', () => {
    const fromRaw = buildClassToMacro(RAW)
    const fromParsed = classToMacroFromKinds([...KINDS, { kind: 'dog', parentKind: 'animal' }])
    expect([...fromRaw].sort()).toEqual([...fromParsed].sort())
  })

  it('builds the same glyph map from both', () => {
    const fromRaw = buildKindIconIds(RAW)
    const fromParsed = iconIdsFromKinds([...KINDS, { kind: 'dog', iconId: 'dog' }])
    expect([...fromRaw].sort()).toEqual([...fromParsed].sort())
  })

  it('is total on anything that is not the payload — a hub too old, an error', () => {
    expect(buildClassToMacro(null).size).toBe(0)
    expect(buildClassToMacro({ nope: true }).size).toBe(0)
    expect(buildKindIconIds('x').size).toBe(0)
  })
})
