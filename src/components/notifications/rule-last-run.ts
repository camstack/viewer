/**
 * rule-last-run — what the "last run" line on a rule card may CLAIM, decided
 * once, for both kinds of card (`RuleRow`, `FamilyRuleRow`).
 *
 * D315: a rule is called absent ("not in the last 7 days") only by a read that
 * ANSWERED. While it is pending the line claims nothing; when it failed the line
 * says it could not look. The window it names is the one the hub answered with
 * (`horizonMs` — the outbox prune window, narrowed when the hub's read hit its
 * bound), never a constant here: the operator can change the window, and "7
 * days" over a 3-day window would be a lie about 4 of them. Floored, so a
 * narrowed 5.9-day window says 5, never 6.
 *
 * `hidden` is the viewer who is never asked: `getRuleLastRuns` is admin, and a
 * non-admin's FORBIDDEN must not render as an absence — so for them the line
 * does not exist at all.
 *
 * Mirrors the admin table's `notification-rule-last-run.ts`, in i18n keys.
 */
import type { NcHistoryStatus, NcRuleLastRuns } from '@camstack/types'

/** How far the ONE list-wide `getRuleLastRuns` read has got, for this viewer. */
export type RuleLastRunsRead =
  | { readonly state: 'hidden' }
  | { readonly state: 'pending' }
  | { readonly state: 'failed' }
  | { readonly state: 'answered'; readonly data: NcRuleLastRuns }

/** An absence phrase: an i18n key, with the floored span when it has one. */
export interface LastRunAbsence {
  readonly key: string
  readonly count?: number
}

/** The line one card draws. */
export type RuleLastRunLine =
  | { readonly kind: 'blank' }
  | { readonly kind: 'failed'; readonly hintKey: string }
  | ({ readonly kind: 'absent' } & LastRunAbsence)
  | {
      readonly kind: 'ran'
      readonly lastAt: number
      readonly status: NcHistoryStatus
      readonly statusKey: string
    }

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

const STATUS_KEYS: Readonly<Record<NcHistoryStatus, string>> = {
  sent: 'v2.nc.rules.lastRun.status.sent',
  pending: 'v2.nc.rules.lastRun.status.pending',
  dead: 'v2.nc.rules.lastRun.status.dead',
}

/** The status word of a delivery (shared with the history screen). */
export function deliveryStatusKey(status: NcHistoryStatus): string {
  return STATUS_KEYS[status]
}

/**
 * "Not in the last N …" for the window the hub answered over. `null` is the
 * operator's keep-forever outbox read to its end: absent means never recorded.
 * A window under a minute names no span at all rather than round one up.
 */
export function lastRunAbsence(horizonMs: number | null): LastRunAbsence {
  if (horizonMs === null) return { key: 'v2.nc.rules.lastRun.never' }
  if (horizonMs >= DAY_MS) return { key: 'v2.nc.rules.lastRun.notInDays', count: Math.floor(horizonMs / DAY_MS) }
  if (horizonMs >= HOUR_MS) return { key: 'v2.nc.rules.lastRun.notInHours', count: Math.floor(horizonMs / HOUR_MS) }
  if (horizonMs >= MINUTE_MS) {
    return { key: 'v2.nc.rules.lastRun.notInMinutes', count: Math.floor(horizonMs / MINUTE_MS) }
  }
  return { key: 'v2.nc.rules.lastRun.notInWindow' }
}

/** The line for one rule, or `undefined` when this viewer has no line. */
export function ruleLastRunLine(read: RuleLastRunsRead, ruleId: string): RuleLastRunLine | undefined {
  if (read.state === 'hidden') return undefined
  if (read.state === 'pending') return { kind: 'blank' }
  if (read.state === 'failed') return { kind: 'failed', hintKey: 'v2.nc.rules.lastRun.unavailable' }
  const run = read.data.runs.find((r) => r.ruleId === ruleId)
  if (run === undefined) return { kind: 'absent', ...lastRunAbsence(read.data.horizonMs) }
  return { kind: 'ran', lastAt: run.lastAt, status: run.status, statusKey: deliveryStatusKey(run.status) }
}
