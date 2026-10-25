/**
 * rule-ai-form — the pure, RN-free half of the rule editor's AI section.
 *
 * The feature landed on the hub with no interface at all: `nc.setRuleAi` was
 * reachable only from a terminal. This module is what the widgets read, and it
 * owns the three decisions that would be invisible if they broke.
 *
 * ## 1. WHICH QUESTION the rule will be asked — and it is not a field
 *
 * The hub derives the shape from the ROW (`ruleAiShapeOf`), never from the
 * rule, so a row can only ever be narrated as what it actually descends from.
 * The editor therefore does not offer a shape select; it PREDICTS the shape
 * from the form and shows the operator the question that shape asks, so the
 * prompt box is pre-filled with what they are about to change rather than with
 * nothing. {@link ruleAiShapeForForm} mirrors the hub's derivation exactly —
 * see the table on {@link NcRuleAiShape}.
 *
 * ## 2. LANGUAGE and LENGTH compose the prompt — they are not post-processing
 *
 * Both are stated to the MODEL, in the system turn the hub builds:
 * `buildRuleAiSystemPrompt(shape, language, maxWords)` emits the shape
 * contract, then `Use at most N words of prose.`, then the language clause,
 * then the anti-injection clause. Stating the cap is what makes the answer a
 * shorter sentence instead of a longer one with its tail cut off; `capWords` is
 * only a backstop, and it marks a cut with an ellipsis. So the word cap is an
 * INSTRUCTION and the label must say so — an operator told "limit: 24" and
 * shown 25 words concludes the feature is broken.
 *
 * ## 3. ABSENCE is the default, everywhere
 *
 * `NcRuleAiSchema` carries no `.default()` on the hub because the block is
 * FROZEN onto a durable outbox row at enqueue: a default materialised at parse
 * time would be a number the operator never chose, pinned onto a row for days.
 * The same discipline runs here — {@link ruleAiFormToInput} prunes a value
 * still sitting on the default back out to `undefined`, so opening a rule and
 * saving it unchanged writes nothing, and a hub that improves its own default
 * tomorrow reaches a rule authored today.
 *
 * ## What this module deliberately CANNOT express
 *
 * A response format. The occupancy answer is structured — `{confirmed, count,
 * reason}` — and the addon composes the verdict sentence from it ("NOT
 * confirmed — the camera shows 1, not 2"), which is the whole point of that
 * shape: a refutation the model cannot soften into a caption. The operator's
 * text is a QUESTION and reaches only the first line of the user turn; the
 * contract, the JSON schema and the hardening live in the system turn, where
 * nothing authorable reaches them. There is no field here that could override
 * it, and that absence is the feature.
 */
import { ruleKindSpec } from '@camstack/types/client'
import type { NcRuleKind } from '@camstack/types'
import {
  NC_RULE_AI_WORDS_MAX,
  NC_RULE_AI_WORDS_MIN,
  type NcAiProfile,
  type NcDelivery,
  type NcRuleAi,
  type NcRuleAiLanguage,
  type Target,
  type TargetKind,
} from '../../data/notification-center.js'

// ── The shape ───────────────────────────────────────────────────────

/**
 * WHICH QUESTION this rule's picture is worth asking. The hub's
 * `NcRuleAiShape`, member for member.
 *
 * | shape | the question |
 * | --- | --- |
 * | `occupancy` | does the NUMBER this notification claims actually hold? |
 * | `detection-track` | what HAPPENED over this passage? |
 * | `detection-immediate` | what IS there, in this frame? |
 */
export const NC_RULE_AI_SHAPES = ['occupancy', 'detection-immediate', 'detection-track'] as const
export type NcRuleAiShape = (typeof NC_RULE_AI_SHAPES)[number]

/**
 * The shape this rule's rows will take — the hub's `ruleAiShapeOf`, predicted
 * from the form.
 *
 * A PREDICTION and not an authority: the hub derives it from the row, and this
 * only decides which default question the box is pre-filled with. It matches
 * because the two inputs are the two the row carries — an occupancy edge is the
 * only subject with a count, and the detection split is the one the engine
 * already draws (`track-end` fires from a CLOSED track, everything else fires
 * on one instant).
 */
export function ruleAiShapeForForm(kind: NcRuleKind, delivery: NcDelivery): NcRuleAiShape {
  if (kind === 'occupancy') return 'occupancy'
  return delivery === 'track-end' ? 'detection-track' : 'detection-immediate'
}

/**
 * Can a rule of this kind carry an AI section at all?
 *
 * Asked of the SHARED model rather than compared against `'system'`, because
 * the property that decides it is the one already named there: a kind whose
 * subject freezes no frame has nothing a vision model could be asked about.
 * The hub refuses the same rule from the other end — `frozenRuleAiPolicy`
 * returns `undefined` for a system event, and the analyst skips the pass
 * entirely on zero frames — so a section offered here would be a switch the
 * operator turns on and that provably never runs.
 */
export function ruleAiApplies(kind: NcRuleKind): boolean {
  return ruleKindSpec(kind).carriesMedia
}

// ── The default question, per shape ─────────────────────────────────

/**
 * The question the hub asks when the operator wrote none — its own
 * `DEFAULT_QUESTION`, verbatim.
 *
 * ENGLISH, and not translated, deliberately, as a VALUE: it is what would be
 * sent to the model, and the box pre-fills with it so the operator can SEE what
 * they are changing. A localised pre-fill would show a sentence the hub is not
 * going to use — and because a box left on this value is pruned back to
 * `undefined` (see {@link ruleAiFormToInput}), what the operator reads is
 * exactly what the model will be asked. The ANSWER's language is a separate
 * knob and is enforced in the system turn.
 *
 * Only the PLACEHOLDER — what a CLEARED box shows, which also sends nothing and
 * lets the hub ask its own default — is translated
 * ({@link ruleAiDefaultPromptKey}, with this string as its `defaultValue`).
 */
export const NC_RULE_AI_DEFAULT_PROMPT: Readonly<Record<NcRuleAiShape, string>> = {
  occupancy: 'Does the claimed count hold?',
  'detection-immediate': 'What is in this picture?',
  'detection-track': 'What happened during this passage?',
}

/** The i18n key of the prompt box's PLACEHOLDER for one shape. */
export function ruleAiDefaultPromptKey(shape: NcRuleAiShape): string {
  return `v2.nc.rules.ai.defaultPrompt.${shape}`
}

// ── The word cap ────────────────────────────────────────────────────

/** The hub's fallback when the target's own budget is unknown — PUSH-shaped:
 *  a sentence too long for a lock screen is truncated mid-word by the degrade
 *  engine, and the operator sees a feature that does not work. */
export const NC_RULE_AI_WORDS_FALLBACK = 24

/** The curve, from `rule-ai.ts`: doubling a target's body budget buys
 *  {@link NC_RULE_AI_WORDS_PER_DOUBLING} more words, from a floor of
 *  {@link NC_RULE_AI_WORDS_FLOOR_CHARS} characters. */
export const NC_RULE_AI_WORDS_FLOOR_CHARS = 250
export const NC_RULE_AI_WORDS_PER_DOUBLING = 12

/**
 * The word cap for ONE delivery — the hub's `ruleAiWordCap`, mirrored.
 *
 * Mirrored and not imported because it lives in the addon (`rule-ai.ts`), which
 * this app cannot reach; the pair is pinned by
 * `__tests__/rule-ai-form.spec.ts` against the table the hub's own docblock
 * publishes, so a drift is a failing test rather than a number the phone shows
 * and the hub ignores.
 */
export function ruleAiWordCap(authored: number | undefined, bodyMaxLen: number | undefined): number {
  if (authored !== undefined) return authored
  if (bodyMaxLen === undefined || !Number.isFinite(bodyMaxLen) || bodyMaxLen <= 0) {
    return NC_RULE_AI_WORDS_FALLBACK
  }
  const doublings = Math.log2(bodyMaxLen / NC_RULE_AI_WORDS_FLOOR_CHARS)
  const words = Math.round(NC_RULE_AI_WORDS_PER_DOUBLING * doublings)
  return Math.min(NC_RULE_AI_WORDS_MAX, Math.max(NC_RULE_AI_WORDS_MIN, words))
}

/**
 * What the word-cap field SHOWS while the operator has authored nothing.
 *
 * One rule fans out to several targets and the hub resolves the cap PER TARGET
 * at send time, so there is no single number to show — `varies` says so rather
 * than picking one and calling it "the" default. The number shown is the
 * STRICTEST of the selected targets: it is the one an over-long sentence is
 * actually truncated by, and showing the most generous instead would promise a
 * paragraph that the smallest screen cuts.
 *
 * No targets selected yet, or a kind catalog that has not answered, is UNKNOWN
 * and falls back to the hub's own fallback — never to a cap of nothing.
 */
export interface NcRuleAiWordDefault {
  readonly words: number
  /** True when the selected targets do not agree — the field is showing the
   *  strictest of several, not a single answer. */
  readonly varies: boolean
}

export function ruleAiTargetWordDefault(
  targetIds: readonly string[],
  targets: readonly Target[],
  kinds: readonly TargetKind[],
): NcRuleAiWordDefault {
  const budgets: number[] = []
  for (const id of targetIds) {
    const target = targets.find((candidate) => candidate.id === id)
    if (target === undefined) continue
    const kind = kinds.find((candidate) => candidate.kind === target.kind)
    if (kind === undefined) continue
    budgets.push(kind.caps.bodyMaxLen)
  }
  if (budgets.length === 0) return { words: NC_RULE_AI_WORDS_FALLBACK, varies: false }
  const caps = budgets.map((budget) => ruleAiWordCap(undefined, budget))
  const words = Math.min(...caps)
  return { words, varies: caps.some((cap) => cap !== words) }
}

// ── The form ────────────────────────────────────────────────────────

/**
 * The AI section as the editor holds it.
 *
 * `prompt` and `maxWords` stay `undefined` until the operator MOVES them, and
 * the widgets render the resolved default in their place
 * ({@link ruleAiPromptValue}, {@link ruleAiWordsValue}). Holding a concrete
 * seed instead would freeze whichever default happened to be current when the
 * form opened — and both of them move while the form is open: authoring an
 * occupancy condition converts the rule and changes the SHAPE, and adding a
 * target changes the word budget. The operator would then be looking at a
 * number that used to be the default and is no longer, with nothing saying so.
 */
export interface NcRuleAiFormState {
  readonly enabled: boolean
  /** `''` = no pin, i.e. the hub's own default profile for this consumer. */
  readonly profileId: string
  /** `undefined` = the shape's own question, whatever it is when the row fires. */
  readonly prompt: string | undefined
  /** `undefined` = the rule owner's language, i.e. the hub's. */
  readonly language: NcRuleAiLanguage | undefined
  /** `undefined` = derived from the delivery target at send time. */
  readonly maxWords: number | undefined
  /**
   * Everything this app does not author, carried VERBATIM.
   *
   * `nc.setRuleAi` takes the WHOLE section and not a diff, so a field dropped
   * here is a field cleared on disk — an image bound or a timeout an admin set
   * from the desktop would silently revert the first time the operator opened
   * this form on a phone.
   */
  readonly carried: Readonly<Pick<NcRuleAi, 'maxImagePx' | 'timeoutMs'>>
}

/** A blank section — what a rule with no row on disk opens on. */
export function emptyRuleAiForm(): NcRuleAiFormState {
  return {
    enabled: false,
    profileId: '',
    prompt: undefined,
    language: undefined,
    maxWords: undefined,
    carried: {},
  }
}

/**
 * Seed the form from the stored section.
 *
 * A stored section that authored nothing is indistinguishable from an empty
 * one here, which is exactly what makes "open a rule and save it" a no-op in
 * both cases.
 */
export function ruleAiToForm(ai: NcRuleAi | undefined): NcRuleAiFormState {
  if (ai === undefined) return emptyRuleAiForm()
  return {
    enabled: ai.enabled,
    profileId: ai.profileId ?? '',
    prompt: ai.prompt,
    language: ai.language,
    maxWords: ai.maxWords,
    carried: {
      ...(ai.maxImagePx !== undefined ? { maxImagePx: ai.maxImagePx } : {}),
      ...(ai.timeoutMs !== undefined ? { timeoutMs: ai.timeoutMs } : {}),
    },
  }
}

/**
 * What the prompt box SHOWS — the operator's question, or the one the hub would
 * ask in its place. Never an empty box: the section exists so the operator can
 * see what they are changing.
 */
export function ruleAiPromptValue(form: NcRuleAiFormState, shape: NcRuleAiShape): string {
  return form.prompt ?? NC_RULE_AI_DEFAULT_PROMPT[shape]
}

/** What the word-cap stepper SHOWS — the authored cap, or the target-derived
 *  default it would otherwise resolve to at send time. */
export function ruleAiWordsValue(form: NcRuleAiFormState, wordDefault: number): number {
  return form.maxWords ?? wordDefault
}

/**
 * The section to send, or `null` to CLEAR the row.
 *
 * `null` and `{ enabled: false }` deliver identically; the difference is what
 * is left on disk, and a section the operator never switched on should leave
 * nothing — a row per rule for a feature nobody used is a table that outlives
 * every reason to read it. So an untouched, disabled form clears, and a form
 * the operator authored and then switched OFF is kept with `enabled: false`:
 * their prompt survives the switch.
 *
 * A value the operator moved back ONTO its default is pruned to absence rather
 * than written: what they see is then what happens, and a hub that improves its
 * own default still reaches the rule. Only `wordDefault` is passed for that,
 * because the prompt's default is a constant of the shape.
 */
export function ruleAiFormToInput(
  form: NcRuleAiFormState,
  shape: NcRuleAiShape,
  wordDefault: number,
): NcRuleAi | null {
  const prompt = form.prompt?.trim() ?? ''
  const authoredPrompt = prompt.length > 0 && prompt !== NC_RULE_AI_DEFAULT_PROMPT[shape]
  const authoredWords = form.maxWords !== undefined && form.maxWords !== wordDefault
  const carried = form.carried.maxImagePx !== undefined || form.carried.timeoutMs !== undefined
  const authoredAnything =
    authoredPrompt || authoredWords || carried || form.profileId !== '' || form.language !== undefined
  if (!form.enabled && !authoredAnything) return null
  return {
    enabled: form.enabled,
    ...(form.profileId !== '' ? { profileId: form.profileId } : {}),
    ...(authoredPrompt ? { prompt } : {}),
    ...(form.language !== undefined ? { language: form.language } : {}),
    ...(authoredWords && form.maxWords !== undefined ? { maxWords: form.maxWords } : {}),
    ...form.carried,
  }
}

/**
 * Is this section the one already on disk?
 *
 * The editor skips the `nc.setRuleAi` call when it is. Not an optimisation: a
 * write bumps `updatedAt` on a durable row, and a rule opened and cancelled out
 * of should leave no trace that it was looked at.
 */
export function ruleAiUnchanged(next: NcRuleAi | null, stored: NcRuleAi | undefined): boolean {
  if (next === null) return stored === undefined
  if (stored === undefined) return false
  return (
    next.enabled === stored.enabled &&
    next.profileId === stored.profileId &&
    next.prompt === stored.prompt &&
    next.language === stored.language &&
    next.maxWords === stored.maxWords &&
    next.maxImagePx === stored.maxImagePx &&
    next.timeoutMs === stored.timeoutMs
  )
}

// ── Options ─────────────────────────────────────────────────────────

/** The i18n key for a language option's word. */
export function ruleAiLanguageKey(language: NcRuleAiLanguage): string {
  return `v2.nc.rules.editor.ai.language.${language}`
}

/** The languages the hub can write an answer in — its `NC_LANGUAGES`. */
export const NC_RULE_AI_LANGUAGES: readonly NcRuleAiLanguage[] = ['en', 'it']

/** The label a profile option carries: the operator's name for it, then the
 *  model — two profiles are routinely the same endpoint at two models. */
export function ruleAiProfileLabel(profile: NcAiProfile): string {
  return profile.model.length > 0 ? `${profile.name} · ${profile.model}` : profile.name
}
