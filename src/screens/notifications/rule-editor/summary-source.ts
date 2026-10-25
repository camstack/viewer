/**
 * summary-source — the pure half of the digest editor route.
 *
 * Which rule `/summary-rule/[id]` names, what form it opens on, and what a
 * save sends. Kept out of the screen so the decisions that matter are testable
 * without a renderer:
 *
 *  - a rule is reported MISSING only from a list that ANSWERED (D315) — an
 *    unanswered query is `loading` (or `disconnected` with no link to the
 *    hub, said in words), a failed one `failed`;
 *  - the same answer says whether this hub accepts a digest write at all
 *    (`canAuthor`, absent on an older hub). Without it an edit is READ-ONLY and
 *    "new" is `cannot-author` — never a form whose only feedback is a 403;
 *  - an edit is the diff plus the clears (`summary-form.ts`), and an edit that
 *    changed nothing is `unchanged`, so the screen sends no request.
 */
import type {
  NcListSummaryRulesResult,
  NcSummaryRuleClearableKey,
  NcSummaryRuleInput,
  NcSummaryRulePatch,
  NcViewerSummaryRule,
} from '../../../data/notification-center.js'
import {
  emptySummaryForm,
  summaryClearsFor,
  summaryFormToInput,
  summaryFormToPatch,
  summaryRuleToForm,
  type SummaryBuildOptions,
  type SummaryFormState,
} from '../../../components/notifications/summary-form.js'

export const NEW_SUMMARY_ID = 'new'

export type SummarySource =
  | { readonly status: 'loading' }
  /** No link to the hub and nothing answered yet — neither missing nor refused. */
  | { readonly status: 'disconnected' }
  | { readonly status: 'failed' }
  | { readonly status: 'missing' }
  /** "New" on a hub that still refuses a digest write (no `canAuthor`). */
  | { readonly status: 'cannot-author' }
  | {
      readonly status: 'ready'
      readonly rule: NcViewerSummaryRule | null
      /** The server's verdict, or a hub that refuses the write: shown, never saved. */
      readonly readOnly: boolean
      readonly seed: SummaryFormState
    }

export function resolveSummarySource(
  id: string,
  list: NcListSummaryRulesResult | undefined,
  failed: boolean,
  connected: boolean,
): SummarySource {
  if (list === undefined) {
    if (failed) return { status: 'failed' }
    return connected ? { status: 'loading' } : { status: 'disconnected' }
  }
  const canAuthor = list.canAuthor === true
  if (id === NEW_SUMMARY_ID) {
    return canAuthor
      ? { status: 'ready', rule: null, readOnly: false, seed: emptySummaryForm() }
      : { status: 'cannot-author' }
  }
  const rule = list.rules.find((candidate) => candidate.id === id)
  if (rule === undefined) return { status: 'missing' }
  return { status: 'ready', rule, readOnly: rule.readOnly || !canAuthor, seed: summaryRuleToForm(rule) }
}

export type SummarySaveRequest =
  | { readonly mode: 'create'; readonly rule: NcSummaryRuleInput }
  | {
      readonly mode: 'update'
      readonly ruleId: string
      readonly patch: NcSummaryRulePatch
      readonly clear: readonly NcSummaryRuleClearableKey[]
    }
  /** An edit that changed nothing — no request, because a round-trip that
   *  reports success for work it did not do hides one that failed. */
  | { readonly mode: 'unchanged' }

export function summarySaveRequest(
  form: SummaryFormState,
  rule: NcViewerSummaryRule | null,
  options: SummaryBuildOptions,
): SummarySaveRequest {
  if (rule === null) return { mode: 'create', rule: summaryFormToInput(form, options) }
  const patch = summaryFormToPatch(form, rule, options)
  const clear = summaryClearsFor(form, rule)
  if (Object.keys(patch).length === 0 && clear.length === 0) return { mode: 'unchanged' }
  return { mode: 'update', ruleId: rule.id, patch, clear }
}

/**
 * Whether leaving now would lose an edit. Structural, over the form's own
 * plain values — no `Date`, no `Map`, no cycle.
 */
export function isSummaryFormDirty(form: SummaryFormState, seed: SummaryFormState): boolean {
  return JSON.stringify(form) !== JSON.stringify(seed)
}
