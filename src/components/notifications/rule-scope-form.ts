/**
 * rule-scope-form — the rule editor's SCOPE axes on the phone (D641), each
 * drawn as ONE field — "All | Only these | All except these" over one picker:
 * devices (`devices` / `devicesExclude`), detection classes (`classes` /
 * `classesExclude`) and — since the operator's 2026-10-01 ruling that faces,
 * zones and labels use "the SAME control as Object classes" — zones
 * (`zones.ids` / `zonesExclude`), faces (`identities` / `identitiesExclude`)
 * and labels (`labelEquals`, include only: the hub has no label exclusion).
 * An item is included OR excluded, never both, and the zone condition's old
 * any/all quantifier is not written any more (the hub's default is any).
 *
 * Faces keep one reading the others do not have: an Only list left EMPTY is
 * `identities: []` — "any known face" — never "every person"
 * ({@link identityScopeDraftOf}, {@link projectIdentityScope}).
 *
 * The decisions about a single axis are `rule-scope-model.ts` (byte-identical
 * to the admin's copy). This file wires them to the phone's form:
 *
 *  - The draft lives on the FORM (`deviceScope`, `classScope`), never in
 *    `conditions`. {@link splitRuleScopes} lifts the four lists out when a rule
 *    is opened; {@link formScopedConditions} projects them back — only the
 *    active mode's list, plus a legacy rule's kept exclusions (D49) — and it
 *    is the ONE input of the save funnel, so a stray scope key left in
 *    `conditions` can never be what a save writes.
 *  - "All except these" is offered only when the hub SERVES the exclusion for
 *    this trigger and kind ({@link ruleScopeExceptOffered}): a hub that does
 *    not know the key strips it, and the rule would silently include what the
 *    operator excluded.
 *  - Old-descriptor safety: only the `devices` descriptor of valueType
 *    `deviceIdList` binds to `conditions.devices`
 *    ({@link deviceListConditionKey}). An exclusion — under its own valueType
 *    or an older one — can never write the include list.
 *
 * Pure and RN-free: the node-env specs exercise it directly.
 */
import { conditionVisibleForKind, pickerForRuleClasses } from '@camstack/types/client'
import type { NcRuleKind } from '@camstack/types'
import type {
  NcConditionDescriptor,
  NcConditions,
  NcDelivery,
  NcTaxonomy,
} from '../../data/notification-center.js'
import type { PickerItem } from './device-picker-model.js'
import {
  projectRuleScope,
  ruleScopeDraftOf,
  type RuleScopeDraft,
  type RuleScopeMode,
  type RuleScopeSave,
} from './rule-scope-model.js'

/** The pre-selector's words, by mode (`v2.nc.rules.scope.*`). */
export const RULE_SCOPE_MODE_LABEL_KEYS: Readonly<Record<RuleScopeMode, string>> = {
  all: 'v2.nc.rules.scope.all',
  only: 'v2.nc.rules.scope.only',
  except: 'v2.nc.rules.scope.except',
}

/** The form's slice of a rule's conditions: everything else, and the axes. */
export interface NcRuleScopeSplit {
  readonly conditions: NcConditions
  readonly deviceScope: RuleScopeDraft<number>
  readonly classScope: RuleScopeDraft<string>
  readonly zoneScope: RuleScopeDraft<string>
  readonly identityScope: RuleScopeDraft<string>
  readonly labelScope: RuleScopeDraft<string>
}

/** What {@link formScopedConditions} reads off a form. */
export type NcRuleScopeSubject = NcRuleScopeSplit

/** Drop every scope key, whatever it holds. */
function withoutScopeKeys(conditions: NcConditions): NcConditions {
  const {
    devices,
    devicesExclude,
    classes,
    classesExclude,
    zones,
    zonesExclude,
    identities,
    identitiesExclude,
    labelEquals,
    ...rest
  } = conditions
  void devices
  void devicesExclude
  void classes
  void classesExclude
  void zones
  void zonesExclude
  void identities
  void identitiesExclude
  void labelEquals
  return rest
}

/**
 * The face axis as it opens. `identities` PRESENT — even empty — is Only: an
 * empty list is "any known face", a real narrowing the operator chose.
 */
export function identityScopeDraftOf(
  include: readonly string[] | undefined,
  exclude: readonly string[] | undefined,
): RuleScopeDraft<string> {
  const draft = ruleScopeDraftOf(include, exclude)
  return include !== undefined ? { ...draft, mode: 'only' } : draft
}

/** What a save writes for the face axis — Only writes its list even when empty. */
export function projectIdentityScope(draft: RuleScopeDraft<string>): RuleScopeSave<string> {
  if (draft.mode !== 'only') return projectRuleScope(draft)
  const projected = projectRuleScope(draft)
  return { ...projected, include: [...draft.include] }
}

/**
 * Lift the two scope axes out of stored conditions. Each mode is DERIVED from
 * its two lists; nothing about a mode is stored on the rule.
 */
export function splitRuleScopes(conditions: NcConditions): NcRuleScopeSplit {
  return {
    conditions: withoutScopeKeys(conditions),
    deviceScope: ruleScopeDraftOf(conditions.devices, conditions.devicesExclude),
    classScope: ruleScopeDraftOf(conditions.classes, conditions.classesExclude),
    zoneScope: ruleScopeDraftOf(conditions.zones?.ids, conditions.zonesExclude),
    identityScope: identityScopeDraftOf(conditions.identities, conditions.identitiesExclude),
    labelScope: ruleScopeDraftOf(conditions.labelEquals, undefined),
  }
}

/**
 * The conditions the form MEANS: its authored conditions (any scope key they
 * still carry ignored) with each axis projected as its save writes it. What
 * the save funnel prunes and what the drop warning judges, so the two cannot
 * disagree.
 */
export function formScopedConditions(form: NcRuleScopeSubject): NcConditions {
  const devices = projectRuleScope(form.deviceScope)
  const classes = projectRuleScope(form.classScope)
  const zones = projectRuleScope(form.zoneScope)
  const identities = projectIdentityScope(form.identityScope)
  const labels = projectRuleScope(form.labelScope)
  return {
    ...withoutScopeKeys(form.conditions),
    ...(devices.include !== undefined ? { devices: [...devices.include] } : {}),
    ...(devices.exclude !== undefined ? { devicesExclude: [...devices.exclude] } : {}),
    ...(classes.include !== undefined ? { classes: [...classes.include] } : {}),
    ...(classes.exclude !== undefined ? { classesExclude: [...classes.exclude] } : {}),
    // No quantifier: "any of / all of" is gone from both editors (2026-10-01);
    // the hub reads an absent `match` as any.
    ...(zones.include !== undefined ? { zones: { ids: [...zones.include] } } : {}),
    ...(zones.exclude !== undefined ? { zonesExclude: [...zones.exclude] } : {}),
    ...(identities.include !== undefined ? { identities: [...identities.include] } : {}),
    ...(identities.exclude !== undefined ? { identitiesExclude: [...identities.exclude] } : {}),
    ...(labels.include !== undefined ? { labelEquals: [...labels.include] } : {}),
  }
}

/**
 * Conditions with ONE axis — the classes — projected from its draft: what a
 * pre-save warning about classes must read (the occupancy × classes drop,
 * `occupancyDroppedClasses`), since the class lists no longer live in
 * `conditions` while the rule is edited.
 */
export function withClassScope(conditions: NcConditions, classScope: RuleScopeDraft<string>): NcConditions {
  const { classes, classesExclude, ...rest } = conditions
  void classes
  void classesExclude
  const projected = projectRuleScope(classScope)
  return {
    ...rest,
    ...(projected.include !== undefined ? { classes: [...projected.include] } : {}),
    ...(projected.exclude !== undefined ? { classesExclude: [...projected.exclude] } : {}),
  }
}

/**
 * The cameras a zone / occupancy picker resolves its zones from: an Only
 * scope's list, else none (= every camera). An Except list is not "these
 * cameras".
 */
export function formScopedDeviceIds(form: Pick<NcRuleScopeSubject, 'deviceScope'>): readonly number[] {
  return form.deviceScope.mode === 'only' ? form.deviceScope.include : []
}

/** The exclusion conditions a pre-selector can offer. */
export type NcScopeExcludeConditionId =
  | 'devicesExclude'
  | 'classesExclude'
  | 'zonesExclude'
  | 'identitiesExclude'

/**
 * Is "All except these" offered for this axis? Only when the hub serves the
 * exclusion for this rule's trigger and kind. An empty catalog (not answered,
 * or an older hub) cannot vouch for it, so it is not offered.
 */
export function ruleScopeExceptOffered(
  catalog: readonly NcConditionDescriptor[],
  id: NcScopeExcludeConditionId,
  delivery: NcDelivery,
  kind: NcRuleKind,
): boolean {
  return catalog.some((d) => d.id === id && conditionVisibleForKind(d, delivery, kind))
}

/** One scope axis. */
export type NcScopeAxis = 'devices' | 'classes' | 'zones' | 'identities' | 'labels'

/**
 * How a catalog descriptor takes part in a scope field: the include id DRAWS
 * the one field, the exclude id is MERGED into it (never a second row).
 */
export type NcScopeDescriptorRole =
  | { readonly kind: 'field'; readonly axis: NcScopeAxis }
  | { readonly kind: 'merged'; readonly axis: NcScopeAxis }

const SCOPE_ROLES: Readonly<Record<string, NcScopeDescriptorRole>> = {
  devices: { kind: 'field', axis: 'devices' },
  devicesExclude: { kind: 'merged', axis: 'devices' },
  classes: { kind: 'field', axis: 'classes' },
  classesExclude: { kind: 'merged', axis: 'classes' },
  zones: { kind: 'field', axis: 'zones' },
  zonesExclude: { kind: 'merged', axis: 'zones' },
  identities: { kind: 'field', axis: 'identities' },
  identitiesExclude: { kind: 'merged', axis: 'identities' },
  labelEquals: { kind: 'field', axis: 'labels' },
}

/** A descriptor's scope role, or null when it is not a scope list. */
export function scopeDescriptorRole(descriptorId: string): NcScopeDescriptorRole | null {
  return Object.prototype.hasOwnProperty.call(SCOPE_ROLES, descriptorId)
    ? (SCOPE_ROLES[descriptorId] ?? null)
    : null
}

/**
 * The ONE descriptor that may write `conditions.devices`: id `devices`,
 * valueType `deviceIdList`. Anything else — `devicesExclude` under its own
 * valueType, or served under the old one — binds to nothing.
 */
export function deviceListConditionKey(
  descriptor: Pick<NcConditionDescriptor, 'id' | 'valueType'>,
): 'devices' | null {
  return descriptor.id === 'devices' && descriptor.valueType === 'deviceIdList' ? 'devices' : null
}

/** The class picker's list, and each group's English header. */
export interface NcClassPickerItems {
  readonly items: readonly PickerItem<string>[]
  /** Group key (the item's `type`) → the taxonomy's English header. */
  readonly groupLabels: ReadonlyMap<string, string>
}

/**
 * The detection-class picker's items: one per taxonomy option of the shared
 * RULE class picker (`pickerForRuleClasses` — no class list lives here),
 * grouped under its taxonomy category. That picker never offers the audio
 * labels (R13, D690): a sound picked as a detection rule's class broke the
 * rule; sounds are a sound rule's own condition. A class listed under
 * two categories is offered once, under the first. Null when the hub serves no
 * taxonomy: the caller keeps its free-text input rather than an empty picker
 * that reads as "no classes".
 */
export function classPickerItems(taxonomy: NcTaxonomy | undefined): NcClassPickerItems | null {
  const picker = pickerForRuleClasses(taxonomy)
  if (picker === null) return null
  const seen = new Set<string>()
  const items: PickerItem<string>[] = []
  const groupLabels = new Map<string, string>()
  for (const group of picker.groups) {
    groupLabels.set(group.key, group.fallbackLabel)
    for (const option of group.options) {
      if (seen.has(option.value)) continue
      seen.add(option.value)
      items.push({ id: option.value, name: option.label, type: group.key })
    }
  }
  return { items, groupLabels }
}
