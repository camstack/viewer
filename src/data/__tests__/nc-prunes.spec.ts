/**
 * The viewer's mirror of `nc.listPrunes`, and the one question a screen asks
 * of it: did the deleted-device prune switch THIS rule off, and is it still
 * off? The same rules as the admin banner (`addon-admin-ui`
 * `notification-prunes.ts`).
 */
import { describe, expect, it, vi } from 'vitest'
import { makeNcClient } from '../notification-center.js'
import {
  NcListPrunesResultSchema,
  type NcPruneRecord,
  pruneBannerFor,
} from '../nc-prunes.js'

const KEPT: NcPruneRecord = {
  kind: 'rule',
  ruleId: 'r1',
  subjectKind: 'device',
  subject: '102',
  field: 'conditions.devices',
  outcome: 'kept-disabled',
  at: 5_000,
  source: 'event',
}

describe('NcListPrunesResultSchema', () => {
  it('parses the hub answer', () => {
    expect(NcListPrunesResultSchema.parse({ prunes: [KEPT] }).prunes).toEqual([KEPT])
  })

  it('refuses a malformed answer rather than reading it as "nothing pruned"', () => {
    expect(NcListPrunesResultSchema.safeParse({ produced: 1 }).success).toBe(false)
  })
})

describe('pruneBannerFor', () => {
  it('answers the kept-disabled prune of a rule that is still off', () => {
    expect(pruneBannerFor([KEPT], 'rule', 'r1', false, KEPT.at)).toEqual(KEPT)
  })

  it('answers nothing once the rule is back on (the operator chose it)', () => {
    expect(pruneBannerFor([KEPT], 'rule', 'r1', true, KEPT.at)).toBeNull()
  })

  it('answers nothing for a removal, a rule that was already off, or another rule', () => {
    expect(pruneBannerFor([{ ...KEPT, outcome: 'removed' }], 'rule', 'r1', false, KEPT.at)).toBeNull()
    expect(pruneBannerFor([{ ...KEPT, outcome: 'kept' }], 'rule', 'r1', false, KEPT.at)).toBeNull()
    expect(pruneBannerFor([KEPT], 'timelapse', 'r1', false, KEPT.at)).toBeNull()
    expect(pruneBannerFor([KEPT], 'rule', 'r2', false, KEPT.at)).toBeNull()
  })

  it('a LATER prune write on the same still-disabled rule keeps the banner', () => {
    const later = { ...KEPT, subject: 't-x', subjectKind: 'target' as const, field: 'targets', outcome: 'removed' as const, at: KEPT.at + 5_000 }
    // The later prune write bumped the rule's updatedAt past the kept row.
    expect(pruneBannerFor([KEPT, later], 'rule', 'r1', false, KEPT.at + 4_000)).toEqual(KEPT)
  })

  it('an operator edit after EVERY prune hides it', () => {
    const later = { ...KEPT, subject: 't-x', subjectKind: 'target' as const, field: 'targets', outcome: 'removed' as const, at: KEPT.at + 5_000 }
    expect(pruneBannerFor([KEPT, later], 'rule', 'r1', false, KEPT.at + 6_000)).toBeNull()
  })

  it('a rule touched AFTER the prune (re-enabled, then off again) gets no banner', () => {
    expect(pruneBannerFor([KEPT], 'rule', 'r1', false, KEPT.at + 60_000)).toBeNull()
  })

  it('picks the newest when several subjects were kept', () => {
    const older = { ...KEPT, subject: '600', at: 1 }
    expect(pruneBannerFor([KEPT, older], 'rule', 'r1', false, KEPT.at)?.subject).toBe('102')
  })
})

describe('ncClient.listPrunes', () => {
  it('asks pipeline-analytics for nc.listPrunes and validates the answer', async () => {
    const mutate = vi.fn(async () => ({ prunes: [KEPT] }))
    const client = makeNcClient({ addonsCustomMutate: mutate })
    await expect(client.listPrunes()).resolves.toEqual({ prunes: [KEPT] })
    expect(mutate).toHaveBeenCalledWith({
      addonId: 'pipeline-analytics',
      action: 'nc.listPrunes',
      input: {},
    })
  })

  it('throws on a malformed answer (never "nothing pruned")', async () => {
    const client = makeNcClient({ addonsCustomMutate: async () => ({ produced: 1 }) })
    await expect(client.listPrunes()).rejects.toThrow()
  })
})
