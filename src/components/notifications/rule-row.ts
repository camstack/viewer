/**
 * rule-row — the pure presentational model behind {@link RuleRow}. Given a
 * viewer rule and the caller's OWN targets, it resolves how the row behaves:
 *
 *   • Personal rule (`readOnly === false`) → `editable`; the row offers ONE
 *     action row — Edit (unless the rule is `mixed`), Delete and the Enabled
 *     switch — and NO per-target opt-out toggles.
 *   • Admin / global rule (`readOnly === true`) → read-only; the ONLY control the
 *     caller gets is a per-target opt-out toggle for each of the rule's targets
 *     they personally OWN. A target the caller doesn't own yields no toggle, and
 *     an admin rule that touches none of the caller's targets yields none at all.
 *
 * The "receiving" flag mirrors the server contract: a target participates unless
 * its id is in the rule's `disabledTargetIds`. Kept as a pure, transport-free
 * module so it is unit-tested directly (the repo's node-env `.spec.ts` idiom),
 * with {@link RuleRow} rendering the resulting model.
 */
import type { NcMediaPolicy, NcSchedule, NcSharedSequence, NcSnooze, NcViewerRule, Target } from '../../data/notification-center.js'
import { pruneMediaPolicy } from './rule-editor.js'
import { normalizeMediaPolicy, resolveNcMediaImage, type NcMediaRuleSubject } from './rule-media-image.js'
import { summaryScheduleOf } from './system-event-delivery.js'
import { ruleKindOf, ruleKindSpec } from '@camstack/types/client'
import { kindLabelKey } from './rule-kind-nav.js'
import { isSnoozeExempt, sequenceResolver } from './rule-field-choices.js'
import { storedActionSteps } from './rule-action-form.js'

/**
 * The list order: by NAME (operator, 2026-10-01), case- and accent-blind, the
 * id breaking a tie so two rules of one name never swap places on a refresh.
 * A new array — the query's cache is never sorted in place.
 */
export function sortRulesByName<R extends { readonly id: string; readonly name: string }>(
  rules: readonly R[],
): R[] {
  return [...rules].sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id),
  )
}

/**
 * The card's Snooze switch — "snooze THIS RULE now" (controller ruling on R3,
 * 2026-10-01; the admin column's `NotificationRuleSnoozeSwitch`): on while the
 * caller can see a LIVE rule-scoped window for it. On opens a window for
 * {@link NC_RULE_SNOOZE_NOW_MINUTES}; off cancels every live one. It is NOT
 * the notification's snooze-button config (`snoozeOptions`) — that stays in
 * the editor.
 *
 * `unknown` while the windows have not been read (D315): the switch is then
 * drawn disabled rather than claiming the rule is not snoozed.
 */
export interface RuleSnoozeSwitch {
  readonly state: 'on' | 'off' | 'unknown'
  /** The live windows an off would cancel. */
  readonly activeIds: readonly string[]
}

/**
 * How long the list's switch silences a rule. The admin's
 * `NC_SNOOZE_NOW_DEFAULT_MINUTES` (NotificationRuleSnoozeControl) — a
 * duplicated literal on purpose, the same one-button-one-constant pattern the
 * admin file uses.
 */
export const NC_RULE_SNOOZE_NOW_MINUTES = 30

/** The live rule-scoped windows of one rule at `nowMs` — expiry is exclusive. */
export function activeRuleSnoozeIds(
  snoozes: readonly NcSnooze[],
  ruleId: string,
  nowMs: number,
): readonly string[] {
  return snoozes
    .filter((s) => s.scope === 'rule' && s.ruleId === ruleId && nowMs >= s.startedAt && nowMs < s.expiresAt)
    .map((s) => s.id)
}

/** The snooze switch of a rule, over the windows the hub listed (undefined = not read yet). */
export function ruleSnoozeSwitchFor(
  rule: Pick<NcViewerRule, 'id'>,
  snoozes: readonly NcSnooze[] | undefined,
  nowMs: number,
): RuleSnoozeSwitch {
  if (snoozes === undefined) return { state: 'unknown', activeIds: [] }
  const activeIds = activeRuleSnoozeIds(snoozes, rule.id, nowMs)
  return { state: activeIds.length > 0 ? 'on' : 'off', activeIds }
}

/**
 * Is this a SYSTEM rule — one about the installation rather than about
 * anything a camera saw?
 *
 * Kept as a named predicate rather than an inline comparison so the viewer and
 * the admin UI split their rule lists on the same question. The admin UI's
 * equivalent is `isSystemDelivery` in
 * `packages/addon-admin-ui/src/pages/system/notification-rules.helpers.ts`.
 */
export function isSystemEventRule(rule: Pick<NcViewerRule, 'delivery'>): boolean {
  return rule.delivery === 'system-event'
}

/** The rule list split into the sections the Rules tab renders. */
export interface RuleSections {
  /** The caller's own detection rules — editable. */
  readonly personal: readonly NcViewerRule[]
  /** Admin/global detection rules — read-only bar the per-target opt-out. */
  readonly admin: readonly NcViewerRule[]
  /**
   * System-event rules, WHOEVER owns them.
   *
   * Ownership is not the axis here: what a row offers (Edit/Delete vs an
   * opt-out toggle) is already decided per row by {@link buildRuleRowModel},
   * while "why am I being told a node went offline" is a question about the
   * KIND of rule. Splitting these by ownership as well would produce four
   * headings for what an operator thinks of as one list.
   */
  readonly system: readonly NcViewerRule[]
}

/**
 * Split the rules into the tab's sections.
 *
 * Operator request, 2026-08-12: a system-event rule inside the general list is
 * indistinguishable from a detection rule until you open it, which is how "why
 * did I get this?" becomes unanswerable from the list.
 */
export function partitionRules(rules: readonly NcViewerRule[]): RuleSections {
  return {
    personal: rules.filter((rule) => !rule.readOnly && !isSystemEventRule(rule)),
    admin: rules.filter((rule) => rule.readOnly && !isSystemEventRule(rule)),
    system: rules.filter((rule) => isSystemEventRule(rule)),
  }
}

/** One opt-out toggle: a caller-owned target an admin rule delivers to. */
export interface RuleOptOutTarget {
  readonly targetId: string
  readonly targetName: string
  /** `true` while the caller receives this rule on this target — i.e. the target
   *  is NOT in the rule's `disabledTargetIds`. Toggling sends the negation. */
  readonly receiving: boolean
}

/**
 * One media badge on a rule row. `labelKey` is a full i18n key; `params` feeds
 * its interpolation. Kept as keys rather than rendered strings so the model
 * stays pure and translatable.
 */
export interface RuleMediaBadge {
  readonly id: string
  readonly labelKey: string
  readonly params?: Readonly<Record<string, string>>
}

/** The tone a header meta chip is drawn in. */
export type RuleHeaderTone = 'neutral' | 'subtle' | 'warning'

/** One chip on the line UNDER a rule's name. */
export interface RuleHeaderChip {
  readonly id: 'kind' | 'delivery' | 'owner' | 'off'
  readonly labelKey: string
  readonly tone: RuleHeaderTone
  /**
   * The `delivery` chip of a SUMMARY rule (D647): the schedule its words are
   * built from ("Summary · daily 08:00", `summaryDeliveryLabel`) — the send
   * times, where an instant rule's row has nothing to say about WHEN.
   */
  readonly summarySchedule?: NcSchedule
}

/**
 * How the row's title is laid out. The NAME owns its line (only the chevron
 * sits beside it) and wraps up to {@link nameMaxLines}; the kind, the ownership
 * word and the off notice ride the line below it. Operator, 2026-09-26: with
 * all five on one line the off notice took the width and an off rule read
 * "Alla…" — the one row where the name matters most.
 */
export interface RuleHeaderModel {
  readonly nameMaxLines: number
  readonly meta: readonly RuleHeaderChip[]
}

/**
 * The controls on the card's ONE action row. `edit` is ownership AND a kind an
 * editor can open (a `mixed` rule has none); `remove` and `enableSwitch` are
 * ownership alone — a mixed rule may still be switched off and deleted by
 * whoever owns it. A rule the caller cannot edit gets none of them: an admin
 * rule a non-admin sees offers only its per-target opt-out.
 */
export interface RuleRowActions {
  readonly edit: boolean
  readonly remove: boolean
  readonly enableSwitch: boolean
  /**
   * The Snooze switch. NOT ownership: a snooze is personal, so anyone who
   * receives the rule may silence it for themselves — every rule except one no
   * snooze can silence (it concerns or arms the alarm), which gets NO switch.
   */
  readonly snoozeSwitch: boolean
}

/** The resolved shape of a rule row. */
export interface RuleRowModel {
  /** Personal rule owned by the caller → Edit/Delete. Admin/global → read-only. */
  readonly editable: boolean
  /** Per-target opt-out toggles. Empty for a personal rule, or for an admin rule
   *  that delivers to none of the caller's own targets. */
  readonly optOutTargets: readonly RuleOptOutTarget[]
  /** What this rule attaches, as badges — EMPTY for the default policy, so an
   *  ordinary rule stays visually quiet and a rule that ships a clip says so. */
  readonly mediaBadges: readonly RuleMediaBadge[]
  /** The rule's KIND, as the strip word (`v2.nc.rules.kind.<kind>`). Shown on
   *  every row, so a list filtered to All never mixes kinds anonymously. */
  readonly kindLabelKey: string
  /** Whether the rule is on. An off rule is REPORTED off, never merely absent
   *  from the notifications — disabled must not look like broken. */
  readonly enabled: boolean
  /**
   * A stored system rule whose kinds span families (`mixed`, D637). It keeps
   * firing, but no editor may change it: the row says so and points at the way
   * out (one rule per family, then delete this one). Delete stays where
   * ownership allows it — {@link editable} is ownership, not the kind.
   */
  readonly mustRecreate: boolean
  /**
   * The notice a rule to recreate shows, or `undefined` for every other rule.
   * The instruction ("create one rule per family, then delete this one") is
   * for someone who CAN; a caller who cannot edit the rule is told it is
   * read-only and an admin must recreate it — never handed steps they cannot
   * take.
   */
  readonly recreateNoticeKey: string | undefined
  /** The title's layout — see {@link RuleHeaderModel}. */
  readonly header: RuleHeaderModel
  /** The action row's controls — see {@link RuleRowActions}. */
  readonly actions: RuleRowActions
}

/** The fallback word of a summary rule's delivery chip (its schedule says the rest). */
const SUMMARY_CHIP_KEY = 'v2.nc.rules.summaryDelivery.custom'

/** A rule name wraps to this many lines before it is cut. */
const RULE_NAME_MAX_LINES = 2
const OFF_NOTICE_KEY = 'v2.nc.rules.offNotice'

/**
 * The title layout for a rule of this kind, ownership and state.
 *
 * The off notice is for a card WITHOUT the Enabled switch — a rule the caller
 * cannot edit. A card that draws the switch already says the rule is off, and
 * the words were the same state said a second time (operator, 2026-09-26:
 * "we show the disabled-rule text twice, and there is no need: the switch is
 * already there"). The switch is drawn exactly for an editable rule
 * ({@link ruleActionsFor}), so `editable` decides both. An off rule's name is
 * still dimmed either way.
 */
export function ruleHeaderFor(
  kindKey: string,
  editable: boolean,
  enabled: boolean,
  summarySchedule: NcSchedule | null = null,
): RuleHeaderModel {
  const base: readonly RuleHeaderChip[] = [
    { id: 'kind', labelKey: kindKey, tone: 'neutral' },
    ...(summarySchedule !== null
      ? [{ id: 'delivery', labelKey: SUMMARY_CHIP_KEY, tone: 'neutral', summarySchedule } as const]
      : []),
    {
      id: 'owner',
      labelKey: editable ? 'v2.nc.rules.personalBadge' : 'v2.nc.rules.adminBadge',
      tone: 'subtle',
    },
  ]
  return {
    nameMaxLines: RULE_NAME_MAX_LINES,
    meta:
      enabled || ruleActionsFor(editable, false).enableSwitch
        ? base
        : [...base, { id: 'off', labelKey: OFF_NOTICE_KEY, tone: 'warning' }],
  }
}

/** Which action-row controls a rule gets — see {@link RuleRowActions}. The Snooze
 *  switch is not ownership: {@link buildRuleRowModel} decides it per rule. */
export function ruleActionsFor(editable: boolean, mustRecreate: boolean): RuleRowActions {
  return { edit: editable && !mustRecreate, remove: editable, enableSwitch: editable, snoozeSwitch: false }
}

const RECREATE_INSTRUCTION_KEY = 'v2.nc.rules.mustRecreate'
const RECREATE_BY_ADMIN_KEY = 'v2.nc.rules.mustRecreateByAdmin'

/** Which recreate notice a row shows — see {@link RuleRowModel.recreateNoticeKey}. */
export function recreateNoticeKeyFor(mustRecreate: boolean, editable: boolean): string | undefined {
  if (!mustRecreate) return undefined
  return editable ? RECREATE_INSTRUCTION_KEY : RECREATE_BY_ADMIN_KEY
}

const MEDIA_BADGE_PREFIX = 'v2.nc.rules.mediaBadge'

/** What the media badges read off a rule. */
export interface NcMediaBadgeSubject extends NcMediaRuleSubject {
  readonly media: NcMediaPolicy
}

/**
 * Describe a rule's media policy as badges. Only NON-default choices produce
 * one — the policy is read the way the hub reads it (legacy triple folded,
 * D897) and pruned first, so absence (the wire default) is never advertised.
 * The picture mode is a badge only when it is not the kind's own default
 * (`crop` for a detection, `clean` for a sensor or a sound); the trigger-zone
 * outline, a gif, a clip and an explicit footage profile each yield one. A kind
 * with no picture says nothing.
 */
export function ruleMediaBadges(rule: NcMediaBadgeSubject): readonly RuleMediaBadge[] {
  const kind = ruleKindOf(rule)
  if (!ruleKindSpec(kind).carriesMedia) return []
  const policy = pruneMediaPolicy(normalizeMediaPolicy(rule.media, rule), { kind, conditions: rule.conditions })
  const badges: RuleMediaBadge[] = []
  if (policy.image !== undefined && policy.image !== resolveNcMediaImage({}, kind)) {
    badges.push({ id: `image:${policy.image}`, labelKey: `${MEDIA_BADGE_PREFIX}.image.${policy.image}` })
  }
  if (policy.showTriggerZone === true) {
    badges.push({ id: 'triggerZone', labelKey: `${MEDIA_BADGE_PREFIX}.triggerZone` })
  }
  if (policy.showSubjectPath === true) {
    badges.push({ id: 'subjectPath', labelKey: `${MEDIA_BADGE_PREFIX}.subjectPath` })
  }
  if (policy.gif === true) {
    badges.push({ id: 'gif', labelKey: `${MEDIA_BADGE_PREFIX}.gif` })
  }
  if (policy.clip === true) {
    badges.push({ id: 'clip', labelKey: `${MEDIA_BADGE_PREFIX}.clip` })
  }
  if (policy.profile !== undefined) {
    badges.push({
      id: `profile:${policy.profile}`,
      labelKey: `${MEDIA_BADGE_PREFIX}.profile`,
      params: { profile: policy.profile },
    })
  }
  return badges
}

/**
 * Resolve a rule + the caller's own targets into a {@link RuleRowModel}. A
 * personal rule is editable and carries no opt-out toggles; an admin rule is
 * read-only and carries one toggle per target the caller owns (its `receiving`
 * flag derived from `disabledTargetIds`).
 */
export function buildRuleRowModel(
  rule: NcViewerRule,
  ownTargets: readonly Target[],
  sequences: readonly NcSharedSequence[] = [],
): RuleRowModel {
  const mediaBadges = ruleMediaBadges(rule)
  const kind = ruleKindOf(rule)
  const identity = {
    kindLabelKey: kindLabelKey(kind),
    enabled: rule.enabled,
    mustRecreate: kind === 'mixed',
  }
  const snoozeSwitch = !isSnoozeExempt(
    rule.conditions,
    storedActionSteps(rule.actions, sequenceResolver(sequences)),
  )
  if (!rule.readOnly) {
    return {
      editable: true,
      optOutTargets: [],
      mediaBadges,
      ...identity,
      recreateNoticeKey: recreateNoticeKeyFor(identity.mustRecreate, true),
      header: ruleHeaderFor(identity.kindLabelKey, true, rule.enabled, summaryScheduleOf(rule)),
      actions: { ...ruleActionsFor(true, identity.mustRecreate), snoozeSwitch },
    }
  }

  const ownById = new Map(ownTargets.map((target) => [target.id, target]))
  const disabled = new Set(rule.disabledTargetIds)
  const optOutTargets: RuleOptOutTarget[] = []
  for (const target of rule.targets) {
    const owned = ownById.get(target.targetId)
    if (!owned) continue
    optOutTargets.push({
      targetId: target.targetId,
      targetName: owned.name,
      receiving: !disabled.has(target.targetId),
    })
  }
  return {
    editable: false,
    optOutTargets,
    mediaBadges,
    ...identity,
    recreateNoticeKey: recreateNoticeKeyFor(identity.mustRecreate, false),
    header: ruleHeaderFor(identity.kindLabelKey, false, rule.enabled, summaryScheduleOf(rule)),
    actions: { ...ruleActionsFor(false, identity.mustRecreate), snoozeSwitch },
  }
}
