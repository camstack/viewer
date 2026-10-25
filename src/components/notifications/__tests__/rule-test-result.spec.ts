import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import { NcViewerRuleSchema, type NcDryRunRecord, type NcRuleTestResult } from '../../../data/notification-center.js'
import {
  NC_RULE_TEST_KEYS,
  canDryRun,
  canTestNow,
  dryRunRecordLine,
  dryRunSummaryLine,
  ruleTestNowLines,
} from '../rule-test-result.js'

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

function record(overrides: Partial<NcDryRunRecord> = {}): NcDryRunRecord {
  return {
    recordId: 'r1',
    recordKind: 'object-event',
    deviceId: 7,
    timestamp: 1_000,
    wouldFire: true,
    ...overrides,
  }
}

function outcome(overrides: Partial<NcRuleTestResult> = {}): NcRuleTestResult {
  return {
    recordId: 'synthetic:1',
    origin: 'synthetic',
    delivery: 'immediate',
    candidates: 1,
    outcomes: [
      {
        ruleId: 'r1',
        ruleName: 'Front door',
        matched: true,
        cooldown: 'bypassed',
        enqueued: 2,
        targetIds: ['t1', 't2'],
      },
    ],
    still: 'none',
    notes: [],
    trigger: 'immediate',
    planNotes: [],
    ...overrides,
  }
}

describe('dry-run record line', () => {
  it('a refused record names the condition that refused it', () => {
    expect(dryRunRecordLine({ wouldFire: false, failedCondition: 'classes' })).toEqual({
      key: 'v2.nc.rules.test.failed',
      params: { condition: 'classes' },
    })
  })
  it('a record that would fire says so', () => {
    expect(dryRunRecordLine({ wouldFire: true })).toEqual({ key: 'v2.nc.rules.test.wouldFire' })
  })
  it('a refusal without a named condition is still a refusal, never a blank', () => {
    expect(dryRunRecordLine({ wouldFire: false })).toEqual({ key: 'v2.nc.rules.test.notMatched' })
  })
})

describe('dry-run summary line', () => {
  it('counts the records that would fire', () => {
    const results = [record(), record({ recordId: 'r2', wouldFire: false, failedCondition: 'zones' })]
    expect(dryRunSummaryLine(results, 'immediate')).toEqual({
      key: 'v2.nc.rules.test.firingCount',
      params: { firing: 1, total: 2 },
    })
  })
  it('an empty answer says there was nothing to evaluate — not that the rule never fires', () => {
    expect(dryRunSummaryLine([], 'track-end')).toEqual({ key: 'v2.nc.rules.test.noRecords' })
  })
  it('a device-event rule is said to be undry-runnable, whatever came back', () => {
    expect(dryRunSummaryLine([], 'device-event')).toEqual({ key: 'v2.nc.rules.test.deviceEventUnsupported' })
  })
})

describe('test-now lines', () => {
  it('a match that queued something says how much, and where', () => {
    expect(ruleTestNowLines(outcome())).toEqual([
      { key: 'v2.nc.rules.test.now.queued', params: { count: 2, targets: 2 } },
    ])
  })
  it('a planNotes entry becomes one note line', () => {
    const lines = ruleTestNowLines(
      outcome({ planNotes: [{ conditionId: 'devices', note: 'This rule names no camera.' }] }),
    )
    expect(lines).toHaveLength(2)
    expect(lines[1]).toEqual({
      key: 'v2.nc.rules.test.note',
      params: { condition: 'devices', note: 'This rule names no camera.' },
    })
  })
  it('a live still is said next to the verdict', () => {
    expect(ruleTestNowLines(outcome({ still: 'live' }))).toContainEqual({ key: 'v2.nc.rules.test.now.still.live' })
  })
  it('a refusal names the condition, like the dry-run does', () => {
    const lines = ruleTestNowLines(
      outcome({
        outcomes: [
          {
            ruleId: 'r1',
            ruleName: 'Front door',
            matched: false,
            failedCondition: 'schedule',
            cooldown: 'n/a',
            enqueued: 0,
            targetIds: [],
          },
        ],
      }),
    )
    expect(lines[0]).toEqual({ key: 'v2.nc.rules.test.failed', params: { condition: 'schedule' } })
  })
  it('a match with nothing queued is not reported as sent', () => {
    const lines = ruleTestNowLines(
      outcome({
        outcomes: [
          { ruleId: 'r1', ruleName: 'x', matched: true, cooldown: 'bypassed', enqueued: 0, targetIds: [] },
        ],
      }),
    )
    expect(lines[0]).toEqual({ key: 'v2.nc.rules.test.now.noneQueued' })
  })
  it('a rule that was no candidate names the trigger it was tested with', () => {
    expect(ruleTestNowLines(outcome({ outcomes: [], trigger: 'track-end' }))[0]).toEqual({
      key: 'v2.nc.rules.test.now.notCandidate',
      params: { trigger: 'track-end' },
    })
  })
  it('an event dropped before evaluation says what dropped it', () => {
    expect(ruleTestNowLines(outcome({ droppedBy: 'camera-muted' }))[0]).toEqual({
      key: 'v2.nc.rules.test.now.dropped',
      params: { reason: 'camera-muted' },
    })
  })
  it('the server notes ride along, one line each', () => {
    expect(ruleTestNowLines(outcome({ notes: ['cooldown bypassed'] }))).toContainEqual({
      key: 'v2.nc.rules.test.detail',
      params: { note: 'cooldown bypassed' },
    })
  })
})

describe('who sees the tests', () => {
  const rule = NcViewerRuleSchema.parse({
    id: 'r1',
    name: 'Door',
    enabled: true,
    delivery: 'immediate',
    conditions: {},
    targets: [{ targetId: 't1' }],
    media: { attach: 'none' },
    priority: 3,
    createdBy: 'me',
    createdAt: 1,
    updatedAt: 1,
    readOnly: false,
  })
  it('the dry-run: a CONFIRMED admin, never on a system rule, never while auth.me is pending', () => {
    expect(canDryRun('admin', 'detection')).toBe(true)
    expect(canDryRun('admin', 'sensor')).toBe(true)
    // No detection record behind ANY system rule kind (D637).
    for (const kind of ['device-events', 'system', 'alarm', 'mixed'] as const) {
      expect(canDryRun('admin', kind), kind).toBe(false)
    }
    expect(canDryRun('pending', 'detection')).toBe(false)
    expect(canDryRun('not-admin', 'detection')).toBe(false)
  })
  it('test now: a confirmed admin, a SAVED rule, never read-only', () => {
    expect(canTestNow('admin', false, rule)).toBe(true)
    expect(canTestNow('admin', false, null)).toBe(false)
    expect(canTestNow('admin', true, rule)).toBe(false)
    expect(canTestNow('pending', false, rule)).toBe(false)
    expect(canTestNow('not-admin', false, rule)).toBe(false)
  })
})

describe('locales', () => {
  it('every key this module can return exists in BOTH locales', () => {
    for (const key of NC_RULE_TEST_KEYS) {
      expect(lookupLocale(enLocale, key), `en ${key}`).toBeTypeOf('string')
      expect(lookupLocale(itLocale, key), `it ${key}`).toBeTypeOf('string')
    }
  })
})
