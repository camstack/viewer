/**
 * ONE control, TWO dimensions — the kind tree, and what it turns into.
 *
 * ## What was wrong with the first attempt
 *
 * The tree under "Classi" already lists Motion, Audio, Person, Vehicle,
 * Animal, Package, Control and Sensor, and the operator reads those as eight
 * equal rows. Shipping a separate "Event sources" row in the More menu made
 * two controls answer one question: the chip read "More · 1" for a condition
 * the operator had gone looking for in the tree. That row is gone; the ticks
 * drive both dimensions now.
 *
 * ## The routing, and why it cannot be a list of names
 *
 * A ticked node goes down whichever dimension can actually select it:
 *
 *  - PIPELINE nodes → `classes`. The class lives in the row's `className` /
 *    `classes[]` and the hub's class filter selects it.
 *  - SYNTHETIC nodes (Audio, Sensor, Control) → `excludeSources`. Those rows
 *    carry no accumulated class at all, and the hub's class filter is a
 *    deliberate SUPERSET that keeps every row it cannot read — so a class
 *    selection can neither select nor exclude them.
 *
 * The split is the node's own taxonomy CATEGORY, so a node the hub adds
 * tomorrow is routed correctly the day it appears. It is deliberately not
 * "is the category `detection`": `motion` and `package` are not detection but
 * they ARE pipeline rows, and sending them down the source dimension would ask
 * the hub to exclude a source that does not exist.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULTS,
  parseFilter,
  resolveEventsClasses,
  resolveEventsExcludeSources,
} from '../../store/events-filter-store.js'
import { nodeDrivesSource, summariseSelection } from '../../store/track-filter.js'
import { EVENTS_TRACK_SOURCES, isEventsTrackSource } from '../../../shared/events/events-share-url.js'
import type { EventKindDescriptor } from '../../data/event-kinds.js'

const SRC = join(__dirname, '..', '..')
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8')

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

/** The eight rows of the screenshot, plus one sub apiece. */
const TAXONOMY: readonly EventKindDescriptor[] = [
  kind('motion', 'macro', 'motion'),
  kind('audio', 'macro', 'audio'),
  kind('audio-dog', 'sub', 'audio', 'audio'),
  kind('person', 'macro', 'detection'),
  kind('vehicle', 'macro', 'detection'),
  kind('car', 'sub', 'detection', 'vehicle'),
  kind('animal', 'macro', 'detection'),
  kind('package', 'macro', 'package'),
  kind('sensor', 'macro', 'sensor'),
  kind('contact', 'sub', 'sensor', 'sensor'),
  kind('control', 'macro', 'control'),
  kind('doorbell', 'sub', 'control', 'control'),
]

describe('every node is routed by what it IS', () => {
  it('sends the synthetic nodes down the source dimension', () => {
    for (const k of ['audio', 'audio-dog', 'sensor', 'contact', 'control', 'doorbell']) {
      const d = TAXONOMY.find((x) => x.kind === k)
      expect(d && nodeDrivesSource(d)).toBe(true)
    }
  })

  it('leaves motion and package on the CLASS dimension, detection or not', () => {
    // They are not `detection`, but they are pipeline rows. Excluding a source
    // for them would name a source that does not exist.
    for (const k of ['motion', 'package', 'person', 'vehicle', 'car', 'animal']) {
      const d = TAXONOMY.find((x) => x.kind === k)
      expect(d && nodeDrivesSource(d)).toBe(false)
    }
  })

  it('reads the taxonomy CATEGORY, so a node added tomorrow routes itself', () => {
    expect(nodeDrivesSource(kind('forklift', 'macro', 'detection'))).toBe(false)
    expect(nodeDrivesSource(kind('glassbreak', 'sub', 'audio', 'audio'))).toBe(true)
  })
})

describe('Sensore and Controllo — two rows, one track source', () => {
  it('both stop the source exclusion, so their rows are fetched at all', () => {
    // The model has ONE `sensor` source under both taxonomy macros: a contact
    // and a doorbell are the same kind of projection.
    expect([...resolveEventsExcludeSources(['sensor', 'contact'], TAXONOMY)]).toEqual(['audio'])
    expect([...resolveEventsExcludeSources(['control', 'doorbell'], TAXONOMY)]).toEqual(['audio'])
  })

  it('and the two are told APART by the class list, which carries the kind', () => {
    // This is the half the source dimension cannot do — hence both, from the
    // same ticks. `contact` and `doorbell` are the rows' own `className`.
    expect(resolveEventsClasses(['sensor', 'contact'], TAXONOMY)).toEqual(['sensor', 'contact'])
    expect(resolveEventsClasses(['control', 'doorbell'], TAXONOMY)).toEqual(['control', 'doorbell'])
  })

  it('excludes `sensor` only when NEITHER row is ticked', () => {
    expect([...resolveEventsExcludeSources(['person'], TAXONOMY)]).toContain('sensor')
    expect([...resolveEventsExcludeSources(['person', 'doorbell'], TAXONOMY)]).not.toContain(
      'sensor',
    )
  })
})

describe('the default is Audio simply not ticked', () => {
  it('ticks every other row the hub advertises', () => {
    const preset = resolveEventsClasses(DEFAULTS.classes, TAXONOMY)
    expect(preset).toContain('person')
    expect(preset).toContain('motion')
    expect(preset).toContain('sensor')
    expect(preset).toContain('control')
    expect(preset).not.toContain('audio')
    expect(preset).not.toContain('audio-dog')
  })

  it('and hides audio through the only dimension that can', () => {
    expect([...resolveEventsExcludeSources(DEFAULTS.classes, TAXONOMY)]).toEqual(['audio'])
  })

  it('is not a rule: unticking nothing else survives a restart', () => {
    expect(parseFilter({ classes: [], v: 2 }).classes).toEqual([])
  })
})

describe('there is no second control', () => {
  const bar = read('components/events/EventsFilterBar.tsx')

  it('the More menu offers no source rows', () => {
    expect(bar).not.toContain("v2.events.eventSources")
    expect(bar).not.toContain('setSourceShown')
    expect(bar).not.toContain('OFFERED_SOURCES')
  })

  it('and contributes nothing to the More chip count', () => {
    expect(bar).not.toContain('filter.hiddenSources.length')
  })

  it('the tree is given the RESOLVED ticks, so the default renders as itself', () => {
    expect(bar).toContain('selected={resolvedClasses}')
    expect(bar).toContain('resolveEventsClasses(filter.classes, eventKinds.data)')
  })

  it('and offers a way BACK to the preset from inside the same control', () => {
    // Without it, restoring the default means re-ticking every row you did not
    // mean to change.
    expect(bar).toContain('onReset={useDefaultClasses}')
  })
})

describe('the chip counts what the operator ticked', () => {
  it('says All when the selection covers every macro', () => {
    const everything = TAXONOMY.map((d) => d.kind)
    expect(summariseSelection(everything, TAXONOMY)).toEqual({ kind: 'all' })
    expect(summariseSelection([], TAXONOMY)).toEqual({ kind: 'all' })
  })

  it('counts MACROS, not the subs a macro toggle swept in', () => {
    // Seven of the eight rows in the screenshot: everything but Audio. A raw
    // length would read "10" here — the subs a macro toggle swept in.
    const preset = resolveEventsClasses(DEFAULTS.classes, TAXONOMY)
    expect(preset).toHaveLength(10)
    expect(summariseSelection(preset, TAXONOMY)).toEqual({ kind: 'narrowed', macros: 7 })
  })

  it('reports the DEFAULT as narrowed — it hides something', () => {
    const preset = resolveEventsClasses(DEFAULTS.classes, TAXONOMY)
    expect(summariseSelection(preset, TAXONOMY).kind).toBe('narrowed')
  })
})

describe('the source vocabulary', () => {
  it('is the hub TrackSource enum', () => {
    expect([...EVENTS_TRACK_SOURCES]).toEqual(['pipeline', 'sensor', 'audio'])
  })

  it('drops a token this build has never heard of', () => {
    expect(isEventsTrackSource('audio')).toBe(true)
    expect(isEventsTrackSource('telepathy')).toBe(false)
  })
})
