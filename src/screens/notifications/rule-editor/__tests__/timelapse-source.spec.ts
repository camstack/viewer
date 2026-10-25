/**
 * The pure half of the timelapse editor ROUTE: which rule `/timelapse-rule/[id]`
 * names, when it may say "not found", and what Save sends.
 *
 *  - A rule is reported MISSING only from a list that ANSWERED (D315). An
 *    unanswered query is loading; a failed one is a failure — neither is a
 *    rule that does not exist.
 *  - An edit sends the diff AND the clears; an edit that changed nothing sends
 *    nothing at all.
 *  - The back guard fires on a real change only.
 */
import { describe, expect, it } from 'vitest'
import type { NcViewerTimelapseRule } from '../../../../data/notification-center.js'
import { emptyTimelapseForm, timelapseRuleToForm } from '../../../../components/notifications/timelapse-form.js'
import {
  isTimelapseFormDirty,
  NEW_TIMELAPSE_ID,
  resolveTimelapseSource,
  timelapseSaveRequest,
} from '../timelapse-source.js'

const RULE: NcViewerTimelapseRule = {
  id: 'tl1',
  name: 'Notte',
  enabled: true,
  deviceIds: [101],
  schedule: { windows: [{ days: [0, 1, 2, 3, 4, 5, 6], startMinute: 1320, endMinute: 360 }] },
  cadenceSec: 15,
  framerate: 10,
  denseCadenceSec: 0.5,
  previewText: 'Notte {{camera}}',
  previewMode: 'image',
  targets: [{ targetId: 't-own' }],
  priority: 3,
  createdBy: 'u1',
  createdAt: 1,
  updatedAt: 2,
  readOnly: false,
}

const OWN = { ownTargetIds: ['t-own'], isAdmin: false }

describe('resolveTimelapseSource', () => {
  it('opens a blank form for "new" without waiting for the list', () => {
    const source = resolveTimelapseSource(NEW_TIMELAPSE_ID, undefined, false)
    expect(source).toEqual({ status: 'ready', rule: null, readOnly: false, seed: emptyTimelapseForm() })
  })

  it('is LOADING while the list has not answered — never "missing"', () => {
    expect(resolveTimelapseSource('tl1', undefined, false)).toEqual({ status: 'loading' })
  })

  it('is a FAILURE when the list could not be read — never "missing"', () => {
    expect(resolveTimelapseSource('tl1', undefined, true)).toEqual({ status: 'failed' })
  })

  it('is MISSING only when an answered list lacks the id', () => {
    expect(resolveTimelapseSource('nope', [RULE], false)).toEqual({ status: 'missing' })
  })

  it('seeds an existing rule from the rule itself and carries its read-only verdict', () => {
    const source = resolveTimelapseSource('tl1', [{ ...RULE, readOnly: true }], false)
    expect(source.status).toBe('ready')
    if (source.status !== 'ready') return
    expect(source.readOnly).toBe(true)
    expect(source.seed).toEqual(timelapseRuleToForm(RULE))
  })
})

describe('timelapseSaveRequest', () => {
  it('a new rule is a CREATE of the whole input', () => {
    const form = { ...emptyTimelapseForm(), name: 'N', deviceIds: [101], schedule: RULE.schedule, targetIds: ['t-own'] }
    const request = timelapseSaveRequest(form, null, OWN)
    expect(request.mode).toBe('create')
  })

  it('an edit sends the diff AND the clears', () => {
    const form = { ...timelapseRuleToForm(RULE), name: 'Rinominata', previewText: '', denseCadenceSec: undefined }
    expect(timelapseSaveRequest(form, RULE, OWN)).toEqual({
      mode: 'update',
      ruleId: 'tl1',
      patch: { name: 'Rinominata' },
      clear: ['previewText', 'denseCadenceSec'],
    })
  })

  it('an edit that ONLY empties a field is still an update — the clear is the whole edit', () => {
    const form = { ...timelapseRuleToForm(RULE), previewText: '' }
    expect(timelapseSaveRequest(form, RULE, OWN)).toEqual({
      mode: 'update',
      ruleId: 'tl1',
      patch: {},
      clear: ['previewText'],
    })
  })

  it('an untouched GLOBAL rule with another user\'s target is UNCHANGED (review I1)', () => {
    const shared = { ...RULE, targets: [{ targetId: 't-admin' }, { targetId: 't-user' }] }
    expect(timelapseSaveRequest(timelapseRuleToForm(shared), shared, { ownTargetIds: ['t-admin'], isAdmin: true })).toEqual({
      mode: 'unchanged',
    })
  })

  it('an edit that changed nothing sends nothing', () => {
    expect(timelapseSaveRequest(timelapseRuleToForm(RULE), RULE, OWN)).toEqual({ mode: 'unchanged' })
  })
})

describe('isTimelapseFormDirty', () => {
  it('is clean on the seed and dirty on any change', () => {
    const seed = timelapseRuleToForm(RULE)
    expect(isTimelapseFormDirty(seed, seed)).toBe(false)
    expect(isTimelapseFormDirty({ ...seed }, seed)).toBe(false)
    expect(isTimelapseFormDirty({ ...seed, template: { title: 'x', body: '' } }, seed)).toBe(true)
    expect(isTimelapseFormDirty({ ...seed, reportClasses: ['person'] }, seed)).toBe(true)
  })
})
