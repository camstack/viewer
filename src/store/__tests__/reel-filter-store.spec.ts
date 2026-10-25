/**
 * The Recent reel's own filter.
 *
 * The strip on the Cameras screen followed no filter store and had no control,
 * so it was the one events surface a hidden default could not honestly be
 * applied to. It has its own store now — a different SCOPE from the events
 * page, sharing that page's SHAPE through `track-filter.ts` and none of its
 * values.
 *
 * ## What these pin
 *
 *  1. the default is DERIVED from the live taxonomy, never a list written here;
 *  2. it leaves the synthetic sources out BY CONSTRUCTION, and says so through
 *     `excludeSources` rather than a second mechanism;
 *  3. `null`, `[]` and a list are three different answers on read — the
 *     distinction that makes a narrowing default survive a restart instead of
 *     re-applying itself over the operator's choice;
 *  4. nothing narrows on a taxonomy that has not answered.
 */
import { describe, expect, it } from 'vitest'
import {
  REEL_DEFAULTS,
  parseReelFilter,
  reelFilterCondition,
  resolveReelClasses,
  resolveReelExcludeSources,
} from '../reel-filter-store.js'
import {
  detectionMacroKinds,
  excludeSourcesForSelection,
  nodeDrivesSource,
  presetExcludeSources,
  presetKinds,
  resolveFilterClasses,
  resolveFilterExcludeSources,
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

/** A realistic merged fleet taxonomy: every macro tier the hub advertises. */
const TAXONOMY: readonly EventKindDescriptor[] = [
  kind('motion', 'macro', 'motion'),
  kind('audio', 'macro', 'audio'),
  kind('audio-dog', 'sub', 'audio', 'audio'),
  kind('person', 'macro', 'detection'),
  kind('vehicle', 'macro', 'detection'),
  kind('car', 'sub', 'detection', 'vehicle'),
  kind('animal', 'macro', 'detection'),
  kind('package', 'macro', 'package'),
  kind('contact', 'sub', 'sensor', 'sensor'),
  kind('doorbell', 'sub', 'control', 'control'),
]

describe('the default preset', () => {
  it('is the macro tier of the DETECTION category, read off the taxonomy', () => {
    // person / vehicle / animal — and whatever else the hub puts in that tier.
    // A hand-written list beside a live taxonomy is two sources of truth, and
    // the one that is not generated is the one that rots.
    expect(detectionMacroKinds(TAXONOMY)).toEqual(['person', 'vehicle', 'animal'])
  })

  it('takes the macro tier only — not the detection SUBS', () => {
    expect(detectionMacroKinds(TAXONOMY)).not.toContain('car')
  })

  it('excludes the synthetic and non-detection macros by CONSTRUCTION', () => {
    const macros = detectionMacroKinds(TAXONOMY)
    for (const excluded of ['audio', 'motion', 'package', 'contact', 'doorbell']) {
      expect(macros).not.toContain(excluded)
    }
  })

  it('grows with the taxonomy instead of freezing the vocabulary of today', () => {
    const withNewMacro = [...TAXONOMY, kind('forklift', 'macro', 'detection')]
    expect(detectionMacroKinds(withNewMacro)).toContain('forklift')
  })

  it('is what an unconfigured store resolves to', () => {
    expect(REEL_DEFAULTS.classes).toBeNull()
    expect(resolveReelClasses(REEL_DEFAULTS, TAXONOMY)).toEqual(['person', 'vehicle', 'animal'])
  })
})

describe('the source exclusion is derived, never stored', () => {
  it('hides audio and sensor for the default preset WITHOUT waiting for the taxonomy', () => {
    // "The detection macros" cannot contain an audio or a sensor kind whatever
    // the vocabulary turns out to be, so the part that needs no lookup is
    // applied at once. Otherwise every cold launch flashes a second of exactly
    // the markers the default exists to hide.
    expect([...resolveReelExcludeSources(REEL_DEFAULTS, undefined)]).toEqual(['audio', 'sensor'])
    expect([...resolveReelExcludeSources(REEL_DEFAULTS, TAXONOMY)]).toEqual(['audio', 'sensor'])
  })

  it('stops hiding audio once an audio kind is selected', () => {
    expect([...excludeSourcesForSelection(['person', 'audio'], TAXONOMY)]).toEqual(['sensor'])
  })

  it('stops hiding sensor once a sensor OR a control kind is selected', () => {
    // Two taxonomy macros, one track source — a contact and a doorbell are the
    // same kind of projection.
    expect([...excludeSourcesForSelection(['person', 'contact'], TAXONOMY)]).toEqual(['audio'])
    expect([...excludeSourcesForSelection(['person', 'doorbell'], TAXONOMY)]).toEqual(['audio'])
  })

  it('excludes nothing for an empty selection — that is "show everything"', () => {
    expect([...excludeSourcesForSelection([], TAXONOMY)]).toEqual([])
    expect([...resolveReelExcludeSources({ classes: [] }, TAXONOMY)]).toEqual([])
  })

  it('never excludes pipeline, whatever is selected', () => {
    expect([...excludeSourcesForSelection(['audio'], TAXONOMY)]).not.toContain('pipeline')
    expect([...excludeSourcesForSelection(['contact'], TAXONOMY)]).not.toContain('pipeline')
  })

  it('treats a kind the taxonomy does not describe as a pipeline class', () => {
    // Narrowing on a guess would hide rows the operator asked for. An unknown
    // id keeps pipeline reachable and only the synthetic sources are dropped.
    expect([...excludeSourcesForSelection(['mystery'], TAXONOMY)]).toEqual(['audio', 'sensor'])
  })
})

describe('an unanswered taxonomy narrows nothing by class', () => {
  it('sends no class list rather than a name no row carries', () => {
    // Not-yet-known must never be served as a fact (D315). The SOURCE exclusion
    // still applies, so the default is not inert while the taxonomy loads.
    expect(resolveReelClasses(REEL_DEFAULTS, undefined)).toEqual([])
    expect([...resolveReelExcludeSources(REEL_DEFAULTS, undefined)]).toEqual(['audio', 'sensor'])
  })

  it('sends no class list when the hub advertises no detection macro', () => {
    expect(resolveReelClasses(REEL_DEFAULTS, [kind('motion', 'macro', 'motion')])).toEqual([])
  })
})

describe('null, empty and a list are three answers', () => {
  it('reads an absent blob as the default preset', () => {
    expect(parseReelFilter(undefined).classes).toBeNull()
    expect(parseReelFilter({}).classes).toBeNull()
  })

  it('reads a malformed value as the default, not as "nothing hidden"', () => {
    // Garbage is closer to "we do not know" than to "the operator chose
    // nothing" — and the wrong reading here silently turns the default off.
    expect(parseReelFilter({ classes: 'person' }).classes).toBeNull()
    expect(parseReelFilter({ classes: null }).classes).toBeNull()
  })

  it('KEEPS an explicit empty selection — the operator asked for everything', () => {
    // The distinction the design turns on. Collapsing `[]` into absent
    // re-applies the default on every launch, which is a rule wearing the
    // clothes of a default.
    expect(parseReelFilter({ classes: [] }).classes).toEqual([])
    expect(resolveReelClasses({ classes: [] }, TAXONOMY)).toEqual([])
  })

  it('round-trips an explicit selection and drops non-strings from it', () => {
    expect(parseReelFilter({ classes: ['person', 7, 'audio'] }).classes).toEqual([
      'person',
      'audio',
    ])
  })
})

describe('the condition the surfaces draw', () => {
  it('reports the DEFAULT as narrowed, not as "all"', () => {
    // It hides audio and sensor markers. Reporting it as unfiltered is exactly
    // the quietly-shorter strip this control exists to prevent.
    expect(reelFilterCondition(REEL_DEFAULTS)).toEqual({ kind: 'default' })
  })

  it('reports an explicit empty selection as all', () => {
    expect(reelFilterCondition({ classes: [] })).toEqual({ kind: 'all' })
  })

  it('counts an explicit selection', () => {
    expect(reelFilterCondition({ classes: ['person', 'vehicle'] })).toEqual({
      kind: 'selection',
      count: 2,
    })
  })
})

/**
 * The strip and the events page use the SAME routing.
 *
 * The reel was built first and had its own copy of "resolve a preset, derive
 * the exclusion". When the events page moved its source decision into the kind
 * tree, that copy would have been the surface left behind on the old path —
 * exactly the divergence `track-filter.ts` exists to prevent. Both stores now
 * delegate, and these pin it.
 */
describe('one routing, two surfaces', () => {
  it('the reel resolves through the shared resolver, not a private copy', () => {
    expect(resolveReelClasses(REEL_DEFAULTS, TAXONOMY)).toEqual(
      resolveFilterClasses(null, 'detection-macros', TAXONOMY),
    )
    expect([...resolveReelExcludeSources(REEL_DEFAULTS, TAXONOMY)]).toEqual([
      ...resolveFilterExcludeSources(null, 'detection-macros', TAXONOMY),
    ])
  })

  it('and a ticked SENSOR node stops the exclusion on the strip too', () => {
    // The routing is by taxonomy category, so it reaches every surface that
    // renders the same tree — the strip did not have to be taught it.
    expect([...resolveReelExcludeSources({ classes: ['contact'] }, TAXONOMY)]).toEqual(['audio'])
    expect([...resolveReelExcludeSources({ classes: ['doorbell'] }, TAXONOMY)]).toEqual(['audio'])
  })

  it('the two presets differ in VALUE and agree in shape', () => {
    // A glance wants the detection tier; an investigation surface hides only
    // what was reported as noise.
    expect(presetKinds('detection-macros', TAXONOMY)).toEqual(['person', 'vehicle', 'animal'])
    expect(presetKinds('all-but-audio', TAXONOMY)).toContain('contact')
    expect(presetKinds('all-but-audio', TAXONOMY)).not.toContain('audio')
    expect([...presetExcludeSources('detection-macros')]).toEqual(['audio', 'sensor'])
    expect([...presetExcludeSources('all-but-audio')]).toEqual(['audio'])
  })

  it('routes motion and package as CLASSES on both, detection or not', () => {
    expect(nodeDrivesSource(kind('motion', 'macro', 'motion'))).toBe(false)
    expect(nodeDrivesSource(kind('package', 'macro', 'package'))).toBe(false)
  })
})
