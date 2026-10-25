/**
 * D698 — the phone's per-category split of a state summary: the mirror keeps
 * the field, every schedule edit keeps it, `rule` is stored as ABSENT, the body
 * warning of a split rule, and the TEST answer of a summary rule.
 */
import { describe, expect, it } from 'vitest'
import enLocale from '../../../../locales/en.json'
import itLocale from '../../../../locales/it.json'
import { NcRuleTestResultSchema, NcSystemEventDeliverySchema } from '../../../data/notification-center.js'
import { NC_RULE_TEST_KEYS, ruleTestNowLines } from '../rule-test-result.js'
import {
  NC_SUMMARY_SPLIT_KEYS,
  scheduleForSendTimes,
  summarySplitBodyWarning,
  summarySplitOf,
  withSummarySchedule,
  withSummarySplit,
  type NcSummaryDelivery,
} from '../system-event-delivery.js'

function lookupLocale(tree: unknown, key: string): string | undefined {
  let node: unknown = tree
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined
    const record: Record<string, unknown> = { ...node }
    node = record[part]
  }
  return typeof node === 'string' ? node : undefined
}

const EIGHT = scheduleForSendTimes([{ days: [1, 2, 3, 4, 5], minute: 480 }])
const SUMMARY: NcSummaryDelivery = { mode: 'summary', schedule: EIGHT }
const SPLIT: NcSummaryDelivery = { mode: 'summary', schedule: EIGHT, split: 'section' }

describe('the split on the phone (D698)', () => {
  it('the mirror KEEPS the field — a parse that stripped it would save the rule unsplit', () => {
    expect(NcSystemEventDeliverySchema.parse(SPLIT)).toEqual(SPLIT)
  })

  it('absent reads as one message; rule is stored as absent', () => {
    expect(summarySplitOf(SUMMARY)).toBe('rule')
    expect(summarySplitOf(SPLIT)).toBe('section')
    expect(withSummarySplit(SUMMARY, 'section')).toEqual(SPLIT)
    expect(withSummarySplit(SPLIT, 'rule')).toEqual(SUMMARY)
  })

  it('a schedule edit keeps the split', () => {
    const later = scheduleForSendTimes([{ days: [1], minute: 1170 }])
    expect(withSummarySchedule(SPLIT, later)).toEqual({ ...SPLIT, schedule: later })
  })

  it('a split rule whose body names no {{summaryText}} is warned', () => {
    const form = { delivery: 'system-event' as const, systemEventDelivery: SPLIT }
    expect(summarySplitBodyWarning({ ...form, templateBody: 'Oggi: {{summaryBattery}}' })).toBe(true)
    expect(summarySplitBodyWarning({ ...form, templateBody: '{{summaryText}}' })).toBe(false)
    expect(summarySplitBodyWarning({ ...form, templateBody: '' })).toBe(false)
    expect(
      summarySplitBodyWarning({ ...form, systemEventDelivery: SUMMARY, templateBody: 'Oggi: {{summaryBattery}}' }),
    ).toBe(false)
  })
})

const BASE = {
  origin: 'synthetic' as const,
  delivery: 'system-event',
  candidates: 1,
  still: 'unattachable' as const,
  trigger: 'state-summary',
  planNotes: [],
  notes: [],
}

describe('the TEST answer of a summary rule (D698)', () => {
  it('parses and says what was queued, per category', () => {
    const result = NcRuleTestResultSchema.parse({
      ...BASE,
      recordId: 'state-summary-test:r1:1',
      outcomes: [
        { ruleId: 'r1', ruleName: 'Stato', matched: true, cooldown: 'bypassed', enqueued: 2, targetIds: ['t1'] },
      ],
      stateSummary: {
        recordId: 'state-summary-test:r1:1',
        split: 'section',
        nothingToReport: false,
        sections: [
          { id: 'battery', status: 'read', items: 2 },
          { id: 'streams', status: 'read', items: 1 },
        ],
        rows: [
          { recordId: 'state-summary-test:r1:1:battery', section: 'battery', enqueued: 1, targetIds: ['t1'] },
          { recordId: 'state-summary-test:r1:1:streams', section: 'streams', enqueued: 1, targetIds: ['t1'] },
        ],
      },
    })
    expect(ruleTestNowLines(result)[0]).toEqual({
      key: 'v2.nc.rules.test.now.summary.queuedPerCategory',
      params: { count: 2, targets: 1, sections: 'battery (2), streams (1)' },
    })
  })

  it('nothing to report is said as such, with each section read — never "dropped"', () => {
    const result = NcRuleTestResultSchema.parse({
      ...BASE,
      recordId: 'state-summary-test:r1:1',
      outcomes: [
        { ruleId: 'r1', ruleName: 'Stato', matched: false, cooldown: 'bypassed', enqueued: 0, targetIds: [] },
      ],
      droppedBy: 'nothing-to-report',
      stateSummary: {
        recordId: 'state-summary-test:r1:1',
        split: 'rule',
        nothingToReport: true,
        sections: [
          { id: 'battery', status: 'read', items: 0 },
          { id: 'nodes', status: 'unavailable', items: 0, reason: 'the node directory did not answer completely' },
        ],
        rows: [],
      },
    })
    expect(ruleTestNowLines(result).slice(0, 3)).toEqual([
      { key: 'v2.nc.rules.test.now.summary.nothing' },
      { key: 'v2.nc.rules.test.now.summary.sectionRead', params: { section: 'battery', items: 0 } },
      { key: 'v2.nc.rules.test.now.summary.sectionUnavailable', params: { section: 'nodes' } },
    ])
  })

  it('every new key exists in EN and IT', () => {
    for (const key of [...NC_RULE_TEST_KEYS, ...NC_SUMMARY_SPLIT_KEYS]) {
      expect(lookupLocale(enLocale, key), `en ${key}`).toBeDefined()
      expect(lookupLocale(itLocale, key), `it ${key}`).toBeDefined()
    }
  })
})
