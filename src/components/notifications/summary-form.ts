/**
 * summary-form — the phone's form model for a MULTI-CAMERA DIGEST rule. Pure,
 * RN-free, unit-tested in the node env.
 *
 * ## Every field the admin authors — and a patch that is still a DIFF
 *
 * This surface used to author a subset ("rule più semplici"). On 2026-09-24
 * the operator decided for FULL PARITY with the admin editor, so the form now
 * owns every field of the digest rule: the window's track-close barrier, the
 * track filters, ranking and tile budget, the mosaic's captions,
 * the whole AI section and its image budget, empty-window delivery and the
 * notification template. Each has an absent state kept honest here:
 *
 *  - a DEFAULTED field (`maxTiles`, `maxAiImages`, `rank`,
 *    `barrierSeconds`, `captions`, `deliverEmpty`) is `undefined` in the form
 *    until the operator touches it or the stored rule carries it. Untouched =
 *    ABSENT: a create lets the hub apply its own default, and an edit never
 *    re-sends a value it merely displayed;
 *  - `filters`, `template` and `ai` are SECTIONS the hub replaces whole: a
 *    change sends the section, an emptied one is `null` (the patch's clear);
 *  - `captionText` — an EMPTY box is absent, which is the hub's default
 *    caption. The desktop's `''` ("no caption at all") is not authored here,
 *    and a stored `''` is left alone rather than cleared. An emptied caption
 *    cannot ride the patch (omitting it keeps the stored one, and it takes no
 *    `null`), so it travels as `clear` ({@link summaryClearsFor}).
 *
 * **The patch is still a DIFF** ({@link summaryFormToPatch}): every section is
 * compared against the stored rule READ BACK THROUGH THIS FORM, so an untouched
 * rule — whitespace, a rounded AI time limit and all — patches nothing.
 *
 * ## The window is a UNION, and this form does not flatten it
 *
 * `NcSummaryWindow` is either `{ kind: 'schedule', schedule }` or
 * `{ kind: 'motion', quietSeconds, maxWindowSeconds }` — a discriminated union
 * precisely so "neither" and "both" are not representable. A form cannot be a
 * union, so it holds a `windowKind` plus BOTH drafts and emits exactly the
 * selected branch. Keeping the unselected draft is the point: switching to
 * Motion to look at it and switching back must not cost the operator the weekly
 * bands they had already entered.
 *
 * ## Why the schema is a local mirror
 *
 * `NcSummaryRule` lives in `addon-post-analysis`, deliberately (a field added
 * there is live on the next `camstack deploy` rather than the next framework
 * train), so this app cannot import it — see `data/notification-center.ts`.
 */
import type {
  NcRuleTarget,
  NcSchedule,
  NcSummaryAi,
  NcSummaryAiLanguage,
  NcSummaryAiOnFailure,
  NcSummaryCaptions,
  NcSummaryFilters,
  NcSummaryRank,
  NcSummaryRule,
  NcSummaryRuleClearableKey,
  NcSummaryRuleInput,
  NcSummaryRulePatch,
  NcSummaryTemplate,
  NcSummaryWindow,
} from '../../data/notification-center.js'
import {
  ownershipSafeTargets,
  savedTargetIds,
  targetOwnershipPolicy,
  type TargetSaveContext,
} from './target-ownership.js'


// ── The bounds, mirrored from the addon's own constraint schemas ────
//
// `summary-rule.ts` in addon-post-analysis; `summary-form.spec.ts` pins each
// against a save the hub would refuse.

export const SUMMARY_QUIET_MIN_SEC = 30
export const SUMMARY_QUIET_MAX_SEC = 3600
export const SUMMARY_MAX_WINDOW_MIN_SEC = 60
export const SUMMARY_MAX_WINDOW_MAX_SEC = 86_400
export const SUMMARY_PRIORITY_MIN = 1
export const SUMMARY_PRIORITY_MAX = 5
export const SUMMARY_MAX_DEVICES = 64
export const SUMMARY_BARRIER_MIN_SEC = 0
export const SUMMARY_BARRIER_MAX_SEC = 3600
export const SUMMARY_TILES_MIN = 1
export const SUMMARY_TILES_MAX = 24
export const SUMMARY_AI_IMAGES_MIN = 1
export const SUMMARY_AI_IMAGES_MAX = 8
export const SUMMARY_CLASSES_MAX = 20
export const SUMMARY_CLASS_NAME_MAX = 40
export const SUMMARY_ZONES_MAX = 40
export const SUMMARY_IMPORTANCE_MIN = 0
export const SUMMARY_IMPORTANCE_MAX = 1
export const SUMMARY_DWELL_MIN_SEC = 0
export const SUMMARY_DWELL_MAX_SEC = 3600
export const SUMMARY_CAPTION_MAX = 200
export const SUMMARY_TITLE_MAX = 500
export const SUMMARY_BODY_MAX = 2000
export const SUMMARY_AI_PROMPT_MAX = 2000
export const SUMMARY_AI_IMAGE_PX_MIN = 64
export const SUMMARY_AI_IMAGE_PX_MAX = 2048
export const SUMMARY_AI_TIMEOUT_MIN_SEC = 10
export const SUMMARY_AI_TIMEOUT_MAX_SEC = 600
const MS_PER_SEC = 1000

/** What a blank motion window opens on — two minutes of quiet, one hour cap. */
export const SUMMARY_DEFAULT_QUIET_SEC = 120
export const SUMMARY_DEFAULT_MAX_WINDOW_SEC = 3600
export const SUMMARY_DEFAULT_PRIORITY = 3

/**
 * The hub's own `.default(...)` for every defaulted field — what an ABSENT
 * field MEANS. Shown by the screen and used by the budget check; never sent
 * for an untouched field.
 */
export const SUMMARY_HUB_DEFAULTS = {
  maxTiles: 12,
  maxAiImages: 6,
  rank: 'importance',
  barrierSeconds: 120,
  captions: 'none',
  deliverEmpty: false,
  aiOnFailure: 'deliver-without-text',
} as const satisfies {
  readonly maxTiles: number
  readonly maxAiImages: number
  readonly rank: NcSummaryRank
  readonly barrierSeconds: number
  readonly captions: NcSummaryCaptions
  readonly deliverEmpty: boolean
  readonly aiOnFailure: NcSummaryAiOnFailure
}

/** Which branch of the window union is selected. */
export type SummaryWindowKind = NcSummaryWindow['kind']

/** The template as two text boxes — a blank one is simply not sent. */
export interface SummaryFormTemplate {
  readonly title: string
  readonly body: string
}

/** Every field this surface authors. Anything absent here is preserved. */
export interface SummaryFormState {
  readonly name: string
  readonly enabled: boolean
  readonly deviceIds: readonly number[]
  readonly windowKind: SummaryWindowKind
  /** The SCHEDULE branch's draft. Kept while Motion is selected. */
  readonly schedule: NcSchedule | undefined
  /** The MOTION branch's drafts. Kept while Schedule is selected. */
  readonly quietSeconds: number
  readonly maxWindowSeconds: number
  readonly priority: number
  readonly targetIds: readonly string[]
  // ── Defaulted fields: `undefined` = untouched, the hub's default applies ──
  readonly barrierSeconds: number | undefined
  readonly rank: NcSummaryRank | undefined
  readonly maxTiles: number | undefined
  readonly maxAiImages: number | undefined
  readonly captions: NcSummaryCaptions | undefined
  readonly deliverEmpty: boolean | undefined
  // ── What goes in (the `filters` section) ──
  readonly classes: readonly string[]
  readonly classesExclude: readonly string[]
  readonly zones: readonly string[]
  readonly minImportance: number | undefined
  readonly minDwellSeconds: number | undefined
  /** Parked objects in the digest too — absent/false is the default. */
  readonly includeStationary: boolean
  // ── Text ──
  /** The mosaic caption; blank = the hub's default caption. */
  readonly captionText: string
  readonly template: SummaryFormTemplate
  // ── The AI section: EVERY field of the addon's `NcSummaryAiSchema` has a
  //    home here, because a change sends the section whole and a field with
  //    no home would be deleted by it. ──
  readonly aiEnabled: boolean
  /** `undefined` = whatever `llm` resolves for the digest consumer. */
  readonly aiProfileId: string | undefined
  /** Blank = the shipped question. */
  readonly aiPrompt: string
  readonly aiLanguage: NcSummaryAiLanguage | undefined
  readonly aiMaxImagePx: number | undefined
  /** SECONDS in the form, milliseconds on the wire. */
  readonly aiTimeoutSeconds: number | undefined
  readonly aiOnFailure: NcSummaryAiOnFailure | undefined
}

/** Why a save is refused. Ids, not sentences — the screen owns the words. */
export type SummaryFormProblem =
  | 'name'
  | 'devices'
  | 'window'
  | 'targets'
  | 'barrier'
  | 'budget'
  | 'filters'
  | 'caption'
  | 'template'
  | 'ai'

/**
 * What "New summary" opens on.
 *
 * A MOTION window, because that is the feature as the operator described it
 * ("windows driven by MOTION of the selected cameras") and because it is the
 * one branch that needs no calendar answered before the rule can work at all.
 * Every defaulted field is untouched, every section empty.
 */
export function emptySummaryForm(): SummaryFormState {
  return {
    name: '',
    enabled: true,
    deviceIds: [],
    windowKind: 'motion',
    schedule: undefined,
    quietSeconds: SUMMARY_DEFAULT_QUIET_SEC,
    maxWindowSeconds: SUMMARY_DEFAULT_MAX_WINDOW_SEC,
    priority: SUMMARY_DEFAULT_PRIORITY,
    targetIds: [],
    barrierSeconds: undefined,
    rank: undefined,
    maxTiles: undefined,
    maxAiImages: undefined,
    captions: undefined,
    deliverEmpty: undefined,
    classes: [],
    classesExclude: [],
    zones: [],
    minImportance: undefined,
    minDwellSeconds: undefined,
    includeStationary: false,
    captionText: '',
    template: { title: '', body: '' },
    aiEnabled: false,
    aiProfileId: undefined,
    aiPrompt: '',
    aiLanguage: undefined,
    aiMaxImagePx: undefined,
    aiTimeoutSeconds: undefined,
    aiOnFailure: undefined,
  }
}

/**
 * Read a stored rule back into the form — every field the rule carries.
 *
 * The UNSELECTED window branch falls back to the defaults rather than to
 * zeroes: an operator who switches a schedule rule to Motion to see what it
 * offers must be shown a workable window, not a pair of empty steppers.
 */
export function summaryRuleToForm(rule: NcSummaryRule): SummaryFormState {
  const window = rule.window
  const filters = rule.filters
  const ai = rule.ai
  return {
    name: rule.name,
    enabled: rule.enabled,
    deviceIds: [...rule.deviceIds],
    windowKind: window.kind,
    schedule: window.kind === 'schedule' ? window.schedule : undefined,
    quietSeconds: window.kind === 'motion' ? window.quietSeconds : SUMMARY_DEFAULT_QUIET_SEC,
    maxWindowSeconds:
      window.kind === 'motion' ? window.maxWindowSeconds : SUMMARY_DEFAULT_MAX_WINDOW_SEC,
    priority: rule.priority,
    targetIds: rule.targets.map((target) => target.targetId),
    barrierSeconds: rule.barrierSeconds,
    rank: rule.rank,
    maxTiles: rule.maxTiles,
    maxAiImages: rule.maxAiImages,
    captions: rule.captions,
    deliverEmpty: rule.deliverEmpty,
    classes: [...(filters?.classes ?? [])],
    classesExclude: [...(filters?.classesExclude ?? [])],
    zones: [...(filters?.zones ?? [])],
    minImportance: filters?.minImportance,
    minDwellSeconds: filters?.minDwellSeconds,
    includeStationary: filters?.includeStationary === true,
    captionText: rule.captionText ?? '',
    template: { title: rule.template?.title ?? '', body: rule.template?.body ?? '' },
    aiEnabled: ai?.enabled ?? false,
    aiProfileId: ai?.profileId,
    aiPrompt: ai?.prompt ?? '',
    aiLanguage: ai?.language,
    aiMaxImagePx: ai?.maxImagePx,
    aiTimeoutSeconds: ai?.timeoutMs === undefined ? undefined : Math.round(ai.timeoutMs / MS_PER_SEC),
    aiOnFailure: ai?.onFailure,
  }
}

/**
 * Everything wrong with this form, as ids.
 *
 * The bounds are the hub's own, checked HERE so the operator meets a disabled
 * Save and a sentence rather than a Zod string after the round-trip.
 */
export function summaryFormProblems(
  form: SummaryFormState,
  targets?: TargetSaveContext,
): readonly SummaryFormProblem[] {
  const problems: SummaryFormProblem[] = []
  if (form.name.trim().length === 0) problems.push('name')
  if (form.deviceIds.length === 0 || form.deviceIds.length > SUMMARY_MAX_DEVICES) problems.push('devices')
  // What the save will SEND (m3): a non-admin's foreign ids are dropped by it.
  if (savedTargetIds(form.targetIds, targets).length === 0) problems.push('targets')
  if (!windowIsSavable(form)) problems.push('window')
  if (form.barrierSeconds !== undefined && !inRange(form.barrierSeconds, SUMMARY_BARRIER_MIN_SEC, SUMMARY_BARRIER_MAX_SEC)) {
    problems.push('barrier')
  }
  if (budgetRefused(form)) problems.push('budget')
  if (filtersRefused(form)) problems.push('filters')
  if (form.captionText.trim().length > SUMMARY_CAPTION_MAX) problems.push('caption')
  const template = formTemplate(form.template)
  if ((template?.title?.length ?? 0) > SUMMARY_TITLE_MAX || (template?.body?.length ?? 0) > SUMMARY_BODY_MAX) {
    problems.push('template')
  }
  if (aiRefused(form)) problems.push('ai')
  return problems
}

export function isSummaryFormValid(form: SummaryFormState, targets?: TargetSaveContext): boolean {
  return summaryFormProblems(form, targets).length === 0
}

/** The tile and AI budgets as the hub will apply them. */
export interface SummaryBudget {
  readonly tiles: number
  readonly aiImages: number
}

/** An untouched budget is the hub's default, never "no budget". */
export function effectiveSummaryBudget(form: SummaryFormState): SummaryBudget {
  return {
    tiles: form.maxTiles ?? SUMMARY_HUB_DEFAULTS.maxTiles,
    aiImages: form.maxAiImages ?? SUMMARY_HUB_DEFAULTS.maxAiImages,
  }
}

/** The most the AI may look at with this many tiles — the hub refuses more. */
function aiImagesCap(tiles: number): number {
  return Math.max(SUMMARY_AI_IMAGES_MIN, Math.min(SUMMARY_AI_IMAGES_MAX, tiles))
}

/**
 * What the AI-images stepper SHOWS: the effective budget, clamped to what the
 * tile count allows — an untouched default of 6 over a 4-tile mosaic must not
 * read as a stepper sitting above its own maximum.
 */
export function summaryAiImagesShown(form: SummaryFormState): number {
  const budget = effectiveSummaryBudget(form)
  return Math.min(budget.aiImages, aiImagesCap(budget.tiles))
}

/**
 * The form change for a new tile count. Lowering the tiles below the AI
 * budget the hub would apply lowers the AI budget WITH it — otherwise the
 * hub's `assertSummaryBudget` refuses a save the stepper just offered. An AI
 * budget that still fits is left as it was, untouched included.
 */
export function summaryMaxTilesChange(form: SummaryFormState, tiles: number): Partial<SummaryFormState> {
  const budget = effectiveSummaryBudget(form)
  return budget.aiImages > tiles ? { maxTiles: tiles, maxAiImages: aiImagesCap(tiles) } : { maxTiles: tiles }
}

/** What the two builders need from the surface around them. */
export interface SummaryBuildOptions {
  /** The target ids the caller OWNS — see `timelapse-form.ts` for the why. */
  readonly ownTargetIds: readonly string[]
  /**
   * A CONFIRMED admin (`useAdminVerdict() === 'admin'`): only then are stored
   * targets outside `ownTargetIds` kept (`target-ownership.ts`). The screen
   * blocks Save while the verdict is pending, so this is never a guess.
   */
  readonly isAdmin: boolean
}

/**
 * The CREATE payload — the required fields plus every optional one the form
 * EXPRESSES. An untouched defaulted field is absent, so the hub's default
 * applies.
 *
 * Throws when the selected window branch cannot be built, rather than falling
 * back to the other one: a rule that silently became a motion digest because
 * the operator had not finished entering their bands fires at the wrong times.
 */
export function summaryFormToInput(
  form: SummaryFormState,
  options: SummaryBuildOptions,
): NcSummaryRuleInput {
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    deviceIds: [...form.deviceIds],
    window: buildWindow(form),
    priority: form.priority,
    targets: ownedTargets(form.targetIds, [], options.ownTargetIds, options.isAdmin),
    ...formOptionalFields(form),
  }
}

/**
 * The EDIT payload — a DIFF: only what the operator changed.
 *
 * Each optional field and section is compared against the stored rule READ
 * BACK THROUGH THIS FORM ({@link storedOptionalFields}), so a value the form
 * normalises (trimmed text, a rounded time limit, an explicit `false`) is not
 * mistaken for an edit. A SECTION the form no longer expresses is `null` — the
 * patch's own clear for `filters`, `template` and `ai`. An emptied caption is
 * not here at all: see {@link summaryClearsFor}.
 *
 * The WINDOW is compared as a whole, which is what makes "I opened the schedule
 * tab, looked, and switched back" a no-op.
 */
export function summaryFormToPatch(
  form: SummaryFormState,
  rule: NcSummaryRule,
  options: SummaryBuildOptions,
): NcSummaryRulePatch {
  const patch: MutableSummaryPatch = {}

  // Compared TRIMMED on both sides: whitespace the desktop stored is not an edit.
  const name = form.name.trim()
  if (name !== rule.name.trim()) patch.name = name
  if (form.enabled !== rule.enabled) patch.enabled = form.enabled
  if (!sameNumberSet(form.deviceIds, rule.deviceIds)) patch.deviceIds = [...form.deviceIds]
  if (form.priority !== rule.priority) patch.priority = form.priority

  // Only when the selected branch is actually buildable: an unfinished schedule
  // draft must leave the stored window alone rather than clear it.
  if (windowIsSavable(form)) {
    const window = buildWindow(form)
    if (!sameJson(window, rule.window)) patch.window = window
  }

  const targets = ownedTargets(form.targetIds, rule.targets, options.ownTargetIds, options.isAdmin)
  if (!sameJson(targets, rule.targets)) patch.targets = targets

  const next = formOptionalFields(form)
  const stored = storedOptionalFields(rule)
  if (next.barrierSeconds !== undefined && next.barrierSeconds !== stored.barrierSeconds) {
    patch.barrierSeconds = next.barrierSeconds
  }
  if (next.rank !== undefined && next.rank !== stored.rank) patch.rank = next.rank
  if (next.maxTiles !== undefined && next.maxTiles !== stored.maxTiles) patch.maxTiles = next.maxTiles
  if (next.maxAiImages !== undefined && next.maxAiImages !== stored.maxAiImages) {
    patch.maxAiImages = next.maxAiImages
  }
  if (next.captions !== undefined && next.captions !== stored.captions) patch.captions = next.captions
  if (next.deliverEmpty !== undefined && next.deliverEmpty !== stored.deliverEmpty) {
    patch.deliverEmpty = next.deliverEmpty
  }
  if (next.captionText !== undefined && next.captionText !== stored.captionText) {
    patch.captionText = next.captionText
  }
  if (!sameJson(next.filters, stored.filters)) patch.filters = next.filters ?? null
  if (!sameJson(next.template, stored.template)) patch.template = next.template ?? null
  if (!sameJson(next.ai, stored.ai)) patch.ai = next.ai ?? null

  return patch
}

/**
 * The optional fields the operator EMPTIED that the patch cannot remove — sent
 * as `clear` beside it. Today that is the caption alone.
 *
 * Only a key the stored rule actually SAID something under: clearing a stored
 * `captionText: ''` would turn the desktop's "no caption" into the default
 * caption behind the operator's back (the phone shows both as a blank box).
 */
export function summaryClearsFor(form: SummaryFormState, rule: NcSummaryRule): NcSummaryRuleClearableKey[] {
  const next = formOptionalFields(form)
  const clears: NcSummaryRuleClearableKey[] = []
  if (next.captionText === undefined && (rule.captionText ?? '').trim().length > 0) clears.push('captionText')
  return clears
}

// ── Local helpers ───────────────────────────────────────────────────

/** The patch under construction — the named type `NcSummaryRulePatch`, writable. */
type MutableSummaryPatch = { -readonly [K in keyof NcSummaryRulePatch]: NcSummaryRulePatch[K] }

/** The optional fields and sections as the wire wants them: empty is ABSENT. */
interface SummaryOptionalFields {
  readonly barrierSeconds?: number
  readonly rank?: NcSummaryRank
  readonly maxTiles?: number
  readonly maxAiImages?: number
  readonly captions?: NcSummaryCaptions
  readonly deliverEmpty?: boolean
  readonly captionText?: string
  readonly filters?: NcSummaryFilters
  readonly template?: NcSummaryTemplate
  readonly ai?: NcSummaryAi
}

function formOptionalFields(form: SummaryFormState): SummaryOptionalFields {
  const filters = formFilters(form)
  const template = formTemplate(form.template)
  const ai = formAi(form)
  const captionText = form.captionText.trim()
  return {
    ...(filters !== undefined ? { filters } : {}),
    ...(form.maxTiles !== undefined ? { maxTiles: form.maxTiles } : {}),
    ...(form.maxAiImages !== undefined ? { maxAiImages: form.maxAiImages } : {}),
    ...(form.rank !== undefined ? { rank: form.rank } : {}),
    ...(form.barrierSeconds !== undefined ? { barrierSeconds: form.barrierSeconds } : {}),
    ...(template !== undefined ? { template } : {}),
    ...(form.captions !== undefined ? { captions: form.captions } : {}),
    ...(captionText.length > 0 ? { captionText } : {}),
    ...(form.deliverEmpty !== undefined ? { deliverEmpty: form.deliverEmpty } : {}),
    ...(ai !== undefined ? { ai } : {}),
  }
}

/** The stored rule in the form's own normal form — so only a real change differs. */
function storedOptionalFields(rule: NcSummaryRule): SummaryOptionalFields {
  return formOptionalFields(summaryRuleToForm(rule))
}

/** The filters the form expresses, or `undefined` when it expresses none. */
function formFilters(form: SummaryFormState): NcSummaryFilters | undefined {
  const filters: NcSummaryFilters = {
    ...(form.classes.length > 0 ? { classes: [...form.classes] } : {}),
    ...(form.classesExclude.length > 0 ? { classesExclude: [...form.classesExclude] } : {}),
    ...(form.zones.length > 0 ? { zones: [...form.zones] } : {}),
    ...(form.minImportance !== undefined ? { minImportance: form.minImportance } : {}),
    ...(form.minDwellSeconds !== undefined ? { minDwellSeconds: form.minDwellSeconds } : {}),
    // Named ONLY when on: off is the default AND the reading of an absent key.
    ...(form.includeStationary ? { includeStationary: true } : {}),
  }
  return Object.keys(filters).length === 0 ? undefined : filters
}

/** Trimmed, with a blank half left out and a wholly blank template absent. */
function formTemplate(template: SummaryFormTemplate): NcSummaryTemplate | undefined {
  const title = template.title.trim()
  const body = template.body.trim()
  if (title.length === 0 && body.length === 0) return undefined
  return {
    ...(title.length > 0 ? { title } : {}),
    ...(body.length > 0 ? { body } : {}),
  }
}

/**
 * The AI section the form expresses, or `undefined` when it expresses none.
 *
 * "None" is NOT "off" — the admin editor's rule: an operator who switches AI
 * off for a week finds his prompt where he left it, so the section is absent
 * only when the switch is off AND nothing else in it is set.
 */
function formAi(form: SummaryFormState): NcSummaryAi | undefined {
  const profileId = form.aiProfileId?.trim() ?? ''
  const prompt = form.aiPrompt.trim()
  const section: NcSummaryAi = {
    enabled: form.aiEnabled,
    ...(profileId.length > 0 ? { profileId } : {}),
    ...(prompt.length > 0 ? { prompt } : {}),
    ...(form.aiLanguage !== undefined ? { language: form.aiLanguage } : {}),
    ...(form.aiMaxImagePx !== undefined ? { maxImagePx: form.aiMaxImagePx } : {}),
    ...(form.aiTimeoutSeconds !== undefined ? { timeoutMs: Math.round(form.aiTimeoutSeconds * MS_PER_SEC) } : {}),
    ...(form.aiOnFailure !== undefined ? { onFailure: form.aiOnFailure } : {}),
  }
  const configured = Object.keys(section).length > 1
  return form.aiEnabled || configured ? section : undefined
}

/** The hub's `assertSummaryBudget`, on the budgets it WILL apply. */
function budgetRefused(form: SummaryFormState): boolean {
  if (form.maxTiles !== undefined && !inRange(form.maxTiles, SUMMARY_TILES_MIN, SUMMARY_TILES_MAX)) return true
  if (form.maxAiImages !== undefined && !inRange(form.maxAiImages, SUMMARY_AI_IMAGES_MIN, SUMMARY_AI_IMAGES_MAX)) {
    return true
  }
  const budget = effectiveSummaryBudget(form)
  return budget.aiImages > budget.tiles
}

function filtersRefused(form: SummaryFormState): boolean {
  const badClasses = (names: readonly string[]): boolean =>
    names.length > SUMMARY_CLASSES_MAX || names.some((n) => n.length === 0 || n.length > SUMMARY_CLASS_NAME_MAX)
  if (badClasses(form.classes) || badClasses(form.classesExclude)) return true
  if (form.zones.length > SUMMARY_ZONES_MAX) return true
  if (form.minImportance !== undefined && !inRealRange(form.minImportance, SUMMARY_IMPORTANCE_MIN, SUMMARY_IMPORTANCE_MAX)) {
    return true
  }
  if (form.minDwellSeconds !== undefined && !inRealRange(form.minDwellSeconds, SUMMARY_DWELL_MIN_SEC, SUMMARY_DWELL_MAX_SEC)) {
    return true
  }
  // Every included class also excluded: no track can ever become a tile.
  const excluded = new Set(form.classesExclude)
  return form.classes.length > 0 && form.classes.every((name) => excluded.has(name))
}

function aiRefused(form: SummaryFormState): boolean {
  if (form.aiPrompt.trim().length > SUMMARY_AI_PROMPT_MAX) return true
  if (form.aiMaxImagePx !== undefined && !inRange(form.aiMaxImagePx, SUMMARY_AI_IMAGE_PX_MIN, SUMMARY_AI_IMAGE_PX_MAX)) {
    return true
  }
  return (
    form.aiTimeoutSeconds !== undefined &&
    !inRealRange(form.aiTimeoutSeconds, SUMMARY_AI_TIMEOUT_MIN_SEC, SUMMARY_AI_TIMEOUT_MAX_SEC)
  )
}

/** Can the SELECTED branch be turned into a window the schema accepts? */
function windowIsSavable(form: SummaryFormState): boolean {
  if (form.windowKind === 'schedule') {
    return form.schedule !== undefined && form.schedule.windows.length > 0
  }
  if (!inRange(form.quietSeconds, SUMMARY_QUIET_MIN_SEC, SUMMARY_QUIET_MAX_SEC)) return false
  if (!inRange(form.maxWindowSeconds, SUMMARY_MAX_WINDOW_MIN_SEC, SUMMARY_MAX_WINDOW_MAX_SEC)) {
    return false
  }
  // A hard cap shorter than the quiet period closes EVERY window at the cap,
  // with whatever it happened to hold — the rule still runs, and the operator
  // reads the result as the digest missing things.
  return form.maxWindowSeconds > form.quietSeconds
}

/** The selected branch, as the union member the schema accepts. */
function buildWindow(form: SummaryFormState): NcSummaryWindow {
  if (form.windowKind === 'schedule') {
    const schedule = form.schedule
    if (schedule === undefined || schedule.windows.length === 0) {
      throw new Error('a scheduled digest needs at least one schedule window')
    }
    return { kind: 'schedule', schedule }
  }
  return {
    kind: 'motion',
    quietSeconds: form.quietSeconds,
    maxWindowSeconds: form.maxWindowSeconds,
  }
}

/** Ownership-safe targets, PRESERVING a stored target's `params` — see
 *  `target-ownership.ts`. A stored target the caller cannot see rides through. */
function ownedTargets(
  selected: readonly string[],
  existing: readonly NcRuleTarget[],
  ownTargetIds: readonly string[],
  isAdmin: boolean,
): NcRuleTarget[] {
  return ownershipSafeTargets(
    selected,
    existing,
    ownTargetIds,
    (id, stored) => stored ?? { targetId: id },
    targetOwnershipPolicy(isAdmin),
  )
}

function inRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

function inRealRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max
}

/** Cameras are a SET — reordering the checklist is not an edit. */
function sameNumberSet(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort((x, y) => x - y)
  const sortedB = [...b].sort((x, y) => x - y)
  return sortedA.every((value, index) => value === sortedB[index])
}

/** Structural equality over plain JSON values (no `Date`, `Map` or cycle). */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
