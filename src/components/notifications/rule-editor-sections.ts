/**
 * rule-editor-sections — which sections the summary screen lists for a rule.
 *
 * The ORDER and the SET come from `ruleEditorSectionsForKind` in
 * `@camstack/types`, the same call the admin's tabs are checked against — the
 * viewer never re-lists them. The viewer decides only three things: the i18n
 * keys, which form fields each section edits (the claim map, checked
 * exhaustive in the spec so a new field cannot live nowhere), and which
 * catalog descriptors the Devices / Conditions sub-screens show. Actions is
 * dropped for a non-admin because the hub refuses the field from one.
 */
import {
  NC_RULE_EDITOR_SECTION_ORDER,
  conditionVisibleForKind,
  ruleEditorSectionsForKind,
} from '@camstack/types/client'
import type { NcKindVisibilitySubject, NcRuleEditorSectionKey, NcRuleKind } from '@camstack/types'
import type { NcRuleFormState } from './rule-editor.js'
import { isKindLockedOut } from './rule-kind-nav.js'

/** A form field the summary screen routes to one section's sub-screen. */
export type NcRuleFormField = keyof NcRuleFormState

export interface NcViewerEditorSection {
  readonly key: NcRuleEditorSectionKey
  readonly titleKey: string
  readonly fields: readonly NcRuleFormField[]
}

/**
 * Which section edits each form field — every field exactly once.
 *
 * `devices` claims `deviceScope` (D641): the device scope is ONE field over
 * `devices` / `devicesExclude`, held on the form rather than in `conditions`;
 * the Conditions sub-screen hides both descriptors ({@link conditionsForSection}).
 * The class scope (`classScope`) is drawn among the conditions, where the
 * `classes` descriptor sits.
 * `actions` and `targetUsers` are admin-only; the Actions section is dropped
 * for a non-admin (below) and `formToInput` neither sends nor clears either
 * field for one, so the hub keeps what an admin wired.
 */
export const NC_VIEWER_SECTION_FIELDS: Readonly<
  Record<NcRuleEditorSectionKey, readonly NcRuleFormField[]>
> = {
  rule: ['name', 'enabled', 'delivery', 'groupingSec', 'targetIds', 'targetParams', 'targetUsers'],
  devices: ['deviceScope'],
  conditions: [
    'conditions',
    'schedule',
    'classScope',
    'zoneScope',
    'identityScope',
    'labelScope',
    'systemEventDelivery',
  ],
  notification: ['priority', 'media', 'templateTitle', 'templateBody'],
  actions: ['actions'],
  advanced: ['cooldownSec', 'snoozeOptions', 'snoozeAllowGlobal', 'askVerdict', 'confirm'],
}

const EDITOR_PREFIX = 'v2.nc.rules.editor'

/**
 * The heading for a section of the editor.
 *
 * The conditions section is keyed on the KIND — the rename the shared model
 * asks for, as an i18n key so the phone says "Suono" where the admin says
 * "Sound".
 */
export function editorSectionLabelKey(key: NcRuleEditorSectionKey, kind: NcRuleKind): string {
  return key === 'conditions'
    ? `${EDITOR_PREFIX}.kindSection.${kind}`
    : `${EDITOR_PREFIX}.section.${key}`
}

/** One line under the conditions heading — what this kind of rule IS
 *  (`ruleKindSpec(kind).blurb` is its English source). */
export function kindBlurbKey(kind: NcRuleKind): string {
  return `${EDITOR_PREFIX}.kindBlurb.${kind}`
}

/** The note above the media controls for a kind whose picture is special
 *  (`ruleKindSpec(kind).mediaBlurb` is its English fallback). */
export function mediaBlurbKey(kind: NcRuleKind): string {
  return `${EDITOR_PREFIX}.mediaBlurb.${kind}`
}

/** The sections THIS rule lists, in the shared order. */
export function editorSectionsFor(
  kind: NcRuleKind,
  isAdmin: boolean,
): readonly NcViewerEditorSection[] {
  return ruleEditorSectionsForKind(kind)
    .filter((section) => isAdmin || section.key !== 'actions')
    .map((section) => ({
      key: section.key,
      titleKey: editorSectionLabelKey(section.key, kind),
      fields: NC_VIEWER_SECTION_FIELDS[section.key],
    }))
}

/** Narrow a route param back to a shared section key (no cast). */
export function parseSectionKey(value: string | undefined): NcRuleEditorSectionKey | undefined {
  return NC_RULE_EDITOR_SECTION_ORDER.find((key) => key === value)
}

/** The descriptors the Devices sub-screen draws, as one scope field. */
const DEVICE_SCOPE_IDS: ReadonlySet<string> = new Set(['devices', 'devicesExclude'])

/**
 * The conditions drawn in the ADVANCED section, not among the conditions
 * (operator, 2026-10-01): the detection source and the zone-crossing
 * direction. Everything else a kind can use is always visible — there is no
 * "more conditions" expander any more.
 */
export const NC_ADVANCED_CONDITION_IDS: ReadonlySet<string> = new Set(['source', 'crossing'])

/** The two sub-screens that edit `conditions`. */
export type NcConditionSubScreen = Extract<NcRuleEditorSectionKey, 'devices' | 'conditions'>

/**
 * The catalog descriptors a sub-screen renders.
 *
 * Devices edits the device scope — `devices` AND `devicesExclude`, drawn as
 * ONE field (D641); Conditions shows everything else this kind and trigger
 * can use, minus another kind's discriminator (offering it would let the rule
 * silently become that other kind) and minus the two the Advanced section
 * draws ({@link NC_ADVANCED_CONDITION_IDS}).
 */
export function conditionsForSection<D extends NcKindVisibilitySubject>(
  section: NcConditionSubScreen,
  kind: NcRuleKind,
  delivery: string,
  catalog: readonly D[],
): readonly D[] {
  return catalog.filter((descriptor) =>
    section === 'devices'
      ? DEVICE_SCOPE_IDS.has(descriptor.id)
      : !DEVICE_SCOPE_IDS.has(descriptor.id) &&
        !NC_ADVANCED_CONDITION_IDS.has(descriptor.id) &&
        conditionAuthorable(descriptor, kind, delivery),
  )
}

/** The advanced-section conditions this kind and trigger can use, catalog order. */
export function advancedConditionsFor<D extends NcKindVisibilitySubject>(
  kind: NcRuleKind,
  delivery: string,
  catalog: readonly D[],
): readonly D[] {
  return catalog.filter(
    (descriptor) => NC_ADVANCED_CONDITION_IDS.has(descriptor.id) && conditionAuthorable(descriptor, kind, delivery),
  )
}

/** Usable by this kind and trigger, and never another kind's discriminator. */
function conditionAuthorable(descriptor: NcKindVisibilitySubject, kind: NcRuleKind, delivery: string): boolean {
  return !isKindLockedOut(kind, descriptor.id) && conditionVisibleForKind(descriptor, delivery, kind)
}
