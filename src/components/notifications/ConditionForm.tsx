/**
 * ConditionForm — renders the whole catalog-driven condition surface for a rule.
 * Descriptors from `getConditionCatalog` are grouped by `descriptor.group` (in
 * the shared authoring order); each descriptor's widget comes from
 * {@link ConditionField} (a pure `valueType` dispatch — NO hardcoded
 * per-condition UI). The `schedule` group is threaded to the rule-level
 * {@link NcSchedule}, not a `conditions` field.
 *
 * VISIBILITY IS `delivery` × `kind`, and the shared model decides it
 * ({@link conditionVisibleForKind} in `@camstack/types`). `appliesTo` alone —
 * what this form used until now — left an occupancy rule offering `sensorKinds`,
 * `eventTypeTokens` and `source`: three fields the engine fails CLOSED on an
 * occupancy subject, so the rule sat enabled, in the list, and permanently
 * silent. A field the kind cannot use is simply ABSENT here (the phone stays
 * simpler than the admin's disabled-with-reason rows); what an authored one
 * costs is said once, next to Save, by `droppedRuleConditions`.
 *
 * One group is CONDITIONAL on another's value: an authored `occupancy`
 * condition hides the class group, because the two silently AND into a rule
 * that can never fire (see {@link OCCUPANCY_SUPPRESSED_GROUPS}). One condition
 * is conditional on another: "Notify when" (D640) is drawn only while every
 * chosen sensor kind raises and clears (`conditionSupportedByRule`).
 *
 * THE SCOPE AXES ARE ONE FIELD EACH (D641; zones, faces and labels joined
 * devices and classes on 2026-10-01). An include + exclude pair is drawn as
 * one pre-selector over one picker (`ScopeFields.tsx`), at the include
 * descriptor's place; the exclude descriptor never draws a second row. Their
 * value is the caller's scope DRAFT (`scopes`), never `conditions`: a scope id
 * with no binding draws nothing rather than a picker whose edits no save
 * would write.
 *
 * Two local presentation choices ride on the catalog: `minConfidence` sits
 * under the Detections group ({@link VIEWER_GROUP_OF}), and the hub's English
 * description is not drawn under a field that says what it means itself
 * ({@link QUIET_DESCRIPTIONS}) — the scopes, the zone crossing (its own short
 * line) and the scene gate (its explanation lives in the scenes docs).
 */
import React from 'react'
import { Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { ConditionField, type SetConditionField } from './ConditionField.js'
import {
  ClassScopeField,
  DeviceScopeField,
  IdentityScopeField,
  LabelScopeField,
  ZoneScopeField,
  type DeviceScopeBinding,
  type RuleScopeBinding,
  type ZoneScopeFieldProps,
} from './ScopeFields.js'
import { deviceListConditionKey, scopeDescriptorRole, withClassScope } from './rule-scope-form.js'
import { conditionSupportedByRule, type NcSensorTransitionAlarmActions } from './sensor-transition.js'
import { occupancyDroppedClasses } from './occupancy-condition.js'
import { conditionGroupLabelFallback, orderedConditionGroups } from './rule-sections.js'
import { conditionVisibleForKind } from '@camstack/types/client'
import type { NcRuleKind, NcSystemEventFamily } from '@camstack/types'
import type {
  NcConditionDescriptor,
  NcConditions,
  NcDelivery,
  NcSchedule,
  NcTaxonomy,
} from '../../data/notification-center.js'
import { SectionLabel } from '../ui/SectionLabel.js'

/** The scope axes this form draws, bound to the editor's drafts (D641). */
export interface ConditionFormScopes {
  readonly devices?: DeviceScopeBinding
  readonly classes?: RuleScopeBinding<string>
  readonly zones?: ZoneScopeFieldProps
  readonly identities?: RuleScopeBinding<string>
  readonly labels?: RuleScopeBinding<string>
}

/**
 * A descriptor drawn under another group than the catalog's. Operator,
 * 2026-10-01: the minimum confidence is a property of the DETECTION, so it
 * sits with the object classes, not under "Quality".
 */
const VIEWER_GROUP_OF: Readonly<Record<string, string>> = { minConfidence: 'class' }

/** The group a descriptor is drawn under. */
function viewerGroupOf(descriptor: NcConditionDescriptor): string {
  return VIEWER_GROUP_OF[descriptor.id] ?? descriptor.group
}

/** Descriptors whose hub description is not drawn — see the header. */
const QUIET_DESCRIPTIONS: ReadonlySet<string> = new Set([
  'devices',
  'classes',
  'zones',
  'identities',
  'labelEquals',
  'crossing',
  'scene',
])

/** Condition groups an authored occupancy condition SUPPRESSES.
 *
 *  An occupancy subject carries exactly one class name — the counted edge's own
 *  — and every condition ANDs, so a `classes` list beside `occupancy.className`
 *  can only narrow the rule to nothing (`classes:['vehicle']` +
 *  `occupancy.className:'person'` never fires) or restate what the occupancy
 *  scope already says. The pairing is resolved on save by
 *  `reconcileOccupancyClasses`; hiding the group is how the operator sees that
 *  BEFORE the save rather than discovering a silently-dropped value after it.
 */
const OCCUPANCY_SUPPRESSED_GROUPS: ReadonlySet<string> = new Set(['class'])

interface ConditionFormProps {
  readonly catalog: readonly NcConditionDescriptor[]
  readonly delivery: NcDelivery
  /** The rule's kind — the second half of the visibility question. */
  readonly kind: NcRuleKind
  readonly conditions: NcConditions
  /** The rule's conditions as OPENED (the draft's baseline: the saved rule,
   *  or a new rule's seed) — what a picker whose empty value means "all"
   *  compares against to warn that a save widens the rule. It outlives the
   *  picker's own mount; `undefined` where there is no baseline. */
  readonly savedConditions: NcConditions | undefined
  readonly schedule: NcSchedule | undefined
  /** Server class/label vocabulary feeding the condition pickers (optional). */
  readonly taxonomy: NcTaxonomy | undefined
  readonly onConditionsChange: (next: NcConditions) => void
  readonly onScheduleChange: (next: NcSchedule | undefined) => void
  /** Optional predicate to render only a SUBSET of the catalog (progressive
   *  disclosure: base vs advanced). Absent → the whole catalog. When it selects
   *  no descriptor the form renders nothing (the empty-catalog hint is shown
   *  only for the unfiltered surface). */
  readonly includeDescriptor?: (descriptor: NcConditionDescriptor) => boolean
  /** Which FAMILY a system rule authors (D637) — `systemFamilyOfKind(kind)`,
   *  so decided by the rule's kind, never by the value being edited: unticking
   *  the last device kind must not flip the editor to another family.
   *  `undefined` for a camera kind, and for a `mixed` rule (read-only). */
  readonly systemFamily: NcSystemEventFamily | undefined
  /** The scope drafts the scope descriptors draw (D641). */
  readonly scopes?: ConditionFormScopes
  /** The cameras the occupancy zone picker reads its zones from — an Only
   *  device scope's list, else none. (The zone SCOPE field reads the device
   *  scope itself, through its binding.) */
  readonly deviceIds?: readonly number[]
  /** The rule's actions and their sequence resolver — the alarm half of "Notify when"'s
   *  never-fires warning (D640 × D630). */
  readonly alarmActions?: NcSensorTransitionAlarmActions
  /** A scheduled STATE SUMMARY system rule (D647, D906) — `isStateSummaryForm`. */
  readonly summary?: boolean
}

/** No cameras chosen. */
const NO_DEVICE_IDS: readonly number[] = []

export function ConditionForm({
  catalog,
  delivery,
  kind,
  conditions,
  savedConditions,
  schedule,
  taxonomy,
  onConditionsChange,
  onScheduleChange,
  includeDescriptor,
  systemFamily,
  scopes,
  deviceIds = NO_DEVICE_IDS,
  alarmActions,
  summary = false,
}: ConditionFormProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  const setField: SetConditionField = (key, value) => {
    const next: NcConditions = { ...conditions }
    if (value === undefined) {
      delete next[key]
    } else {
      next[key] = value
    }
    onConditionsChange(next)
  }

  const authorable = catalog.filter((descriptor) =>
    conditionVisibleForKind(descriptor, delivery, kind),
  )
  const visible = (includeDescriptor ? authorable.filter(includeDescriptor) : authorable).filter(
    (descriptor) =>
      // The exclude half is drawn INSIDE its axis's one field, never as a row.
      scopeDescriptorRole(descriptor.id)?.kind !== 'merged' &&
      conditionSupportedByRule(descriptor.id, conditions),
  )
  // The class lists live in the scope draft while the rule is edited (D641):
  // the occupancy drop warning reads them from there, or it would go silent.
  const classDraft = scopes?.classes?.draft
  const droppedClasses = occupancyDroppedClasses(
    classDraft === undefined ? conditions : withClassScope(conditions, classDraft),
  )
  const suppressClasses = conditions.occupancy !== undefined
  const groups = orderedConditionGroups(visible.map((descriptor) => ({ group: viewerGroupOf(descriptor) })))
    .filter((id) => !(suppressClasses && OCCUPANCY_SUPPRESSED_GROUPS.has(id)))
    .map((id) => ({
      id,
      descriptors: visible.filter((descriptor) => viewerGroupOf(descriptor) === id),
    }))
    .filter((group) => group.descriptors.length > 0)

  if (groups.length === 0) {
    // A filtered subset with nothing to show renders nothing; the empty-catalog
    // hint belongs only to the unfiltered surface.
    if (includeDescriptor) return null
    return (
      <Text style={{ color: colors.foregroundSubtle, fontSize: 13, paddingHorizontal: SPACING.xs }}>
        {t('v2.nc.rules.editor.noConditions')}
      </Text>
    )
  }

  return (
    <View style={{ gap: SPACING['2xl'] }}>
      {groups.map((group) => (
        <View key={group.id} style={{ gap: SPACING.lg }}>
          <SectionLabel inset>
            {t(`v2.nc.rules.editor.group.${group.id}`, {
              defaultValue: conditionGroupLabelFallback(group.id),
            })}
          </SectionLabel>
          {group.id === 'occupancy' && droppedClasses.length > 0 ? (
            // Said BEFORE the save, not discovered after it: these values are
            // about to be dropped because they can only make the rule silent.
            <Text style={{ color: colors.warning, fontSize: 11, lineHeight: 15, paddingHorizontal: SPACING.xs }}>
              {t('v2.nc.rules.editor.occupancy.classesDropped', {
                classes: droppedClasses.join(', '),
              })}
            </Text>
          ) : null}
          {/* Every descriptor reaching here is authorable for this rule: the
              kind-composed filter above already removed the ones the trigger or
              the kind cannot use, so there is no disabled row and no "not for
              this trigger" hint to render. */}
          {group.descriptors.map((descriptor) => (
            <View key={descriptor.id} style={{ gap: SPACING.sm }}>
              <Text style={{ color: colors.foreground, fontSize: 14, fontWeight: '500' }}>
                {t(`v2.nc.rules.editor.condition.${descriptor.id}`, {
                  defaultValue: descriptor.label,
                })}
              </Text>
              {scopeDescriptorRole(descriptor.id) !== null ? (
                <ScopeFieldFor descriptor={descriptor} scopes={scopes} taxonomy={taxonomy} />
              ) : (
                <ConditionField
                  descriptor={descriptor}
                  conditions={conditions}
                  savedConditions={savedConditions}
                  schedule={schedule}
                  taxonomy={taxonomy}
                  onFieldChange={setField}
                  onScheduleChange={onScheduleChange}
                  systemFamily={systemFamily}
                  deviceIds={deviceIds}
                  alarmActions={alarmActions}
                  summary={summary}
                />
              )}
              {descriptor.description && !QUIET_DESCRIPTIONS.has(descriptor.id) ? (
                <Text style={{ color: colors.foregroundSubtle, fontSize: 11, lineHeight: 15 }}>
                  {descriptor.description}
                </Text>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}

interface ScopeFieldForProps {
  readonly descriptor: NcConditionDescriptor
  readonly scopes: ConditionFormScopes | undefined
  readonly taxonomy: NcTaxonomy | undefined
}

/**
 * The scope field a scope descriptor draws, or nothing: an axis with no
 * binding, and a `devices` descriptor of any valueType but `deviceIdList`
 * (old-descriptor safety — only that pair may ever edit the device list).
 */
function ScopeFieldFor({ descriptor, scopes, taxonomy }: ScopeFieldForProps) {
  const role = scopeDescriptorRole(descriptor.id)
  if (role === null || role.kind !== 'field') return null
  if (role.axis === 'devices') {
    const binding = scopes?.devices
    if (binding === undefined || deviceListConditionKey(descriptor) === null) return null
    return <DeviceScopeField {...binding} />
  }
  switch (role.axis) {
    case 'classes':
      return scopes?.classes === undefined ? null : <ClassScopeField {...scopes.classes} taxonomy={taxonomy} />
    case 'zones':
      return scopes?.zones === undefined ? null : <ZoneScopeField {...scopes.zones} />
    case 'identities':
      return scopes?.identities === undefined ? null : <IdentityScopeField {...scopes.identities} />
    case 'labels':
      return scopes?.labels === undefined ? null : <LabelScopeField {...scopes.labels} />
  }
}
