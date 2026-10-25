import { describe, it, expect } from 'vitest'
import {
  toEventKindDescriptor,
  toEventKindDescriptors,
  mergeEventKinds,
  macroKinds,
  subKindsOf,
  buildEventKindTree,
  classToMacroMap,
  macroOf,
  collapseToMacro,
  expandMacroSelection,
  type EventKindDescriptor,
} from '../event-kinds.js'

function desc(
  kind: string,
  parentKind: string | null,
  level: 'macro' | 'sub',
): EventKindDescriptor {
  return {
    kind,
    labelKey: `eventKind.${kind}`,
    label: kind,
    color: '#000000',
    iconId: kind,
    category: 'detection',
    parentKind,
    level,
  }
}

const SAMPLE: readonly EventKindDescriptor[] = [
  desc('person', null, 'macro'),
  desc('vehicle', null, 'macro'),
  desc('car', 'vehicle', 'sub'),
  desc('truck', 'vehicle', 'sub'),
]

describe('toEventKindDescriptor', () => {
  it('narrows a full row', () => {
    const d = toEventKindDescriptor({
      kind: 'car',
      labelKey: 'eventKind.car',
      label: 'Car',
      color: '#f59e0b',
      iconId: 'car',
      category: 'detection',
      parentKind: 'vehicle',
      level: 'sub',
    })
    expect(d?.kind).toBe('car')
    expect(d?.level).toBe('sub')
    expect(d?.parentKind).toBe('vehicle')
  })

  it('rejects a row without a kind', () => {
    expect(toEventKindDescriptor({ label: 'x' })).toBeNull()
    expect(toEventKindDescriptor(null)).toBeNull()
  })

  it('derives level from parentKind when absent + fills defaults', () => {
    const macro = toEventKindDescriptor({ kind: 'person' })
    expect(macro?.level).toBe('macro')
    expect(macro?.labelKey).toBe('eventKind.person')
    expect(macro?.label).toBe('person')
    const sub = toEventKindDescriptor({ kind: 'car', parentKind: 'vehicle' })
    expect(sub?.level).toBe('sub')
  })
})

describe('toEventKindDescriptors', () => {
  it('drops malformed rows', () => {
    const out = toEventKindDescriptors([{ kind: 'person' }, null, { label: 'no kind' }, 5])
    expect(out).toHaveLength(1)
    expect(out[0]?.kind).toBe('person')
  })

  it('returns [] for non-arrays', () => {
    expect(toEventKindDescriptors(null)).toEqual([])
  })
})

describe('mergeEventKinds', () => {
  it('de-dupes by kind, first wins', () => {
    const a = [desc('person', null, 'macro')]
    const b = [desc('person', null, 'macro'), desc('vehicle', null, 'macro')]
    const merged = mergeEventKinds([a, b])
    expect(merged.map((d) => d.kind)).toEqual(['person', 'vehicle'])
  })
})

describe('macroKinds / subKindsOf', () => {
  it('splits by level and parent', () => {
    expect(macroKinds(SAMPLE).map((d) => d.kind)).toEqual(['person', 'vehicle'])
    expect(subKindsOf(SAMPLE, 'vehicle').map((d) => d.kind)).toEqual(['car', 'truck'])
    expect(subKindsOf(SAMPLE, 'person')).toEqual([])
  })
})

describe('buildEventKindTree', () => {
  it('nests subs under their macro', () => {
    const tree = buildEventKindTree(SAMPLE)
    expect(tree.map((n) => n.macro.kind)).toEqual(['person', 'vehicle'])
    expect(tree[1]?.subs.map((s) => s.kind)).toEqual(['car', 'truck'])
    expect(tree[0]?.subs).toEqual([])
  })

  it('creates a synthetic macro for an orphan sub', () => {
    const tree = buildEventKindTree([desc('car', 'vehicle', 'sub')])
    expect(tree).toHaveLength(1)
    expect(tree[0]?.macro.kind).toBe('vehicle')
    expect(tree[0]?.macro.level).toBe('macro')
    expect(tree[0]?.subs.map((s) => s.kind)).toEqual(['car'])
  })
})

describe('classToMacroMap / macroOf / collapseToMacro', () => {
  it('maps a kind to its macro (self for a macro/unknown)', () => {
    const map = classToMacroMap(SAMPLE)
    expect(macroOf('car', map)).toBe('vehicle')
    expect(macroOf('person', map)).toBe('person')
    expect(macroOf('unicorn', map)).toBe('unicorn')
  })

  it('collapses a class list to distinct macros, order preserved', () => {
    const map = classToMacroMap(SAMPLE)
    expect(collapseToMacro(['car', 'truck', 'person', 'car'], map)).toEqual(['vehicle', 'person'])
  })
})

describe('expandMacroSelection', () => {
  it('returns the macro plus all its subs', () => {
    expect(expandMacroSelection('vehicle', SAMPLE)).toEqual(['vehicle', 'car', 'truck'])
    expect(expandMacroSelection('person', SAMPLE)).toEqual(['person'])
  })
})
