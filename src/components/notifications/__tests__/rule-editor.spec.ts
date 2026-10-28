import { describe, it, expect } from 'vitest'
import {
  NC_GROUPING_DEFAULT_SEC,
  NC_GROUPING_MAX_SEC,
  NC_GROUPING_MIN_SEC,
  NC_SYSTEM_EVENT_CLASS_SPECS,
  NC_SYSTEM_EVENT_FAMILY_FILTERS,
} from '@camstack/types/client'
import {
  NC_CONDITION_CATALOG,
  NC_AUTHORABLE_SYSTEM_EVENT_KINDS,
  NC_SYSTEM_EVENT_FAMILIES,
  NC_SYSTEM_EVENT_FAMILY,
  NC_SYSTEM_EVENT_FILTER_KEYS,
  systemEventFilterApplies,
  type NcSystemEventFilterKey,
} from '@camstack/types'
import type {
  NcConditionDescriptor,
  NcConditions,
  NcRule,
  NcRuleInput,
} from '../../../data/notification-center.js'
import {
  NC_SNOOZE_MAX_MINUTES,
  NcConditionDescriptorSchema,
  NcConditionsSchema,
  NcMediaPolicySchema,
  NcRuleSchema,
  NcSystemEventKindSchema,
} from '../../../data/notification-center.js'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import {
  applyDeliveryChoice,
  deliveryChoiceOf,
  deliveryChoicesFor,
  emptyRuleForm,
  formToInput,
  inputToForm,
  verdictApplies,
  isRuleFormValid,
  ruleFormProblems,
  buildConditions,
  isConditionValueEmpty,
  isStringListKey,
  isNumber01Key,
  readStringList,
  readNumber01,
  NC_STRING_LIST_KEYS,
  NC_NUMBER01_KEYS,
  NC_DELIVERY_OPTIONS,
  parseMediaImage,
  parseMediaProfile,
  NC_DEVICE_TYPE_OPTIONS,
  pruneMediaPolicy,
  ruleClearsFor,
  type NcRuleFormState,
  type NcSystemEventFilterVisibility,
} from '../rule-editor.js'
import { familyFilterVisibility, systemEventKindGroupsForFamily } from '../system-event-family.js'
import { confirmToForm } from '../rule-confirm-form.js'
import { NC_ACTIONS_EMPTY_FORM } from '../rule-action-form.js'
import { ruleScopeDraftOf } from '../rule-scope-model.js'
import { splitRuleScopes } from '../rule-scope-form.js'

/**
 * Every kind the family editors make REACHABLE on an instant rule
 * (`SystemEventField` renders exactly `systemEventKindGroupsForFamily`), across
 * the three families: what ticking each chip WRITES — a one-edge kind, or both
 * edges of a paired class (D906). The oracle it is held to is the hub's
 * `NC_AUTHORABLE_SYSTEM_EVENT_KINDS`.
 */
const DRAWN_SYSTEM_EVENT_KINDS: readonly string[] = NC_SYSTEM_EVENT_FAMILIES.flatMap((family) =>
  systemEventKindGroupsForFamily(family, undefined).flatMap((group) =>
    group.options.flatMap((option) => option.writes),
  ),
)

/** A dotted locale key's string, or `undefined` when absent. */
function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return typeof node === 'string' ? node : undefined
}

/** Every class chip of every family, instant wording — the class ids drawn. */
const DRAWN_CLASS_IDS: readonly string[] = NC_SYSTEM_EVENT_FAMILIES.flatMap((family) =>
  systemEventKindGroupsForFamily(family, undefined).flatMap((group) =>
    group.options.flatMap((option) => (option.classId !== undefined ? [option.classId] : [])),
  ),
)

/** A minimal catalog covering the value-types the assertions exercise. */
const CATALOG: readonly NcConditionDescriptor[] = [
  {
    id: 'classes',
    group: 'class',
    label: 'Classes',
    valueType: 'stringList',
    operator: 'in',
    appliesTo: ['immediate', 'track-end'],
    phase: 'root',
  },
  {
    id: 'minConfidence',
    group: 'quality',
    label: 'Min confidence',
    valueType: 'number01',
    operator: 'gte',
    appliesTo: ['immediate', 'track-end'],
    phase: 'root',
  },
  {
    id: 'customZones',
    group: 'zones',
    label: 'Drawn zones',
    valueType: 'polygonDraw',
    operator: 'anyOf',
    appliesTo: ['immediate', 'track-end'],
    phase: 'root',
  },
  {
    id: 'minImportance',
    group: 'quality',
    label: 'Min importance',
    valueType: 'number01',
    operator: 'gte',
    appliesTo: ['track-end'],
    phase: 'track-end',
  },
]

/** The hub's own `zones` descriptor — what lets a zone condition survive the save. */
const ZONES_CATALOG: readonly NcConditionDescriptor[] = NC_CONDITION_CATALOG.filter((d) => d.id === 'zones').map((d) =>
  NcConditionDescriptorSchema.parse(d),
)

function makeForm(overrides: Partial<NcRuleFormState> = {}): NcRuleFormState {
  return { ...emptyRuleForm(), ...overrides }
}

describe('formToInput', () => {
  it('wires system-event delivery and preserves its typed filters', () => {
    const systemCatalog: readonly NcConditionDescriptor[] = [
      {
        id: 'systemEvent',
        group: 'system',
        label: 'System event',
        valueType: 'systemEvent',
        operator: 'in',
        appliesTo: ['system-event'],
        phase: 'P1',
      },
    ]
    const input = formToInput(
      makeForm({
        name: 'Node down',
        delivery: 'system-event',
        targetIds: ['tgt-a'],
        conditions: {
          systemEvent: { kinds: ['node-offline'], nodeIds: ['agent-a'] },
        },
      }),
      { ownTargetIds: ['tgt-a'], catalog: systemCatalog },
    )
    expect(input.delivery).toBe('system-event')
    expect(input.conditions.systemEvent).toEqual({
      kinds: ['node-offline'],
      nodeIds: ['agent-a'],
    })
    expect(input.media).toEqual({ image: 'none' })
  })
  it('emits conditions.customZones when a polygon is present', () => {
    const form = makeForm({
      name: 'Backyard people',
      targetIds: ['tgt-a'],
      conditions: {
        customZones: [{ kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }],
      },
      classScope: ruleScopeDraftOf(['person'], undefined),
    })
    const input = formToInput(form, { ownTargetIds: ['tgt-a'], catalog: CATALOG })
    expect(input.conditions.customZones).toEqual([
      { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] },
    ])
    expect(input.conditions.classes).toEqual(['person'])
  })

  it('includes ONLY condition groups that carry a value (empties pruned)', () => {
    const form = makeForm({
      name: 'r',
      targetIds: ['tgt-a'],
      conditions: {
        customZones: [], // empty → dropped
        minConfidence: 0.6,
      },
      // An emptied exclusion beside a chosen list writes no `classesExclude`.
      classScope: ruleScopeDraftOf(['car'], []),
    })
    const input = formToInput(form, { ownTargetIds: ['tgt-a'], catalog: CATALOG })
    expect(Object.keys(input.conditions).sort()).toEqual(['classes', 'minConfidence'])
    expect(input.conditions.customZones).toBeUndefined()
    expect(input.conditions.classesExclude).toBeUndefined()
  })

  it('drops conditions whose descriptor does not apply to the chosen delivery', () => {
    const form = makeForm({
      name: 'r',
      delivery: 'immediate',
      targetIds: ['tgt-a'],
      conditions: { minImportance: 0.4 },
      classScope: ruleScopeDraftOf(['person'], undefined),
    })
    // minImportance only appliesTo track-end → dropped for an immediate rule.
    const input = formToInput(form, { ownTargetIds: ['tgt-a'], catalog: CATALOG })
    expect(input.conditions.minImportance).toBeUndefined()
    expect(input.conditions.classes).toEqual(['person'])
  })

  it('constrains targets to the provided own-target list (drops foreign/unknown ids)', () => {
    const form = makeForm({
      name: 'r',
      targetIds: ['tgt-a', 'tgt-foreign', 'tgt-b'],
    })
    const input = formToInput(form, { ownTargetIds: ['tgt-a', 'tgt-b'], catalog: CATALOG })
    expect(input.targets.map((t) => t.targetId)).toEqual(['tgt-a', 'tgt-b'])
  })

  it('never stamps ownerUserId (server-derived)', () => {
    const form = makeForm({ name: 'r', targetIds: ['tgt-a'] })
    const input = formToInput(form, { ownTargetIds: ['tgt-a'] })
    expect('ownerUserId' in input).toBe(false)
  })

  it('omits the template when both title and body are blank, includes it otherwise', () => {
    const bare = formToInput(makeForm({ name: 'r', targetIds: ['tgt-a'] }), { ownTargetIds: ['tgt-a'] })
    expect(bare.template).toBeUndefined()
    const templated = formToInput(
      makeForm({ name: 'r', targetIds: ['tgt-a'], templateTitle: 'Hi {{camera}}' }),
      { ownTargetIds: ['tgt-a'] },
    )
    expect(templated.template).toEqual({ title: 'Hi {{camera}}' })
  })
})

describe('inputToForm round-trip', () => {
  const rule: NcRule = {
    id: 'rule-1',
    name: 'Front door people',
    enabled: true,
    delivery: 'immediate',
    conditions: {
      classes: ['person'],
      minConfidence: 0.7,
      customZones: [{ kind: 'polygon', points: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }] }],
    },
    targets: [{ targetId: 'tgt-a' }, { targetId: 'tgt-b', params: { sound: 'ping' } }],
    media: { attach: 'best-matching' },
    throttle: { cooldownSec: 120, scope: 'rule' },
    priority: 4,
    template: { title: 'T', body: 'B' },
    createdBy: 'me',
    createdAt: 10,
    updatedAt: 20,
    disabledTargetIds: [],
  }

  it('hydrates a form and rebuilds an equivalent input', () => {
    const form = inputToForm(rule)
    const back = formToInput(form, {
      ownTargetIds: ['tgt-a', 'tgt-b'],
      catalog: CATALOG,
      preserve: { throttle: rule.throttle },
    })
    expect(back.name).toBe('Front door people')
    expect(back.delivery).toBe('immediate')
    expect(back.priority).toBe(4)
    // A legacy `best-matching` reads as the subject crop (D897) and is saved as it.
    expect(back.media).toEqual({ image: 'crop' })
    expect(back.throttle).toEqual({ cooldownSec: 120, scope: 'rule' })
    expect(back.template).toEqual({ title: 'T', body: 'B' })
    expect(back.conditions.classes).toEqual(['person'])
    expect(back.conditions.minConfidence).toBe(0.7)
    expect(back.conditions.customZones).toEqual(rule.conditions.customZones)
    // per-target params are preserved verbatim across the round-trip.
    expect(back.targets).toEqual([{ targetId: 'tgt-a' }, { targetId: 'tgt-b', params: { sound: 'ping' } }])
  })

  it('round-trips the FULL media policy — the fields the editor used to wipe', () => {
    // The regression this guards: `formToInput` emitted `{ attach }` only, so a
    // rule authored with a gif/clip lost them on every save from the app.
    // Remove the media handling in `formToInput` and this fails.
    const rich: NcRule = {
      ...rule,
      media: {
        image: 'scene-boxes',
        gif: true,
        clip: true,
        clipPreRollSec: 5,
        clipPostRollSec: 12,
        profile: 'low',
      },
    }
    const back = formToInput(inputToForm(rich), {
      ownTargetIds: ['tgt-a', 'tgt-b'],
      catalog: CATALOG,
      preserve: { throttle: rich.throttle },
    })
    expect(back.media).toEqual(rich.media)
  })

  it('a LEGACY media triple is saved as the mode it meant — never written back (D897)', () => {
    const legacy: NcRule = {
      ...rule,
      conditions: { ...rule.conditions, zones: { ids: ['z-porch'] } },
      media: { attach: 'keyFrame', frame: 'full', zoneCrop: true, gif: true },
    }
    const back = formToInput(inputToForm(legacy), {
      ownTargetIds: ['tgt-a', 'tgt-b'],
      catalog: [...CATALOG, ...ZONES_CATALOG],
      preserve: { throttle: legacy.throttle },
    })
    expect(back.conditions.zones).toEqual({ ids: ['z-porch'] })
    // `zoneCrop` on a zone rule = the clean scene with the trigger zone drawn.
    expect(back.media).toEqual({ image: 'clean', showTriggerZone: true, gif: true })
    expect(back.media).not.toHaveProperty('attach')
    expect(back.media).not.toHaveProperty('frame')
    expect(back.media).not.toHaveProperty('zoneCrop')
  })

  // ── System events: the vocabulary the hub changed under the app ──────────
  //
  // `formToInput` re-emits `conditions` as a FULL replacement, so a field the
  // mirror does not know is not merely unrendered — it is GONE the first time
  // the operator saves. These three fix that at the seam that would lose it.

  const SYSTEM_CATALOG: readonly NcConditionDescriptor[] = [
    {
      id: 'systemEvent',
      group: 'system',
      label: 'System event',
      valueType: 'systemEvent',
      operator: 'in',
      appliesTo: ['system-event'],
      phase: 'P1',
    },
  ]

  function systemRule(systemEvent: NcConditions['systemEvent']): NcRule {
    return {
      ...rule,
      name: 'Installation',
      delivery: 'system-event',
      conditions: { systemEvent },
      media: { attach: 'none' },
    }
  }

  function roundTrip(source: NcRule): NcRuleInput {
    return formToInput(inputToForm(source), {
      ownTargetIds: ['tgt-a', 'tgt-b'],
      catalog: SYSTEM_CATALOG,
      preserve: { throttle: source.throttle },
    })
  }

  it('round-trips a generic device-liveness rule WITH its device-type filter', () => {
    const source = systemRule({ kinds: ['device-offline'], deviceTypes: ['camera'] })
    // Parsed through the mirror first: `deviceTypes` unmirrored means the field
    // never survives being READ, let alone written back.
    expect(NcRuleSchema.parse(source).conditions.systemEvent).toEqual({
      kinds: ['device-offline'],
      deviceTypes: ['camera'],
    })
    expect(roundTrip(source).conditions.systemEvent).toEqual({
      kinds: ['device-offline'],
      deviceTypes: ['camera'],
    })
  })

  it('round-trips an alarm rule', () => {
    const source = systemRule({ kinds: ['alarm-triggered'], deviceIds: [102] })
    expect(roundTrip(source).conditions.systemEvent).toEqual({
      kinds: ['alarm-triggered'],
      deviceIds: [102],
    })
  })

  it('still parses — and does not gut — a rule on the legacy camera kinds', () => {
    // An unmigrated rule must survive being opened. A kind that fails to parse
    // does not cost the condition one field, it costs the operator the WHOLE
    // rule: it simply vanishes from the list on the phone.
    const source = systemRule({ kinds: ['camera-offline'], deviceIds: [102] })
    const parsed = NcRuleSchema.safeParse(source)
    expect(parsed.success).toBe(true)
    expect(roundTrip(source).conditions.systemEvent).toEqual({
      kinds: ['camera-offline'],
      deviceIds: [102],
    })
  })

  it('preserves a cooldown granularity the app has no control for (the cooldown itself is authored)', () => {
    // `formToInput` re-emits the whole throttle, so an unmirrored sub-field is
    // read off and written back missing — the media-policy wipe again.
    const source: NcRule = {
      ...rule,
      throttle: { cooldownSec: 120, scope: 'rule', granularity: 'per-class' },
    }
    const back = formToInput(inputToForm(source), {
      ownTargetIds: ['tgt-a', 'tgt-b'],
      catalog: CATALOG,
      preserve: { throttle: NcRuleSchema.parse(source).throttle },
    })
    expect(back.throttle).toEqual({ cooldownSec: 120, scope: 'rule', granularity: 'per-class' })
  })

  it('round-trips the rule’s snooze buttons through the form', () => {
    // The strip-on-save trap: `snoozeOptions` is absent-means-"the hub decides",
    // so a save from the phone that drops it does not merely lose a field — it
    // silently re-points the rule at whatever the hub's default is today.
    // Remove the `snoozeOptions` spread in `formToInput` and this fails.
    const source: NcRule = { ...rule, snoozeOptions: [5, 45] }
    const parsed = NcRuleSchema.parse(source)
    expect(parsed.snoozeOptions).toEqual([5, 45])
    const back = formToInput(inputToForm(source), {
      ownTargetIds: ['tgt-a', 'tgt-b'],
      catalog: CATALOG,
      preserve: { throttle: parsed.throttle },
    })
    expect(back.snoozeOptions).toEqual([5, 45])
  })

  it('keeps "no snooze buttons" as an EMPTY list, never promoted back to absent', () => {
    // The three states are distinct on this field: absent = the hub decides,
    // `[]` = the operator removed the buttons, a list = these choices. A
    // preserve step that tests truthiness instead of `!== undefined` collapses
    // `[]` into absent — and the notification silently grows three buttons back.
    const source: NcRule = { ...rule, snoozeOptions: [] }
    const back = formToInput(inputToForm(source), {
      ownTargetIds: ['tgt-a', 'tgt-b'],
      catalog: CATALOG,
      preserve: { throttle: rule.throttle },
    })
    expect(back.snoozeOptions).toEqual([])
  })

  it('leaves the choice to the hub for a rule that never named its buttons', () => {
    // Absence must stay absence — writing today's default in is how "the hub
    // decides" becomes "this rule froze 10/30/60 the day a phone saved it".
    const back = formToInput(inputToForm(rule), {
      ownTargetIds: ['tgt-a', 'tgt-b'],
      catalog: CATALOG,
      preserve: { throttle: rule.throttle },
    })
    expect('snoozeOptions' in back).toBe(false)
  })

  it('refuses a snooze-button list the hub would reject', () => {
    // The mirror carries the cap's bounds, so an over-long or out-of-range list
    // is caught at the parse boundary rather than by a rejected save.
    expect(NcRuleSchema.safeParse({ ...rule, snoozeOptions: [10, 20, 30, 40, 50] }).success).toBe(
      false,
    )
    expect(NcRuleSchema.safeParse({ ...rule, snoozeOptions: [0] }).success).toBe(false)
    expect(
      NcRuleSchema.safeParse({ ...rule, snoozeOptions: [NC_SNOOZE_MAX_MINUTES + 1] }).success,
    ).toBe(false)
  })
})

describe('media.linkedCameras is a SENSOR rule\'s knob (ADR 0632)', () => {
  const opts = { ownTargetIds: ['tgt-a'], catalog: CATALOG }
  const sensorForm = (): NcRuleFormState =>
    makeForm({ name: 'Porta', delivery: 'device-event', targetIds: ['tgt-a'], conditions: {} })

  it('keeps linkedCameras for a sensor rule and drops it for any other kind', () => {
    const sensor = { ...sensorForm(), media: { linkedCameras: 'each' as const } }
    expect(formToInput(sensor, opts).media.linkedCameras).toBe('each')
    const detection = makeForm({
      name: 'Vialetto',
      delivery: 'track-end',
      targetIds: ['tgt-a'],
      media: { linkedCameras: 'each' },
    })
    expect(formToInput(detection, opts).media).not.toHaveProperty('linkedCameras')
  })

  it('a sensor rule that attaches nothing writes none of it', () => {
    const form = { ...sensorForm(), media: { image: 'none' as const, linkedCameras: 'each' as const } }
    expect(formToInput(form, opts).media).toEqual({ image: 'none' })
  })

  it('a stored sensor rule round-trips it through the form', () => {
    const stored = NcRuleSchema.parse({
      id: 'r-sensor',
      name: 'Porta',
      enabled: true,
      delivery: 'device-event',
      conditions: {},
      targets: [{ targetId: 'tgt-a' }],
      media: { attach: 'best', linkedCameras: 'each' },
      throttle: { cooldownSec: 60, scope: 'rule-device' },
      priority: 3,
      createdBy: 'admin',
      createdAt: 1,
      updatedAt: 2,
      disabledTargetIds: [],
    })
    // A sensor rule written before D897 shipped one clean snapshot whatever it
    // stored, so that is what it reads as (the hub's migration, mirrored).
    expect(formToInput(inputToForm(stored), opts).media).toEqual({ image: 'clean', linkedCameras: 'each' })
  })

  it('the mirror parses a rule that carries it (the hub would otherwise be stripped on read)', () => {
    expect(NcMediaPolicySchema.parse({ attach: 'best', linkedCameras: 'mosaic' }).linkedCameras).toBe('mosaic')
  })
})

describe('media policy — absence IS the default', () => {
  const detection = { kind: 'detection' as const, conditions: {} }
  const zoned = { kind: 'detection' as const, conditions: { zones: { ids: ['z1'] } } }

  it('prunes every field that equals its absent-means-default, and always names the picture', () => {
    // An untouched policy is the kind's own default mode, written explicitly.
    expect(pruneMediaPolicy({}, detection)).toEqual({ image: 'crop' })
    // A toggle turned back off writes nothing, not `false`.
    expect(pruneMediaPolicy({ image: 'crop', gif: false, clip: false, showTriggerZone: false }, detection)).toEqual({
      image: 'crop',
    })
    // 3 / 7 are the roll defaults; 2x the speed default.
    expect(pruneMediaPolicy({ gif: true, clipPreRollSec: 3, clipPostRollSec: 7 }, detection)).toEqual({
      image: 'crop',
      gif: true,
    })
    expect(pruneMediaPolicy({ clip: true, clipSpeed: 2 }, detection)).toEqual({ image: 'crop', clip: true })
  })

  it('keeps a value the operator actually moved off its default', () => {
    expect(pruneMediaPolicy({ image: 'scene-boxes' }, detection)).toEqual({ image: 'scene-boxes' })
    expect(pruneMediaPolicy({ image: 'clean', showTriggerZone: true }, zoned)).toEqual({
      image: 'clean',
      showTriggerZone: true,
    })
    expect(
      pruneMediaPolicy({ clip: true, clipPreRollSec: 0, clipPostRollSec: 30, profile: 'mid' }, detection),
    ).toEqual({ image: 'crop', clip: true, clipPreRollSec: 0, clipPostRollSec: 30, profile: 'mid' })
    // Absent clipSpeed means 2x. A rate the operator (or admin-ui) set must
    // survive a phone save — dropping it was wiping the authored speed.
    expect(pruneMediaPolicy({ clip: true, clipSpeed: 4 }, detection)).toEqual({ image: 'crop', clip: true, clipSpeed: 4 })
    expect(pruneMediaPolicy({ gif: true, clipSpeed: 1 }, detection)).toEqual({ image: 'crop', gif: true, clipSpeed: 1 })
  })

  it('drops the cut fields with no gif/clip to cut', () => {
    expect(pruneMediaPolicy({ clipPreRollSec: 10, clipPostRollSec: 20, profile: 'high' }, detection)).toEqual({
      image: 'crop',
    })
    expect(pruneMediaPolicy({ clipSpeed: 4 }, detection)).toEqual({ image: 'crop' })
  })

  it('writes showTriggerZone only where the hub can draw it — a zone trigger and a scene mode', () => {
    // No zone fires this rule: the hub refuses the flag, so it is never sent.
    expect(pruneMediaPolicy({ image: 'clean', showTriggerZone: true }, detection)).toEqual({ image: 'clean' })
    // A crop never shows the zone, and nothing has no zone to show.
    expect(pruneMediaPolicy({ image: 'crop', showTriggerZone: true }, zoned)).toEqual({ image: 'crop' })
    expect(pruneMediaPolicy({ image: 'none', showTriggerZone: true }, zoned)).toEqual({ image: 'none' })
    // An occupancy rule's scoped zone IS its trigger.
    const occupancy = { kind: 'occupancy' as const, conditions: { occupancy: { zoneId: 'z-drive', op: 'became-occupied' as const, count: 1, sustainSeconds: 15 } } }
    expect(pruneMediaPolicy({ image: 'scene-boxes', showTriggerZone: true }, occupancy)).toEqual({
      image: 'scene-boxes',
      showTriggerZone: true,
    })
  })

  it('writes showSubjectPath on every picture of a tracked subject, a crop included — never on a sound or with no picture', () => {
    for (const image of ['scene-boxes', 'crop', 'clean'] as const) {
      expect(pruneMediaPolicy({ image, showSubjectPath: true }, detection)).toEqual({ image, showSubjectPath: true })
    }
    expect(pruneMediaPolicy({ image: 'crop', showSubjectPath: false }, detection)).toEqual({ image: 'crop' })
    expect(pruneMediaPolicy({ image: 'none', showSubjectPath: true }, detection)).toEqual({ image: 'none' })
    expect(pruneMediaPolicy({ image: 'clean', showSubjectPath: true }, { kind: 'sound', conditions: {} })).toEqual({
      image: 'clean',
    })
  })

  it('a mode the kind cannot honour is saved as the nearest one it can — a sound is never a crop', () => {
    expect(pruneMediaPolicy({ image: 'crop' }, { kind: 'sound', conditions: {} })).toEqual({ image: 'clean' })
    expect(pruneMediaPolicy({}, { kind: 'sound', conditions: {} })).toEqual({ image: 'clean' })
    expect(pruneMediaPolicy({}, { kind: 'sensor', conditions: {} })).toEqual({ image: 'clean' })
  })

  it('a kind with no picture writes `none` whatever the form held', () => {
    expect(pruneMediaPolicy({ image: 'scene-boxes', gif: true }, { kind: 'system', conditions: {} })).toEqual({
      image: 'none',
    })
  })

  it('narrows image and profile without a cast, rejecting anything else', () => {
    expect(parseMediaImage('scene-boxes')).toBe('scene-boxes')
    expect(parseMediaImage('boxed')).toBeUndefined()
    expect(parseMediaProfile('low')).toBe('low')
    // `auto` is the UI stand-in for ABSENT — it must never reach the wire.
    expect(parseMediaProfile('auto')).toBeUndefined()
  })

  it('a new detection rule saves the subject crop — never the legacy triple', () => {
    const input = formToInput(makeForm({ name: 'r', targetIds: ['tgt-a'] }), { ownTargetIds: ['tgt-a'] })
    expect(input.media).toEqual({ image: 'crop' })
  })
})

describe('ruleClearsFor — an emptied field is emptied on the hub', () => {
  it('clears the template when both fields are blank', () => {
    const form = { ...makeForm(), templateTitle: '', templateBody: '  ' }
    expect(ruleClearsFor(form)).toContain('template')
  })

  it('clears the schedule when it has no windows', () => {
    const form = { ...makeForm(), schedule: { windows: [] } }
    expect(ruleClearsFor(form)).toContain('schedule')
  })

  it('never clears the admin-only fields for a caller not known to be admin', () => {
    // `targetUsers` / `actions` are admin-only on the hub: a non-admin's clear
    // is refused, so the default (no `isAdmin`) never names them.
    const clears = ruleClearsFor(makeForm())
    for (const key of ['targetUsers', 'actions'] as const) {
      expect(clears).not.toContain(key)
    }
  })

  it('is disjoint from formToInput', () => {
    const form = { ...makeForm(), templateTitle: 'T' }
    const input = formToInput(form)
    for (const key of ruleClearsFor(form)) expect(input[key]).toBeUndefined()
  })
})

describe('helpers', () => {
  it('exposes and narrows the system-event trigger vocabulary', () => {
    expect(NC_DELIVERY_OPTIONS.some((option) => option.value === 'system-event')).toBe(true)
  })

  it('draws exactly the hub’s authorable kinds (NC_AUTHORABLE_SYSTEM_EVENT_KINDS), each once', () => {
    // Order is the shared group table's; membership is the hub's. The four
    // newer alarm kinds, the consumable pair, wrapper-update-available and
    // backup-completed were each missing from an older viewer list while the
    // hub authored them.
    // Each kind is reached through exactly ONE chip — its class's, or its own.
    expect(new Set(DRAWN_SYSTEM_EVENT_KINDS).size).toBe(DRAWN_SYSTEM_EVENT_KINDS.length)
    expect([...DRAWN_SYSTEM_EVENT_KINDS].sort()).toEqual([...NC_AUTHORABLE_SYSTEM_EVENT_KINDS].sort())
    // A paired class (D906) is one chip, drawn once: every shared class, no other.
    expect([...DRAWN_CLASS_IDS].sort()).toEqual(NC_SYSTEM_EVENT_CLASS_SPECS.map((spec) => spec.id).sort())
  })

  it('names every class chip, instant AND snapshot wording, in BOTH locales', () => {
    for (const locale of [enLocale, itLocale]) {
      const missing = DRAWN_CLASS_IDS.flatMap((id) =>
        ['systemClasses', 'systemClassSnapshots'].flatMap((branch) =>
          lookupLocale(locale, `v2.nc.rules.editor.${branch}.${id}`) === undefined ? [`${branch}.${id}`] : [],
        ),
      )
      expect(missing).toEqual([])
    }
  })

  it('offers the new kinds and never the legacy camera-worded ones', () => {
    for (const kind of [
      'device-offline',
      'device-online',
      'device-disabled',
      'device-enabled',
      'alarm-triggered',
      'alarm-armed',
      'alarm-disarmed',
    ] as const) {
      expect(DRAWN_SYSTEM_EVENT_KINDS).toContain(kind)
    }
    // The legacy tail PARSES (see the schema round-trip below) but is never
    // authorable: the hub produces only the generic kinds, so a rule authored
    // with `camera-offline` is a rule that can never fire.
    for (const legacy of ['camera-online', 'camera-offline', 'camera-disabled', 'camera-enabled']) {
      expect(DRAWN_SYSTEM_EVENT_KINDS).not.toContain(legacy)
    }
  })

  /**
   * THE TWO SILENT FAILURES (server enum, 2026-08-14). Both report a component
   * that is UP and producing NOTHING — the one shape ordinary liveness cannot
   * express. They are mirrored here for the reason the whole enum is mirrored:
   * a kind this build cannot decode does not cost the condition one field, it
   * fails `safeParse` and costs the operator the WHOLE rule.
   */
  it('mirrors the two silent-failure kinds, parsed AND authorable', () => {
    for (const kind of ['node-inference-unavailable', 'detection-blind'] as const) {
      expect(NcSystemEventKindSchema.safeParse(kind).success).toBe(true)
      expect(DRAWN_SYSTEM_EVENT_KINDS).toContain(kind)
    }
    // Not merely parseable in isolation: a whole RULE carrying them survives.
    expect(
      NcConditionsSchema.safeParse({
        systemEvent: { kinds: ['node-inference-unavailable', 'detection-blind'] },
      }).success,
    ).toBe(true)
  })

  it('scopes a blind camera by device and an unusable node by node', () => {
    // `detection-blind` does NOT start with `device-`, so the prefix rule alone
    // would hide the device filter on the one kind that is entirely about a
    // single camera — "tell me when THIS camera goes blind" must be authorable.
    expect(familyFilterVisibility('device-events', ['detection-blind'])).toMatchObject({
      devices: true,
      deviceTypes: true,
      nodes: false,
      packages: false,
    })
    expect(familyFilterVisibility('system', ['node-inference-unavailable'])).toMatchObject({
      devices: false,
      deviceTypes: false,
      nodes: true,
      packages: false,
    })
  })

  /**
   * THE SCOPING IS NOT AUTHORED HERE. `systemEventFilterApplies`
   * (`@camstack/types` → `src/notification/system-event-filters.ts`) is the one
   * place that says which narrowing filter speaks about which kind, and the
   * rule ENGINE reads the same function — a viewer that re-derived it would be
   * a third author of a rule that already cost four days of undelivered system
   * events when two authors disagreed.
   *
   * `familyFilterVisibility` is therefore a RENAME (`deviceIds` → the
   * editor's `devices`, `nodeIds` → `nodes`, `packageNames` → `packages`)
   * composed with the family's allowed filters, and this sweep is what holds
   * it to that: every authorable kind (the hub's
   * `NC_AUTHORABLE_SYSTEM_EVENT_KINDS`) against every filter, in its own
   * family, so a kind added to the vocabulary is covered the day it lands
   * instead of the day someone remembers to write its case.
   *
   * The server side of the same rule is guarded by
   * `scripts/check-nc-system-filter-scope.ts`, which runs the real engine and
   * probes this function against the hub's family validator.
   */
  const EDITOR_FIELD_OF_FILTER: Readonly<
    Record<NcSystemEventFilterKey, keyof NcSystemEventFilterVisibility>
  > = {
    deviceIds: 'devices',
    deviceTypes: 'deviceTypes',
    nodeIds: 'nodes',
    packageNames: 'packages',
    consumableLowPercent: 'consumableThreshold',
  }

  it('shows exactly the filters the shared predicate scopes to each kind', () => {
    for (const kind of NC_AUTHORABLE_SYSTEM_EVENT_KINDS) {
      const family = NC_SYSTEM_EVENT_FAMILY[kind]
      // An authorable kind always has a family; the guard proves it hub-side.
      expect({ kind, family }).not.toEqual({ kind, family: null })
      if (family === null) continue
      const visibility = familyFilterVisibility(family, [kind])
      for (const filter of NC_SYSTEM_EVENT_FILTER_KEYS) {
        // The pair travels INSIDE the assertion so a failure names the kind and
        // the filter, not just `false !== true`.
        expect({ kind, filter, shown: visibility[EDITOR_FIELD_OF_FILTER[filter]] }).toEqual({
          kind,
          filter,
          shown:
            NC_SYSTEM_EVENT_FAMILY_FILTERS[family].includes(filter) &&
            systemEventFilterApplies(kind, filter),
        })
      }
    }
  })

  it('derives an update kind by node and package, and never by device type', () => {
    // An update is always pinned to the node it landed on, which is what makes
    // "only the hub" expressible; it has no device and therefore no type.
    expect(systemEventFilterApplies('server-updated', 'nodeIds')).toBe(true)
    expect(systemEventFilterApplies('server-updated', 'deviceTypes')).toBe(false)
    expect(familyFilterVisibility('system', ['server-updated'])).toMatchObject({
      devices: false,
      deviceTypes: false,
      nodes: true,
      packages: true,
    })
  })

  /**
   * The alarm panel's transitions, ALL of them. `alarm-arming` and
   * `alarm-arm-refused` exist on the hub and were authorable there while this
   * mirror knew only three — so a rule authored in the admin UI on either of
   * them failed `safeParse` and vanished from the phone's list entirely.
   */
  it('mirrors every alarm transition, so such a rule is not DROPPED', () => {
    for (const kind of ['alarm-arm-refused', 'alarm-arming'] as const) {
      expect(NcSystemEventKindSchema.safeParse(kind).success).toBe(true)
      expect(DRAWN_SYSTEM_EVENT_KINDS).toContain(kind)
    }
    expect(
      NcConditionsSchema.safeParse({ systemEvent: { kinds: ['alarm-arming'] } }).success,
    ).toBe(true)
  })

  /**
   * Every kind the picker can OFFER has a word in both languages. Without this
   * the chip falls back to the raw kind string — `detection-blind` shown to an
   * Italian operator as `detection-blind`. The fallback exists so nothing
   * crashes, not so the vocabulary can go untranslated.
   */
  it('names every authorable kind in BOTH locales', () => {
    function systemKinds(tree: unknown): Record<string, unknown> {
      const node = ['v2', 'nc', 'rules', 'editor', 'systemKinds'].reduce<unknown>(
        (current, part) =>
          current != null && typeof current === 'object' && part in current
            ? (current as Record<string, unknown>)[part]
            : undefined,
        tree,
      )
      return node != null && typeof node === 'object' ? (node as Record<string, unknown>) : {}
    }
    for (const locale of [enLocale, itLocale]) {
      const words = systemKinds(locale)
      // The hub's authorable list is the oracle, not the viewer's own drawing:
      // a kind the hub makes authorable that has no `systemKinds.<kind>` word
      // fails here, and the test above ties what is drawn to that list.
      const kinds = [...new Set([...NC_AUTHORABLE_SYSTEM_EVENT_KINDS, ...DRAWN_SYSTEM_EVENT_KINDS])]
      expect(kinds.filter((kind) => typeof words[kind] !== 'string')).toEqual([])
    }
  })

  it('offers a device-type vocabulary built from the shared enum', () => {
    const values = NC_DEVICE_TYPE_OPTIONS.map((option) => option.value)
    expect(values).toContain('camera')
    expect(values).toContain('sensor')
    expect(NC_DEVICE_TYPE_OPTIONS.find((option) => option.value === 'camera')?.label).toBe('Camera')
  })
  it('isRuleFormValid requires a name and at least one target', () => {
    expect(isRuleFormValid(makeForm({ name: '', targetIds: ['a'] }))).toBe(false)
    expect(isRuleFormValid(makeForm({ name: 'x', targetIds: [] }))).toBe(false)
    expect(isRuleFormValid(makeForm({ name: 'x', targetIds: ['a'] }))).toBe(true)
  })

  it('isConditionValueEmpty treats empty arrays/strings and source "any" as unset but keeps 0', () => {
    expect(isConditionValueEmpty([])).toBe(true)
    expect(isConditionValueEmpty('')).toBe(true)
    expect(isConditionValueEmpty('any')).toBe(true)
    expect(isConditionValueEmpty(0)).toBe(false)
    expect(isConditionValueEmpty(['x'])).toBe(false)
  })

  it('buildConditions keeps touched keys when no catalog is supplied', () => {
    const out = buildConditions({ classes: ['person'], minConfidence: 0.5 }, 'immediate', [])
    expect(out).toEqual({ classes: ['person'], minConfidence: 0.5 })
  })
})

describe('condition-key narrowing', () => {
  it('isStringListKey accepts string-array keys and rejects others', () => {
    expect(isStringListKey('classes')).toBe(true)
    expect(isStringListKey('sensorKinds')).toBe(true)
    expect(isStringListKey('minConfidence')).toBe(false)
    expect(isStringListKey('devices')).toBe(false)
    expect(isStringListKey('toString')).toBe(false) // proto pollution guard
  })

  it('isNumber01Key accepts 0..1-number keys and rejects others', () => {
    expect(isNumber01Key('minConfidence')).toBe(true)
    expect(isNumber01Key('minLabelConfidence')).toBe(true)
    expect(isNumber01Key('minDwellSeconds')).toBe(false) // number, but no 0..1 bound
    expect(isNumber01Key('classes')).toBe(false)
    expect(isNumber01Key('hasOwnProperty')).toBe(false)
  })

  it('readStringList returns the array or [] when unset/non-array', () => {
    const conditions: NcConditions = { classes: ['person', 'car'] }
    expect(readStringList(conditions, 'classes')).toEqual(['person', 'car'])
    expect(readStringList({}, 'identities')).toEqual([])
  })

  it('readNumber01 returns the number or undefined when unset', () => {
    expect(readNumber01({ minConfidence: 0.7 }, 'minConfidence')).toBe(0.7)
    expect(readNumber01({ minConfidence: 0 }, 'minConfidence')).toBe(0)
    expect(readNumber01({}, 'minImportance')).toBeUndefined()
  })
})

/**
 * Whitelist ↔ schema drift guard. The `stringList` / `number01` widget
 * whitelists MUST enumerate exactly the string-array / 0..1-number fields of
 * `NcConditionsSchema`. We derive the expected sets from the LIVE Zod schema
 * (via parse-probes — version-agnostic, no internals, no cast): a future A1
 * catalog addition of such a field that forgets the whitelist FAILS here loudly
 * instead of silently rendering a blank widget in `ConditionField`.
 */
describe('whitelist ↔ NcConditionsSchema exhaustiveness', () => {
  const schemaKeys = Object.keys(NcConditionsSchema.shape)
  const accepts = (key: string, value: unknown): boolean => NcConditionsSchema.safeParse({ [key]: value }).success

  /** A field that accepts a string array but rejects a number array. */
  const deriveStringListKeys = (): readonly string[] =>
    schemaKeys.filter((key) => accepts(key, ['x']) && !accepts(key, [1])).sort()

  /** A field that accepts 0.5 and 1 but rejects 1.5 and -0.5 (the 0..1 bound). */
  const deriveNumber01Keys = (): readonly string[] =>
    schemaKeys
      .filter((key) => accepts(key, 0.5) && accepts(key, 1) && !accepts(key, 1.5) && !accepts(key, -0.5))
      .sort()

  it('NC_STRING_LIST_KEYS equals the schema string-array fields', () => {
    expect(Object.keys(NC_STRING_LIST_KEYS).sort()).toEqual(deriveStringListKeys())
  })

  it('NC_NUMBER01_KEYS equals the schema 0..1-number fields', () => {
    expect(Object.keys(NC_NUMBER01_KEYS).sort()).toEqual(deriveNumber01Keys())
  })
})

/**
 * The recognition scopes, whose EMPTY value is AUTHORED.
 *
 * This is the strip-on-save trap in its sharpest form: `identities: []` means
 * "only people I know" and `plates: { values: [] }` means "any plate that was
 * actually read", and both look exactly like "unset" to every generic emptiness
 * check in the editor. Before this, opening such a rule on the phone and tapping
 * Save silently widened it to "anybody" / "any vehicle at all" — the operator's
 * own narrowing, deleted without a word.
 *
 * Remove the `isAuthoredEmptyScope` guard in `buildConditions` and these fail.
 */
describe('authored-empty recognition scopes survive a save', () => {
  const RECOGNITION_CATALOG: readonly NcConditionDescriptor[] = [
    ...CATALOG,
    {
      id: 'identities',
      group: 'label',
      label: 'Known faces',
      valueType: 'stringList',
      operator: 'in',
      appliesTo: ['immediate', 'track-end'],
      phase: 'P1',
    },
    {
      id: 'identitiesExclude',
      group: 'label',
      label: 'Excluded faces',
      valueType: 'stringList',
      operator: 'notIn',
      appliesTo: ['immediate', 'track-end'],
      phase: 'P1',
    },
    {
      id: 'plates',
      group: 'label',
      label: 'Known plates',
      valueType: 'plateMatcher',
      operator: 'fuzzyIn',
      appliesTo: ['immediate', 'track-end'],
      phase: 'P1',
    },
  ]

  // The face scope lives in its draft while a rule is edited (2026-10-01), so
  // the form is built the way a stored rule opens: through the split.
  const build = (conditions: NcConditions): NcRuleInput =>
    formToInput(makeForm({ name: 'r', targetIds: ['tgt-a'], ...splitRuleScopes(conditions) }), {
      ownTargetIds: ['tgt-a'],
      catalog: RECOGNITION_CATALOG,
    })

  it('keeps identities: [] — "only known faces" is not "anybody"', () => {
    const input = build({ identities: [] })
    expect(input.conditions.identities).toEqual([])
    expect('identities' in input.conditions).toBe(true)
  })

  it('keeps plates: { values: [] } — "any readable plate" is not "any vehicle"', () => {
    const input = build({ plates: { values: [], maxDistance: 1 } })
    expect(input.conditions.plates).toEqual({ values: [], maxDistance: 1 })
  })

  it('keeps a NAMED identity/plate list unchanged', () => {
    const input = build({
      identities: ['id-uuid-1', 'id-uuid-2'],
      plates: { values: ['AB123CD'], maxDistance: 2 },
    })
    expect(input.conditions.identities).toEqual(['id-uuid-1', 'id-uuid-2'])
    expect(input.conditions.plates).toEqual({ values: ['AB123CD'], maxDistance: 2 })
  })

  it('still prunes an empty identitiesExclude — there, empty and absent AGREE', () => {
    // The hub reads an empty exclude list as "exclude nobody", which is exactly
    // what absence means. Keeping it would strand a condition the operator
    // emptied on the rule with no way to remove it.
    const input = build({ identitiesExclude: [] })
    expect(input.conditions.identitiesExclude).toBeUndefined()
  })

  it('still prunes every OTHER empty list (the general rule is unchanged)', () => {
    const input = build({ classes: [], classesExclude: [], customZones: [] })
    expect(Object.keys(input.conditions)).toEqual([])
  })
})

describe('groupingSec — "Immediate, grouped" (D692)', () => {
  const detectionRule: NcRule = {
    id: 'r1',
    name: 'Someone I know is at the door',
    enabled: true,
    delivery: 'immediate',
    conditions: { identities: [] },
    targets: [{ targetId: 'tgt-a' }],
    media: { attach: 'best' },
    throttle: { cooldownSec: 60, scope: 'rule-device' },
    priority: 3,
    groupingSec: 30,
    createdBy: 'me',
    createdAt: 1,
    updatedAt: 2,
    disabledTargetIds: [],
  }
  const save = { ownTargetIds: ['tgt-a'] }

  it('round-trips groupingSec through load → edit → save', () => {
    const form = inputToForm(detectionRule)
    expect(form.groupingSec).toBe(30)
    // Edit an unrelated field, exactly as an operator would.
    const back = formToInput({ ...form, priority: 5 }, save)
    expect(back.groupingSec).toBe(30)
    expect(back.conditions.identities).toEqual([])
  })

  it('a plain Immediate rule sends no groupingSec', () => {
    const input = formToInput(makeForm({ name: 'r', targetIds: ['tgt-a'] }), save)
    expect('groupingSec' in input).toBe(false)
  })

  it('NEVER emits the two retired keys, grouped or not', () => {
    // `waitForEnhancement` used to be sent ALWAYS (`false` included). The hub no
    // longer reads either key, and an unmirrored key on the wire is a refusal
    // waiting for the first hub that validates strictly.
    for (const form of [
      makeForm({ name: 'r', targetIds: ['tgt-a'] }),
      makeForm({ name: 'r', targetIds: ['tgt-a'], groupingSec: 20 }),
      inputToForm(detectionRule),
    ]) {
      const input = formToInput(form, save)
      expect('waitForEnhancement' in input).toBe(false)
      expect('groupIdleSec' in input).toBe(false)
    }
  })

  it('is sent only while the rule can group — a leftover on track-end or a sound rule is dropped', () => {
    const trackEnd = formToInput(makeForm({ name: 'r', targetIds: ['tgt-a'], delivery: 'track-end', groupingSec: 20 }), save)
    expect('groupingSec' in trackEnd).toBe(false)
    const sound = formToInput(
      makeForm({
        name: 'r',
        targetIds: ['tgt-a'],
        conditions: { audio: { hitPercent: 50, samplingSeconds: 5, dbThreshold: -40 } },
        groupingSec: 20,
      }),
      save,
    )
    expect('groupingSec' in sound).toBe(false)
  })

  it('ruleClearsFor authors groupingSec ONLY when the form emptied it AND the stored rule had one', () => {
    const stored = NcRuleSchema.parse(detectionRule)
    const grouped = inputToForm(stored)
    // Still grouped: nothing to clear.
    expect(ruleClearsFor(grouped, { ...save, stored })).not.toContain('groupingSec')
    // Moved to track-end: the stored window must be cleared on the hub.
    const moved = { ...grouped, delivery: 'track-end' as const, groupingSec: undefined }
    expect(ruleClearsFor(moved, { ...save, stored })).toContain('groupingSec')
    // The stored rule never had one: nothing is invented.
    const plainStored = NcRuleSchema.parse({ ...detectionRule, groupingSec: undefined })
    expect(ruleClearsFor(moved, { ...save, stored: plainStored })).not.toContain('groupingSec')
    // No stored rule at all (judge by the form alone): the emptied key is named.
    expect(ruleClearsFor(moved, save)).toContain('groupingSec')
  })

  it('is disjoint from the input', () => {
    const stored = NcRuleSchema.parse(detectionRule)
    const moved = { ...inputToForm(stored), delivery: 'track-end' as const, groupingSec: 40 }
    const input = formToInput(moved, { ...save, stored })
    for (const key of ruleClearsFor(moved, { ...save, stored })) expect(input[key]).toBeUndefined()
  })

  describe('the trigger choice', () => {
    it('reads grouped only while the rule can group', () => {
      expect(deliveryChoiceOf(makeForm({ groupingSec: 20 }))).toBe('immediate-grouped')
      expect(deliveryChoiceOf(makeForm())).toBe('immediate')
      expect(deliveryChoiceOf(makeForm({ delivery: 'track-end', groupingSec: 20 }))).toBe('track-end')
      expect(deliveryChoiceOf(makeForm({ conditions: { audio: { hitPercent: 50, samplingSeconds: 5, dbThreshold: -40 } }, groupingSec: 20 }))).toBe('immediate')
    })

    it('choosing grouped is immediate + the default window, kept if one was already chosen', () => {
      const fresh = applyDeliveryChoice(makeForm(), 'immediate-grouped')
      expect(fresh.delivery).toBe('immediate')
      expect(fresh.groupingSec).toBe(NC_GROUPING_DEFAULT_SEC)
      expect(NC_GROUPING_DEFAULT_SEC).toBe(20)
      expect(applyDeliveryChoice(makeForm({ groupingSec: 45 }), 'immediate-grouped').groupingSec).toBe(45)
    })

    it('any other choice forgets the window', () => {
      expect(applyDeliveryChoice(makeForm({ groupingSec: 45 }), 'immediate').groupingSec).toBeUndefined()
      const toEnd = applyDeliveryChoice(makeForm({ groupingSec: 45 }), 'track-end')
      expect(toEnd.delivery).toBe('track-end')
      expect(toEnd.groupingSec).toBeUndefined()
    })

    it('offers grouped on a detection rule, never on a sound rule or a non-detection trigger', () => {
      const values = (form: NcRuleFormState): readonly string[] => deliveryChoicesFor(form).map((o) => o.value)
      expect(values(makeForm())).toEqual(['immediate', 'immediate-grouped', 'track-end'])
      expect(values(makeForm({ delivery: 'track-end' }))).toContain('immediate-grouped')
      expect(values(makeForm({ conditions: { audio: { hitPercent: 50, samplingSeconds: 5, dbThreshold: -40 } } }))).not.toContain('immediate-grouped')
      expect(values(makeForm({ delivery: 'package-event' }))).not.toContain('immediate-grouped')
    })
  })

  describe('what blocks the save', () => {
    it('a window outside 5..60 is a problem, in range is not', () => {
      const grouped = (groupingSec: number) => makeForm({ name: 'r', targetIds: ['tgt-a'], groupingSec })
      expect(ruleFormProblems(grouped(4))).toContain('groupingSec')
      expect(ruleFormProblems(grouped(61))).toContain('groupingSec')
      expect(ruleFormProblems(grouped(NC_GROUPING_MIN_SEC))).not.toContain('groupingSec')
      expect(ruleFormProblems(grouped(NC_GROUPING_MAX_SEC))).not.toContain('groupingSec')
      expect(isRuleFormValid(grouped(4))).toBe(false)
    })

    it('an out-of-range window on a rule that does not group blocks nothing (it is not sent)', () => {
      const form = makeForm({ name: 'r', targetIds: ['tgt-a'], delivery: 'track-end', groupingSec: 4 })
      expect(ruleFormProblems(form)).not.toContain('groupingSec')
    })

    it('a grouped rule whose AI confirm expects more than one subject is a problem — the stored rule’s confirm counts', () => {
      // T16 refuses it on the hub: a tile judges ONE picture. The phone says so
      // BEFORE the save, reading the confirm the form holds (hydrated from the
      // stored rule, or typed in Advanced).
      const stored = NcRuleSchema.parse({
        ...detectionRule,
        confirm: { enabled: true, expect: { op: '>=', count: 2 } },
      })
      const form = inputToForm(stored)
      expect(ruleFormProblems(form)).toContain('groupedConfirm')
      expect(isRuleFormValid(form)).toBe(false)
    })

    it('judges the expectation as one subject would meet it, and only for an enabled confirm', () => {
      const withConfirm = (confirm: unknown): NcRuleFormState =>
        inputToForm(NcRuleSchema.parse({ ...detectionRule, confirm }))
      const problem = (confirm: unknown): boolean => ruleFormProblems(withConfirm(confirm)).includes('groupedConfirm')
      expect(problem({ enabled: true, expect: { op: '>=', count: 1 } })).toBe(false)
      expect(problem({ enabled: true, expect: { op: '==', count: 1 } })).toBe(false)
      expect(problem({ enabled: true, expect: { op: '<=', count: 3 } })).toBe(false)
      expect(problem({ enabled: true, expect: { op: '==', count: 2 } })).toBe(true)
      expect(problem({ enabled: true, expect: { op: '>', count: 1 } })).toBe(true)
      expect(problem({ enabled: true })).toBe(false)
      expect(problem({ enabled: false, expect: { op: '>=', count: 2 } })).toBe(false)
    })

    it('both problem codes are said in BOTH locales (the summary prints `problem.<code>`)', () => {
      for (const code of ['groupingSec', 'groupedConfirm']) {
        for (const locale of [enLocale, itLocale]) {
          expect(locale.v2.nc.rules.editor.problem).toHaveProperty(code)
        }
      }
    })

    it('the same confirm on a plain Immediate rule is not a problem', () => {
      const stored = NcRuleSchema.parse({
        ...detectionRule,
        groupingSec: undefined,
        confirm: { enabled: true, expect: { op: '>=', count: 2 } },
      })
      expect(ruleFormProblems(inputToForm(stored))).not.toContain('groupedConfirm')
    })
  })
})

describe('the viewer decodes every kind the hub can author', () => {
  it('addon-crash-loop parses and is offered — an admin rule with it must not vanish from the phone', () => {
    // The schema docblock promises MEMBER FOR MEMBER with the server cap, and
    // a kind this build cannot decode does not cost a field — it costs the
    // operator the WHOLE rule (safeParse fails, the rule disappears from the
    // list). addon-crash-loop (D6 breaker giving up, node-scoped) was missing.
    expect(DRAWN_SYSTEM_EVENT_KINDS).toContain('addon-crash-loop')
    const parsed = NcSystemEventKindSchema.safeParse('addon-crash-loop')
    expect(parsed.success).toBe(true)
  })
})

describe('D3 — the form models EVERY rule field (parse → form → input is the identity)', () => {
  // A server-shaped rule carrying every authored field, each OFF its default so
  // a field the form forgets cannot hide behind "absent means default".
  const serverShaped = {
    id: 'rule-full',
    name: 'Everything',
    enabled: false,
    delivery: 'immediate',
    conditions: { classes: ['person'], minConfidence: 0.7 },
    schedule: {
      windows: [{ days: [1, 2], startMinute: 60, endMinute: 120 }],
      timezone: 'Europe/Rome',
      invert: true,
    },
    targets: [{ targetId: 'tgt-a' }, { targetId: 'tgt-b', params: { sound: 'ping', ttl: 30 } }],
    targetUsers: ['u-anna', 'u-bob'],
    media: {
      image: 'scene-boxes',
      gif: true,
      clip: true,
      clipPreRollSec: 5,
      clipPostRollSec: 12,
      clipSpeed: 4,
      profile: 'low',
      // No `linkedCameras`: this is a DETECTION rule and the key is a sensor
      // rule's (ADR 0632) — its round-trip is pinned in the sensor describe.
    },
    throttle: { cooldownSec: 120, scope: 'rule', granularity: 'per-class' },
    template: { title: 'T {{camera}}', body: 'B' },
    priority: 4,
    snoozeAllowGlobal: true,
    snoozeOptions: [5, 45],
    // The hub's shape: hook bindings to SHARED sequences by id, or one inline
    // step — on every edge — and buttons that run a shared sequence by id.
    actions: {
      onActivation: [{ kind: 'sequence', sequenceId: 'seq-arm' }],
      onDeactivation: [{ kind: 'do', action: { kind: 'wait', seconds: 2.5 } }],
      onTrigger: [
        { kind: 'sequence', sequenceId: 'seq-siren' },
        {
          kind: 'do',
          action: { kind: 'cap', deviceId: 7, cap: 'switch', method: 'setState', args: { on: true, level: 50, payload: { a: [1] } } },
        },
      ],
      onTriggerOff: [{ kind: 'do', action: { kind: 'cap', deviceId: 9, cap: 'lock', method: 'unlock' } }],
      buttons: [{ id: 'b1', label: 'Open', sequenceId: 'seq-open', icon: 'unlock', destructive: true }],
    },
    confirm: {
      enabled: true,
      profileId: 'vision-1',
      prompt: 'Is it a courier?',
      expect: { op: '>=', count: 2 },
      timeoutMs: 5_000,
      onTimeout: 'suppress',
      maxImagePx: 512,
    },
    groupingSec: 20,
    createdBy: 'admin',
    createdAt: 1,
    updatedAt: 2,
    disabledTargetIds: [],
  }
  const persisted = NcRuleSchema.parse(serverShaped)
  const SCHEDULED_CATALOG: readonly NcConditionDescriptor[] = [
    ...CATALOG,
    {
      id: 'schedule',
      group: 'schedule',
      label: 'Schedule',
      valueType: 'schedule',
      operator: 'withinSchedule',
      appliesTo: ['immediate', 'track-end'],
      phase: 'root',
    },
  ]
  const options = {
    ownTargetIds: ['tgt-a', 'tgt-b'],
    catalog: SCHEDULED_CATALOG,
    preserve: { throttle: persisted.throttle },
    stored: persisted,
    isAdmin: true,
  }
  const { id: _id, createdBy: _by, createdAt: _at, updatedAt: _up, disabledTargetIds: _dis, ...original } = persisted

  it('every field of the parsed rule comes back byte-identical', () => {
    expect(formToInput(inputToForm(persisted), options)).toEqual(original)
  })

  it('the mirror did not strip anything the server sent', () => {
    const { id: _i, createdBy: _c, createdAt: _a, updatedAt: _u, disabledTargetIds: _d, ...sent } = serverShaped
    expect(original).toEqual(sent)
  })

  it('an untouched edit clears nothing', () => {
    expect(ruleClearsFor(inputToForm(persisted), options)).toEqual([])
  })

  it('the cooldown is authored; the scope and granularity ride along', () => {
    const back = formToInput({ ...inputToForm(persisted), cooldownSec: 15 }, options)
    expect(back.throttle).toEqual({ cooldownSec: 15, scope: 'rule', granularity: 'per-class' })
  })

  it('a new rule writes the P1 throttle from the form cooldown', () => {
    const input = formToInput(makeForm({ name: 'r', targetIds: ['tgt-a'] }), { ownTargetIds: ['tgt-a'] })
    expect(input.throttle).toEqual({ cooldownSec: 60, scope: 'rule-device' })
    for (const key of ['targetUsers', 'snoozeOptions', 'snoozeAllowGlobal', 'groupingSec', 'confirm', 'actions'] as const) {
      expect(key in input).toBe(false)
    }
  })

  it('a non-admin never SENDS the admin-only fields — the hub keeps what it has', () => {
    const back = formToInput(inputToForm(persisted), { ...options, isAdmin: false })
    expect('actions' in back).toBe(false)
    expect('targetUsers' in back).toBe(false)
  })

  it('ruleClearsFor(non-admin) never names targetUsers or actions, even when emptied', () => {
    const emptied = { ...inputToForm(persisted), targetUsers: [], actions: NC_ACTIONS_EMPTY_FORM }
    const clears = ruleClearsFor(emptied, { ...options, isAdmin: false })
    expect(clears).not.toContain('targetUsers')
    expect(clears).not.toContain('actions')
  })

  it('an admin who empties actions and users clears them on the hub', () => {
    const emptied = { ...inputToForm(persisted), targetUsers: [], actions: NC_ACTIONS_EMPTY_FORM }
    const clears = ruleClearsFor(emptied, options)
    expect(clears).toContain('actions')
    expect(clears).toContain('targetUsers')
  })

  it('emptying the phone-authored optionals clears each of them', () => {
    const emptied = {
      ...inputToForm(persisted),
      snoozeOptions: undefined,
      snoozeAllowGlobal: false,
      groupingSec: undefined,
      confirm: confirmToForm(undefined),
    }
    const clears = ruleClearsFor(emptied, options)
    for (const key of ['snoozeOptions', 'snoozeAllowGlobal', 'groupingSec', 'confirm'] as const) {
      expect(clears).toContain(key)
    }
  })

  it('an actions block that does not parse is NEITHER sent NOR cleared — and blocks the save', () => {
    const form = inputToForm(persisted)
    const broken = {
      ...form,
      actions: {
        ...form.actions,
        onTrigger: [
          {
            editId: 'b1',
            kind: 'do' as const,
            step: { editId: 't1', kind: 'cap' as const, seconds: 0, deviceId: 7, cap: 'switch', method: 'm', args: [{ editId: 'a1', key: 'p', type: 'json' as const, text: '{' }] },
          },
        ],
      },
    }
    expect(isRuleFormValid(broken, { isAdmin: true })).toBe(false)
    expect(ruleClearsFor(broken, options)).not.toContain('actions')
  })

  it('the clears stay disjoint from the input for the new keys', () => {
    const emptied = {
      ...inputToForm(persisted),
      targetUsers: [],
      actions: NC_ACTIONS_EMPTY_FORM,
      snoozeOptions: undefined,
      snoozeAllowGlobal: false,
      groupingSec: undefined,
      confirm: confirmToForm(undefined),
    }
    for (const isAdmin of [true, false]) {
      const input = formToInput(emptied, { ...options, isAdmin })
      for (const key of ruleClearsFor(emptied, { ...options, isAdmin })) expect(input[key]).toBeUndefined()
    }
  })

  it('a rule addressed only to users is a valid form (the hub needs ONE addressee)', () => {
    expect(isRuleFormValid(makeForm({ name: 'x', targetIds: [], targetUsers: ['u1'] }))).toBe(true)
    expect(isRuleFormValid(makeForm({ name: 'x', targetIds: [], targetUsers: [] }))).toBe(false)
  })
})

describe('fix round 1 — actions is an ADMIN problem; stored absent-equivalents are not cleared', () => {
  const dangling = makeForm({
    name: 'x',
    targetIds: ['tgt-a'],
    // Admin-wired, and broken: the button runs no sequence at all.
    actions: { ...NC_ACTIONS_EMPTY_FORM, buttons: [{ id: 'b', label: 'Open', sequenceId: '' }] },
  })

  it('a non-admin is never blocked by actions they cannot see or change', () => {
    expect(ruleFormProblems(dangling, { isAdmin: false })).toEqual([])
    expect(isRuleFormValid(dangling, { isAdmin: false })).toBe(true)
    expect(isRuleFormValid(dangling)).toBe(true)
  })

  it('an admin gets the actions problem', () => {
    expect(ruleFormProblems(dangling, { isAdmin: true })).toEqual(['actions'])
    expect(isRuleFormValid(dangling, { isAdmin: true })).toBe(false)
  })

  const absentEquivalent = NcRuleSchema.parse({
    id: 'r-abs',
    name: 'Absent-ish',
    enabled: true,
    delivery: 'immediate',
    conditions: {},
    targets: [{ targetId: 'tgt-a' }],
    confirm: { enabled: false },
    snoozeAllowGlobal: false,
    createdBy: 'admin',
    createdAt: 1,
    updatedAt: 2,
  })

  it('an untouched save of a rule storing absent-equivalent values clears nothing', () => {
    const form = inputToForm(absentEquivalent)
    for (const isAdmin of [true, false]) {
      expect(ruleClearsFor(form, { ownTargetIds: ['tgt-a'], stored: absentEquivalent, isAdmin })).toEqual([])
    }
  })

  it('a stored MEANINGFUL value the form empties is still cleared', () => {
    const stored = NcRuleSchema.parse({
      ...absentEquivalent,
      confirm: { enabled: true },
      groupingSec: 30,
      snoozeAllowGlobal: true,
    })
    const emptied = {
      ...inputToForm(stored),
      confirm: confirmToForm(undefined),
      groupingSec: undefined,
      snoozeAllowGlobal: false,
    }
    const clears = ruleClearsFor(emptied, { ownTargetIds: ['tgt-a'], stored })
    expect(clears).toEqual(expect.arrayContaining(['confirm', 'groupingSec', 'snoozeAllowGlobal']))
  })
})

describe('askVerdict — sent only where a detection can be asked about', () => {
  const absentEquivalent = NcRuleSchema.parse({
    id: 'r-v',
    name: 'Verdict',
    enabled: true,
    delivery: 'immediate',
    conditions: {},
    targets: [{ targetId: 'tgt-a' }],
    createdBy: 'admin',
    createdAt: 1,
    updatedAt: 2,
  })
  const base = inputToForm(absentEquivalent)
  const opts = { ownTargetIds: ['tgt-a'] }

  it('round-trips through the form and is sent on a detection trigger', () => {
    const stored = NcRuleSchema.parse({ ...absentEquivalent, askVerdict: true })
    expect(inputToForm(stored).askVerdict).toBe(true)
    expect(formToInput(inputToForm(stored), opts).askVerdict).toBe(true)
    expect(formToInput({ ...base, askVerdict: false }, opts).askVerdict).toBe(false)
    expect(formToInput(base, opts).askVerdict).toBeUndefined()
  })

  it('is never sent from a trigger that reports no track', () => {
    expect(formToInput({ ...base, delivery: 'device-event', askVerdict: true }, opts).askVerdict).toBeUndefined()
    expect(verdictApplies({ delivery: 'device-event' })).toBe(false)
    expect(verdictApplies({ delivery: 'track-end' })).toBe(true)
  })
})

describe('formToInput — a family rule sends only its family’s filters (D637)', () => {
  it('D637: a save sends only the family’s filters (alarm camera filter needs alarm-triggered)', () => {
    const form = { ...emptyRuleForm(), delivery: 'system-event' as const, conditions: { systemEvent: { kinds: ['alarm-armed' as const], deviceIds: [102] } } }
    expect(formToInput(form).conditions.systemEvent).toEqual({ kinds: ['alarm-armed'] })
  })

  it('D637: a system rule never sends a device filter', () => {
    const form = { ...emptyRuleForm(), delivery: 'system-event' as const, conditions: { systemEvent: { kinds: ['export-completed' as const], deviceIds: [102] } } }
    expect(formToInput(form).conditions.systemEvent).toEqual({ kinds: ['export-completed'] })
  })

  it('an alarm-triggered rule keeps its camera filter', () => {
    const form = {
      ...emptyRuleForm(),
      delivery: 'system-event' as const,
      conditions: { systemEvent: { kinds: ['alarm-triggered' as const], deviceIds: [102] } },
    }
    expect(formToInput(form).conditions.systemEvent).toEqual({ kinds: ['alarm-triggered'], deviceIds: [102] })
  })

  it('a device-events rule keeps include, exclude and types, and drops node and package filters', () => {
    const form = {
      ...emptyRuleForm(),
      delivery: 'system-event' as const,
      conditions: {
        systemEvent: {
          kinds: ['device-offline' as const],
          deviceIds: [102],
          excludeDeviceIds: [101],
          deviceTypes: ['camera'],
          nodeIds: ['hub'],
          packageNames: ['@camstack/server'],
        },
      },
    }
    expect(formToInput(form).conditions.systemEvent).toEqual({
      kinds: ['device-offline'],
      deviceIds: [102],
      excludeDeviceIds: [101],
      deviceTypes: ['camera'],
    })
  })

  it('a MIXED rule (read-only) is sent as it stands — it has no family to prune by', () => {
    const systemEvent = {
      kinds: ['device-offline' as const, 'node-offline' as const],
      deviceIds: [102],
      nodeIds: ['hub'],
    }
    const form = { ...emptyRuleForm(), delivery: 'system-event' as const, conditions: { systemEvent } }
    expect(formToInput(form).conditions.systemEvent).toEqual(systemEvent)
  })
})
