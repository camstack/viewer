import { describe, expect, it } from 'vitest'
import { expandSelectionToServerClasses } from '../event-kinds.js'

const MACROS = new Map<string, string>([
  ['car', 'vehicle'],
  ['truck', 'vehicle'],
  ['person', 'person'],
  ['cat', 'animal'],
])

describe('expandSelectionToServerClasses', () => {
  it('expands a macro into the concrete classes the server actually stores', () => {
    // The whole point: the legend says `vehicle`, the rows say `car`.
    expect(expandSelectionToServerClasses(new Set(['vehicle']), MACROS)).toEqual([
      'car',
      'truck',
      'vehicle',
    ])
  })

  it('keeps a selection that is already its own macro', () => {
    expect(expandSelectionToServerClasses(new Set(['person']), MACROS)).toEqual(['person'])
  })

  it('expands several macros at once', () => {
    expect(expandSelectionToServerClasses(new Set(['vehicle', 'animal']), MACROS)).toEqual([
      'animal',
      'car',
      'cat',
      'truck',
      'vehicle',
    ])
  })

  it('sends nothing when the operator has narrowed nothing', () => {
    expect(expandSelectionToServerClasses(new Set(), MACROS)).toBeNull()
  })

  it('sends nothing while the macro map is still unknown', () => {
    // An unloaded map cannot expand `vehicle`, and asking the server for
    // `vehicle` on a camera that stores `car` answers with an empty day. The
    // honest request is the unfiltered one — the client filter still narrows.
    expect(expandSelectionToServerClasses(new Set(['vehicle']), new Map())).toBeNull()
  })

  it('keeps an unknown selection rather than dropping it to nothing', () => {
    // A class the map does not describe is still worth asking for: it may be
    // stored verbatim. Dropping it would silently widen the read instead.
    expect(expandSelectionToServerClasses(new Set(['boat']), MACROS)).toEqual(['boat'])
  })
})
