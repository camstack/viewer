/**
 * timelapse-source — the pure half of the timelapse editor route.
 *
 * Which rule `/timelapse-rule/[id]` names, what form it opens on, and what a
 * save sends. Kept out of the screen so the decisions that matter are testable
 * without a renderer:
 *
 *  - a rule is reported MISSING only from a list that ANSWERED (D315) — an
 *    unanswered query is `loading`, a failed one `failed`;
 *  - an edit is the diff plus the clears (`timelapse-form.ts`), and an edit
 *    that changed nothing is `unchanged`, so the screen sends no request.
 */
import type { TimelapseRuleInput, TimelapseRulePatch } from '@camstack/types'
import type {
  NcTimelapseRuleClearableKey,
  NcViewerTimelapseRule,
} from '../../../data/notification-center.js'
import {
  emptyTimelapseForm,
  timelapseClearsFor,
  timelapseFormToInput,
  timelapseFormToPatch,
  timelapseRuleToForm,
  type TimelapseBuildOptions,
  type TimelapseFormState,
} from '../../../components/notifications/timelapse-form.js'

export const NEW_TIMELAPSE_ID = 'new'

export type TimelapseSource =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'missing' }
  | {
      readonly status: 'ready'
      readonly rule: NcViewerTimelapseRule | null
      /** The server's verdict (an admin rule, for a non-admin): shown, never saved. */
      readonly readOnly: boolean
      readonly seed: TimelapseFormState
    }

export function resolveTimelapseSource(
  id: string,
  rules: readonly NcViewerTimelapseRule[] | undefined,
  failed: boolean,
): TimelapseSource {
  if (id === NEW_TIMELAPSE_ID) {
    return { status: 'ready', rule: null, readOnly: false, seed: emptyTimelapseForm() }
  }
  if (rules === undefined) return failed ? { status: 'failed' } : { status: 'loading' }
  const rule = rules.find((candidate) => candidate.id === id)
  if (rule === undefined) return { status: 'missing' }
  return { status: 'ready', rule, readOnly: rule.readOnly, seed: timelapseRuleToForm(rule) }
}

export type TimelapseSaveRequest =
  | { readonly mode: 'create'; readonly rule: TimelapseRuleInput }
  | {
      readonly mode: 'update'
      readonly ruleId: string
      readonly patch: TimelapseRulePatch
      readonly clear: readonly NcTimelapseRuleClearableKey[]
    }
  /** An edit that changed nothing — no request, because a round-trip that
   *  reports success for work it did not do hides one that failed. */
  | { readonly mode: 'unchanged' }

export function timelapseSaveRequest(
  form: TimelapseFormState,
  rule: NcViewerTimelapseRule | null,
  options: TimelapseBuildOptions,
): TimelapseSaveRequest {
  if (rule === null) return { mode: 'create', rule: timelapseFormToInput(form, options) }
  const patch = timelapseFormToPatch(form, rule, options)
  const clear = timelapseClearsFor(form, rule)
  if (Object.keys(patch).length === 0 && clear.length === 0) return { mode: 'unchanged' }
  return { mode: 'update', ruleId: rule.id, patch, clear }
}

/**
 * Whether leaving now would lose an edit. Structural, over the form's own
 * plain values (strings, numbers, arrays, the schedule tree) — no `Date`, no
 * `Map`, no cycle.
 */
export function isTimelapseFormDirty(form: TimelapseFormState, seed: TimelapseFormState): boolean {
  return JSON.stringify(form) !== JSON.stringify(seed)
}
