/**
 * rule-sections — the VIEWER's projection of the shared rule-kind / rule-section
 * model. Pure, RN-free, i18n-key-only.
 *
 * The model itself lives in `@camstack/types`
 * (`src/notification/rule-kinds.ts`): which kind a rule is, which fields that
 * kind can actually use, which list section it belongs to, and what a seeded
 * "New <kind> rule" opens on. Both editors read that one copy — the admin UI
 * fixed "in occupancy alcuni campi non hanno senso" on 2026-08-14 and the
 * viewer never got the fix, because the layer between the schema and the
 * widgets was the one thing the two surfaces were not sharing.
 *
 * WHAT IS DECIDED HERE, and nowhere else:
 *
 *  1. **The two families beside the rule list.** The rule list itself is
 *     filtered BY KIND now (`rule-kind-nav.ts`); what stays here is the pair of
 *     tabs that are not rules of `nc.listRules` at all — timelapse and summary —
 *     and their words.
 *  2. **Which editor sections it renders** — no longer here: the summary
 *     screen's section list lives in `rule-editor-sections.ts`, derived from
 *     the shared `ruleEditorSectionsForKind` so admin and viewer cannot drift.
 *  3. **The i18n binding.** The shared model carries stable ids and English
 *     fallbacks; this file maps id → `v2.nc.rules.*` key and nothing else. No
 *     English string from the shared model is copied into `en.json`, because a
 *     copy of a sentence is exactly what the hoist removed.
 */

// ── The family tabs ──────────────────────────────────────────────────

/**
 * The two FAMILY tabs — and they are not kinds of the rule list at all.
 *
 * A timelapse rule rides no `NcDelivery` member and a digest rule's schema does
 * not even live in `@camstack/types`; each is its own store behind its own
 * `nc.*` bridge actions. So `ruleKindOf` has no opinion about them and
 * must never be asked: it treats anything it does not recognise as a DETECTION
 * rule (the deliberate catch-all that keeps a rule with an unknown trigger
 * visible), which means a `'timelapse'` key handed to it would return the whole
 * detection list — a Timelapse tab showing every detection rule, which reads as
 * "my rules got duplicated".
 *
 * The type system carries the distinction rather than a comment: these keys are
 * not `NcRuleSectionKey`, so nothing that takes a section key will accept one.
 */
export const NC_VIEWER_FAMILY_SECTIONS = ['timelapse', 'summary'] as const
export type NcViewerFamilySection = (typeof NC_VIEWER_FAMILY_SECTIONS)[number]

/** True for one of the two separate rule families (no cast). */
export function isFamilySection(value: string): value is NcViewerFamilySection {
  return NC_VIEWER_FAMILY_SECTIONS.some((key) => key === value)
}

const SECTION_PREFIX = 'v2.nc.rules.section'

/** The family tab's word. */
export function sectionLabelKey(key: NcViewerFamilySection): string {
  return `${SECTION_PREFIX}.${key}`
}

/** What the family tab says when it holds nothing yet. */
export function sectionEmptyKey(key: NcViewerFamilySection): string {
  return `${SECTION_PREFIX}.empty.${key}`
}

/** The family tab's create button words. */
export function sectionCreateKey(key: NcViewerFamilySection): string {
  return `${SECTION_PREFIX}.create.${key}`
}

// ── Condition groups ────────────────────────────────────────────────

/**
 * Condition-group headings in authoring order — the ADMIN's order, adopted.
 *
 * The two surfaces had drifted (the viewer put `occupancy` and `audio` before
 * `package`, the admin after), which is a small thing that costs an operator
 * the ability to find the same field twice. The admin's is kept because it is
 * the one the larger surface teaches.
 */
export const NC_CONDITION_GROUP_ORDER: readonly string[] = [
  // First: on a `system-event` rule this is the ONLY group that applies, and it
  // is the rule's whole subject rather than a narrowing of one.
  'system',
  'scope',
  'class',
  'zones',
  'quality',
  'label',
  'device',
  'package',
  'occupancy',
  'audio',
  'schedule',
]

/** The only thing grouping reads — deliberately `string`-typed, because the
 *  catalog arrives at runtime from a server that may be newer than this build. */
export interface GroupedDescriptor {
  readonly group: string
}

/**
 * The group ids to render, in order, for the descriptors actually present.
 *
 * Known groups first in authoring order; a group the catalog introduces that
 * this build has never heard of is APPENDED (first-appearance order) rather than
 * dropped. The previous implementation filtered the KNOWN list, so a new
 * server-side group rendered nothing at all — the same silent-drop failure the
 * served catalog exists to prevent.
 */
export function orderedConditionGroups(
  descriptors: readonly GroupedDescriptor[],
): readonly string[] {
  const present = new Set(descriptors.map((descriptor) => descriptor.group))
  const ordered = NC_CONDITION_GROUP_ORDER.filter((id) => present.has(id))
  const known = new Set(NC_CONDITION_GROUP_ORDER)
  const extra: string[] = []
  for (const descriptor of descriptors) {
    if (known.has(descriptor.group) || extra.includes(descriptor.group)) continue
    extra.push(descriptor.group)
  }
  return [...ordered, ...extra]
}

/**
 * The heading a condition group falls back to when the phone has no word for
 * it — a group the hub added after this build. Never the raw i18n key: the id
 * with its first letter capitalised (`quality` → "Quality"). The catalog
 * carries no per-group label, so there is no server string to prefer.
 */
export function conditionGroupLabelFallback(groupId: string): string {
  return groupId.charAt(0).toUpperCase() + groupId.slice(1)
}
