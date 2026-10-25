/**
 * rule-kind-nav — every rule is ONE kind, listed and created as that kind.
 *
 * The operator: "le rules devono essere specifiche per il tipo, occupancy
 * detection etc, sul viewer sembra che adesso sia tutto mischiato". The list
 * used the shared SECTIONS (where a sensor rule sits under detection), and the
 * editor derived the kind live, so authoring a sound condition on a detection
 * rule turned it into a sound rule mid-edit. Here the KIND is the unit: the
 * strip filters by `ruleKindOf`, a new rule picks its kind first, and an editor
 * never offers another kind's discriminator — changing kind means a new rule.
 */
import {
  NC_RULE_KIND_SPECS,
  isSystemRuleKind,
  kindsForDiscriminator,
  ruleKindOf,
  ruleSeedForSection,
} from '@camstack/types/client'
import type { NcRuleKind, NcRuleSectionSubject, NcRuleSeed } from '@camstack/types'
import type { AdminVerdict } from '../../data/use-me.js'
import type { NcConditions, NcDelivery } from '../../data/notification-center.js'
import { isFamilySection, type NcViewerFamilySection } from './rule-sections.js'

/**
 * The kinds the viewer lists, in strip order — exactly the shared `NcRuleKind`s
 * (D637). A system rule is one of three families (`device-events`, `system`,
 * `alarm`), or `mixed`: a stored rule whose kinds span families, which keeps
 * firing but is read-only and never offered for creation. The viewer-only
 * `battery` section (D636) is gone: batteries are device events, on the hub.
 */
export const NC_VIEWER_KIND_ORDER: readonly NcRuleKind[] = [
  'detection',
  'sensor',
  'sound',
  'occupancy',
  'device-events',
  'system',
  'alarm',
  'mixed',
]

export type NcKindFilter = 'all' | NcRuleKind

/** Kinds only an admin authors: every system rule narrates the hub itself. */
function adminOnly(kind: NcRuleKind): boolean {
  return isSystemRuleKind(kind)
}

export interface NcKindStripTab {
  readonly key: NcKindFilter
  readonly labelKey: string
  readonly count: number
}

const KIND_PREFIX = 'v2.nc.rules.kind'

export function kindLabelKey(kind: NcKindFilter): string {
  return `${KIND_PREFIX}.${kind}`
}

/** Anything the Rules tab's strip can have selected: a kind, or a family. */
export type NcRulesStripKey = NcKindFilter | NcViewerFamilySection

/** Validate a REMEMBERED strip key. An old section key (`audio`) is not one. */
export function parseStripKey(value: string | null | undefined): NcRulesStripKey | undefined {
  if (value === 'all' || (value !== null && value !== undefined && isFamilySection(value))) return value
  return parseKind(value ?? undefined)
}

export function parseKind(value: string | undefined): NcRuleKind | undefined {
  return NC_VIEWER_KIND_ORDER.find((kind) => kind === value)
}

/**
 * What "New rule" may open as. `mixed` never — it is derived from a stored
 * rule, not authored. A system family narrates the hub itself; only an admin
 * authors one.
 */
export function creatableKinds(isAdmin: boolean): readonly NcRuleKind[] {
  return NC_VIEWER_KIND_ORDER.filter(
    (kind) => kind !== 'mixed' && (isAdmin || !adminOnly(kind)),
  )
}

export function rulesOfKind<T extends NcRuleSectionSubject>(
  rules: readonly T[],
  filter: NcKindFilter,
): readonly T[] {
  return filter === 'all' ? rules : rules.filter((rule) => ruleKindOf(rule) === filter)
}

/** The strip's tabs — counted by the SAME predicate that fills the list. */
export function kindStrip<T extends NcRuleSectionSubject>(
  rules: readonly T[],
): readonly NcKindStripTab[] {
  const keys: readonly NcKindFilter[] = ['all', ...NC_VIEWER_KIND_ORDER]
  return keys.map((key) => ({
    key,
    labelKey: kindLabelKey(key),
    count: rulesOfKind(rules, key).length,
  }))
}

/**
 * The strip as THIS caller sees it: an empty system-family tab is noise for
 * someone who can neither author one nor is targeted by one — but only once
 * the hub has said they are not an admin. Before it answers, nothing is
 * claimed absent (D315). A tab that HOLDS rules is always shown: hiding the one
 * kind a caller cannot author their way out of is how "why am I still getting
 * this?" becomes unanswerable.
 *
 * An EMPTY `mixed` tab is hidden for everyone, admins included: nobody can
 * create one, so an empty "To recreate" tab only says "there is nothing to do".
 * Its count is known only once the list answered — while it is pending the
 * count is 0 and the tab is absent, which claims nothing (no empty message is
 * drawn for a tab that is not there).
 */
export function viewerKindStrip<T extends NcRuleSectionSubject>(
  rules: readonly T[],
  verdict: AdminVerdict,
): readonly NcKindStripTab[] {
  // `unknown` (a failed role read) hides like `not-admin`: fail-closed, as
  // before that state had a name.
  const notAdmin = verdict === 'not-admin' || verdict === 'unknown'
  return kindStrip(rules).filter((tab) => {
    if (tab.key === 'all' || tab.count > 0) return true
    if (tab.key === 'mixed') return false
    return !(adminOnly(tab.key) && notAdmin)
  })
}

/** The "New …" button's words for a strip filter. */
export function kindCreateKey(filter: NcKindFilter): string {
  return `v2.nc.rules.kindCreate.${filter}`
}

/** What a kind's list says when it holds nothing. */
export function kindEmptyKey(filter: NcKindFilter): string {
  return `v2.nc.rules.kindEmpty.${filter}`
}

/**
 * What a new rule of this kind opens on — the shared seeds, plus sensor. A
 * family opens with its own kinds seeded, so it is never authored empty (an
 * empty system rule classifies `mixed`). A DETECTION rule opens on the
 * pipeline source (operator, 2026-10-01): the camera's own onboard events are
 * the exception an operator opts into from the Advanced section.
 */
/** The detection source a new detection rule is seeded on. */
export const DETECTION_SEED_SOURCE = 'pipeline'

/** The triggers the detection seed's source belongs to. */
const DETECTION_DELIVERIES: readonly NcDelivery[] = ['immediate', 'track-end']

/** What a trigger change writes: the delivery, and the conditions it leaves. */
export interface NcDeliveryChange {
  readonly delivery: NcDelivery
  readonly conditions: NcConditions
}

/**
 * A trigger change. The detection seed's `source: 'pipeline'` belongs to the
 * DETECTION triggers only: moving onto any other drops it (a sensor event is
 * never a pipeline detection, so the default would silence the rule). A
 * source the operator chose themselves is not the default and is kept.
 */
export function withDeliveryChange(
  form: { readonly conditions: NcConditions },
  delivery: NcDelivery,
): NcDeliveryChange {
  const { source, ...rest } = form.conditions
  const dropsDefault = source === DETECTION_SEED_SOURCE && !DETECTION_DELIVERIES.includes(delivery)
  return { delivery, conditions: dropsDefault ? rest : form.conditions }
}

export function seedForKind(kind: NcRuleKind): NcRuleSeed {
  switch (kind) {
    case 'sensor':
      return { delivery: 'device-event', conditions: {} }
    case 'sound':
      return ruleSeedForSection('audio')
    case 'occupancy':
      return ruleSeedForSection('occupancy')
    case 'device-events':
    case 'system':
    case 'alarm':
      return ruleSeedForSection(kind)
    case 'detection': {
      const seed = ruleSeedForSection('detection')
      return { ...seed, conditions: { ...seed.conditions, source: DETECTION_SEED_SOURCE } }
    }
    case 'mixed':
      // Unreachable through `creatableKinds`, which never offers it.
      throw new Error('a mixed rule cannot be created')
  }
}

/**
 * Would offering this condition let the rule become ANOTHER kind?
 *
 * A discriminator is shared by a GROUP of kinds — `systemEvent` makes all
 * three families and `mixed` — so the question is "is this kind one of the
 * kinds it makes", never "is this kind THE kind it makes".
 */
export function isKindLockedOut(kind: NcRuleKind, conditionId: string): boolean {
  const discriminator = NC_RULE_KIND_SPECS.find(
    (spec) => spec.discriminator !== undefined && spec.discriminator === conditionId,
  )?.discriminator
  if (discriminator === undefined) return false
  return !kindsForDiscriminator(discriminator).includes(kind)
}
