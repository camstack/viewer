/**
 * nc-rule-draft-store — the rule being edited, shared across its sub-screens.
 *
 * The editor is a summary route plus one route per section, so the form cannot
 * live in one component's state: popping a sub-screen would drop it. It lives
 * here, keyed by rule (or by kind for a new one), IN MEMORY ONLY — a draft that
 * survived an app restart would reopen a rule showing edits the operator
 * thought they abandoned. Pure reducers, thin zustand glue (the grid-store
 * pattern).
 *
 * The draft holds the FORM, never a clear list: what a save clears is computed
 * from the form at save time (`formToInput` / `ruleClearsFor`), exactly as the
 * single-screen editor does.
 */
import { create } from 'zustand'
import type { NcRuleKind } from '@camstack/types'
import type { NcRuleFormState } from '../components/notifications/rule-editor.js'
import type { NcRuleAiFormState } from '../components/notifications/rule-ai-form.js'
import type { NcViewerRule } from '../data/notification-center.js'

export interface NcRuleDraft {
  readonly key: string
  readonly kind: NcRuleKind
  readonly ruleId: string | null
  readonly baseline: NcRuleFormState
  readonly form: NcRuleFormState
  /** `null` = the AI section was not touched (derived from its own query). */
  readonly ai: NcRuleAiFormState | null
  /** Save was pressed on an invalid form: the missing fields now show red. */
  readonly saveAttempted: boolean
  /**
   * A NEW rule the hub already STORED although the save failed after it — a
   * hub older than D647 keeps the rule and drops its summary. The draft is
   * then MOVED under that rule's key ({@link adoptDraftRule}) and edits it:
   * the next Save is an update. Also the rule the edit route resolves while
   * the rules list has not caught up. Absent for every other draft.
   */
  readonly adopted?: NcViewerRule
  /**
   * An i18n key the editor shows until the draft ends — why it was adopted
   * (`v2.nc.rules.editor.summaryNotKept`). Carried on the draft because the
   * screen that raised it is replaced by the rule's edit route.
   */
  readonly notice?: string
  /** When the draft was adopted (ms) — a rules list fetched AFTER this that
   *  lacks the rule is an answer, not a list that has not caught up yet. */
  readonly adoptedAt?: number
  /** The rules list has contained the adopted rule once: from then on the
   *  list alone decides, and its absence is `missing` (a server-side delete). */
  readonly adoptedSeen?: boolean
}

export type NcRuleDrafts = Readonly<Record<string, NcRuleDraft>>

/** Keyed by the kind for a new rule: a new device-events rule and a new
 *  system rule are two drafts, though both are `system-event` on the hub. */
export function draftKey(ruleId: string | null, kind: NcRuleKind): string {
  return ruleId ?? `new:${kind}`
}

/** Opening a draft that is already open keeps its edits (a sub-screen round trip). */
export function openDraft(drafts: NcRuleDrafts, draft: NcRuleDraft): NcRuleDrafts {
  const existing = drafts[draft.key]
  // A NEW rule's route never joins a draft that already belongs to a stored
  // rule: its save would UPDATE that rule. Adoption moves the draft off the
  // `new:<kind>` key, so this is the second lock on the same door.
  if (existing !== undefined && !(draft.ruleId === null && existing.adopted !== undefined)) return drafts
  return { ...drafts, [draft.key]: draft }
}

export function patchDraft(drafts: NcRuleDrafts, key: string, patch: Partial<NcRuleFormState>): NcRuleDrafts {
  const draft = drafts[key]
  if (!draft) return drafts
  return { ...drafts, [key]: { ...draft, form: { ...draft.form, ...patch } } }
}

export function patchDraftAi(drafts: NcRuleDrafts, key: string, ai: NcRuleAiFormState): NcRuleDrafts {
  const draft = drafts[key]
  if (!draft) return drafts
  return { ...drafts, [key]: { ...draft, ai } }
}

export function markDraftSaveAttempted(drafts: NcRuleDrafts, key: string): NcRuleDrafts {
  const draft = drafts[key]
  if (!draft) return drafts
  return { ...drafts, [key]: { ...draft, saveAttempted: true } }
}

/**
 * The hub stored this NEW draft's rule although the save failed after it:
 * move the draft under the rule's own key, bound to its id, so it edits that
 * rule from now on and the `new:<kind>` key is free for the next new rule.
 */
export function adoptDraftRule(
  drafts: NcRuleDrafts,
  fromKey: string,
  rule: NcViewerRule,
  notice: string,
  at: number,
): NcRuleDrafts {
  const draft = drafts[fromKey]
  if (!draft) return drafts
  const key = draftKey(rule.id, draft.kind)
  const rest = discardDraft(drafts, fromKey)
  return { ...rest, [key]: { ...draft, key, ruleId: rule.id, adopted: rule, notice, adoptedAt: at } }
}

/** The rules list has shown the adopted rule: its local copy stands in no more. */
export function markAdoptedSeen(drafts: NcRuleDrafts, key: string): NcRuleDrafts {
  const draft = drafts[key]
  if (!draft || draft.adopted === undefined || draft.adoptedSeen === true) return drafts
  return { ...drafts, [key]: { ...draft, adoptedSeen: true } }
}

export function discardDraft(drafts: NcRuleDrafts, key: string): NcRuleDrafts {
  return Object.fromEntries(Object.entries(drafts).filter(([k]) => k !== key))
}

/**
 * Dirty = the form differs from its baseline, or the AI section was touched.
 * JSON equality is sound: form and baseline are both built by `inputToForm` /
 * `emptyRuleForm` and these reducers, so key order is stable. `ai !== null`
 * counts as dirty on purpose — the AI form is `null` until touched (`useRuleAiState`).
 */
export function isDraftDirty(draft: NcRuleDraft): boolean {
  return draft.ai !== null || JSON.stringify(draft.form) !== JSON.stringify(draft.baseline)
}

interface NcRuleDraftStore {
  readonly drafts: NcRuleDrafts
  readonly open: (draft: NcRuleDraft) => void
  readonly patch: (key: string, patch: Partial<NcRuleFormState>) => void
  readonly patchAi: (key: string, ai: NcRuleAiFormState) => void
  readonly markSaveAttempted: (key: string) => void
  readonly adopt: (key: string, rule: NcViewerRule, notice: string, at: number) => void
  readonly markAdoptedSeen: (key: string) => void
  readonly discard: (key: string) => void
}

export const useNcRuleDraftStore = create<NcRuleDraftStore>((set) => ({
  drafts: {},
  open: (draft) => set((s) => ({ drafts: openDraft(s.drafts, draft) })),
  patch: (key, patch) => set((s) => ({ drafts: patchDraft(s.drafts, key, patch) })),
  patchAi: (key, ai) => set((s) => ({ drafts: patchDraftAi(s.drafts, key, ai) })),
  markSaveAttempted: (key) => set((s) => ({ drafts: markDraftSaveAttempted(s.drafts, key) })),
  adopt: (key, rule, notice, at) => set((s) => ({ drafts: adoptDraftRule(s.drafts, key, rule, notice, at) })),
  markAdoptedSeen: (key) => set((s) => ({ drafts: markAdoptedSeen(s.drafts, key) })),
  discard: (key) => set((s) => ({ drafts: discardDraft(s.drafts, key) })),
}))
