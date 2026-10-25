/**
 * The audio condition's pure logic, and — the reason this file exists — the
 * ROUND TRIP.
 *
 * The viewer mirrors the notification-rules cap by hand and Zod strips what the
 * mirror does not declare, so an unmirrored condition field is deleted the
 * first time a rule is saved from the phone. That has happened twice: a whole
 * media policy, then every occupancy condition. `conditions.audio` is mirrored
 * BEFORE any audio rule can exist, and this suite is the proof — remove
 * `audio` from `NcConditionsSchema` and `survives the editor's
 * serialize/deserialize` fails, because `buildConditions` re-parses through
 * that schema on every save.
 *
 * The rest pins the behaviours a plain four-field form would get wrong:
 *  - dBFS is NEGATIVE-GOING (`0` = full scale, `-96` = digital silence), so a
 *    threshold is clamped into `[-96, 0]` and never authored as a positive
 *    "decibel" the engine can never reach;
 *  - naming NEITHER a level nor a label is fail-closed on the hub (every sample
 *    is trivially a hit → it would fire on silence), so the editor can say so;
 *  - `audio-dog` and `dog` are ONE label — a rule authored in the admin UI must
 *    not read as "nothing selected" here.
 */
import { describe, it, expect } from 'vitest'
import {
  NC_AUDIO_DB_MAX,
  NC_AUDIO_DB_MIN,
  NC_AUDIO_DB_OFFERED,
  NC_AUDIO_DEFAULTS,
  NC_AUDIO_HIT_PERCENT_MAX,
  NC_AUDIO_MACRO_LABELS,
  NC_AUDIO_SAMPLING_MAX_SEC,
  audioIsFailClosed,
  audioLabelChoices,
  audioModeOf,
  audioOrDefaults,
  isAudioLabelSelected,
  normalizeAudioLabel,
  patchAudio,
  toggleAudioLabel,
} from '../audio-condition.js'
import { buildConditions, formToInput, inputToForm, emptyRuleForm } from '../rule-editor.js'
import { NcConditionsSchema, NcRuleSchema } from '../../../data/notification-center.js'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import type {
  NcAudioCondition,
  NcConditionDescriptor,
  NcRule,
  NcTaxonomy,
} from '../../../data/notification-center.js'

/** The descriptor the hub serves once an audio rule is authorable (P2). */
const AUDIO_DESCRIPTOR: NcConditionDescriptor = {
  id: 'audio',
  group: 'audio',
  label: 'Sound',
  valueType: 'audio',
  operator: 'anyOf',
  appliesTo: ['immediate'],
  phase: 'P3',
}

const CATALOG: readonly NcConditionDescriptor[] = [
  AUDIO_DESCRIPTOR,
  {
    id: 'devices',
    group: 'scope',
    label: 'Cameras',
    valueType: 'deviceIdList',
    operator: 'in',
    appliesTo: ['immediate', 'track-end'],
    phase: 'P1',
  },
]

/** A rule with an audio condition that uses EVERY field of the schema. */
const AUDIO_CONDITION: NcAudioCondition = {
  labels: ['crying', 'glass_breaking'],
  dbThreshold: -42,
  hitPercent: 75,
  samplingSeconds: 20,
}

describe('the round trip — conditions.audio survives a save from the phone', () => {
  it('survives the editor serialize/deserialize with every field intact', () => {
    const rule: NcRule = NcRuleSchema.parse({
      id: 'rule-1',
      name: 'Baby crying',
      enabled: true,
      delivery: 'immediate',
      conditions: { devices: [102], audio: AUDIO_CONDITION },
      targets: [{ targetId: 't1' }],
      media: { attach: 'best' },
      throttle: { cooldownSec: 60, scope: 'rule-device' },
      priority: 3,
      createdBy: 'u1',
      createdAt: 1,
      updatedAt: 2,
      disabledTargetIds: [],
    })

    // Open it in the editor and save it again, touching nothing.
    const form = inputToForm(rule)
    expect(form.conditions.audio).toEqual(AUDIO_CONDITION)

    const saved = formToInput(form, { ownTargetIds: ['t1'], catalog: CATALOG })
    expect(saved.conditions.audio).toEqual(AUDIO_CONDITION)
    // Not merely present: unchanged, field for field, including the optional
    // filters an unmirrored schema would have quietly dropped.
    expect(saved.conditions.audio?.labels).toEqual(['crying', 'glass_breaking'])
    expect(saved.conditions.audio?.dbThreshold).toBe(-42)
    expect(saved.conditions.audio?.hitPercent).toBe(75)
    expect(saved.conditions.audio?.samplingSeconds).toBe(20)
  })

  it('emits the audio condition through buildConditions (the single funnel)', () => {
    const out = buildConditions({ audio: AUDIO_CONDITION }, 'immediate', CATALOG)
    expect(out.audio).toEqual(AUDIO_CONDITION)
  })

  it('keeps a level-only rule (no labels) and a label-only rule (no level)', () => {
    const levelOnly = buildConditions(
      { audio: { dbThreshold: -30, hitPercent: 60, samplingSeconds: 10 } },
      'immediate',
      CATALOG,
    )
    expect(levelOnly.audio).toEqual({ dbThreshold: -30, hitPercent: 60, samplingSeconds: 10 })

    const labelOnly = buildConditions(
      { audio: { labels: ['dog'], hitPercent: 60, samplingSeconds: 10 } },
      'immediate',
      CATALOG,
    )
    expect(labelOnly.audio).toEqual({ labels: ['dog'], hitPercent: 60, samplingSeconds: 10 })
  })

  it('authors nothing when the form has no audio condition', () => {
    const saved = formToInput(
      { ...emptyRuleForm(), name: 'plain', targetIds: ['t1'] },
      { ownTargetIds: ['t1'], catalog: CATALOG },
    )
    expect('audio' in saved.conditions).toBe(false)
  })
})

describe('the mirrored schema', () => {
  it('accepts the cap shape and applies the cap defaults', () => {
    const parsed = NcConditionsSchema.parse({ audio: { labels: ['scream'] } })
    expect(parsed.audio).toEqual({ labels: ['scream'], hitPercent: 60, samplingSeconds: 10 })
  })

  it('refuses a POSITIVE threshold — dBFS is negative-going, 0 is full scale', () => {
    // "60 dB, quite loud" would be a threshold no sample can ever reach; the
    // rule would look broken rather than mis-configured.
    expect(NcConditionsSchema.safeParse({ audio: { dbThreshold: 60 } }).success).toBe(false)
    expect(NcConditionsSchema.safeParse({ audio: { dbThreshold: -200 } }).success).toBe(false)
    expect(NcConditionsSchema.safeParse({ audio: { dbThreshold: 0 } }).success).toBe(true)
    expect(NcConditionsSchema.safeParse({ audio: { dbThreshold: -96 } }).success).toBe(true)
  })

  it('refuses an out-of-range hit percentage or window', () => {
    expect(NcConditionsSchema.safeParse({ audio: { hitPercent: 0 } }).success).toBe(false)
    expect(NcConditionsSchema.safeParse({ audio: { hitPercent: 101 } }).success).toBe(false)
    expect(NcConditionsSchema.safeParse({ audio: { samplingSeconds: 0 } }).success).toBe(false)
    expect(NcConditionsSchema.safeParse({ audio: { samplingSeconds: 301 } }).success).toBe(false)
  })

  it('refuses an EMPTY label list — absent means any sound, [] means nothing', () => {
    expect(NcConditionsSchema.safeParse({ audio: { labels: [] } }).success).toBe(false)
  })

  it('mirrors the `audio` detection source, so such a rule is not DROPPED', () => {
    // Rules are parsed per rule and a member this build cannot decode drops the
    // WHOLE rule from the phone's list — the operator's own configuration.
    expect(NcConditionsSchema.safeParse({ source: 'audio' }).success).toBe(true)
  })
})

describe('defaults and fail-closed', () => {
  it('offers exactly the cap schema defaults', () => {
    expect(NC_AUDIO_DEFAULTS).toEqual({ hitPercent: 60, samplingSeconds: 10 })
    expect(audioOrDefaults(undefined)).toEqual(NC_AUDIO_DEFAULTS)
    expect(NcConditionsSchema.parse({ audio: NC_AUDIO_DEFAULTS }).audio).toEqual(NC_AUDIO_DEFAULTS)
  })

  it('offers a level floor QUIET enough for the sounds this hub actually hears', () => {
    // Seeding at -96 would need thirty taps to reach a usable threshold, but
    // the offered value used to be -30 and -30 is a TRAP: dBFS is
    // negative-going, so a higher number is a NARROWER filter, and real crying
    // measured on the live installation sits between -55 and -26 dBFS. A floor
    // at -30 rejects most of the very sound the filter was turned on for.
    expect(NC_AUDIO_DB_OFFERED).toBe(-55)
    expect(NC_AUDIO_DB_OFFERED).toBeGreaterThan(NC_AUDIO_DB_MIN)
    expect(NC_AUDIO_DB_OFFERED).toBeLessThan(NC_AUDIO_DB_MAX)
    expect(NC_AUDIO_DB_MIN).toBe(-96)
    expect(NC_AUDIO_DB_MAX).toBe(0)
  })

  it('flags a condition with NEITHER filter — the hub refuses it', () => {
    expect(audioIsFailClosed({ hitPercent: 60, samplingSeconds: 10 })).toBe(true)
    expect(audioIsFailClosed({ dbThreshold: -30, hitPercent: 60, samplingSeconds: 10 })).toBe(false)
    expect(audioIsFailClosed({ labels: ['dog'], hitPercent: 60, samplingSeconds: 10 })).toBe(false)
    // An ABSENT condition is not a broken one — nothing to warn about.
    expect(audioIsFailClosed(undefined)).toBe(false)
  })
})

/**
 * The two EXCLUSIVE modes (server decision D157, 2026-08-14). A rule either
 * NAMES SOUNDS — and fires on the first frame the classifier labels, with no
 * window at all — or NAMES A LEVEL, where the sampling window is the whole
 * condition. The mode is not a stored field: it is which filter the rule
 * carries, so a rule authored before the modes existed migrates for free and
 * there is no second switch that can disagree with the first.
 *
 * This mirrors `@camstack/types` `audioModeOf`; the viewer keeps its own copy
 * for the same reason it keeps its own `patchAudio` (separate toolchain), and
 * this suite is what keeps the copy honest.
 */
describe('audioModeOf — the mode is which filter the rule carries', () => {
  it('reads labels-without-a-threshold as LABEL mode', () => {
    expect(audioModeOf({ labels: ['crying', 'scream'], hitPercent: 60, samplingSeconds: 10 })).toBe(
      'label',
    )
  })

  it('reads a threshold-without-labels as LEVEL mode', () => {
    expect(audioModeOf({ dbThreshold: -55, hitPercent: 60, samplingSeconds: 10 })).toBe('level')
  })

  it('has NO mode when neither filter is named — the engine refuses it', () => {
    expect(audioModeOf({ hitPercent: 60, samplingSeconds: 10 })).toBeNull()
    expect(audioModeOf({ labels: [], hitPercent: 60, samplingSeconds: 10 })).toBeNull()
    expect(audioModeOf(undefined)).toBeNull()
  })

  it('resolves a LEGACY rule carrying BOTH onto LABEL — the mode that fires', () => {
    // Only reachable from a rule authored before the modes existed: neither the
    // editor nor `patchAudio` can produce this any more.
    expect(audioModeOf(AUDIO_CONDITION)).toBe('label')
  })
})

describe('patchAudio — the modes are exclusive at the ONE write path', () => {
  it('choosing sounds clears a stored level floor', () => {
    const level = patchAudio(undefined, { dbThreshold: -55 })
    const labels = patchAudio(level, { labels: ['crying'] })
    expect(labels.labels).toEqual(['crying'])
    expect('dbThreshold' in labels).toBe(false)
    expect(audioModeOf(labels)).toBe('label')
  })

  it('adding a level floor clears the sounds', () => {
    const labelled = patchAudio(undefined, { labels: ['crying'] })
    const level = patchAudio(labelled, { dbThreshold: -55 })
    expect(level.dbThreshold).toBe(-55)
    expect('labels' in level).toBe(false)
    expect(audioModeOf(level)).toBe('level')
  })

  it('switching to LEVEL mode seeds the offered floor so the rule CAN fire', () => {
    // A level rule with no floor is fail-closed; handing the operator a mode
    // that cannot fire is the trap this whole change exists to remove.
    const labelled = patchAudio(undefined, { labels: ['crying'] })
    const level = patchAudio(labelled, { mode: 'level' })
    expect(level.dbThreshold).toBe(NC_AUDIO_DB_OFFERED)
    expect('labels' in level).toBe(false)
    expect(audioIsFailClosed(level)).toBe(false)
  })

  it('switching to LABEL mode keeps the sounds and drops the floor', () => {
    const both = patchAudio(undefined, { labels: ['crying'], dbThreshold: -55 })
    const labelled = patchAudio(both, { mode: 'label' })
    expect(labelled.labels).toEqual(['crying'])
    expect('dbThreshold' in labelled).toBe(false)
  })

  it('normalizes a LEGACY both-filters rule onto the mode that fires, on first touch', () => {
    const patched = patchAudio(AUDIO_CONDITION, {})
    expect(patched.labels).toEqual(AUDIO_CONDITION.labels)
    expect('dbThreshold' in patched).toBe(false)
  })

  it('never emits BOTH filters, whatever the caller asks for', () => {
    // The form must not send both even though the hub would normalize it: a
    // save that writes a window the editor no longer shows is a knob that
    // disagrees with the authority.
    const forced = patchAudio(undefined, { labels: ['dog'], dbThreshold: -55 })
    expect(forced.labels !== undefined && forced.dbThreshold !== undefined).toBe(false)
    expect(NcConditionsSchema.safeParse({ audio: forced }).success).toBe(true)
  })
})

describe('patchAudio', () => {
  it('seeds from the defaults when nothing is stored yet', () => {
    expect(patchAudio(undefined, { labels: ['dog'] })).toEqual({
      labels: ['dog'],
      hitPercent: 60,
      samplingSeconds: 10,
    })
  })

  it('keeps the untouched fields of the mode it is in', () => {
    const labelRule: NcAudioCondition = { labels: ['crying'], hitPercent: 60, samplingSeconds: 10 }
    expect(patchAudio(labelRule, { hitPercent: 90 })).toEqual({ ...labelRule, hitPercent: 90 })
    const levelRule: NcAudioCondition = { dbThreshold: -42, hitPercent: 60, samplingSeconds: 10 }
    expect(patchAudio(levelRule, { samplingSeconds: 30 })).toEqual({
      ...levelRule,
      samplingSeconds: 30,
    })
  })

  it('clamps the threshold into the negative-going dBFS range', () => {
    expect(patchAudio(undefined, { dbThreshold: 12 }).dbThreshold).toBe(0)
    expect(patchAudio(undefined, { dbThreshold: -400 }).dbThreshold).toBe(-96)
    expect(patchAudio(undefined, { dbThreshold: Number.NaN }).dbThreshold).toBe(-96)
  })

  it('clamps the hit percentage and the window to the cap bounds', () => {
    expect(patchAudio(undefined, { hitPercent: 0 }).hitPercent).toBe(1)
    expect(patchAudio(undefined, { hitPercent: 300 }).hitPercent).toBe(NC_AUDIO_HIT_PERCENT_MAX)
    expect(patchAudio(undefined, { samplingSeconds: 0 }).samplingSeconds).toBe(1)
    expect(patchAudio(undefined, { samplingSeconds: 9999 }).samplingSeconds).toBe(
      NC_AUDIO_SAMPLING_MAX_SEC,
    )
  })

  it('OMITS a cleared filter instead of storing an explicit undefined', () => {
    const noLevel = patchAudio(AUDIO_CONDITION, { dbThreshold: undefined })
    expect('dbThreshold' in noLevel).toBe(false)
    const noLabels = patchAudio(AUDIO_CONDITION, { labels: undefined })
    expect('labels' in noLabels).toBe(false)
  })

  it('never stores an empty label array (the schema rejects it)', () => {
    const cleared = patchAudio(AUDIO_CONDITION, { labels: [] })
    expect('labels' in cleared).toBe(false)
    expect(NcConditionsSchema.safeParse({ audio: cleared }).success).toBe(true)
  })

  it('always yields something the mirrored schema accepts', () => {
    const next = patchAudio(undefined, { dbThreshold: 40, hitPercent: -3, samplingSeconds: 1e6 })
    expect(NcConditionsSchema.parse({ audio: next }).audio).toEqual(next)
  })
})

describe('label vocabulary — both spellings are one label', () => {
  it('normalizes the taxonomy namespace away', () => {
    expect(normalizeAudioLabel('audio-dog')).toBe('dog')
    expect(normalizeAudioLabel('dog')).toBe('dog')
  })

  it('reads a rule authored with the taxonomy spelling as SELECTED', () => {
    expect(isAudioLabelSelected(['audio-dog'], 'dog')).toBe(true)
    expect(isAudioLabelSelected(['dog'], 'audio-dog')).toBe(true)
    expect(isAudioLabelSelected(['dog'], 'cat')).toBe(false)
    expect(isAudioLabelSelected(undefined, 'dog')).toBe(false)
  })

  it('toggles off EVERY stored spelling, and clears to undefined not []', () => {
    expect(toggleAudioLabel(['audio-dog', 'cat'], 'dog')).toEqual(['cat'])
    expect(toggleAudioLabel(['audio-dog'], 'dog')).toBeUndefined()
    expect(toggleAudioLabel(undefined, 'dog')).toEqual(['dog'])
    expect(toggleAudioLabel(['dog'], 'cat')).toEqual(['dog', 'cat'])
  })

  it('carries the macro catalog with its icons when the hub sent no taxonomy', () => {
    const { choices } = audioLabelChoices(undefined, undefined)
    expect(choices).toHaveLength(NC_AUDIO_MACRO_LABELS.length)
    expect(choices.find((c) => c.value === 'crying')).toEqual({
      value: 'crying',
      label: 'Crying / Baby',
      icon: '😢',
      unknown: false,
    })
    expect(choices.every((c) => c.icon.length > 0)).toBe(true)
  })

  it('prefers the hub WORDS and keeps the local EMOJI, keyed by macro id', () => {
    const taxonomy: NcTaxonomy = {
      videoClasses: [],
      audioKinds: [
        { kind: 'audio-dog', label: 'Cane', parentKind: 'audio' },
        { kind: 'audio-scream', label: 'Urlo', parentKind: 'audio' },
      ],
      labels: [],
    }
    const { choices } = audioLabelChoices(taxonomy, undefined)
    expect(choices).toEqual([
      { value: 'dog', label: 'Cane', icon: '🐕', unknown: false },
      { value: 'scream', label: 'Urlo', icon: '😱', unknown: false },
    ])
  })

  it('keeps a stored label neither side knows, marked unknown and removable', () => {
    const taxonomy: NcTaxonomy = {
      videoClasses: [],
      audioKinds: [{ kind: 'audio-dog', label: 'Dog', parentKind: 'audio' }],
      labels: [],
    }
    const { choices, unknownLabels } = audioLabelChoices(taxonomy, ['audio-dog', 'audio-chainsaw'])
    expect(unknownLabels).toEqual(['chainsaw'])
    expect(choices.at(-1)).toEqual({
      value: 'chainsaw',
      label: 'chainsaw',
      icon: '🔈',
      unknown: true,
    })
  })
})

describe('i18n — every string the audio widget asks for exists in BOTH locales', () => {
  /** Resolve a dotted i18n key against a locale JSON tree. */
  function lookup(tree: unknown, key: string): string | undefined {
    const value = key.split('.').reduce<unknown>((node, part) => {
      if (node != null && typeof node === 'object' && part in node) {
        return (node as Record<string, unknown>)[part]
      }
      return undefined
    }, tree)
    return typeof value === 'string' ? value : undefined
  }

  const BASE = 'v2.nc.rules.editor.audio'
  const KEYS: readonly string[] = [
    'v2.nc.rules.editor.group.audio',
    'v2.nc.rules.editor.source.audio',
    `${BASE}.modeLabel`,
    `${BASE}.modeLabelOption`,
    `${BASE}.modeLevelOption`,
    `${BASE}.modeLabelHint`,
    `${BASE}.modeLevelHint`,
    `${BASE}.labelsLabel`,
    `${BASE}.labelsHint`,
    `${BASE}.confirmHitsLabel`,
    `${BASE}.confirmHitsHint`,
    `${BASE}.confirmWindowLabel`,
    `${BASE}.confirmWindowHint`,
    `${BASE}.labelsUnknown`,
    `${BASE}.dbLabel`,
    `${BASE}.dbHint`,
    `${BASE}.hitPercentLabel`,
    `${BASE}.hitPercentHint`,
    `${BASE}.samplingLabel`,
    `${BASE}.samplingHint`,
    `${BASE}.failClosedHint`,
    `${BASE}.hint`,
  ]

  it('English', () => {
    expect(KEYS.filter((key) => lookup(enLocale, key) === undefined)).toEqual([])
  })

  it('Italian', () => {
    expect(KEYS.filter((key) => lookup(itLocale, key) === undefined)).toEqual([])
  })

  it('interpolates the values the widget passes', () => {
    expect(lookup(enLocale, `${BASE}.labelsUnknown`)).toContain('{{labels}}')
    expect(lookup(itLocale, `${BASE}.labelsUnknown`)).toContain('{{labels}}')
  })

  it('says a LABEL rule fires at once, with no window at all', () => {
    // The one thing an operator cannot infer from the controls: the window
    // fields are not merely hidden in label mode, they do not apply.
    for (const locale of [enLocale, itLocale]) {
      expect((lookup(locale, `${BASE}.modeLabelHint`) ?? '').length).toBeGreaterThan(40)
    }
  })

  it('states the DEFAULTS the widget starts from', () => {
    // A number field with no stated default reads as an arbitrary choice.
    expect(lookup(enLocale, `${BASE}.hitPercentHint`)).toContain('60')
    expect(lookup(itLocale, `${BASE}.hitPercentHint`)).toContain('60')
    expect(lookup(enLocale, `${BASE}.samplingHint`)).toContain('10')
    expect(lookup(itLocale, `${BASE}.samplingHint`)).toContain('10')
  })

  it('explains that the dBFS scale is negative-going, and states the MEASURED band', () => {
    // The one misreading that authors an unreachable threshold — and the one
    // number that made the shipped default a trap: a higher floor is a
    // NARROWER filter, and real crying on this hub reads −55 to −26 dBFS.
    for (const locale of [enLocale, itLocale]) {
      const hint = lookup(locale, `${BASE}.dbHint`) ?? ''
      expect(hint).toContain('−96')
      expect(hint).toContain('−55')
      expect(hint).toContain('−26')
    }
  })
})
