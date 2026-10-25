/**
 * The viewer's half of the shared rule-KIND / rule-SECTION model.
 *
 * The model itself is pinned in `@camstack/types`
 * (`src/notification/__tests__/rule-kinds.spec.ts`). What is asserted HERE is
 * the part that is the viewer's own decision and that nothing upstream can
 * check:
 *
 *  - the timelapse and summary tabs are kept apart from the rule list (the
 *    kind strip itself is pinned in `rule-kind-nav.spec.ts`);
 *  - the save-drop warning tells the TRUTH: every condition it names is one the
 *    save actually drops, and it names every one it drops. A warning that
 *    over-promises trains the operator to ignore it; one that under-promises is
 *    the silent rewrite this repo has already paid for.
 *  - every string the new surface asks for exists in BOTH locales.
 */
import { describe, expect, it } from 'vitest'
import { NC_RULE_KIND_SPECS } from '@camstack/types/client'
import { NC_RULE_SECTIONS } from '@camstack/types'
import {
  isFamilySection,
  NC_CONDITION_GROUP_ORDER,
  NC_VIEWER_FAMILY_SECTIONS,
  orderedConditionGroups,
  sectionCreateKey,
  sectionEmptyKey,
  sectionLabelKey,
} from '../rule-sections.js'
import { droppedRuleConditions, dropReasonKey, formToInput } from '../rule-editor.js'
import { formScopedConditions } from '../rule-scope-form.js'
import { ruleScopeDraftOf } from '../rule-scope-model.js'
import { seedFormForKind } from '../../../screens/notifications/rule-editor/rule-draft-source.js'
import type {
  NcConditionDescriptor,
  NcConditions,
  NcMediaPolicy,
} from '../../../data/notification-center.js'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'

/** Resolve a dotted i18n key against a locale JSON tree, without a cast. */
function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return typeof node === 'string' ? node : undefined
}

// ── The two OTHER rule families ─────────────────────────────────────

/**
 * Timelapse and digest rules are NOT a partition of `nc.listRules`.
 *
 * They are separate stores behind separate bridge actions, and this is the
 * distinction the strip has to keep straight: `ruleKindOf` has no
 * opinion about them, so their tabs cannot be counted by filtering the rule
 * list — the counts come from their own queries and are passed in.
 *
 * Getting this wrong is not cosmetic. A timelapse key accepted by
 * `rulesOfKind` would silently return the WHOLE detection list (it is the
 * catch-all), so the Timelapse tab would show every detection rule and the
 * operator would conclude their rules had been duplicated.
 */
describe('the timelapse and summary tabs', () => {
  it('are the timelapse and the summary, in that order', () => {
    expect(NC_VIEWER_FAMILY_SECTIONS).toEqual(['timelapse', 'summary'])
  })

  it('are NOT keys of the shared section model', () => {
    const shared = new Set<string>(NC_RULE_SECTIONS.map((s) => s.key))
    for (const key of NC_VIEWER_FAMILY_SECTIONS) expect(shared.has(key), key).toBe(false)
  })

  it('tells a family tab apart from a rule section without a cast', () => {
    expect(isFamilySection('timelapse')).toBe(true)
    expect(isFamilySection('summary')).toBe(true)
    expect(isFamilySection('detection')).toBe(false)
    expect(isFamilySection('all')).toBe(false)
  })

  it('has a create button, a label and an empty state in BOTH locales', () => {
    for (const key of NC_VIEWER_FAMILY_SECTIONS) {
      for (const resolve of [sectionLabelKey, sectionEmptyKey, sectionCreateKey]) {
        const i18nKey = resolve(key)
        expect(lookupLocale(enLocale, i18nKey), `en is missing ${i18nKey}`).toBeTruthy()
        expect(lookupLocale(itLocale, i18nKey), `it is missing ${i18nKey}`).toBeTruthy()
      }
    }
  })
})

// ── The save-drop warning ───────────────────────────────────────────

/** A catalog descriptor with the fields this spec does not vary. */
function descriptor(
  fields: Pick<NcConditionDescriptor, 'id' | 'label' | 'group' | 'valueType' | 'appliesTo'>,
): NcConditionDescriptor {
  return { ...fields, operator: 'in', phase: 'ga' }
}

const CATALOG: readonly NcConditionDescriptor[] = [
  descriptor({ id: 'devices', label: 'Cameras', group: 'scope', valueType: 'deviceIdList', appliesTo: ['immediate', 'device-event'] }),
  descriptor({ id: 'sensorKinds', label: 'Sensor kinds', group: 'device', valueType: 'stringList', appliesTo: ['device-event'] }),
  descriptor({ id: 'source', label: 'Source', group: 'scope', valueType: 'sourceSelect', appliesTo: ['immediate', 'device-event'] }),
  descriptor({ id: 'occupancy', label: 'Occupancy', group: 'occupancy', valueType: 'occupancy', appliesTo: ['device-event'] }),
  descriptor({ id: 'classes', label: 'Classes', group: 'class', valueType: 'stringList', appliesTo: ['immediate'] }),
  descriptor({ id: 'audio', label: 'Sound', group: 'audio', valueType: 'audio', appliesTo: ['immediate'] }),
]

describe('the save-drop warning tells the truth', () => {
  const occupancyForm = {
    ...seedFormForKind('occupancy'),
    name: 'Driveway',
    targetIds: ['t1'],
    conditions: {
      occupancy: { op: 'became-occupied', count: 1, sustainSeconds: 15 },
      sensorKinds: ['doorbell'],
      source: 'sensor',
    } satisfies NcConditions,
    // The device scope lives on the form, not in `conditions` (D641).
    deviceScope: ruleScopeDraftOf([102], undefined),
  }

  it('names the fields an occupancy rule can never satisfy, with the reason', () => {
    const dropped = droppedRuleConditions(occupancyForm)
    expect(dropped.map((d) => d.conditionId).sort()).toEqual(['sensorKinds', 'source'])
    for (const entry of dropped) expect(entry.reason.length).toBeGreaterThan(30)
  })

  it('and the save DROPS exactly those — no more, and no less', () => {
    // The load-bearing pair. A warning naming a field the save keeps trains the
    // operator to ignore it; a save dropping a field the warning did not name is
    // the silent rewrite the warning exists to prevent.
    const input = formToInput(occupancyForm, { ownTargetIds: ['t1'], catalog: CATALOG })
    const named = new Set(droppedRuleConditions(occupancyForm).map((d) => d.conditionId))
    for (const key of Object.keys(formScopedConditions(occupancyForm))) {
      const survived = Object.prototype.hasOwnProperty.call(input.conditions, key)
      expect(survived, `${key} named=${named.has(key)} survived=${survived}`).toBe(!named.has(key))
    }
  })

  it('drops NOTHING from the same fields on a plain sensor rule', () => {
    // The identical conditions on a rule with no occupancy condition are a
    // perfectly good sensor rule: the exclusion is the KIND's, not the trigger's.
    const sensorForm = {
      ...occupancyForm,
      conditions: { sensorKinds: ['doorbell'], source: 'sensor' } satisfies NcConditions,
    }
    expect(droppedRuleConditions(sensorForm)).toEqual([])
    const input = formToInput(sensorForm, { ownTargetIds: ['t1'], catalog: CATALOG })
    expect(input.conditions.sensorKinds).toEqual(['doorbell'])
    expect(input.conditions.source).toBe('sensor')
  })

  it('a SOUND rule loses its detection fields and keeps its sound', () => {
    const soundForm = {
      ...seedFormForKind('sound'),
      name: 'Dog',
      targetIds: ['t1'],
      conditions: {
        audio: { hitPercent: 60, samplingSeconds: 10, dbThreshold: -55 },
      } satisfies NcConditions,
      // The class scope lives on the form (D641); a sound rule must still SAY it drops it.
      classScope: ruleScopeDraftOf(['person'], undefined),
    }
    expect(droppedRuleConditions(soundForm).map((d) => d.conditionId)).toEqual(['classes'])
    const input = formToInput(soundForm, { ownTargetIds: ['t1'], catalog: CATALOG })
    expect(input.conditions.classes).toBeUndefined()
    expect(input.conditions.audio).toBeDefined()
  })

  it('says nothing about a field the operator merely left empty', () => {
    const form = {
      ...occupancyForm,
      conditions: { occupancy: { op: 'became-occupied', count: 1, sustainSeconds: 15 }, sensorKinds: [] } satisfies NcConditions,
    }
    expect(droppedRuleConditions(form)).toEqual([])
  })
})

describe('media follows the KIND, not the trigger', () => {
  it('a SOUND rule keeps its picture but is never saved as a crop', () => {
    // It photographs the camera at the match — a sound owns no region of the
    // frame, so the hub refuses `crop` for it (D897) and the editor saves the
    // nearest mode it can honour.
    const form = {
      ...seedFormForKind('sound'),
      name: 'Dog',
      targetIds: ['t1'],
      media: { image: 'crop', clip: true } satisfies NcMediaPolicy,
    }
    const input = formToInput(form, { ownTargetIds: ['t1'], catalog: CATALOG })
    expect(input.media).toEqual({ image: 'clean', clip: true })
  })

  it('a SYSTEM rule attaches nothing at all', () => {
    const form = {
      ...seedFormForKind('detection'),
      name: 'Node down',
      delivery: 'system-event' as const,
      targetIds: ['t1'],
      media: { image: 'scene-boxes', gif: true } satisfies NcMediaPolicy,
    }
    expect(formToInput(form, { ownTargetIds: ['t1'], catalog: CATALOG }).media).toEqual({ image: 'none' })
  })

  it('a DETECTION rule keeps every mode, the crop included', () => {
    for (const image of ['scene-boxes', 'crop', 'clean', 'none'] as const) {
      const form = { ...seedFormForKind('detection'), name: 'Person', targetIds: ['t1'], media: { image } }
      expect(formToInput(form, { ownTargetIds: ['t1'], catalog: CATALOG }).media).toEqual({ image })
    }
  })
})

describe('condition groups', () => {
  it('renders only the groups actually present, in the shared order', () => {
    expect(
      orderedConditionGroups([{ group: 'audio' }, { group: 'scope' }, { group: 'schedule' }]),
    ).toEqual(['scope', 'audio', 'schedule'])
  })

  it('APPENDS a group this build has never heard of instead of dropping it', () => {
    // The old `GROUP_ORDER.filter(...)` rendered nothing for a group the server
    // introduced — the silent drop the served catalog exists to prevent.
    expect(orderedConditionGroups([{ group: 'weather' }, { group: 'scope' }])).toEqual([
      'scope',
      'weather',
    ])
  })

  it('puts `package` before occupancy and audio — the admin order, adopted', () => {
    const order = [...NC_CONDITION_GROUP_ORDER]
    expect(order.indexOf('package')).toBeLessThan(order.indexOf('occupancy'))
    expect(order.indexOf('occupancy')).toBeLessThan(order.indexOf('audio'))
  })
})

// ── i18n ────────────────────────────────────────────────────────────

describe('every string this surface asks for exists in BOTH locales', () => {
  const KEYS: readonly string[] = [
    'v2.nc.rules.editor.dropTitle',
    'v2.nc.rules.editor.dropHint',
  ]

  it.each(KEYS)('%s', (key) => {
    expect(lookupLocale(enLocale, key), `en is missing ${key}`).toBeTruthy()
    expect(lookupLocale(itLocale, key), `it is missing ${key}`).toBeTruthy()
  })

  it('keys the drop reason on the kind AND the condition', () => {
    // Both halves, because the same condition is dropped by two kinds for two
    // different reasons — `source` is excluded from an occupancy rule because
    // an occupancy edge is always `pipeline`, and from a sound rule because a
    // window is always `audio`. A key on the condition alone would translate
    // one of the two wrongly.
    expect(dropReasonKey('occupancy', 'sensorKinds')).toBe(
      'v2.nc.rules.editor.dropReason.occupancy.sensorKinds',
    )
  })

  /**
   * THE EXCLUSION SENTENCES ARE TRANSLATED, in both languages.
   *
   * They rendered through `defaultValue` — the shared model's English — until
   * Phase 3. That was defensible while the key was a placeholder and not while
   * the warning is the thing standing between an operator and a silently
   * dropped value: an Italian operator reading an English paragraph in an
   * otherwise Italian form reads it as a bug and stops reading the warning,
   * which is the one outcome the warning exists to prevent.
   *
   * Derived from the shared model rather than listed, so an exclusion added
   * upstream fails this spec until both locales carry its sentence.
   */
  const EXCLUSION_KEYS: readonly string[] = NC_RULE_KIND_SPECS.flatMap((spec) =>
    Object.keys(spec.excluded).map((conditionId) => dropReasonKey(spec.kind, conditionId)),
  )

  it('covers all seventeen exclusions the shared model declares (D640 occupancy × sensorTransition, D690 detection × audio)', () => {
    expect(EXCLUSION_KEYS.length).toBe(17)
    expect(EXCLUSION_KEYS).toContain('v2.nc.rules.editor.dropReason.detection.audio')
  })

  it.each(EXCLUSION_KEYS)('%s is translated', (key) => {
    expect(lookupLocale(enLocale, key), `en is missing ${key}`).toBeTruthy()
    expect(lookupLocale(itLocale, key), `it is missing ${key}`).toBeTruthy()
  })

  /**
   * And the condition each reason is ABOUT is named in the operator's language.
   *
   * The warning renders `condition.<id>` above the sentence and falls back to
   * the raw descriptor id — so an operator was told, in Italian, that
   * "sensorKinds" would be removed. The id is the form state's key, not a word.
   */
  const DROPPED_CONDITION_KEYS: readonly string[] = [
    ...new Set(
      NC_RULE_KIND_SPECS.flatMap((spec) =>
        Object.keys(spec.excluded).map((id) => `v2.nc.rules.editor.condition.${id}`),
      ),
    ),
  ]

  it.each(DROPPED_CONDITION_KEYS)('%s names the condition', (key) => {
    expect(lookupLocale(enLocale, key), `en is missing ${key}`).toBeTruthy()
    expect(lookupLocale(itLocale, key), `it is missing ${key}`).toBeTruthy()
  })
})
