/**
 * The "last run" line on a rule card — what it may CLAIM, decided once (D315).
 *
 *  - a read still in flight claims nothing (blank);
 *  - a read that FAILED says it could not look ("—" plus a hint), never
 *    "not in the last N days";
 *  - only an ANSWERED read may call a rule absent, and the window it names is
 *    the one the hub answered with (`horizonMs`, floored: days, then hours,
 *    then minutes) — `null` is a keep-forever outbox read to its end, "never
 *    recorded";
 *  - a non-admin viewer is never asked, so the line does not exist at all.
 */
import { describe, expect, it } from 'vitest'
import { lastRunAbsence, ruleLastRunLine, type RuleLastRunsRead } from '../rule-last-run.js'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function answered(horizonMs: number | null): RuleLastRunsRead {
  return {
    state: 'answered',
    data: {
      horizonMs,
      runs: [
        { ruleId: 'ran-sent', lastAt: 1_000, status: 'sent', deviceId: 7 },
        { ruleId: 'ran-dead', lastAt: 2_000, status: 'dead', deviceId: 8 },
        { ruleId: 'ran-pending', lastAt: 3_000, status: 'pending', deviceId: 9 },
      ],
    },
  }
}

describe('ruleLastRunLine', () => {
  it('a viewer who is not asked (non-admin) gets no line at all', () => {
    expect(ruleLastRunLine({ state: 'hidden' }, 'r1')).toBeUndefined()
  })

  it('a read in flight claims nothing', () => {
    expect(ruleLastRunLine({ state: 'pending' }, 'r1')).toEqual({ kind: 'blank' })
  })

  it('a failed read says it could not look, never that the rule did not run', () => {
    const line = ruleLastRunLine({ state: 'failed' }, 'r1')
    expect(line).toEqual({
      kind: 'failed',
      hintKey: 'v2.nc.rules.lastRun.unavailable',
    })
  })

  it('an answered absence names the window the hub answered, in days', () => {
    expect(ruleLastRunLine(answered(7 * DAY), 'never-ran')).toEqual({
      kind: 'absent',
      key: 'v2.nc.rules.lastRun.notInDays',
      count: 7,
    })
  })

  it('an answered absence with no horizon is "never recorded"', () => {
    expect(ruleLastRunLine(answered(null), 'never-ran')).toEqual({
      kind: 'absent',
      key: 'v2.nc.rules.lastRun.never',
    })
  })

  it('a rule that ran carries its time and its status word', () => {
    expect(ruleLastRunLine(answered(7 * DAY), 'ran-sent')).toEqual({
      kind: 'ran',
      lastAt: 1_000,
      status: 'sent',
      statusKey: 'v2.nc.rules.lastRun.status.sent',
    })
    expect(ruleLastRunLine(answered(7 * DAY), 'ran-dead')).toMatchObject({
      status: 'dead',
      statusKey: 'v2.nc.rules.lastRun.status.dead',
    })
    expect(ruleLastRunLine(answered(null), 'ran-pending')).toMatchObject({
      status: 'pending',
      statusKey: 'v2.nc.rules.lastRun.status.pending',
    })
  })
})

describe('lastRunAbsence — floored, never rounded up', () => {
  it('days: a narrowed 5.9-day window is 5 days, never 6', () => {
    expect(lastRunAbsence(5.9 * DAY)).toEqual({ key: 'v2.nc.rules.lastRun.notInDays', count: 5 })
    expect(lastRunAbsence(DAY)).toEqual({ key: 'v2.nc.rules.lastRun.notInDays', count: 1 })
  })

  it('hours: under a day', () => {
    expect(lastRunAbsence(23.9 * HOUR)).toEqual({ key: 'v2.nc.rules.lastRun.notInHours', count: 23 })
    expect(lastRunAbsence(HOUR)).toEqual({ key: 'v2.nc.rules.lastRun.notInHours', count: 1 })
  })

  it('minutes: under an hour', () => {
    expect(lastRunAbsence(59.9 * MINUTE)).toEqual({ key: 'v2.nc.rules.lastRun.notInMinutes', count: 59 })
    expect(lastRunAbsence(MINUTE)).toEqual({ key: 'v2.nc.rules.lastRun.notInMinutes', count: 1 })
  })

  it('under a minute claims no span it did not read', () => {
    expect(lastRunAbsence(30_000)).toEqual({ key: 'v2.nc.rules.lastRun.notInWindow' })
  })

  it('null is never recorded', () => {
    expect(lastRunAbsence(null)).toEqual({ key: 'v2.nc.rules.lastRun.never' })
  })
})
