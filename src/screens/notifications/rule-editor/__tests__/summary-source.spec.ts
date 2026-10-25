/**
 * The pure half of the digest editor ROUTE: which rule `/summary-rule/[id]`
 * names, when it may say "not found", and what Save sends.
 *
 *  - A rule is reported MISSING only from a list that ANSWERED (D315).
 *  - The list also says whether this hub accepts the write at all
 *    (`canAuthor`): absent means an older hub, and the editor is read-only —
 *    and "new" waits for that answer rather than offering a form the hub
 *    would refuse.
 *  - An edit sends the diff AND the clears; an edit that changed nothing sends
 *    nothing at all.
 */
import { describe, expect, it } from 'vitest'
import type { NcListSummaryRulesResult, NcViewerSummaryRule } from '../../../../data/notification-center.js'
import { emptySummaryForm, summaryRuleToForm } from '../../../../components/notifications/summary-form.js'
import {
  isSummaryFormDirty,
  NEW_SUMMARY_ID,
  resolveSummarySource,
  summarySaveRequest,
} from '../summary-source.js'

const RULE: NcViewerSummaryRule = {
  id: 'sum1',
  name: 'Notte',
  enabled: true,
  deviceIds: [101],
  window: { kind: 'motion', quietSeconds: 120, maxWindowSeconds: 3600 },
  targets: [{ targetId: 't-own' }],
  priority: 3,
  maxTiles: 12,
  captionText: 'Notte {{from}}',
  createdBy: 'u1',
  createdAt: 1,
  updatedAt: 2,
  readOnly: false,
}

const LIST: NcListSummaryRulesResult = { rules: [RULE], canAuthor: true }
const OWN = { ownTargetIds: ['t-own'], isAdmin: false }

describe('resolveSummarySource', () => {
  it('is LOADING while the list has not answered — for "new" too, because canAuthor rides on it', () => {
    expect(resolveSummarySource('sum1', undefined, false, true)).toEqual({ status: 'loading' })
    expect(resolveSummarySource(NEW_SUMMARY_ID, undefined, false, true)).toEqual({ status: 'loading' })
  })

  it('is a FAILURE when the list could not be read — never "missing"', () => {
    expect(resolveSummarySource('sum1', undefined, true, true)).toEqual({ status: 'failed' })
  })

  it('is MISSING only when an answered list lacks the id', () => {
    expect(resolveSummarySource('nope', LIST, false, true)).toEqual({ status: 'missing' })
  })

  it('opens a blank form for "new" once the hub said it accepts the write', () => {
    expect(resolveSummarySource(NEW_SUMMARY_ID, LIST, false, true)).toEqual({
      status: 'ready',
      rule: null,
      readOnly: false,
      seed: emptySummaryForm(),
    })
  })

  it('an older hub (no canAuthor) cannot author: "new" is refused and an edit is read-only', () => {
    const old: NcListSummaryRulesResult = { rules: [RULE] }
    expect(resolveSummarySource(NEW_SUMMARY_ID, old, false, true)).toEqual({ status: 'cannot-author' })
    const source = resolveSummarySource('sum1', old, false, true)
    expect(source.status === 'ready' && source.readOnly).toBe(true)
  })

  it('seeds an existing rule from the rule itself and carries its read-only verdict', () => {
    const source = resolveSummarySource('sum1', { rules: [{ ...RULE, readOnly: true }], canAuthor: true }, false, true)
    expect(source.status).toBe('ready')
    if (source.status !== 'ready') return
    expect(source.readOnly).toBe(true)
    expect(source.seed).toEqual(summaryRuleToForm(RULE))
  })
})

describe('resolveSummarySource while DISCONNECTED (review m1/m6, D315)', () => {
  it('an unanswered list with no connection is "disconnected" — never missing, never hubTooOld', () => {
    expect(resolveSummarySource('sum1', undefined, false, false)).toEqual({ status: 'disconnected' })
    expect(resolveSummarySource(NEW_SUMMARY_ID, undefined, false, false)).toEqual({ status: 'disconnected' })
  })

  it('a list already answered keeps serving while the link is down', () => {
    expect(resolveSummarySource('sum1', LIST, false, false).status).toBe('ready')
  })
})

describe('summarySaveRequest', () => {
  it('a new rule is a CREATE', () => {
    const form = { ...emptySummaryForm(), name: 'N', deviceIds: [101], targetIds: ['t-own'] }
    expect(summarySaveRequest(form, null, OWN).mode).toBe('create')
  })

  it('an edit sends the diff AND the clears', () => {
    const form = { ...summaryRuleToForm(RULE), name: 'Rinominata', captionText: '' }
    expect(summarySaveRequest(form, RULE, OWN)).toEqual({
      mode: 'update',
      ruleId: 'sum1',
      patch: { name: 'Rinominata' },
      clear: ['captionText'],
    })
  })

  it('an edit that ONLY empties the caption is still an update', () => {
    const form = { ...summaryRuleToForm(RULE), captionText: '' }
    expect(summarySaveRequest(form, RULE, OWN)).toEqual({
      mode: 'update',
      ruleId: 'sum1',
      patch: {},
      clear: ['captionText'],
    })
  })

  it('an untouched edit sends nothing', () => {
    expect(summarySaveRequest(summaryRuleToForm(RULE), RULE, OWN)).toEqual({ mode: 'unchanged' })
  })
})

describe('isSummaryFormDirty', () => {
  it('is clean as seeded and dirty after a real change', () => {
    const seed = summaryRuleToForm(RULE)
    expect(isSummaryFormDirty(seed, seed)).toBe(false)
    expect(isSummaryFormDirty({ ...seed, maxTiles: 20 }, seed)).toBe(true)
  })
})
