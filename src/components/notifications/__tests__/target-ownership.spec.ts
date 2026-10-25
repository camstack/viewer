/**
 * FOR AN ADMIN (the hub skips his ownership check): an admin editing a GLOBAL rule sees only HIS targets in the picker, but the
 * rule may deliver to other users' targets too. Those are not his to drop: a
 * save that filtered the stored list by "mine" deleted every other user's
 * target on every save (review I1). The ownership filter applies only to ids
 * the operator ADDED; a stored target he cannot see rides through verbatim.
 */
import { describe, expect, it } from 'vitest'
import {
  ownershipSafeTargets,
  savedTargetIds,
  targetSaveContext,
  unlistedTargetCount,
  unlistedTargetNote,
} from '../target-ownership.js'
import { emptyRuleForm, ruleFormProblems } from '../rule-editor.js'
import { emptyTimelapseForm, timelapseFormProblems } from '../timelapse-form.js'
import { emptySummaryForm, summaryFormProblems } from '../summary-form.js'

type T = { readonly targetId: string; readonly params?: Readonly<Record<string, string>> }
const keep = (id: string, stored: T | undefined): T => stored ?? { targetId: id }
const ADMIN = { preserveUnlisted: true }
const USER = { preserveUnlisted: false }

const STORED: readonly T[] = [
  { targetId: 't-admin' },
  { targetId: 't-user', params: { sound: 'siren' } },
]

describe('ownershipSafeTargets', () => {
  it('an untouched selection returns the stored list exactly — foreign target included', () => {
    expect(ownershipSafeTargets(['t-admin', 't-user'], STORED, ['t-admin'], keep, ADMIN)).toEqual(STORED)
  })

  it('keeps a foreign target even when the selection does not name it', () => {
    expect(ownershipSafeTargets(['t-admin'], STORED, ['t-admin'], keep, ADMIN)).toEqual(STORED)
  })

  it('drops an OWN target the operator deselected, and appends one he added', () => {
    expect(ownershipSafeTargets(['t-second'], STORED, ['t-admin', 't-second'], keep, ADMIN)).toEqual([
      { targetId: 't-user', params: { sound: 'siren' } },
      { targetId: 't-second' },
    ])
  })

  it('never ADDS a target the caller does not own', () => {
    expect(ownershipSafeTargets(['t-admin', 't-stranger'], [], ['t-admin'], keep, ADMIN)).toEqual([
      { targetId: 't-admin' },
    ])
  })
})

describe('ownershipSafeTargets for a NON-admin (fix round 2, NB1)', () => {
  // The hub REFUSES a non-admin save that carries a target he does not own —
  // and a target he deleted (`nc.deleteMyTarget`) stays on his rules. Keeping
  // it would make every later save of that rule, a rename included, fail.
  it('drops a stored id that is not in his list — the old behaviour', () => {
    expect(ownershipSafeTargets(['t1', 't-gone'], [{ targetId: 't1' }, { targetId: 't-gone' }], ['t1'], keep, USER)).toEqual([
      { targetId: 't1' },
    ])
  })
})

describe('unlistedTargetCount', () => {
  it('counts the stored targets not in the caller\'s list', () => {
    expect(unlistedTargetCount(STORED, ['t-admin'])).toBe(1)
    expect(unlistedTargetCount(STORED, ['t-admin', 't-user'])).toBe(0)
    expect(unlistedTargetCount([], ['t-admin'])).toBe(0)
  })
})

describe('unlistedTargetNote — what the picker SAYS about the unlisted ones', () => {
  const stored = [{ targetId: 't1' }, { targetId: 't-other' }]
  it('an admin is told they are KEPT', () => {
    expect(unlistedTargetNote(stored, ['t1'], 'admin')).toEqual({ count: 1, fate: 'kept' })
  })
  it('a non-admin is told they will be REMOVED on save', () => {
    expect(unlistedTargetNote(stored, ['t1'], 'not-admin')).toEqual({ count: 1, fate: 'removed' })
  })
  it('says nothing while the role or the list is unknown, or when there is nothing to say', () => {
    expect(unlistedTargetNote(stored, ['t1'], 'pending')).toBeUndefined()
    expect(unlistedTargetNote(stored, undefined, 'admin')).toBeUndefined()
    expect(unlistedTargetNote(stored, ['t1', 't-other'], 'admin')).toBeUndefined()
  })
})

describe('validity counts the targets the save will SEND (final review m3)', () => {
  // A non-admin's save drops every stored id he does not own. A `kept-disabled`
  // rule whose last target was deleted used to validate on the stale id, then
  // send `targets: []`, and the hub refused it in raw English.
  const STALE_ONLY = { ownTargetIds: ['t-mine'], stored: [{ targetId: 't-gone' }] }

  it('targetSaveContext exists only once the role AND the list have answered', () => {
    expect(targetSaveContext('pending', ['t-mine'], [])).toBeUndefined()
    expect(targetSaveContext('unknown', ['t-mine'], [])).toBeUndefined()
    expect(targetSaveContext('not-admin', undefined, [])).toBeUndefined()
    expect(targetSaveContext('not-admin', ['t-mine'], [])).toEqual({ ownTargetIds: ['t-mine'], stored: [], isAdmin: false })
  })

  it('savedTargetIds: a user loses a foreign id, an admin keeps it', () => {
    expect(savedTargetIds(['t-gone'], { ...STALE_ONLY, isAdmin: false })).toEqual([])
    expect(savedTargetIds(['t-gone'], { ...STALE_ONLY, isAdmin: true })).toEqual(['t-gone'])
    expect(savedTargetIds(['t-gone'], undefined)).toEqual(['t-gone'])
  })

  it('rule: a non-admin whose only target is not his has a `targets` problem', () => {
    const form = { ...emptyRuleForm(), name: 'x', targetIds: ['t-gone'] }
    expect(ruleFormProblems(form, { targets: { ...STALE_ONLY, isAdmin: false } })).toContain('targets')
    expect(ruleFormProblems(form, { isAdmin: true, targets: { ...STALE_ONLY, isAdmin: true } })).not.toContain('targets')
    // A user addressee still counts.
    expect(ruleFormProblems({ ...form, targetUsers: ['u1'] }, { targets: { ...STALE_ONLY, isAdmin: false } })).not.toContain('targets')
  })

  it('timelapse and digest: the same', () => {
    const tl = { ...emptyTimelapseForm(), targetIds: ['t-gone'] }
    expect(timelapseFormProblems(tl, { ...STALE_ONLY, isAdmin: false })).toContain('targets')
    expect(timelapseFormProblems(tl, { ...STALE_ONLY, isAdmin: true })).not.toContain('targets')
    const sum = { ...emptySummaryForm(), targetIds: ['t-gone'] }
    expect(summaryFormProblems(sum, { ...STALE_ONLY, isAdmin: false })).toContain('targets')
    expect(summaryFormProblems(sum, { ...STALE_ONLY, isAdmin: true })).not.toContain('targets')
  })
})
