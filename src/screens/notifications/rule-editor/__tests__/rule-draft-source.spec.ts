import { describe, expect, it } from 'vitest'
import { NcViewerRuleSchema, type NcViewerRule } from '../../../../data/notification-center.js'
import { emptyRuleForm, formToInput, ruleFormKind } from '../../../../components/notifications/rule-editor.js'
import { withDeliveryChange } from '../../../../components/notifications/rule-kind-nav.js'
import {
  resolveDraftSource,
  ruleDryRunInput,
  ruleFormProblems,
  ruleSaveRequest,
  seedFormForKind,
} from '../rule-draft-source.js'

function makeRule(overrides: Record<string, unknown> = {}): NcViewerRule {
  return NcViewerRuleSchema.parse({
    id: 'r1',
    name: 'Front door',
    enabled: true,
    delivery: 'immediate',
    conditions: { classes: ['person'] },
    targets: [{ targetId: 't1' }],
    media: { attach: 'best' },
    priority: 3,
    createdBy: 'me',
    createdAt: 1,
    updatedAt: 2,
    disabledTargetIds: [],
    readOnly: false,
    template: { title: 'Hello' },
    ...overrides,
  })
}

describe('resolveDraftSource', () => {
  it('an existing rule waits for the list', () => {
    expect(resolveDraftSource({ id: 'r1' }, undefined)).toEqual({ status: 'loading' })
  })

  it('a list that ANSWERED without the id is missing — never an empty form', () => {
    expect(resolveDraftSource({ id: 'gone' }, [makeRule()])).toEqual({ status: 'missing' })
  })

  it('an existing rule opens on its own kind and its own form, keyed by id', () => {
    const rule = makeRule({ delivery: 'device-event', conditions: {} })
    const source = resolveDraftSource({ id: 'r1', kind: 'sound' }, [rule])
    expect(source.status).toBe('ready')
    if (source.status !== 'ready') return
    expect(source.kind).toBe('sensor')
    expect(source.rule?.id).toBe('r1')
    expect(source.draft.key).toBe('r1')
    expect(source.draft.form.name).toBe('Front door')
    expect(source.draft.form).toEqual(source.draft.baseline)
  })

  it('a new rule needs a known kind, and does not wait for the list', () => {
    expect(resolveDraftSource({ id: 'new' }, undefined)).toEqual({ status: 'needs-kind' })
    expect(resolveDraftSource({ id: 'new', kind: 'nonsense' }, undefined)).toEqual({ status: 'needs-kind' })
    const source = resolveDraftSource({ id: 'new', kind: 'occupancy' }, undefined)
    expect(source.status).toBe('ready')
    if (source.status !== 'ready') return
    expect(source.rule).toBeNull()
    expect(source.draft.key).toBe('new:occupancy')
    expect(source.draft.form.delivery).toBe('device-event')
    expect(source.draft.form.conditions.occupancy).toBeDefined()
  })

  it('a read-only rule (an admin rule, for a non-admin) opens READ-ONLY', () => {
    const source = resolveDraftSource({ id: 'r1' }, [makeRule({ readOnly: true })])
    expect(source.status === 'ready' && source.readOnly).toBe(true)
    const own = resolveDraftSource({ id: 'r1' }, [makeRule()])
    expect(own.status === 'ready' && own.readOnly).toBe(false)
    const fresh = resolveDraftSource({ id: 'new', kind: 'sound' }, undefined)
    expect(fresh.status === 'ready' && fresh.readOnly).toBe(false)
  })

  it('a stored MIXED rule opens read-only, even for an admin who owns it (D637)', () => {
    const mixed = makeRule({
      delivery: 'system-event',
      conditions: { systemEvent: { kinds: ['device-offline', 'alarm-armed'] } },
      readOnly: false,
    })
    const source = resolveDraftSource({ id: 'r1' }, [mixed])
    expect(source.status).toBe('ready')
    if (source.status !== 'ready') return
    expect(source.kind).toBe('mixed')
    expect(source.readOnly).toBe(true)
  })

  it('a family rule stays editable, and opens on its family', () => {
    const battery = makeRule({
      delivery: 'system-event',
      conditions: { systemEvent: { kinds: ['device-battery-low'] } },
      readOnly: false,
    })
    const source = resolveDraftSource({ id: 'r1' }, [battery])
    if (source.status !== 'ready') throw new Error('not ready')
    expect(source.kind).toBe('device-events')
    expect(source.readOnly).toBe(false)
    expect(source.draft.kind).toBe('device-events')
  })

  it('a new rule of a family opens seeded as that family; `mixed` and `battery` are not kinds a route may name', () => {
    const alarm = resolveDraftSource({ id: 'new', kind: 'alarm' }, undefined)
    if (alarm.status !== 'ready') throw new Error('not ready')
    expect(alarm.draft.key).toBe('new:alarm')
    expect(alarm.draft.form.conditions.systemEvent?.kinds).toEqual(['alarm-triggered'])
    expect(resolveDraftSource({ id: 'new', kind: 'battery' }, undefined)).toEqual({ status: 'needs-kind' })
    expect(resolveDraftSource({ id: 'new', kind: 'mixed' }, undefined)).toEqual({ status: 'needs-kind' })
  })

  it('a fresh draft has not been through a save attempt', () => {
    const source = resolveDraftSource({ id: 'new', kind: 'sound' }, undefined)
    expect(source.status === 'ready' && source.draft.saveAttempted).toBe(false)
  })

  it('seeds a sensor rule on device-event', () => {
    expect(seedFormForKind('sensor').delivery).toBe('device-event')
    expect(seedFormForKind('sensor').conditions).toEqual({})
  })

  it('seeds a detection rule on the PIPELINE source (operator, 2026-10-01)', () => {
    expect(seedFormForKind('detection')).toEqual({
      ...emptyRuleForm(),
      delivery: 'immediate',
      conditions: { source: 'pipeline' },
    })
  })
})

describe('ruleSaveRequest', () => {
  it('a NON-admin rename drops a target he no longer has (fix round 2, NB1)', () => {
    // `nc.deleteMyTarget` leaves the id on his rule, and the hub refuses a
    // non-admin save carrying a target he does not own.
    const rule = makeRule({ targets: [{ targetId: 't1' }, { targetId: 't-gone' }] })
    const source = resolveDraftSource({ id: 'r1' }, [rule])
    if (source.status !== 'ready') throw new Error('not ready')
    const renamed = { ...source.draft.form, name: 'Renamed' }
    const request = ruleSaveRequest(renamed, rule, { ownTargetIds: ['t1'], catalog: [], isAdmin: false })
    if (request.mode !== 'update') throw new Error('not an update')
    expect(request.patch.targets).toEqual([{ targetId: 't1' }])
  })

  it('an admin save of a GLOBAL rule keeps another user\'s target (review I1)', () => {
    const rule = makeRule({ targets: [{ targetId: 't1' }, { targetId: 't-user', params: { sound: 'siren' } }] })
    const source = resolveDraftSource({ id: 'r1' }, [rule])
    if (source.status !== 'ready') throw new Error('not ready')
    const renamed = { ...source.draft.form, name: 'Renamed' }
    const request = ruleSaveRequest(renamed, rule, { ownTargetIds: ['t1'], catalog: [], isAdmin: true })
    if (request.mode !== 'update') throw new Error('not an update')
    // The rule editor's patch is the whole input, so `targets` always travels —
    // it must travel WHOLE.
    expect(request.patch.targets).toEqual(rule.targets)
  })

  it('an update sends the clears computed from the form (an emptied message is emptied)', () => {
    const rule = makeRule()
    const source = resolveDraftSource({ id: 'r1' }, [rule])
    if (source.status !== 'ready') throw new Error('not ready')
    const form = { ...source.draft.form, templateTitle: '', templateBody: '' }
    const request = ruleSaveRequest(form, rule, { ownTargetIds: ['t1'], catalog: [] })
    expect(request.mode).toBe('update')
    if (request.mode !== 'update') return
    expect(request.ruleId).toBe('r1')
    expect(request.clear).toContain('template')
    expect(request.patch.throttle).toEqual(rule.throttle)
  })

  it('a create sends the input and no clear', () => {
    const form = { ...seedFormForKind('detection'), name: 'x', targetIds: ['t1'] }
    const request = ruleSaveRequest(form, null, { ownTargetIds: ['t1'], catalog: [] })
    expect(request).toEqual({ mode: 'create', input: formToInput(form, { ownTargetIds: ['t1'], catalog: [] }) })
  })
})

describe('ruleDryRunInput — the dry-run sends what a save would send', () => {
  it('an edited rule sends the update patch, preserved throttle and all', () => {
    const rule = makeRule({ throttle: { cooldownSec: 90, scope: 'rule', granularity: 'per-class' } })
    const source = resolveDraftSource({ id: 'r1' }, [rule])
    if (source.status !== 'ready') throw new Error('not ready')
    const form = { ...source.draft.form, name: 'Edited, unsaved' }
    const options = { ownTargetIds: ['t1'], catalog: [], isAdmin: true }
    const request = ruleSaveRequest(form, rule, options)
    if (request.mode !== 'update') throw new Error('expected update')
    const input = ruleDryRunInput(form, rule, options)
    expect(input).toEqual(request.patch)
    expect(input.name).toBe('Edited, unsaved')
    expect(input.throttle).toEqual(rule.throttle)
  })

  it('a new rule sends the create input', () => {
    const form = { ...seedFormForKind('detection'), name: 'x', targetIds: ['t1', 'foreign'] }
    const options = { ownTargetIds: ['t1'], catalog: [] }
    expect(ruleDryRunInput(form, null, options)).toEqual(formToInput(form, options))
    expect(ruleDryRunInput(form, null, options).targets).toEqual([{ targetId: 't1' }])
  })
})

describe('ruleFormProblems', () => {
  it('names what blocks a save, in the order the Rule sub-screen shows it', () => {
    expect(ruleFormProblems(emptyRuleForm())).toEqual(['name', 'targets'])
    expect(ruleFormProblems({ ...emptyRuleForm(), name: ' x ' })).toEqual(['targets'])
    expect(ruleFormProblems({ ...emptyRuleForm(), name: 'x', targetIds: ['t1'] })).toEqual([])
  })
})

// Moved from rule-sections.spec.ts when `emptyRuleFormForSection` (the section
// seed, no longer called by anything) was deleted: the seed a "New <kind>" opens
// on is `seedFormForKind`, and these are the properties that matter about it.
describe('a seeded create opens the kind its button named', () => {
  it.each(['detection', 'sensor', 'sound', 'occupancy', 'system'] as const)('%s', (kind) => {
    const form = seedFormForKind(kind)
    expect(ruleFormKind(form), `${kind} seed misclassifies`).toBe(kind)
  })

  it('seeds the CONDITION, and nothing else — the rest of the form is blank', () => {
    const form = seedFormForKind('occupancy')
    expect(form.delivery).toBe('device-event')
    expect(form.conditions.occupancy).toEqual({ op: 'became-occupied', count: 1, sustainSeconds: 15 })
    expect(form.name).toBe('')
    expect(form.targetIds).toEqual([])
  })

  it('the sound seed carries a level floor, so the new rule can FIRE', () => {
    // With neither a level nor a label the engine returns false for every
    // window: a preset without one hands the operator a dead rule.
    expect(seedFormForKind('sound').conditions.audio?.dbThreshold).toBeLessThan(0)
  })
})

/**
 * Addendum (2026-10-01): the `source: 'pipeline'` a detection rule is seeded
 * with belongs to DETECTION triggers only. A delivery change onto any other
 * trigger drops that default; an operator's own other choice is kept.
 */
describe('withDeliveryChange', () => {
  const seeded = seedFormForKind('detection')

  it('a detection trigger keeps the pipeline default', () => {
    expect(withDeliveryChange(seeded, 'track-end')).toEqual({ delivery: 'track-end', conditions: { source: 'pipeline' } })
  })

  it('a sensor (or any other) trigger drops it', () => {
    expect(withDeliveryChange(seeded, 'device-event')).toEqual({ delivery: 'device-event', conditions: {} })
    expect(withDeliveryChange(seeded, 'package-event')).toEqual({ delivery: 'package-event', conditions: {} })
  })

  it('a source the operator chose is not the default, and stays', () => {
    const onboard = { ...seeded, conditions: { source: 'onboard' as const } }
    expect(withDeliveryChange(onboard, 'device-event')).toEqual({
      delivery: 'device-event',
      conditions: { source: 'onboard' },
    })
  })
})
