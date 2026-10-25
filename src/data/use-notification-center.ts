/**
 * use-notification-center — TanStack Query hooks over the {@link makeNcClient}
 * bridge client. Reads are `useQuery`, writes are `useMutation` that invalidate
 * the relevant list on success. Every call reaches the hub through the live
 * `system.trpcClient.addons.custom.mutate` proxy (structural access — the SDK
 * types the proxy as `unknown`, the documented tRPC boundary the other data
 * hooks also cross), so no cap method or SDK regen is involved.
 *
 * Query keys follow the repo's `['v2', …]` namespace with an `nc` sub-key:
 * rules under `['v2','nc','rules']`, targets under `['v2','nc','targets']`.
 * Mutations throw on transport/server failure (like `use-face-gallery`) so the
 * UI can surface it rather than silently "succeeding".
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { useDebouncedValue } from '../hooks/use-debounced-value.js'
import type { TimelapseRule, TimelapseRuleInput, TimelapseRulePatch } from '@camstack/types'
import {
  makeNcClient,
  type NcAiProfile,
  type NcClient,
  type NcConditionCatalogResult,
  type NcGetRuleAiResult,
  type NcRuleAi,
  type NcConditionDescriptor,
  type NcListSummaryRulesResult,
  type NcRule,
  type NcRuleClearableKey,
  type NcRuleInput,
  type NcRulePatch,
  type NcSnooze,
  type NcSnoozeInput,
  type NcSummaryRule,
  type NcSummaryRuleInput,
  type NcSummaryRulePatch,
  type NcSummaryRuleClearableKey,
  type NcTaxonomy,
  type NcTemplateCatalogResult,
  type NcTemplatePreviewInput,
  type NcTemplatePreviewResult,
  type NcTemplateVarContext,
  type NcTemplateVarDescriptor,
  type NcTestTargetResult,
  type NcViewerRule,
  type NcTimelapseRuleClearableKey,
  type NcViewerTimelapseRule,
  type Target,
  type TargetKind,
} from './notification-center.js'
import type { NcPruneRecord } from './nc-prunes.js'
import { restoreHeldBackKinds, restoreHeldBackVars } from '../components/notifications/template-field.js'
import { hubKeepsSummaryDelivery } from '../components/notifications/system-event-delivery.js'
import { useAdminVerdict } from './use-me.js'
import {
  assertClearsLanded,
  assertSummaryDeliveryLanded,
  NcRuleEnableNotAppliedError,
  ncNotConnectedError,
} from './nc-errors.js'

const RULES_KEY = ['v2', 'nc', 'rules'] as const
const TARGETS_KEY = ['v2', 'nc', 'targets'] as const
const CATALOG_KEY = ['v2', 'nc', 'catalog'] as const
/**
 * NOT under the `['v2', 'nc', …]` namespace the rest of this file uses — the
 * template-variable catalog and preview are their own bridge surface with
 * nothing to invalidate against and nothing that invalidates them, so they
 * carry the keys the task that added them specified rather than borrowing the
 * unrelated `RULES_KEY`/`CATALOG_KEY` prefix convention.
 */
const TEMPLATE_CATALOG_KEY = ['nc', 'template-catalog'] as const
const TARGET_KINDS_KEY = ['v2', 'nc', 'target-kinds'] as const
const SNOOZES_KEY = ['v2', 'nc', 'snoozes'] as const
// The AI sections and the vision profiles. Separate from `RULES_KEY` because
// they are a separate STORE behind separate bridge actions — a rule edit does
// not change a section, and writing a section does not change a rule.
const RULE_AI_KEY = ['v2', 'nc', 'rule-ai'] as const
const AI_PROFILES_KEY = ['v2', 'nc', 'ai-profiles'] as const
// The two OTHER rule families. Separate keys and not a slice of `RULES_KEY`,
// because they are separate stores behind separate bridge actions — invalidating
// one must not refetch the other two.
const TIMELAPSE_KEY = ['v2', 'nc', 'timelapse-rules'] as const
const SUMMARY_KEY = ['v2', 'nc', 'summary-rules'] as const
// What the hub's deleted-device prune did. Its own store, written only by the
// hub — nothing on the phone invalidates it.
const PRUNES_KEY = ['v2', 'nc', 'prunes'] as const

/**
 * Route one `addons.custom` call over the live tRPC proxy. `trpcClient` is typed
 * `unknown` by the SDK (the tRPC proxy boundary — a router/method is a callable
 * proxy, `typeof` 'function'), so we read the leaf `.mutate` structurally, as the
 * other data hooks do. Throws when the bridge procedure is absent so the caller
 * surfaces the failure rather than treating it as a void success.
 */
async function addonsCustomCall(
  trpcClient: unknown,
  args: { addonId: string; action: string; input: unknown },
): Promise<unknown> {
  const client = trpcClient as Record<string, unknown>
  const addons = client.addons
  const fn =
    typeof addons === 'object' || typeof addons === 'function'
      ? (addons as Record<string, unknown> | null)?.custom
      : undefined
  const mutate = fn != null ? (fn as { mutate?: unknown }).mutate : undefined
  if (typeof mutate !== 'function') throw new Error('addons.custom unavailable')
  return await (mutate as (i: { addonId: string; action: string; input: unknown }) => Promise<unknown>)(args)
}

/** Build an {@link NcClient} bound to a live tRPC proxy. Exported for the
 *  sibling hook files that add one action each (`use-nc-rule-test.ts`). */
export function ncClientForTrpc(trpcClient: unknown): NcClient {
  return makeNcClient({ addonsCustomMutate: (args) => addonsCustomCall(trpcClient, args) })
}

// ── Queries ────────────────────────────────────────────────────────────────

/** The rules visible to the caller (admin/global read-only + own personal). */
export function useNcRules(): UseQueryResult<NcViewerRule[]> {
  const { controller, state } = useConnection()
  return useQuery<NcViewerRule[]>({
    queryKey: RULES_KEY,
    enabled: state === 'connected',
    staleTime: 30_000,
    queryFn: async (): Promise<NcViewerRule[]> => {
      const system = controller.getSystem()
      // No system is a failure to ASK, never "no rules": the editor route
      // would call a rule missing on a read that never happened (D315).
      if (!system) throw ncNotConnectedError()
      const { rules } = await ncClientForTrpc(system.trpcClient).listRules()
      return rules
    },
  })
}

/** Fetch the full condition-catalog result (catalog + additive taxonomy). */
async function fetchConditionCatalog(
  controller: ReturnType<typeof useConnection>['controller'],
): Promise<NcConditionCatalogResult> {
  const system = controller.getSystem()
  if (!system) return { catalog: [] }
  return ncClientForTrpc(system.trpcClient).getConditionCatalog()
}

/** The machine-readable condition catalog (rule editors render from this). */
export function useNcConditionCatalog(): UseQueryResult<NcConditionDescriptor[]> {
  const { controller, state } = useConnection()
  return useQuery<NcConditionCatalogResult, Error, NcConditionDescriptor[]>({
    queryKey: CATALOG_KEY,
    enabled: state === 'connected',
    staleTime: 5 * 60_000,
    queryFn: () => fetchConditionCatalog(controller),
    select: (result) => result.catalog,
  })
}

/**
 * The additive class/label taxonomy shipped alongside the catalog. Shares the
 * catalog query (same key + fetch) and selects the `taxonomy` slice — `undefined`
 * when the hub predates the field, so the editor falls back to free-text.
 */
export function useNcConditionTaxonomy(): UseQueryResult<NcTaxonomy | undefined> {
  const { controller, state } = useConnection()
  return useQuery<NcConditionCatalogResult, Error, NcTaxonomy | undefined>({
    queryKey: CATALOG_KEY,
    enabled: state === 'connected',
    staleTime: 5 * 60_000,
    queryFn: () => fetchConditionCatalog(controller),
    select: (result) => result.taxonomy,
  })
}

/**
 * The declared `{{var}}` template vocabulary — every descriptor the hub
 * knows. The editor filters this list client-side by the field it is
 * rendering (family/field/kind/delivery/systemEventKinds), the same axes
 * `templateVarsFor` reads on the server.
 */
export function useNcTemplateCatalog(): UseQueryResult<NcTemplateVarDescriptor[]> {
  const { controller, state } = useConnection()
  return useQuery<NcTemplateCatalogResult, Error, NcTemplateVarDescriptor[]>({
    queryKey: TEMPLATE_CATALOG_KEY,
    enabled: state === 'connected',
    staleTime: 5 * 60_000,
    queryFn: () => fetchTemplateCatalog(controller),
    select: selectTemplateCatalog,
  })
}

/** The one fetch behind both template-catalog reads (one cache entry). */
async function fetchTemplateCatalog(
  controller: ReturnType<typeof useConnection>['controller'],
): Promise<NcTemplateCatalogResult> {
  const system = controller.getSystem()
  if (!system) return { vars: [] }
  return ncClientForTrpc(system.trpcClient).getTemplateCatalog()
}

/**
 * The catalog as the editor reads it. The hub holds back kinds the installed
 * viewers cannot parse (D642 review M3) and the state-summary vocabulary it
 * holds back whole (D647); this build restores both.
 */
export function selectTemplateCatalog(result: NcTemplateCatalogResult): NcTemplateVarDescriptor[] {
  return restoreHeldBackVars(restoreHeldBackKinds(result.vars))
}

/**
 * Is this hub KNOWN to keep a state summary (D647)? Read off the catalog it
 * SERVED — the same cache entry as {@link useNcTemplateCatalog}, before this
 * build restores anything into it (the restored summary variables carry the
 * delivery axis whatever the hub is). `false` while unanswered, failed or
 * older: see `hubKeepsSummaryDelivery`.
 */
export function useNcHubKeepsSummary(): boolean {
  const { controller, state } = useConnection()
  const query = useQuery<NcTemplateCatalogResult, Error, boolean>({
    queryKey: TEMPLATE_CATALOG_KEY,
    enabled: state === 'connected',
    staleTime: 5 * 60_000,
    queryFn: () => fetchTemplateCatalog(controller),
    select: (result) => hubKeepsSummaryDelivery(result.vars),
  })
  return query.data === true
}

/**
 * Live preview of a draft title/body against the hub's own render + text
 * catalog. Debounced 400 ms so a keystroke does not fire a round trip, and
 * gated (beyond the caller's own `enabled`) on being connected and there
 * being at least one non-empty field — an empty draft is nothing to preview.
 */
export function useNcTemplatePreview(
  context: NcTemplateVarContext,
  template: NcTemplatePreviewInput,
  enabled: boolean,
): UseQueryResult<NcTemplatePreviewResult> {
  const { controller, state } = useConnection()
  const title = useDebouncedValue(template.title, 400)
  const body = useDebouncedValue(template.body, 400)
  const hasText = (title?.length ?? 0) > 0 || (body?.length ?? 0) > 0
  return useQuery<NcTemplatePreviewResult>({
    queryKey: ['nc', 'template-preview', context, title, body] as const,
    enabled: enabled && state === 'connected' && hasText,
    queryFn: async (): Promise<NcTemplatePreviewResult> => {
      const system = controller.getSystem()
      if (!system) return { title: null, body: null, unknown: [] }
      return ncClientForTrpc(system.trpcClient).previewTemplate(context, { title, body })
    },
  })
}

/**
 * The caller's SCHEDULED TIMELAPSE rules — their own, plus the global ones.
 *
 * A separate query and not a slice of {@link useNcRules}: a timelapse rides no
 * `NcDelivery` member and lives in its own store, so there is no rule list it
 * could be a partition of. `enabled` on the connection for the same reason as
 * every read here.
 */
export function useNcTimelapseRules(): UseQueryResult<NcViewerTimelapseRule[]> {
  const { controller, state } = useConnection()
  return useQuery<NcViewerTimelapseRule[]>({
    queryKey: TIMELAPSE_KEY,
    enabled: state === 'connected',
    staleTime: 30_000,
    queryFn: async (): Promise<NcViewerTimelapseRule[]> => {
      const system = controller.getSystem()
      // Not `[]` — see `useNcRules`.
      if (!system) throw ncNotConnectedError()
      const { rules } = await ncClientForTrpc(system.trpcClient).listTimelapseRules()
      return rules
    },
  })
}

/**
 * The caller's DIGEST rules, and whether this hub lets them author one.
 *
 * Both halves come off ONE response and are kept together deliberately: the
 * list without `canAuthor` is a screen that cannot decide whether to show a
 * "New summary rule" button, and asking a second endpoint would let the two
 * answers disagree. `canAuthor === undefined` is an older hub — the upsert is
 * still `auth: 'admin'` there and the surface degrades to read-only.
 */
export function useNcSummaryRules(): UseQueryResult<NcListSummaryRulesResult> {
  const { controller, state } = useConnection()
  return useQuery<NcListSummaryRulesResult>({
    queryKey: SUMMARY_KEY,
    enabled: state === 'connected',
    staleTime: 30_000,
    queryFn: async (): Promise<NcListSummaryRulesResult> => {
      const system = controller.getSystem()
      // NOT `{ rules: [] }`: that is an ANSWER — "no rules, and (no
      // `canAuthor`) an older hub" — and the editor route would call a rule
      // missing and "new" refused on the strength of a read that never
      // happened (D315). No system is a failure to ask.
      if (!system) throw ncNotConnectedError()
      return await ncClientForTrpc(system.trpcClient).listSummaryRules()
    },
  })
}

/** The caller's own delivery targets. */
export function useNcTargets(): UseQueryResult<Target[]> {
  const { controller, state } = useConnection()
  return useQuery<Target[]>({
    queryKey: TARGETS_KEY,
    enabled: state === 'connected',
    staleTime: 30_000,
    queryFn: async (): Promise<Target[]> => {
      const system = controller.getSystem()
      // NOT `[]`: the save gate reads an answered empty list as "owns no
      // targets", and a save then drops every stored one (final review I3).
      if (!system) throw ncNotConnectedError()
      const { targets } = await ncClientForTrpc(system.trpcClient).listTargets()
      return targets
    },
  })
}

/**
 * The AI sections of every rule the caller may see, keyed by rule id.
 *
 * ONE unscoped query rather than one per rule, and that is what makes the
 * editor's seed synchronous: the list screen has already warmed this by the
 * time a rule is opened, so the section renders filled in on the first frame
 * instead of appearing under the operator's finger a moment later.
 *
 * A rule with no section is ABSENT from the map — never a disabled entry. The
 * distinction survives because `undefined` (no row on disk) and
 * `{ enabled: false }` (a row the operator switched off) are different things
 * to `nc.setRuleAi`, and only one of them is what an untouched rule has.
 */
export function useNcRuleAiSections(): UseQueryResult<ReadonlyMap<string, NcRuleAi>> {
  const { controller, state } = useConnection()
  return useQuery<NcGetRuleAiResult, Error, ReadonlyMap<string, NcRuleAi>>({
    queryKey: RULE_AI_KEY,
    enabled: state === 'connected',
    staleTime: 30_000,
    queryFn: async (): Promise<NcGetRuleAiResult> => {
      const system = controller.getSystem()
      if (!system) return { sections: [] }
      return await ncClientForTrpc(system.trpcClient).getRuleAi()
    },
    select: (result) => new Map(result.sections.map((row) => [row.ruleId, row.ai])),
  })
}

/**
 * The vision profiles a rule's AI section may pin.
 *
 * `isError` is a REAL state here and the editor renders it as one: an older hub
 * has no `nc.listAiProfiles` and the bridge throws NOT_FOUND, which must read as
 * "this hub cannot tell me" and never as the empty list that means "go and
 * create a profile". D315, applied to a bridge action.
 */
export function useNcAiProfiles(): UseQueryResult<NcAiProfile[]> {
  const { controller, state } = useConnection()
  return useQuery<NcAiProfile[]>({
    queryKey: AI_PROFILES_KEY,
    enabled: state === 'connected',
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<NcAiProfile[]> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const { profiles } = await ncClientForTrpc(system.trpcClient).listAiProfiles()
      return profiles
    },
  })
}

/**
 * The hub's prune record (`nc.listPrunes`) — why a rule switched itself off.
 *
 * Asked only when `active` (a screen is showing a DISABLED rule — the only one
 * that can carry the banner) and only by a CONFIRMED admin: the action is
 * admin-only, and a request the hub will refuse is a request not worth making.
 * A non-admin, a pending role, and a failed read all leave `data` undefined,
 * and the banner renders nothing — never "nothing was pruned" (D315).
 */
export function useNcPrunes(active: boolean): UseQueryResult<NcPruneRecord[]> {
  const { controller, state } = useConnection()
  const verdict = useAdminVerdict()
  return useQuery<NcPruneRecord[]>({
    queryKey: PRUNES_KEY,
    enabled: state === 'connected' && active && verdict === 'admin',
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<NcPruneRecord[]> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const { prunes } = await ncClientForTrpc(system.trpcClient).listPrunes()
      return prunes
    },
  })
}

/** The target kinds the caller can create (descriptors + per-kind caps). */
export function useNcTargetKinds(): UseQueryResult<TargetKind[]> {
  const { controller, state } = useConnection()
  return useQuery<TargetKind[]>({
    queryKey: TARGET_KINDS_KEY,
    enabled: state === 'connected',
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TargetKind[]> => {
      const system = controller.getSystem()
      if (!system) return []
      const { kinds } = await ncClientForTrpc(system.trpcClient).listTargetKinds()
      return kinds
    },
  })
}

/**
 * The caller's snooze windows, plus the global ones that silence them.
 *
 * Refetched on an interval as well as on focus: a window ends because the clock
 * passed it, not because anything ran, so a screen left open would otherwise go
 * on showing a silence that is already over.
 */
export function useNcSnoozes(): UseQueryResult<NcSnooze[]> {
  const { controller, state } = useConnection()
  return useQuery<NcSnooze[]>({
    queryKey: SNOOZES_KEY,
    enabled: state === 'connected',
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async (): Promise<NcSnooze[]> => {
      const system = controller.getSystem()
      if (!system) return []
      const { snoozes } = await ncClientForTrpc(system.trpcClient).listSnoozes()
      return snoozes
    },
  })
}

// ── Mutations ────────────────────────────────────────────────────────────────

/** Input for {@link useNcUpdateRule}. */
export interface NcUpdateRuleVars {
  readonly ruleId: string
  readonly patch: NcRulePatch
  readonly clear?: readonly NcRuleClearableKey[]
}

/** Input for {@link useNcSetRuleTargetEnabled}. */
export interface SetRuleTargetEnabledInput {
  readonly ruleId: string
  readonly targetId: string
  readonly enabled: boolean
}

/** Input for {@link useNcSetRuleEnabled}. */
export interface SetRuleEnabledInput {
  readonly ruleId: string
  readonly enabled: boolean
}

/** Input for {@link useNcSetTargetEnabled}. */
export interface SetTargetEnabledInput {
  readonly targetId: string
  readonly enabled: boolean
}

/** Create a personal rule. Invalidates the rules list on success. */
export function useNcCreateRule() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<NcRule, Error, NcRuleInput>({
    mutationFn: async (rule): Promise<NcRule> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const { rule: created } = await ncClientForTrpc(system.trpcClient).createRule(rule)
      // A hub older than D647 stores a summary rule as INSTANT and says success.
      assertSummaryDeliveryLanded(rule, created)
      return created
    },
    // SETTLED: a summary the hub did not keep is raised AFTER it stored the rule.
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: RULES_KEY })
    },
  })
}

/** Update a rule (partial patch). Invalidates the rules list on success. */
export function useNcUpdateRule() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<NcRule, Error, NcUpdateRuleVars>({
    mutationFn: async ({ ruleId, patch, clear }): Promise<NcRule> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const { rule } = await ncClientForTrpc(system.trpcClient).updateRule(ruleId, patch, clear)
      // A hub that ignored `clear` answers success with the field still set.
      assertClearsLanded(rule, clear)
      assertSummaryDeliveryLanded(patch, rule)
      return rule
    },
    // SETTLED, not success: a refused clear (`NcHubTooOldToClearError`) is raised AFTER
    // the hub stored the rest of the patch, so the list must re-read (N1).
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: RULES_KEY })
    },
  })
}

/** Delete a rule. Invalidates the rules list on success. */
export function useNcDeleteRule() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<void, Error, { readonly ruleId: string }>({
    mutationFn: async ({ ruleId }): Promise<void> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      await ncClientForTrpc(system.trpcClient).deleteRule(ruleId)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: RULES_KEY })
    },
  })
}

/** Opt one target in/out of a rule (own target only — enforced server-side).
 *  Invalidates the rules list on success. */
export function useNcSetRuleTargetEnabled() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<void, Error, SetRuleTargetEnabledInput>({
    mutationFn: async ({ ruleId, targetId, enabled }): Promise<void> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      await ncClientForTrpc(system.trpcClient).setRuleTargetEnabled(ruleId, targetId, enabled)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: RULES_KEY })
    },
  })
}

/**
 * Switch a whole rule on or off (owner or admin — enforced server-side).
 *
 * Success means the hub STORES the asked state: a reply whose rule says
 * otherwise is raised as {@link NcRuleEnableNotAppliedError}, so the row puts
 * its switch back. The stored rule is written into the list on success (its
 * `readOnly` verdict kept — the update reply does not carry one), and the list
 * is re-read when the call SETTLES: a refusal must re-read too, because the
 * hub, not the switch, is the authority on whether the rule runs.
 */
export function useNcSetRuleEnabled() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<NcRule, Error, SetRuleEnabledInput>({
    mutationFn: async ({ ruleId, enabled }): Promise<NcRule> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const { rule } = await ncClientForTrpc(system.trpcClient).setRuleEnabled(ruleId, enabled)
      if (rule.enabled !== enabled) throw new NcRuleEnableNotAppliedError(ruleId, enabled)
      return rule
    },
    onSuccess: (stored) => {
      queryClient.setQueryData<NcViewerRule[]>(RULES_KEY, (rules) =>
        rules?.map((rule) => (rule.id === stored.id ? { ...stored, readOnly: rule.readOnly } : rule)),
      )
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: RULES_KEY })
    },
  })
}

/** Input for {@link useNcSetRuleSnooze}. */
export interface SetRuleSnoozeInput {
  readonly ruleId: string
  /** On = open a window for `durationMinutes`; off = cancel `activeIds`. */
  readonly snoozed: boolean
  readonly durationMinutes: number
  /** The rule's live windows — what an off cancels. */
  readonly activeIds: readonly string[]
}

/**
 * The rules list's Snooze switch (controller ruling on R3, 2026-10-01): SNOOZE
 * THIS RULE now, exactly like the admin column — on opens a rule-scoped window
 * (`createSnooze`), off cancels every live one (`cancelSnooze`). The rule
 * itself is never patched: its snooze-BUTTON config is the editor's.
 *
 * The windows are re-read when the call SETTLES, so the switch ends on what
 * the hub holds whether it accepted or refused.
 */
export function useNcSetRuleSnooze() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<void, Error, SetRuleSnoozeInput>({
    mutationFn: async ({ ruleId, snoozed, durationMinutes, activeIds }): Promise<void> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const client = ncClientForTrpc(system.trpcClient)
      if (snoozed) {
        await client.createSnooze({ scope: 'rule', ruleId, durationMinutes })
        return
      }
      for (const snoozeId of activeIds) await client.cancelSnooze(snoozeId)
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: SNOOZES_KEY })
    },
  })
}

/** Input for {@link useNcSetRuleAi}. `ai: null` CLEARS the section. */
export interface SetRuleAiInput {
  readonly ruleId: string
  readonly ai: NcRuleAi | null
}

/**
 * Write one rule's AI section.
 *
 * A SECOND call after the rule save, never part of it — the block is an addon
 * side table, and a key added to `NcRuleInputSchema` would be stripped at save
 * until a framework train landed (`notification-center.ts` states the whole
 * argument). The editor therefore saves the rule first and this second, and
 * surfaces a failure HERE rather than closing: a rule that saved and a section
 * that did not is the one outcome the operator must not have to guess at.
 *
 * Invalidates the AI sections; the rule list is untouched because no field of
 * `NcRule` changed.
 */
export function useNcSetRuleAi() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<void, Error, SetRuleAiInput>({
    mutationFn: async ({ ruleId, ai }): Promise<void> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      await ncClientForTrpc(system.trpcClient).setRuleAi(ruleId, ai)
    },
    // SETTLED, not success: a write that failed after the hub stored it
    // (a dropped reply) must not leave the section cache on the old value (N1).
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: RULE_AI_KEY })
    },
  })
}

// ── The timelapse and digest families ────────────────────────────────────────
//
// ONE mutation each for create AND edit, mirroring the single `nc.upsert*`
// action behind them: `ruleId === undefined` creates, a `ruleId` patches. Two
// hooks would be two call sites for a form that is one form.

/** Create (no `ruleId`) or patch (with one) a scheduled timelapse rule. */
export interface UpsertTimelapseInput {
  readonly ruleId?: string
  readonly rule?: TimelapseRuleInput
  readonly patch?: TimelapseRulePatch
  /** Edit only: optional fields to REMOVE (the hub merges the patch). */
  readonly clear?: readonly NcTimelapseRuleClearableKey[]
}

export function useNcUpsertTimelapseRule() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<TimelapseRule, Error, UpsertTimelapseInput>({
    mutationFn: async ({ ruleId, rule, patch, clear }): Promise<TimelapseRule> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const client = ncClientForTrpc(system.trpcClient)
      if (ruleId === undefined) {
        if (rule === undefined) throw new Error('a new timelapse rule needs its fields')
        return (await client.createTimelapseRule(rule)).rule
      }
      if (patch === undefined) throw new Error('editing a timelapse rule needs a patch')
      const { rule: saved } = await client.updateTimelapseRule(ruleId, patch, clear)
      // An addon older than `clear` strips it and answers success (I4).
      assertClearsLanded(saved, clear)
      return saved
    },
    // SETTLED, not success: a refused clear (`NcHubTooOldToClearError`) is raised AFTER
    // the hub stored the rest of the patch, so the list must re-read (N1).
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: TIMELAPSE_KEY })
    },
  })
}

/**
 * Switch a timelapse rule on or off from its card: the upsert with a patch of
 * `enabled` ALONE. The same contract as {@link useNcSetRuleEnabled} — success
 * means the hub STORES the asked state, and the list is re-read when the call
 * settles, refusal included.
 */
export function useNcSetTimelapseRuleEnabled() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<TimelapseRule, Error, SetRuleEnabledInput>({
    mutationFn: async ({ ruleId, enabled }): Promise<TimelapseRule> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const { rule } = await ncClientForTrpc(system.trpcClient).updateTimelapseRule(ruleId, { enabled })
      if (rule.enabled !== enabled) throw new NcRuleEnableNotAppliedError(ruleId, enabled)
      return rule
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: TIMELAPSE_KEY })
    },
  })
}

export function useNcDeleteTimelapseRule() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<void, Error, { readonly ruleId: string }>({
    mutationFn: async ({ ruleId }): Promise<void> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      await ncClientForTrpc(system.trpcClient).deleteTimelapseRule(ruleId)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TIMELAPSE_KEY })
    },
  })
}

/** Create (no `ruleId`) or patch (with one) a multi-camera digest rule. */
export interface UpsertSummaryInput {
  readonly ruleId?: string
  readonly rule?: NcSummaryRuleInput
  readonly patch?: NcSummaryRulePatch
  /** Edit only: optional fields the operator EMPTIED (see `summary-form.ts`). */
  readonly clear?: readonly NcSummaryRuleClearableKey[]
}

export function useNcUpsertSummaryRule() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<NcSummaryRule, Error, UpsertSummaryInput>({
    mutationFn: async ({ ruleId, rule, patch, clear }): Promise<NcSummaryRule> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const client = ncClientForTrpc(system.trpcClient)
      if (ruleId === undefined) {
        if (rule === undefined) throw new Error('a new summary rule needs its fields')
        return (await client.createSummaryRule(rule)).rule
      }
      if (patch === undefined) throw new Error('editing a summary rule needs a patch')
      const { rule: saved } = await client.updateSummaryRule(ruleId, patch, clear)
      // An addon older than `clear` strips it and answers success (I4).
      assertClearsLanded(saved, clear)
      return saved
    },
    // SETTLED, not success: a refused clear (`NcHubTooOldToClearError`) is raised AFTER
    // the hub stored the rest of the patch, so the list must re-read (N1).
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: SUMMARY_KEY })
    },
  })
}

/** Switch a digest rule on or off from its card — see {@link useNcSetTimelapseRuleEnabled}. */
export function useNcSetSummaryRuleEnabled() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<NcSummaryRule, Error, SetRuleEnabledInput>({
    mutationFn: async ({ ruleId, enabled }): Promise<NcSummaryRule> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const { rule } = await ncClientForTrpc(system.trpcClient).updateSummaryRule(ruleId, { enabled })
      if (rule.enabled !== enabled) throw new NcRuleEnableNotAppliedError(ruleId, enabled)
      return rule
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: SUMMARY_KEY })
    },
  })
}

export function useNcDeleteSummaryRule() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<void, Error, { readonly ruleId: string }>({
    mutationFn: async ({ ruleId }): Promise<void> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      await ncClientForTrpc(system.trpcClient).deleteSummaryRule(ruleId)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SUMMARY_KEY })
    },
  })
}

/** Create or update the caller's own target. Invalidates the targets list. */
export function useNcUpsertTarget() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<Target, Error, Target>({
    mutationFn: async (target): Promise<Target> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const { target: saved } = await ncClientForTrpc(system.trpcClient).upsertTarget(target)
      return saved
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TARGETS_KEY })
    },
  })
}

/** Delete the caller's own target. Invalidates the targets list. */
export function useNcDeleteTarget() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<void, Error, { readonly targetId: string }>({
    mutationFn: async ({ targetId }): Promise<void> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      await ncClientForTrpc(system.trpcClient).deleteTarget(targetId)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TARGETS_KEY })
    },
  })
}

/** Enable/disable the caller's own target globally. Invalidates the targets list. */
export function useNcSetTargetEnabled() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<void, Error, SetTargetEnabledInput>({
    mutationFn: async ({ targetId, enabled }): Promise<void> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      await ncClientForTrpc(system.trpcClient).setTargetEnabled(targetId, enabled)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: TARGETS_KEY })
    },
  })
}

/** Send a test notification to the caller's own target. No cache invalidation. */
export function useNcTestTarget() {
  const { controller } = useConnection()
  return useMutation<NcTestTargetResult, Error, { readonly targetId: string }>({
    mutationFn: async ({ targetId }): Promise<NcTestTargetResult> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      return await ncClientForTrpc(system.trpcClient).testTarget(targetId)
    },
  })
}


/** Open a snooze window. Invalidates the window list on success. */
export function useNcCreateSnooze() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<NcSnooze, Error, NcSnoozeInput>({
    mutationFn: async (snooze): Promise<NcSnooze> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      const { snooze: created } = await ncClientForTrpc(system.trpcClient).createSnooze(snooze)
      return created
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SNOOZES_KEY })
    },
  })
}

/** End a window early. The digest of what it hid still arrives. */
export function useNcCancelSnooze() {
  const { controller } = useConnection()
  const queryClient = useQueryClient()
  return useMutation<void, Error, { readonly snoozeId: string }>({
    mutationFn: async ({ snoozeId }): Promise<void> => {
      const system = controller.getSystem()
      if (!system) throw ncNotConnectedError()
      await ncClientForTrpc(system.trpcClient).cancelSnooze(snoozeId)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SNOOZES_KEY })
    },
  })
}
