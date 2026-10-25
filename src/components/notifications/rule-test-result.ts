/**
 * rule-test-result — what a rule test SAYS, as i18n lines.
 *
 * Two answers, from two surfaces (see `notification-center.ts`):
 *  - the DRY-RUN evaluates the unsaved draft against recent records and sends
 *    nothing — one line per record plus a count;
 *  - TEST NOW fires the saved rule for real — one verdict, then what the plan
 *    could not reproduce, then the hub's own notes.
 *
 * Pure, and it returns keys plus params — never English — so the phone says it
 * in the operator's language. The one exception is text the HUB wrote (a plan
 * note, a server note): it rides as a param, verbatim.
 *
 * TEST NOW never says "sent": delivery is asynchronous through the durable
 * outbox, so the most this side can honestly claim is "queued".
 */
import { isSystemRuleKind } from '@camstack/types/client'
import type { NcRuleKind } from '@camstack/types'
import type {
  NcDelivery,
  NcDryRunRecord,
  NcRuleTestResult,
  NcRuleTestSummary,
  NcViewerRule,
} from '../../data/notification-center.js'
import type { AdminVerdict } from '../../data/use-me.js'

export interface RuleTestLine {
  readonly key: string
  readonly params?: Readonly<Record<string, string | number>>
}

const PREFIX = 'v2.nc.rules.test'

/** Every key this module can return — the locale spec walks it. */
export const NC_RULE_TEST_KEYS: readonly string[] = [
  `${PREFIX}.wouldFire`,
  `${PREFIX}.failed`,
  `${PREFIX}.notMatched`,
  `${PREFIX}.firingCount`,
  `${PREFIX}.noRecords`,
  `${PREFIX}.deviceEventUnsupported`,
  `${PREFIX}.note`,
  `${PREFIX}.detail`,
  `${PREFIX}.now.queued`,
  `${PREFIX}.now.noneQueued`,
  `${PREFIX}.now.notCandidate`,
  `${PREFIX}.now.dropped`,
  `${PREFIX}.now.still.live`,
  `${PREFIX}.now.still.unavailable`,
  `${PREFIX}.now.still.unattachable`,
  `${PREFIX}.now.summary.queued`,
  `${PREFIX}.now.summary.queuedPerCategory`,
  `${PREFIX}.now.summary.noneQueued`,
  `${PREFIX}.now.summary.nothing`,
  `${PREFIX}.now.summary.sectionRead`,
  `${PREFIX}.now.summary.sectionUnavailable`,
]

/** The verdict fields a line is decided from. */
export type RuleTestVerdict = Pick<NcDryRunRecord, 'wouldFire' | 'failedCondition'>

/** A refusal names the condition that refused, when the hub named one. */
function refusalLine(failedCondition: string | undefined): RuleTestLine {
  return failedCondition === undefined
    ? { key: `${PREFIX}.notMatched` }
    : { key: `${PREFIX}.failed`, params: { condition: failedCondition } }
}

/** One evaluated record of a dry-run. */
export function dryRunRecordLine(result: RuleTestVerdict): RuleTestLine {
  return result.wouldFire ? { key: `${PREFIX}.wouldFire` } : refusalLine(result.failedCondition)
}

/**
 * The line over the dry-run's record list.
 *
 * A device-event rule cannot be dry-run (the sensor-event store has no
 * cross-device scan surface), and an empty answer means there was nothing to
 * evaluate — neither may read as "this rule never fires".
 */
export function dryRunSummaryLine(results: readonly RuleTestVerdict[], delivery: NcDelivery): RuleTestLine {
  if (delivery === 'device-event') return { key: `${PREFIX}.deviceEventUnsupported` }
  if (results.length === 0) return { key: `${PREFIX}.noRecords` }
  return {
    key: `${PREFIX}.firingCount`,
    params: { firing: results.filter((r) => r.wouldFire).length, total: results.length },
  }
}

const STILL_KEYS: Readonly<Record<NcRuleTestResult['still'], string | null>> = {
  live: `${PREFIX}.now.still.live`,
  unavailable: `${PREFIX}.now.still.unavailable`,
  unattachable: `${PREFIX}.now.still.unattachable`,
  none: null,
}

/**
 * A STATE-SUMMARY rule's test (D698): the summary was built NOW, not an event
 * injected. Nothing to report is an answer — with every section's read —
 * never "the event was dropped".
 */
function summaryVerdict(result: NcRuleTestResult, summary: NcRuleTestSummary): readonly RuleTestLine[] {
  if (summary.nothingToReport) {
    return [
      { key: `${PREFIX}.now.summary.nothing` },
      ...summary.sections.map((section): RuleTestLine => {
        if (section.status === 'unavailable') {
          return { key: `${PREFIX}.now.summary.sectionUnavailable`, params: { section: section.id } }
        }
        return { key: `${PREFIX}.now.summary.sectionRead`, params: { section: section.id, items: section.items } }
      }),
    ]
  }
  const count = summary.rows.reduce((sum, row) => sum + row.enqueued, 0)
  if (count === 0) return [{ key: `${PREFIX}.now.summary.noneQueued` }]
  const targets = result.outcomes[0]?.targetIds.length ?? 0
  if (summary.split === 'section') {
    // Each category with the items it reports (review LOW), e.g. "battery (2), streams (1)".
    const sections = summary.rows
      .flatMap((row) => (row.section !== undefined ? [row.section] : []))
      .map((id) => `${id} (${String(summary.sections.find((s) => s.id === id)?.items ?? 0)})`)
      .join(', ')
    return [{ key: `${PREFIX}.now.summary.queuedPerCategory`, params: { count, targets, sections } }]
  }
  return [{ key: `${PREFIX}.now.summary.queued`, params: { count, targets } }]
}

/** The verdict of a real test — the first line, always present. */
function testNowVerdict(result: NcRuleTestResult): readonly RuleTestLine[] {
  if (result.stateSummary !== undefined) return summaryVerdict(result, result.stateSummary)
  if (result.droppedBy !== undefined) return [{ key: `${PREFIX}.now.dropped`, params: { reason: result.droppedBy } }]
  const outcome = result.outcomes[0]
  if (outcome === undefined) return [{ key: `${PREFIX}.now.notCandidate`, params: { trigger: result.trigger } }]
  if (!outcome.matched) return [refusalLine(outcome.failedCondition)]
  if (outcome.enqueued === 0) return [{ key: `${PREFIX}.now.noneQueued` }]
  const still = STILL_KEYS[result.still]
  return [
    { key: `${PREFIX}.now.queued`, params: { count: outcome.enqueued, targets: outcome.targetIds.length } },
    ...(still !== null ? [{ key: still }] : []),
  ]
}

/** Everything a real test answers with: verdict, plan notes, hub notes. */
export function ruleTestNowLines(result: NcRuleTestResult): readonly RuleTestLine[] {
  return [
    ...testNowVerdict(result),
    ...result.planNotes.map((note) => ({
      key: `${PREFIX}.note`,
      params: { condition: note.conditionId, note: note.note },
    })),
    ...result.notes.map((note) => ({ key: `${PREFIX}.detail`, params: { note } })),
  ]
}

/**
 * Both tests are `auth: 'admin'` on the hub, so they are drawn only on a
 * CONFIRMED admin verdict — `pending` is not admin. The dry-run is never drawn
 * for a system rule of any family, nor a `mixed` one (D637): it replays persisted DETECTION records, and there is none
 * behind "a node went offline", so it would say "nothing matched" for a rule
 * that works.
 */
export function canDryRun(verdict: AdminVerdict, kind: NcRuleKind): boolean {
  return verdict === 'admin' && !isSystemRuleKind(kind)
}

/**
 * Test now fires what the hub STORED: a new rule has no id to fire, and a
 * read-only rule is not the caller's to exercise from an editor.
 */
export function canTestNow(
  verdict: AdminVerdict,
  readOnly: boolean,
  rule: NcViewerRule | null,
): rule is NcViewerRule {
  return verdict === 'admin' && !readOnly && rule !== null
}
