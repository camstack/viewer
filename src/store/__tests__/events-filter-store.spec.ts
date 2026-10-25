import { describe, it, expect } from 'vitest'
import {
  DEFAULTS,
  parseFilter,
  resolveEventsClasses,
  resolveEventsExcludeSources,
} from '../events-filter-store.js'
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

/** The eight rows the operator sees under "Classi", plus a sub apiece. */
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

describe('events-filter-store parseFilter', () => {
  it('has no sort: a stored sortMode (importance, anything) is ignored, order is newest first', () => {
    for (const sortMode of ['importance', 'time', 'asc', 'nonsense', 42]) {
      const f = parseFilter({ sortMode })
      expect(f).toEqual(DEFAULTS)
      expect('sortMode' in f).toBe(false)
    }
  })

  it('parses the fields without disturbing them', () => {
    const f = parseFilter({
      cameraIds: [1, 2],
      classes: ['person'],
      label: 'alice',
      sortMode: 'importance', // retired: must not leak
    })
    expect(f).toEqual({
      cameraIds: [1, 2],
      classes: ['person'],
      attributes: [],
      label: 'alice',
      filterDebug: false,
      filterTrain: false,
      filterFavourited: false,
      showStationary: false,
    })
  })

  it('ignores retired feed-only facets in old stored blobs', () => {
    // Blobs persisted before the single-page rework still carry groupingRangeSec
    // + onlyWithClips — they must parse cleanly WITHOUT leaking the old fields.
    const f = parseFilter({
      cameraIds: [3],
      classes: [],
      label: '',
      groupingRangeSec: 30,
      onlyWithClips: true,
    })
    expect(f).toEqual({
      cameraIds: [3],
      // Pre-v2 and empty ⇒ never configured, so the preset. See the migration
      // block below — this blob is exactly the case it exists for.
      classes: null,
      attributes: [],
      label: '',
      filterDebug: false,
      filterTrain: false,
      filterFavourited: false,
      showStationary: false,
    })
  })

  it('defaults the three mark filters to off', () => {
    expect(parseFilter({}).filterDebug).toBe(false)
    expect(parseFilter({}).filterTrain).toBe(false)
    expect(parseFilter({}).filterFavourited).toBe(false)
    expect(DEFAULTS.filterDebug).toBe(false)
    expect(DEFAULTS.filterTrain).toBe(false)
    expect(DEFAULTS.filterFavourited).toBe(false)
  })

  it('accepts each mark filter independently', () => {
    expect(parseFilter({ filterFavourited: true }).filterFavourited).toBe(true)
    expect(parseFilter({ filterFavourited: true }).filterDebug).toBe(false)
    expect(parseFilter({ filterDebug: true, filterTrain: true }).filterTrain).toBe(true)
  })

  it('promotes a stored flaggedOnly blob to all three chips, so nothing vanishes', () => {
    const f = parseFilter({ flaggedOnly: true })
    expect(f.filterDebug).toBe(true)
    expect(f.filterTrain).toBe(true)
    expect(f.filterFavourited).toBe(true)
  })

  it('does not let a boolean-looking string turn a chip on', () => {
    expect(parseFilter({ filterDebug: 'yes' }).filterDebug).toBe(false)
  })

  it('defaults showStationary to false — parked rows stay off the feed', () => {
    expect(parseFilter({}).showStationary).toBe(false)
    expect(DEFAULTS.showStationary).toBe(false)
    expect(parseFilter({ showStationary: 'yes' }).showStationary).toBe(false)
  })

  it('accepts a stored showStationary true without turning the mark chips on', () => {
    const f = parseFilter({ showStationary: true })
    expect(f.showStationary).toBe(true)
    expect(f.filterDebug).toBe(false)
  })

  it('still degrades corrupt input to full DEFAULTS ', () => {
    expect(parseFilter(null)).toEqual(DEFAULTS)
    expect(parseFilter('nope')).toEqual(DEFAULTS)
  })
})

describe('attribute chips', () => {
  it('defaults to an EMPTY selection — no narrowing', () => {
    expect(parseFilter({}).attributes).toEqual([])
    expect(DEFAULTS.attributes).toEqual([])
  })

  it('keeps the attributes it knows', () => {
    expect(parseFilter({ attributes: ['face', 'plate'] }).attributes).toEqual(['face', 'plate'])
  })

  it('DROPS a token this build has never heard of', () => {
    // It would otherwise ride into the embed's config, fail its enum and take
    // the whole patch — classes and search with it — down on the way.
    expect(parseFilter({ attributes: ['face', 'rider', 42] }).attributes).toEqual(['face'])
  })
})


/**
 * The class selection is ONE control over TWO dimensions.
 *
 * The kind tree already listed Audio, Sensor and Control beside the detection
 * macros, so a separate source row in the More menu was a second control
 * answering the same question — the operator expected to hide audio by
 * unticking Audio, and instead found a chip reading "More · 1". The ticks now
 * drive both dimensions and the routing is by taxonomy category, not by a list
 * of names (`nodeDrivesSource`).
 *
 * The default is that selection with Audio simply not ticked. Everything below
 * pins that it is a DEFAULT and not a rule.
 */
describe('events-filter-store — classes as the one filter', () => {
  it('starts on the preset, stored as ABSENT rather than as a list', () => {
    // Materialising today's vocabulary would leave a kind the hub learns next
    // year out of the default forever, silently.
    expect(DEFAULTS.classes).toBeNull()
    expect(parseFilter({}).classes).toBeNull()
  })

  it('resolves the preset to everything the hub advertises EXCEPT audio', () => {
    expect([...resolveEventsClasses(null, TAXONOMY)]).toEqual([
      'motion',
      'person',
      'vehicle',
      'car',
      'animal',
      'package',
      'contact',
      'doorbell',
    ])
  })

  it('hides audio through the SOURCE dimension, which is the only one that can', () => {
    // Those rows carry no accumulated `classes[]`, and the hub's class filter
    // is a superset that keeps every row it cannot read — so a class selection
    // can neither select them nor exclude them.
    expect([...resolveEventsExcludeSources(null, TAXONOMY)]).toEqual(['audio'])
  })

  it('hides audio before the taxonomy has answered', () => {
    // "Everything except audio" cannot contain an audio kind whatever the
    // vocabulary turns out to be, so this half needs no lookup. Deferring it
    // flashes exactly what the default hides on every cold launch.
    expect([...resolveEventsExcludeSources(null, undefined)]).toEqual(['audio'])
    expect(resolveEventsClasses(null, undefined)).toEqual([])
  })

  it('keeps sensor and control VISIBLE by default — only audio was noise', () => {
    const preset = resolveEventsClasses(null, TAXONOMY)
    expect(preset).toContain('contact')
    expect(preset).toContain('doorbell')
    expect([...resolveEventsExcludeSources(null, TAXONOMY)]).not.toContain('sensor')
  })

  it('routes a SENSOR tick to the source dimension, so it can actually select', () => {
    // Ticking Sensore and nothing else: the class list narrows to the sensor
    // kinds and the source filter stops excluding `sensor`. Both are needed —
    // the class list alone cannot exclude an audio row, and the source filter
    // alone cannot tell a contact from a doorbell.
    const sensorOnly = ['sensor', 'contact']
    expect([...resolveEventsExcludeSources(sensorOnly, TAXONOMY)]).toEqual(['audio'])
    expect([...resolveEventsExcludeSources(['control', 'doorbell'], TAXONOMY)]).toEqual(['audio'])
  })

  it('routes an AUDIO tick the same way — ticking it stops the exclusion', () => {
    // Audio is no longer excluded; `sensor` still is, because nothing in this
    // selection reaches it. The exclusion is derived from the ticks each time,
    // not toggled independently — which is why the two can never disagree.
    expect([...resolveEventsExcludeSources(['person', 'audio'], TAXONOMY)]).toEqual(['sensor'])
    expect([...resolveEventsExcludeSources(['person', 'audio', 'contact'], TAXONOMY)]).toEqual([])
  })

  it('excludes BOTH synthetic sources for a purely-detection selection', () => {
    expect([...resolveEventsExcludeSources(['person'], TAXONOMY)]).toEqual(['audio', 'sensor'])
  })

  it('KEEPS an explicit empty selection — the operator unticked everything', () => {
    // `[]` and absent are different answers. Collapsing them re-applies the
    // default over the operator's choice on every launch.
    const stored = { classes: [], v: 2 }
    expect(parseFilter(stored).classes).toEqual([])
    expect(resolveEventsClasses([], TAXONOMY)).toEqual([])
    expect([...resolveEventsExcludeSources([], TAXONOMY)]).toEqual([])
  })

  it('round-trips an explicit selection', () => {
    expect(parseFilter({ classes: ['person', 'audio'], v: 2 }).classes).toEqual([
      'person',
      'audio',
    ])
  })

  it('degrades a malformed value to the preset, not to "show everything"', () => {
    expect(parseFilter({ classes: 'person' }).classes).toBeNull()
    expect(parseFilter({ classes: null }).classes).toBeNull()
  })
})

/**
 * The one-time migration, which is load-bearing.
 *
 * Before `classes` became nullable, an operator who had never narrowed
 * anything stored `classes: []` — which now means "show everything". Read
 * literally, every install that had ever opened the events page would keep
 * audio visible and never see the new default. The blob carries `v` from this
 * change on, so the two empties can be told apart.
 */
describe('events-filter-store — the v2 migration', () => {
  it('reads an EMPTY pre-v2 selection as never-configured', () => {
    expect(parseFilter({ classes: [], cameraIds: [1] }).classes).toBeNull()
  })

  it('leaves a NON-EMPTY pre-v2 selection exactly as the operator left it', () => {
    // Overriding a narrowing they made is worse than a missed default.
    expect(parseFilter({ classes: ['person'] }).classes).toEqual(['person'])
  })

  it('trusts an empty selection written by a build that knew the difference', () => {
    expect(parseFilter({ classes: [], v: 2 }).classes).toEqual([])
  })

  it('ignores a retired hiddenSources key from the first attempt', () => {
    // The source row in More shipped once. A blob that still carries it parses
    // cleanly and the field does not come back.
    const parsed = parseFilter({ classes: ['person'], hiddenSources: ['audio'], v: 2 })
    expect(parsed).not.toHaveProperty('hiddenSources')
    expect(parsed.classes).toEqual(['person'])
  })
})
