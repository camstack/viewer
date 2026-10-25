/**
 * The state from the operator's screenshot: Volti + Targhe ticked, every kind
 * checkbox empty, an empty list, the chip reading 4 and the tree header 5.
 *
 * ## One cause, both symptoms
 *
 * A stored selection outlives the scope it was written in. `expandMacroSelection`
 * removes a macro plus the subs the CURRENT taxonomy calls its own, so
 * unticking every visible row leaves behind every id the current vocabulary has
 * never heard of. What is left is a selection that is not empty and cannot
 * match:
 *
 *  - the FEED answers nothing, because the class axis is constrained by ids no
 *    row carries — which is what read as "attribute-only is a dead end". The
 *    AND rule was never the problem; the list was never actually empty;
 *  - the TREE shows nothing ticked, because the residue is unadvertised (no row
 *    to draw) or a SUB under a collapsed macro (whose own id is not selected);
 *  - the NUMBERS disagree, because the chip counted macros and the header
 *    counted raw ids over that same invisible residue.
 *
 * Five stored ids, two of them subs the taxonomy still advertises: header 5,
 * chip 2 macros + 2 attributes = 4, tree visibly empty. Exactly the screenshot.
 *
 * The v2 migration does NOT create this — it cannot invent ids, and it only
 * rewrites an EMPTY pre-v2 selection. It does preserve a non-empty pre-v2
 * selection verbatim, which is how a list written under another scope survives
 * to be resolved against this one.
 */
import { describe, expect, it } from 'vitest'
import { parseFilter, resolveEventsClasses, resolveEventsExcludeSources } from '../events-filter-store.js'
import {
  facetCounts,
  macroCheckState,
  pruneToAdvertised,
  selectedMacroKinds,
} from '../track-filter.js'
import type { EventKindDescriptor } from '../../data/event-kinds.js'

function kind(
  k: string,
  level: 'macro' | 'sub',
  category: string,
  parentKind: string | null = null,
): EventKindDescriptor {
  return {
    kind: k,
    labelKey: `eventKind.${k}`,
    label: k,
    color: '#000',
    iconId: k,
    category,
    parentKind,
    level,
  }
}

const TAXONOMY: readonly EventKindDescriptor[] = [
  kind('motion', 'macro', 'motion'),
  kind('audio', 'macro', 'audio'),
  kind('person', 'macro', 'detection'),
  kind('vehicle', 'macro', 'detection'),
  kind('car', 'sub', 'detection', 'vehicle'),
  kind('animal', 'macro', 'detection'),
]

/** The screenshot's blob: two advertised SUBS plus three ids from a scope that
 *  is no longer selected. Nothing here is visible in the tree. */
const RESIDUE = ['car', 'truck', 'contact', 'doorbell', 'lock']

describe('a selection that can match nothing is not a narrowing', () => {
  it('drops ids the loaded taxonomy does not advertise', () => {
    expect(pruneToAdvertised(RESIDUE, TAXONOMY)).toEqual(['car'])
  })

  it('reduces an ALL-residue selection to the unconstrained empty list', () => {
    // The dead end, gone: with nothing left the class axis stops constraining,
    // so an attribute ticked on its own applies across every kind.
    expect(pruneToAdvertised(['truck', 'contact'], TAXONOMY)).toEqual([])
    expect(resolveEventsClasses(['truck', 'contact'], TAXONOMY)).toEqual([])
  })

  it('leaves the selection ALONE while the taxonomy is unknown', () => {
    // Not-yet-known must never be served as a fact: pruning against a
    // vocabulary nobody has read would erase the operator's selection on every
    // cold open.
    expect(pruneToAdvertised(RESIDUE, undefined)).toEqual(RESIDUE)
  })

  it('leaves it alone when the hub advertises NO kinds at all', () => {
    // A hub too old to describe itself must not have every selection erased.
    expect(pruneToAdvertised(RESIDUE, [])).toEqual(RESIDUE)
  })

  it('returns the same array when there is nothing to prune', () => {
    const clean = ['person', 'car']
    expect(pruneToAdvertised(clean, TAXONOMY)).toBe(clean)
  })
})

describe('no kind ticked + an attribute is NOT an empty result', () => {
  it('sends an unconstrained class axis', () => {
    // "Every event with a face" is sayable. `[]` is unconstrained on this
    // axis — the same absent-versus-empty rule as everywhere else.
    expect(resolveEventsClasses([], TAXONOMY)).toEqual([])
  })

  it('and excludes no source either, so nothing is filtered out upstream', () => {
    // A residual `excludeSources` would have re-created the dead end one layer
    // down: the rows would never be fetched to be matched.
    expect([...resolveEventsExcludeSources([], TAXONOMY)]).toEqual([])
  })

  it('holds for a stored blob made ENTIRELY of residue', () => {
    const stored = parseFilter({ classes: RESIDUE, attributes: ['face', 'plate'], v: 2 })
    expect(resolveEventsClasses(stored.classes, [kind('person', 'macro', 'detection')])).toEqual([])
    expect(stored.attributes).toEqual(['face', 'plate'])
  })
})

describe('every number counts what the tree shows', () => {
  it('counts MACROS, resolving a ticked sub to its macro', () => {
    expect(selectedMacroKinds(['car'], TAXONOMY)).toEqual(['vehicle'])
    expect(selectedMacroKinds(['person', 'car'], TAXONOMY)).toEqual(['person', 'vehicle'])
  })

  it('counts nothing for residue — the header can no longer read 5 over an empty tree', () => {
    expect(selectedMacroKinds(pruneToAdvertised(RESIDUE, TAXONOMY), TAXONOMY)).toEqual(['vehicle'])
    expect(selectedMacroKinds(['truck', 'contact'], TAXONOMY)).toEqual([])
  })

  it('is zero for an empty selection', () => {
    expect(selectedMacroKinds([], TAXONOMY)).toEqual([])
  })
})

describe('a collapsed macro cannot hide a ticked sub', () => {
  it('reports PARTIAL when a sub is on and the macro itself is not', () => {
    // The other half of "the tree shows nothing ticked": `car` was selected,
    // `vehicle` was not, and the collapsed row drew as fully empty.
    expect(macroCheckState('vehicle', ['car'], new Set(['car']))).toBe('partial')
  })

  it('reports ON when the macro id itself is selected', () => {
    expect(macroCheckState('vehicle', ['car'], new Set(['vehicle']))).toBe('on')
  })

  it('reports OFF only when nothing under it is selected', () => {
    expect(macroCheckState('vehicle', ['car'], new Set(['person']))).toBe('off')
    expect(macroCheckState('vehicle', [], new Set())).toBe('off')
  })
})

/**
 * The chip is the SUM of the two counts under it, and nothing else.
 *
 * The screenshot's third number lived here: the chip computed macros, the tree
 * header computed raw ids, and the reset button sat beside the header count
 * looking like a third figure. There are two counts now — one per section —
 * and the chip is their total, so every number is derivable from what the
 * operator can see.
 */
describe('the chip and the sections agree', () => {
  const resolved = pruneToAdvertised(RESIDUE, TAXONOMY) // → ['car']

  it('sums the two sections', () => {
    const c = facetCounts(resolved, TAXONOMY, 2)
    expect(c.classes).toBe(1) // one macro touched, via the `car` sub
    expect(c.attributes).toBe(2)
    expect(c.total).toBe(3)
  })

  it('says All only when NEITHER axis constrains anything', () => {
    expect(facetCounts([], TAXONOMY, 0).narrowed).toBe(false)
    expect(facetCounts([], TAXONOMY, 1).narrowed).toBe(true)
    expect(facetCounts(['person'], TAXONOMY, 0).narrowed).toBe(true)
  })

  it('never reports a class count the tree cannot show', () => {
    // The screenshot: five stored ids, none of them a visible tick. The chip
    // said 2 macros; the tree said 5; the rows said nothing.
    expect(facetCounts(pruneToAdvertised(['truck', 'contact'], TAXONOMY), TAXONOMY, 2)).toEqual({
      classes: 0,
      attributes: 2,
      total: 2,
      narrowed: true,
    })
  })

  it('reports the class count as the tree header does', () => {
    // Same derivation on both sides — that is the whole fix for symptom 2.
    // `['vehicle','car']` is the discriminating case: two ids, ONE macro. A
    // header counting raw ids reads 2 over a tree with one row ticked, which
    // is the "5 over an empty tree" of the screenshot in miniature.
    for (const selection of [
      [],
      ['person'],
      ['car'],
      ['vehicle', 'car'],
      ['person', 'vehicle', 'car'],
      resolved,
    ]) {
      expect(facetCounts(selection, TAXONOMY, 0).classes).toBe(
        selectedMacroKinds(selection, TAXONOMY).length,
      )
    }
  })

  it('counts a full selection as All rather than as a narrowing', () => {
    const everything = TAXONOMY.map((d) => d.kind)
    expect(facetCounts(everything, TAXONOMY, 0).narrowed).toBe(false)
  })
})
