/**
 * Guard over the kind-picker's three-state decision AND the real wire payload.
 *
 * Two regressions this spec exists to prevent, both from 2026-08-01:
 *
 * 1. The `EventKindTree` extraction shipped verified only against synthetic
 *    descriptors — nothing ever fed the helpers the hub's ACTUAL
 *    `pipelineAnalytics.listEventKinds` rows (which carry extra fields the
 *    viewer's narrowed type does not: `icon`, `source`). `REAL_PAYLOAD` below
 *    is a verbatim capture from the live hub (device 101, 2026-08-01).
 *
 * 2. The picker rendered its flat FALLBACK while the taxonomy query was still
 *    in flight: "loading" and "this hub advertises no kinds" were the same
 *    state (`tree.length === 0`), so every cold open of the timeline filter
 *    showed the lesser list. `resolveEventKindTreeSource` is the pure
 *    three-state decision; the fallback is legal ONLY when the query settled
 *    and produced nothing.
 */
import { describe, it, expect } from 'vitest'
import {
  toEventKindDescriptors,
  buildEventKindTree,
  resolveEventKindTreeSource,
} from '../event-kinds.js'

/** Verbatim `result.data.json` of `pipelineAnalytics.listEventKinds` for
 *  deviceId 101 on the live hub — do NOT prune fields to fit the viewer type;
 *  the extra `icon` / `source` members are part of what this pins. */
const REAL_PAYLOAD: unknown = [
  {"kind":"motion","labelKey":"eventKind.motion","label":"Motion","color":"#f59e0b","iconId":"motion","icon":"motion","category":"motion","parentKind":null,"level":"macro","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"person","labelKey":"eventKind.person","label":"Person","color":"#22c55e","iconId":"person","icon":"person","category":"detection","parentKind":null,"level":"macro","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"vehicle","labelKey":"eventKind.vehicle","label":"Vehicle","color":"#3b82f6","iconId":"vehicle","icon":"vehicle","category":"detection","parentKind":null,"level":"macro","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"bicycle","labelKey":"eventKind.bicycle","label":"Bicycle","color":"#ca8a04","iconId":"bicycle","icon":"generic","category":"detection","parentKind":"vehicle","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"car","labelKey":"eventKind.car","label":"Car","color":"#f59e0b","iconId":"car","icon":"generic","category":"detection","parentKind":"vehicle","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"motorcycle","labelKey":"eventKind.motorcycle","label":"Motorcycle","color":"#eab308","iconId":"motorcycle","icon":"generic","category":"detection","parentKind":"vehicle","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"airplane","labelKey":"eventKind.airplane","label":"Airplane","color":"#60a5fa","iconId":"airplane","icon":"generic","category":"detection","parentKind":"vehicle","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"bus","labelKey":"eventKind.bus","label":"Bus","color":"#b45309","iconId":"bus","icon":"generic","category":"detection","parentKind":"vehicle","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"train","labelKey":"eventKind.train","label":"Train","color":"#1d4ed8","iconId":"train","icon":"generic","category":"detection","parentKind":"vehicle","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"truck","labelKey":"eventKind.truck","label":"Truck","color":"#d97706","iconId":"truck","icon":"generic","category":"detection","parentKind":"vehicle","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"boat","labelKey":"eventKind.boat","label":"Boat","color":"#2563eb","iconId":"boat","icon":"generic","category":"detection","parentKind":"vehicle","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"animal","labelKey":"eventKind.animal","label":"Animal","color":"#f97316","iconId":"animal","icon":"animal","category":"detection","parentKind":null,"level":"macro","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"bird","labelKey":"eventKind.bird","label":"Bird","color":"#14b8a6","iconId":"bird","icon":"generic","category":"detection","parentKind":"animal","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"cat","labelKey":"eventKind.cat","label":"Cat","color":"#f97316","iconId":"cat","icon":"generic","category":"detection","parentKind":"animal","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"dog","labelKey":"eventKind.dog","label":"Dog","color":"#84cc16","iconId":"dog","icon":"generic","category":"detection","parentKind":"animal","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"horse","labelKey":"eventKind.horse","label":"Horse","color":"#a16207","iconId":"horse","icon":"generic","category":"detection","parentKind":"animal","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"sheep","labelKey":"eventKind.sheep","label":"Sheep","color":"#a3a3a3","iconId":"sheep","icon":"generic","category":"detection","parentKind":"animal","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"cow","labelKey":"eventKind.cow","label":"Cow","color":"#78716c","iconId":"cow","icon":"generic","category":"detection","parentKind":"animal","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"elephant","labelKey":"eventKind.elephant","label":"Elephant","color":"#6b7280","iconId":"elephant","icon":"generic","category":"detection","parentKind":"animal","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"bear","labelKey":"eventKind.bear","label":"Bear","color":"#7c2d12","iconId":"bear","icon":"generic","category":"detection","parentKind":"animal","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"zebra","labelKey":"eventKind.zebra","label":"Zebra","color":"#404040","iconId":"zebra","icon":"generic","category":"detection","parentKind":"animal","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"giraffe","labelKey":"eventKind.giraffe","label":"Giraffe","color":"#d4a373","iconId":"giraffe","icon":"generic","category":"detection","parentKind":"animal","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio","labelKey":"eventKind.audio","label":"Audio","color":"#06b6d4","iconId":"audio","icon":"audio","category":"audio","parentKind":null,"level":"macro","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-speech","labelKey":"eventKind.audio-speech","label":"Speech","color":"#06b6d4","iconId":"audio-speech","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-scream","labelKey":"eventKind.audio-scream","label":"Scream / Shout","color":"#06b6d4","iconId":"audio-scream","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-crying","labelKey":"eventKind.audio-crying","label":"Crying / Baby","color":"#06b6d4","iconId":"audio-crying","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-laughter","labelKey":"eventKind.audio-laughter","label":"Laughter","color":"#06b6d4","iconId":"audio-laughter","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-music","labelKey":"eventKind.audio-music","label":"Music","color":"#06b6d4","iconId":"audio-music","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-dog","labelKey":"eventKind.audio-dog","label":"Dog","color":"#06b6d4","iconId":"audio-dog","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-cat","labelKey":"eventKind.audio-cat","label":"Cat","color":"#06b6d4","iconId":"audio-cat","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-bird","labelKey":"eventKind.audio-bird","label":"Bird","color":"#06b6d4","iconId":"audio-bird","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-animal","labelKey":"eventKind.audio-animal","label":"Animal (other)","color":"#06b6d4","iconId":"audio-animal","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-alarm","labelKey":"eventKind.audio-alarm","label":"Alarm / Siren","color":"#06b6d4","iconId":"audio-alarm","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-doorbell","labelKey":"eventKind.audio-doorbell","label":"Doorbell / Knock","color":"#06b6d4","iconId":"audio-doorbell","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-glass_breaking","labelKey":"eventKind.audio-glass_breaking","label":"Glass Breaking","color":"#06b6d4","iconId":"audio-glass_breaking","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-gunshot","labelKey":"eventKind.audio-gunshot","label":"Gunshot / Explosion","color":"#06b6d4","iconId":"audio-gunshot","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-vehicle","labelKey":"eventKind.audio-vehicle","label":"Vehicle","color":"#06b6d4","iconId":"audio-vehicle","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-siren","labelKey":"eventKind.audio-siren","label":"Emergency Siren","color":"#06b6d4","iconId":"audio-siren","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-fire","labelKey":"eventKind.audio-fire","label":"Fire / Smoke","color":"#06b6d4","iconId":"audio-fire","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-water","labelKey":"eventKind.audio-water","label":"Water","color":"#06b6d4","iconId":"audio-water","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-wind","labelKey":"eventKind.audio-wind","label":"Wind / Weather","color":"#06b6d4","iconId":"audio-wind","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-door","labelKey":"eventKind.audio-door","label":"Door","color":"#06b6d4","iconId":"audio-door","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-footsteps","labelKey":"eventKind.audio-footsteps","label":"Footsteps","color":"#06b6d4","iconId":"audio-footsteps","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-crowd","labelKey":"eventKind.audio-crowd","label":"Crowd / Chatter","color":"#06b6d4","iconId":"audio-crowd","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-telephone","labelKey":"eventKind.audio-telephone","label":"Telephone","color":"#06b6d4","iconId":"audio-telephone","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-engine","labelKey":"eventKind.audio-engine","label":"Engine / Motor","color":"#06b6d4","iconId":"audio-engine","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-tools","labelKey":"eventKind.audio-tools","label":"Tools / Construction","color":"#06b6d4","iconId":"audio-tools","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"audio-silence","labelKey":"eventKind.audio-silence","label":"Silence","color":"#06b6d4","iconId":"audio-silence","icon":"generic","category":"audio","parentKind":"audio","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"package","labelKey":"eventKind.package","label":"Package","color":"#a855f7","iconId":"package","icon":"package","category":"package","parentKind":null,"level":"macro","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"package-delivered","labelKey":"eventKind.package-delivered","label":"Package delivered","color":"#a855f7","iconId":"package","icon":"package","category":"package","parentKind":"package","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"package-picked-up","labelKey":"eventKind.package-picked-up","label":"Package picked up","color":"#a855f7","iconId":"package","icon":"package","category":"package","parentKind":"package","level":"sub","source":{"capName":"pipeline-analytics","deviceId":101}},
  {"kind":"switch","labelKey":"eventKind.switch","label":"Switch","color":"#10b981","iconId":"switch","icon":"generic","category":"control","parentKind":"control","level":"sub","source":{"capName":"switch","deviceId":616}},]

describe('real listEventKinds payload → descriptors', () => {
  it('narrows all 52 rows (6 macros, 46 subs) — none silently dropped', () => {
    const descs = toEventKindDescriptors(REAL_PAYLOAD)
    expect(descs).toHaveLength(52)
    expect(descs.filter((d) => d.level === 'macro')).toHaveLength(6)
    expect(descs.filter((d) => d.level === 'sub')).toHaveLength(46)
  })

  it('builds the macro→sub tree the panels render, with the detection macros present', () => {
    const tree = buildEventKindTree(toEventKindDescriptors(REAL_PAYLOAD))
    const macros = tree.map((n) => n.macro.kind)
    expect(macros).toContain('person')
    expect(macros).toContain('vehicle')
    expect(macros).toContain('animal')
    const vehicle = tree.find((n) => n.macro.kind === 'vehicle')
    expect(vehicle?.subs.map((s) => s.kind)).toContain('car')
    const animal = tree.find((n) => n.macro.kind === 'animal')
    expect(animal?.subs.length).toBeGreaterThan(0)
  })
})

describe('resolveEventKindTreeSource — loading is NOT fallback', () => {
  it('undefined descriptors (query in flight) → loading, never the fallback', () => {
    expect(resolveEventKindTreeSource(undefined)).toEqual({ state: 'loading' })
  })

  it('settled with the real payload → the taxonomy tree', () => {
    const source = resolveEventKindTreeSource(toEventKindDescriptors(REAL_PAYLOAD))
    expect(source.state).toBe('taxonomy')
    if (source.state === 'taxonomy') {
      expect(source.tree.length).toBeGreaterThanOrEqual(6)
    }
  })

  it('settled EMPTY (hub advertises no kinds) → fallback, the only legal case', () => {
    expect(resolveEventKindTreeSource([])).toEqual({ state: 'fallback' })
  })
})

/**
 * 2026-09-11, camera 101 on the live hub: `listEventKinds` advertised motion,
 * audio, package and the linked sensors — and NOT ONE detection class — while
 * `listTracks` for the same 24 h held 95 `person`, 48 `vehicle` and 30
 * `animal`. The hub infers "detection enabled" from a momentary
 * `getCameraStatus.detection`, which was `null`. The tree trusted the
 * taxonomy over the rows on screen: a class the operator could SEE on the
 * timeline could not be ticked in its filter ("ce ne sono solo alcune").
 *
 * The observed classes travel as the second argument — the same set the
 * fallback branch already renders — and any of them the taxonomy does not
 * name becomes a macro row of its own. A class the taxonomy DOES name, as a
 * macro or under one, is not duplicated.
 */
describe('resolveEventKindTreeSource — observed classes the taxonomy omits', () => {
  /** The hub's answer for 101 on 2026-09-11 in shape: no detection macros. */
  const NO_DETECTION_TAXONOMY = toEventKindDescriptors(REAL_PAYLOAD).filter(
    (d) => d.category !== 'detection',
  )

  it('adds an observed class the taxonomy does not name, as its own macro row', () => {
    const source = resolveEventKindTreeSource(NO_DETECTION_TAXONOMY, ['person', 'vehicle', 'animal'])
    expect(source.state).toBe('taxonomy')
    if (source.state !== 'taxonomy') return
    const macros = source.tree.map((n) => n.macro.kind)
    expect(macros).toEqual(expect.arrayContaining(['person', 'vehicle', 'animal']))
    // Still a taxonomy row: labelled through the locale key, never the raw id.
    const person = source.tree.find((n) => n.macro.kind === 'person')
    expect(person?.macro.labelKey).toBe('eventKind.person')
    expect(person?.macro.level).toBe('macro')
    expect(person?.subs).toEqual([])
  })

  it('does not duplicate a class the taxonomy already names, as a macro or a sub', () => {
    const full = toEventKindDescriptors(REAL_PAYLOAD)
    const source = resolveEventKindTreeSource(full, ['person', 'car', 'audio-dog'])
    expect(source.state).toBe('taxonomy')
    if (source.state !== 'taxonomy') return
    expect(source.tree).toEqual(buildEventKindTree(full))
  })

  it('keeps the observed rows AFTER the advertised ones — the lanes render in that order', () => {
    const source = resolveEventKindTreeSource(NO_DETECTION_TAXONOMY, ['person'])
    if (source.state !== 'taxonomy') throw new Error(source.state)
    expect(source.tree[source.tree.length - 1]?.macro.kind).toBe('person')
  })

  it('an EMPTY taxonomy stays the fallback even with observed classes — that branch renders them already', () => {
    expect(resolveEventKindTreeSource([], ['person'])).toEqual({ state: 'fallback' })
  })

  it('a query still in flight stays loading — observed classes are no substitute for an answer', () => {
    expect(resolveEventKindTreeSource(undefined, ['person'])).toEqual({ state: 'loading' })
  })
})
