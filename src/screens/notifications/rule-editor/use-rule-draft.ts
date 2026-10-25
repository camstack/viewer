/**
 * useRuleDraft — the rule being edited, as the summary and every section
 * sub-screen see it.
 *
 * Every editor route calls this with its own params. The draft lives in
 * {@link useNcRuleDraftStore} keyed by rule (or by kind for a new one), so a
 * sub-screen's edits survive its pop and the summary reads them back. Opening
 * is idempotent — the first screen to mount seeds it, the rest join it.
 *
 * The AI section is a separate side table with its own write
 * ({@link useRuleAiState}); a save writes the rule, then the AI section, then
 * discards the draft.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useRouter } from 'expo-router'
import { useTranslation } from 'react-i18next'
import type { NcRuleKind } from '@camstack/types'
import {
  useNcAiProfiles,
  useNcConditionCatalog,
  useNcCreateRule,
  useNcHubKeepsSummary,
  useNcRuleAiSections,
  useNcRules,
  useNcSetRuleAi,
  useNcTargetKinds,
  useNcTargets,
  useNcUpdateRule,
} from '../../../data/use-notification-center.js'
import type { NcAiProfile, NcRuleAi, NcViewerRule } from '../../../data/notification-center.js'
import { isRuleFormValid, type NcRuleFormState } from '../../../components/notifications/rule-editor.js'
import {
  emptyRuleAiForm,
  ruleAiApplies,
  ruleAiFormToInput,
  ruleAiShapeForForm,
  ruleAiTargetWordDefault,
  ruleAiToForm,
  ruleAiUnchanged,
  type NcRuleAiFormState,
  type NcRuleAiShape,
  type NcRuleAiWordDefault,
} from '../../../components/notifications/rule-ai-form.js'
import { useAdminVerdict } from '../../../data/use-me.js'
import {
  saveBlockReason,
  targetsReadState,
  type SaveBlockReason,
} from '../../../components/notifications/save-gate.js'
import { newRuleHref } from '../../../navigation/rule-routes.js'
import { targetSaveContext } from '../../../components/notifications/target-ownership.js'
import { useNcErrorText } from '../../../components/notifications/use-nc-error-text.js'
import { useNcRuleDraftStore, type NcRuleDraft } from '../../../store/nc-rule-draft-store.js'
import { executeRuleSave, resolveDraftSource, ruleSaveRequest, type RuleDraftParams } from './rule-draft-source.js'
import { NC_SUMMARY_NOT_KEPT_KEY } from '../../../data/nc-errors.js'

export interface UseRuleDraft {
  readonly status: 'loading' | 'failed' | 'missing' | 'ready'
  readonly draft?: NcRuleDraft
  /** The draft's store key, known as soon as the route resolves (before it opens). */
  readonly draftKey?: string
  /** The rule's kind — fixed for the life of the draft. */
  readonly kind?: NcRuleKind
  /** The stored rule, `null` for a new one. */
  readonly rule: NcViewerRule | null
  /** Shown, never saved: the server said the caller cannot edit this rule,
   *  or its kind cannot be edited at all (`mixed`, D637). */
  readonly readOnly: boolean
  readonly patch: (p: Partial<NcRuleFormState>) => void
  /**
   * Resolves only once the rule (and its AI section) LANDED. Rejects — draft
   * intact — on a hub refusal, on a read-only rule, and on an invalid form,
   * which it marks `saveAttempted` so the missing fields show red.
   */
  readonly save: () => Promise<void>
  readonly discard: () => void
  readonly saving: boolean
  readonly error: string | null
  readonly valid: boolean
  /** Why Save may not run yet (`save-gate.ts`); `undefined` = it may. */
  readonly saveBlock: SaveBlockReason | undefined
}

export interface RuleAiState {
  readonly applies: boolean
  readonly form: NcRuleAiFormState
  readonly stored: NcRuleAi | undefined
  readonly shape: NcRuleAiShape
  readonly wordDefault: NcRuleAiWordDefault
  readonly profiles: readonly NcAiProfile[]
  readonly profilesUnavailable: boolean
  readonly onChange: (patch: Partial<NcRuleAiFormState>) => void
}

/**
 * The AI section of a draft.
 *
 * `draft.ai === null` means NOT YET TOUCHED, and the form is then DERIVED from
 * the query rather than snapshotted: on a cold open the sections list answers
 * after the first render, and a snapshot would freeze the blank form.
 */
export function useRuleAiState(draft: NcRuleDraft | undefined): RuleAiState {
  const aiSectionsQuery = useNcRuleAiSections()
  const aiProfilesQuery = useNcAiProfiles()
  const targetsQuery = useNcTargets()
  const targetKindsQuery = useNcTargetKinds()
  const patchAi = useNcRuleDraftStore((s) => s.patchAi)

  const stored = draft?.ruleId ? aiSectionsQuery.data?.get(draft.ruleId) : undefined
  const form = draft?.ai ?? (aiSectionsQuery.data ? ruleAiToForm(stored) : emptyRuleAiForm())
  const kind = draft?.kind ?? 'detection'
  const delivery = draft?.form.delivery ?? 'immediate'
  const draftKeyValue = draft?.key

  const onChange = useCallback(
    (patch: Partial<NcRuleAiFormState>): void => {
      if (draftKeyValue !== undefined) patchAi(draftKeyValue, { ...form, ...patch })
    },
    [draftKeyValue, form, patchAi],
  )

  return {
    applies: draft !== undefined && ruleAiApplies(kind),
    form,
    stored,
    shape: ruleAiShapeForForm(kind, delivery),
    wordDefault: ruleAiTargetWordDefault(
      draft?.form.targetIds ?? [],
      targetsQuery.data ?? [],
      targetKindsQuery.data ?? [],
    ),
    profiles: aiProfilesQuery.data ?? [],
    profilesUnavailable: aiProfilesQuery.isError,
    onChange,
  }
}

/**
 * Which drafts have their summary on screen. A section reached COLD (a deep
 * link, a reload on web) has no summary under it, so nothing would ever
 * discard its draft; it checks here when it goes away. Checked a tick later,
 * because the summary a section `replace`s itself with mounts in the same
 * commit the section unmounts in.
 */
const summaryHolds = new Map<string, number>()

export function useSummaryHold(key: string | undefined): void {
  useEffect(() => {
    if (key === undefined) return undefined
    summaryHolds.set(key, (summaryHolds.get(key) ?? 0) + 1)
    return () => {
      const left = (summaryHolds.get(key) ?? 1) - 1
      if (left > 0) summaryHolds.set(key, left)
      else summaryHolds.delete(key)
    }
  }, [key])
}

/**
 * How long a draft a cold section HANDED to its summary waits for that summary
 * to mount. On web the summary route is a lazy chunk: it can arrive long after
 * the section is gone, and a one-tick check dropped the operator's edits in
 * that window (final review m7). Bounded, so a summary that never comes does
 * not leave a draft to resurface as "unsaved changes" on the next open.
 */
export const DRAFT_HANDOFF_GRACE_MS = 10_000

/**
 * Drop the draft when this section leaves and no summary holds it.
 *
 * Returns `handOff`: call it when the section REPLACES itself with the rule's
 * summary (a cold back), and the check waits {@link DRAFT_HANDOFF_GRACE_MS}
 * instead of one tick.
 */
export function useDiscardOrphanDraft(key: string | undefined): () => void {
  const discardDraft = useNcRuleDraftStore((s) => s.discard)
  const handedOffRef = useRef(false)
  useEffect(() => {
    if (key === undefined) return undefined
    return () => {
      setTimeout(
        () => {
          if (!summaryHolds.has(key)) discardDraft(key)
        },
        handedOffRef.current ? DRAFT_HANDOFF_GRACE_MS : 0,
      )
    }
  }, [key, discardDraft])
  return useCallback((): void => {
    handedOffRef.current = true
  }, [])
}

export function useRuleDraft(params: RuleDraftParams): UseRuleDraft {
  const router = useRouter()
  const errorText = useNcErrorText()
  const { t } = useTranslation()
  const rulesQuery = useNcRules()
  const targetsQuery = useNcTargets()
  const catalogQuery = useNcConditionCatalog()
  const createRule = useNcCreateRule()
  const updateRule = useNcUpdateRule()
  const setRuleAi = useNcSetRuleAi()
  const openDraft = useNcRuleDraftStore((s) => s.open)
  const patchDraft = useNcRuleDraftStore((s) => s.patch)
  const discardDraft = useNcRuleDraftStore((s) => s.discard)
  const markSaveAttempted = useNcRuleDraftStore((s) => s.markSaveAttempted)
  const adoptRule = useNcRuleDraftStore((s) => s.adopt)
  const hubKeepsSummary = useNcHubKeepsSummary()

  const { id, kind: kindParam } = params
  // A draft adopted after a failed create sits under the rule's id already;
  // its local copy stands in ONCE, until the list has caught up.
  const adoptedRule = useNcRuleDraftStore((s) => s.drafts[id]?.adopted)
  const adoptedAt = useNcRuleDraftStore((s) => s.drafts[id]?.adoptedAt ?? 0)
  const adoptedSeen = useNcRuleDraftStore((s) => s.drafts[id]?.adoptedSeen === true)
  const adoption = useMemo(
    () => (adoptedRule !== undefined ? { rule: adoptedRule, at: adoptedAt, seen: adoptedSeen } : undefined),
    [adoptedRule, adoptedAt, adoptedSeen],
  )
  const source = useMemo(
    () =>
      resolveDraftSource(
        { id, kind: kindParam },
        rulesQuery.data,
        rulesQuery.isError,
        adoption,
        rulesQuery.dataUpdatedAt,
      ),
    [id, kindParam, rulesQuery.data, rulesQuery.isError, adoption, rulesQuery.dataUpdatedAt],
  )
  // The list has shown the adopted rule: record it, so its later absence is `missing`.
  const markSeen = useNcRuleDraftStore((s) => s.markAdoptedSeen)
  const adoptedId = adoption !== undefined && !adoption.seen ? adoption.rule.id : undefined
  const listed = adoptedId !== undefined && (rulesQuery.data ?? []).some((r) => r.id === adoptedId)
  useEffect(() => {
    if (listed) markSeen(id)
  }, [listed, markSeen, id])
  const seed = source.status === 'ready' ? source.draft : undefined
  const key = seed?.key
  const draft = useNcRuleDraftStore((s) => (key === undefined ? undefined : s.drafts[key]))
  const ai = useRuleAiState(draft)

  // Open once per key: a sub-screen mounting later joins the open draft
  // (`openDraft` keeps an existing one), it never reseeds it.
  useEffect(() => {
    if (seed !== undefined) openDraft(seed)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the draft, not by every refetch of the list
  }, [key, openDraft])

  useEffect(() => {
    if (source.status === 'needs-kind') router.replace(newRuleHref())
  }, [source.status, router])

  const patch = useCallback(
    (p: Partial<NcRuleFormState>): void => {
      if (key !== undefined) patchDraft(key, p)
    },
    [key, patchDraft],
  )
  const discard = useCallback((): void => {
    if (key !== undefined) discardDraft(key)
  }, [key, discardDraft])

  const rule = source.status === 'ready' ? source.rule : null
  const readOnly = source.status === 'ready' && source.readOnly
  const ownTargetIds = useMemo(() => (targetsQuery.data ?? []).map((tgt) => tgt.id), [targetsQuery.data])
  const catalog = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data])
  // Only a CONFIRMED admin sends or clears the admin-only fields; `pending`
  // counts as not-admin, which leaves them untouched on the hub (never wrong).
  // It also decides which stored targets a save keeps (`target-ownership.ts`),
  // so a save while the verdict is PENDING is refused rather than guessed.
  const verdict = useAdminVerdict()
  const isAdmin = verdict === 'admin'
  // The role AND the caller's own targets decide which stored targets a save
  // keeps; `(data ?? [])` above would read a pending or failed list as "owns
  // nothing" and send `targets: []`. Until both answered, Save is refused and
  // the screen says why (`save-gate.ts`).
  const saveBlock = saveBlockReason(verdict, targetsReadState(targetsQuery))
  // Counts the targets the save will SEND once role and list answered (m3).
  const targetContext = useMemo(
    () => targetSaveContext(verdict, targetsQuery.data?.map((tgt) => tgt.id), rule?.targets ?? []),
    [verdict, targetsQuery.data, rule],
  )
  const valid = draft !== undefined && isRuleFormValid(draft.form, { isAdmin, targets: targetContext })

  /**
   * Rule first, then its AI section, then discard (`executeRuleSave`).
   * Rejects on either failure with the draft intact: the mutation holds the
   * error and the screen shows it, and closing on a half-write would leave the
   * operator believing a sentence was configured.
   */
  const save = useCallback(async (): Promise<void> => {
    if (draft === undefined || readOnly) throw new Error('rule is not editable here')
    if (saveBlock !== undefined) throw new Error(`save blocked: ${saveBlock}`)
    if (!valid) {
      markSaveAttempted(draft.key)
      throw new Error('rule form is incomplete')
    }
    const request = ruleSaveRequest(draft.form, rule, { ownTargetIds, catalog, isAdmin, hubKeepsSummary })
    const draftKeyValue = draft.key
    await executeRuleSave(request, {
      create: (input) => createRule.mutateAsync(input),
      update: (vars) => updateRule.mutateAsync(vars),
      applyAi: async (ruleId) => {
        if (!ai.applies) return
        const next = ruleAiFormToInput(ai.form, ai.shape, ai.wordDefault.words)
        if (!ruleAiUnchanged(next, ai.stored)) await setRuleAi.mutateAsync({ ruleId, ai: next })
      },
      // The draft moves under the created rule's key; the screen then REPLACES
      // itself with that rule's edit route (`RuleSummaryScreen`).
      adopt: (created) =>
        adoptRule(draftKeyValue, { ...created, readOnly: false }, NC_SUMMARY_NOT_KEPT_KEY, Date.now()),
    })
    discard()
  }, [draft, readOnly, saveBlock, valid, markSaveAttempted, rule, ownTargetIds, catalog, isAdmin, hubKeepsSummary, updateRule, createRule, ai, setRuleAi, adoptRule, discard])

  const mutationError = createRule.error ?? updateRule.error ?? setRuleAi.error
  const status =
    source.status === 'missing' || source.status === 'failed'
      ? source.status
      : source.status === 'ready' && draft !== undefined
        ? 'ready'
        : 'loading'

  return {
    status,
    draft,
    draftKey: key,
    kind: source.status === 'ready' ? source.kind : undefined,
    rule,
    readOnly,
    patch,
    save,
    discard,
    saving: createRule.isPending || updateRule.isPending || setRuleAi.isPending,
    // The adoption notice rides the draft: the screen that raised it is gone.
    error: errorText(mutationError) ?? (draft?.notice !== undefined ? t(draft.notice) : null),
    valid,
    saveBlock,
  }
}
