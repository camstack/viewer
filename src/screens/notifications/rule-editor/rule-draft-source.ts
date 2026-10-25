/**
 * rule-draft-source — the pure half of {@link useRuleDraft}.
 *
 * Which rule a route names, what draft it opens on, and what a save sends.
 * Kept out of the hook so the decisions that matter are testable without a
 * renderer: a rule the list does not contain is REPORTED missing (never an
 * empty form in its place), a new rule needs a kind before it has a form, and
 * an update carries the clears computed from the form at save time.
 */
import {
  NcConditionsSchema,
  type NcRule,
  type NcRuleInput,
  type NcRuleClearableKey,
  type NcViewerRule,
} from '../../../data/notification-center.js'
import { NcSummaryNotKeptError } from '../../../data/nc-errors.js'
import { ruleKindOf, ruleKindSpec } from '@camstack/types/client'
import type { NcRuleKind } from '@camstack/types'
import { splitRuleScopes } from '../../../components/notifications/rule-scope-form.js'
import {
  emptyRuleForm,
  formToInput,
  inputToForm,
  ruleClearsFor,
  type FormToInputOptions,
  type NcRuleFormState,
} from '../../../components/notifications/rule-editor.js'
import { parseKind, seedForKind } from '../../../components/notifications/rule-kind-nav.js'
import { draftKey, type NcRuleDraft } from '../../../store/nc-rule-draft-store.js'
import { ruleHref, type RuleHref } from '../../../navigation/rule-routes.js'

// The save gate has ONE authority, next to the form it judges; re-exported so
// the screens keep importing it from here.
export { ruleFormProblems, type RuleFormProblem } from '../../../components/notifications/rule-editor.js'

/** The route params the editor screens receive. */
export interface RuleDraftParams {
  readonly id: string
  readonly kind?: string
}

export const NEW_RULE_ID = 'new'

export type RuleDraftSource =
  | { readonly status: 'loading' }
  /** The rules list could not be read: no rule is known to exist OR be missing (D315). */
  | { readonly status: 'failed' }
  | { readonly status: 'missing' }
  /** `/rule/new` without a kind the app knows — the kind picker comes first. */
  | { readonly status: 'needs-kind' }
  | {
      readonly status: 'ready'
      readonly kind: NcRuleKind
      readonly rule: NcViewerRule | null
      /**
       * Shown, never saved: the server's verdict (an admin rule, for a
       * non-admin), or a kind no editor may change (`mixed`, D637 — it keeps
       * firing, and is recreated as one rule per family).
       */
      readonly readOnly: boolean
      readonly draft: NcRuleDraft
    }

/** A blank form for a new rule of this kind — the shared seed's trigger and condition. */
export function seedFormForKind(kind: NcRuleKind): NcRuleFormState {
  const seed = seedForKind(kind)
  return {
    ...emptyRuleForm(),
    delivery: seed.delivery,
    // A seed that scopes devices or classes opens with that scope drawn in its
    // one field (D641) — never as a stray list inside `conditions`.
    ...splitRuleScopes(NcConditionsSchema.parse(seed.conditions)),
  }
}

function freshDraft(ruleId: string | null, kind: NcRuleKind, form: NcRuleFormState): NcRuleDraft {
  return { key: draftKey(ruleId, kind), kind, ruleId, baseline: form, form, ai: null, saveAttempted: false }
}

/**
 * Resolve the route to a draft.
 *
 * An existing rule's kind is its OWN (`ruleKindOf`) — a `kind` param on an
 * edit route is ignored, since changing kind means a new rule. A kind no
 * editor may change (`ruleKindSpec(kind).editable === false`: `mixed`) opens
 * read-only whoever owns it.
 */
export function resolveDraftSource(
  params: RuleDraftParams,
  rules: readonly NcViewerRule[] | undefined,
  failed = false,
  /** The adoption of the draft on this route, if any — see {@link adoptedStandIn}. */
  adoption?: RuleAdoption,
  /** When `rules` was fetched (ms) — `dataUpdatedAt`. */
  rulesAt?: number,
): RuleDraftSource {
  if (params.id === NEW_RULE_ID) {
    const kind = parseKind(params.kind)
    // `mixed` is a kind the list SHOWS, never one a route may create.
    if (kind === undefined || !ruleKindSpec(kind).editable) return { status: 'needs-kind' }
    return {
      status: 'ready',
      kind,
      rule: null,
      readOnly: false,
      draft: freshDraft(null, kind, seedFormForKind(kind)),
    }
  }
  const bound = adoptedStandIn(params.id, rules, adoption, rulesAt)
  if (rules === undefined && bound === undefined) return failed ? { status: 'failed' } : { status: 'loading' }
  const rule = rules?.find((candidate) => candidate.id === params.id) ?? bound
  if (rule === undefined) return { status: 'missing' }
  const kind = ruleKindOf(rule)
  return {
    status: 'ready',
    kind,
    rule,
    readOnly: rule.readOnly || !ruleKindSpec(kind).editable,
    draft: freshDraft(rule.id, kind, inputToForm(rule)),
  }
}

/** An adopted draft, as the route resolver reads it (`NcRuleDraft`). */
export interface RuleAdoption {
  readonly rule: NcViewerRule
  /** When it was adopted (ms). */
  readonly at: number
  /** The rules list has contained it once. */
  readonly seen: boolean
}

/**
 * The adopted rule's LOCAL copy, standing in for a rules list that has not
 * caught up with the create — ONE-SHOT. It stands in only while the list is
 * absent or was fetched before the adoption, and never again once a list has
 * contained the rule: from then on the list alone decides, so a rule deleted
 * on the hub while its screen is open reads `missing`, not the stale copy.
 */
export function adoptedStandIn(
  routeId: string,
  rules: readonly NcViewerRule[] | undefined,
  adoption: RuleAdoption | undefined,
  rulesAt: number | undefined,
): NcViewerRule | undefined {
  if (adoption === undefined || adoption.seen || adoption.rule.id !== routeId) return undefined
  const stale = rules === undefined || (rulesAt !== undefined && rulesAt <= adoption.at)
  return stale ? adoption.rule : undefined
}

export type RuleSaveRequest =
  | { readonly mode: 'create'; readonly input: NcRuleInput }
  | {
      readonly mode: 'update'
      readonly ruleId: string
      readonly patch: NcRuleInput
      readonly clear: readonly NcRuleClearableKey[]
    }

export type RuleSaveOptions = Pick<FormToInputOptions, 'ownTargetIds' | 'catalog' | 'isAdmin' | 'hubKeepsSummary'>

/**
 * What a save sends. The throttle's unauthored `scope` / `granularity` ride
 * through an edit verbatim, and `clear` is computed from the form so an
 * emptied field is emptied on the hub. `isAdmin` decides whether the
 * admin-only fields (`actions`, `targetUsers`) are sent and cleared at all.
 */
export function ruleSaveRequest(
  form: NcRuleFormState,
  rule: NcViewerRule | null,
  options: RuleSaveOptions,
): RuleSaveRequest {
  const full: FormToInputOptions = {
    ...options,
    preserve: rule ? { throttle: rule.throttle } : undefined,
    stored: rule ?? undefined,
  }
  const input = formToInput(form, full)
  return rule
    ? { mode: 'update', ruleId: rule.id, patch: input, clear: ruleClearsFor(form, full) }
    : { mode: 'create', input }
}

/**
 * What a DRY-RUN evaluates: the current draft through the exact conversion a
 * save would send — the create input, or the update patch with its preserved
 * throttle. A second conversion would test a rule nobody is about to save.
 */
export function ruleDryRunInput(
  form: NcRuleFormState,
  rule: NcViewerRule | null,
  options: RuleSaveOptions,
): NcRuleInput {
  const request = ruleSaveRequest(form, rule, options)
  return request.mode === 'update' ? request.patch : request.input
}

/** What a save DOES, injected so the order and the recovery are testable. */
export interface RuleSaveEffects {
  readonly create: (input: NcRuleInput) => Promise<NcRule>
  readonly update: (vars: {
    readonly ruleId: string
    readonly patch: NcRuleInput
    readonly clear: readonly NcRuleClearableKey[]
  }) => Promise<NcRule>
  /** Write the draft's AI section onto this STORED rule (a no-op when unchanged). */
  readonly applyAi: (ruleId: string) => Promise<void>
  /** A create the hub stored although the save failed: the draft edits it from now on. */
  readonly adopt: (rule: NcRule) => void
}

/**
 * Rule first, then its AI section (which needs the id a create returns).
 *
 * One failure happens AFTER the rule exists: a hub older than D647 stores a
 * summary rule as instant and says success (`NcSummaryNotKeptError`, raised by
 * the mutation). The rule is then real, so a create ADOPTS it — the next Save
 * is an update of that rule, never a second create — and the AI section is
 * still written onto it. The error is re-thrown: the draft stays open and the
 * screen says the rule was kept as Instant.
 */
export async function executeRuleSave(request: RuleSaveRequest, effects: RuleSaveEffects): Promise<NcRule> {
  let saved: NcRule
  try {
    saved =
      request.mode === 'update'
        ? await effects.update({ ruleId: request.ruleId, patch: request.patch, clear: request.clear })
        : await effects.create(request.input)
  } catch (error) {
    if (error instanceof NcSummaryNotKeptError) {
      if (request.mode === 'create') effects.adopt(error.rule)
      await effects.applyAi(error.rule.id)
    }
    throw error
  }
  await effects.applyAi(saved.id)
  return saved
}

/**
 * Where a NEW rule's editor goes when its save failed AFTER the hub stored the
 * rule (`NcSummaryNotKeptError`): that rule's own edit route, replacing the
 * "new" one — a second `new` route of the same kind must open clean, and this
 * screen's next Save must update the stored rule. `null` for anything else.
 */
export function adoptedRuleRoute(routeId: string, error: unknown): RuleHref | null {
  if (routeId !== NEW_RULE_ID || !(error instanceof NcSummaryNotKeptError)) return null
  return ruleHref(error.rule.id)
}
