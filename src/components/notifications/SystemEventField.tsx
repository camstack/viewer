/**
 * SystemEventField — the `systemEvent` condition of ONE system family (D637):
 * device events, system, or alarm.
 *
 * Shape: the family's kinds under their group headings, then only the
 * narrowing filters the family carries AND its selected kinds speak about
 * (`familyFilterVisibility`). The admin twin is
 * `packages/addon-admin-ui/src/pages/system/notification-system-event-field.tsx`.
 *
 *  - Nodes and packages are picked (`NodePicker` / `PackagePicker`): a node id
 *    is minted by the cluster and a package name by the registry, so there is
 *    no free text to mistype.
 *  - The last kind cannot be unticked: a system rule with no kinds classifies
 *    `mixed`, and the family would flip mid-edit.
 *  - A filter hidden by a kind change is CARRIED in the draft (ticking the kind
 *    back restores it) and pruned at save by `formToInput`.
 *
 * A `mixed` rule has no family and is read-only (D637): it is drawn by
 * {@link MixedSystemEventSummary} as a plain line of its kinds.
 */
import React, { useEffect, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { useRouter } from 'expo-router'
import { NC_CONSUMABLE_LOW_PERCENT_DEFAULT } from '@camstack/types/client'
import type { NcSystemEventFamily } from '@camstack/types'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { DevicePicker, type DevicePickerSource } from './DevicePicker.js'
import { Hint } from './FieldHint.js'
import { NodePicker, PackagePicker } from './ScopePickers.js'
import {
  NC_DEVICE_TYPE_OPTIONS,
  deviceTypeLabelKey,
  type NcSystemEventKindOption,
} from './rule-editor.js'
import {
  batteryKindsNarrowedByType,
  familyFilterVisibility,
  NC_CONSUMABLE_THRESHOLD_MAX,
  NC_CONSUMABLE_THRESHOLD_MIN,
  parseConsumableThreshold,
  systemEventKindGroupsForFamily,
  systemEventOptionLabelKey,
  systemEventOptionSelected,
  toggledSystemEventKinds,
} from './system-event-family.js'
import type {
  NcConditionDescriptor,
  NcSystemEventCondition,
  NcSystemEventKind,
} from '../../data/notification-center.js'
import { SectionLabel } from '../ui/SectionLabel.js'

/** An alarm rule's `deviceIds` is the CAMERA whose rule set the alarm off. */
const CAMERAS_SOURCE: DevicePickerSource = { kind: 'cameras' }
/**
 * A device-events rule's devices are EVERY device: liveness, batteries and
 * consumables are device facts, and a vacuum is not a camera (D636). The fleet
 * is read only while the picker's sheet is open.
 */
const FLEET_SOURCE: DevicePickerSource = { kind: 'fleet' }
/** The alarm settings screen (`app/(app)/settings/alarm.tsx`). */
const ALARM_SETTINGS_HREF = '/settings/alarm'

const FILTERS = 'v2.nc.rules.editor.systemFilters'

/** The i18n key of one kind's chip. */
function kindLabelKey(kind: NcSystemEventKind): string {
  return `v2.nc.rules.editor.systemKinds.${kind}`
}

interface ToggleChipProps {
  readonly label: string
  readonly selected: boolean
  readonly onPress: () => void
}

/** A selectable chip — the kind picker and the device-type filter share it. */
function ToggleChip({ label, selected, onPress }: ToggleChipProps) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={{
        borderWidth: 1,
        borderColor: selected ? colors.primary : colors.border,
        backgroundColor: selected ? `${colors.primary}1f` : colors.background,
        borderRadius: RADIUS.md,
        paddingHorizontal: SPACING.sm,
        paddingVertical: SPACING.xs,
      }}
    >
      <Text style={{ color: selected ? colors.primary : colors.foreground, fontSize: 13 }}>
        {label}
      </Text>
    </Pressable>
  )
}

interface FamilyLinksProps {
  readonly family: NcSystemEventFamily
  readonly kinds: readonly NcSystemEventKind[]
}

/**
 * Where a family's settings live. Device events: the battery threshold is a
 * cluster setting the viewer has no screen for, so this is a sentence, not a
 * link; the consumable threshold is the rule's own (D642). Alarm: the alarm settings screen, and — with
 * `alarm-triggered` — what the notification carries.
 */
function FamilyLinks({ family, kinds }: FamilyLinksProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const router = useRouter()
  if (family === 'device-events') return <Hint text={t(`${FILTERS}.thresholdsHint`)} />
  if (family !== 'alarm') return null
  return (
    <View style={{ gap: SPACING.xs }}>
      <Pressable
        testID="system-event-alarm-settings"
        accessibilityRole="link"
        onPress={() => router.push(ALARM_SETTINGS_HREF)}
      >
        <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>
          {t(`${FILTERS}.alarmSettings`)}
        </Text>
      </Pressable>
      {kinds.includes('alarm-triggered') ? (
        <View testID="system-event-alarm-triggered-media">
          <Hint text={t(`${FILTERS}.alarmTriggeredMedia`)} />
        </View>
      ) : null}
    </View>
  )
}

interface ConsumableThresholdFieldProps {
  readonly value: number | undefined
  readonly onChange: (next: number | undefined) => void
}

/**
 * The rule's consumable threshold (D642): a whole number 1–95, empty = the
 * hub's default. The box keeps what is TYPED; only a valid number (or empty)
 * is written, and a number the hub would refuse is said, never swallowed —
 * and on blur it reverts to the stored value.
 */
function ConsumableThresholdField({ value, onChange }: ConsumableThresholdFieldProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [draft, setDraft] = useState(value === undefined ? '' : String(value))
  // A value changed from outside (a reset, another field) replaces the draft
  // — unless the draft already SAYS that value.
  useEffect(() => {
    setDraft((current) => {
      const parsed = parseConsumableThreshold(current)
      const shown = parsed.kind === 'set' ? parsed.value : parsed.kind === 'clear' ? undefined : null
      if (shown === value) return current
      return value === undefined ? '' : String(value)
    })
  }, [value])
  const invalid = parseConsumableThreshold(draft).kind === 'invalid'
  const onText = (text: string): void => {
    setDraft(text)
    const parsed = parseConsumableThreshold(text)
    if (parsed.kind === 'invalid') return
    onChange(parsed.kind === 'set' ? parsed.value : undefined)
  }
  // Leaving the box with a value the hub would refuse puts the STORED value
  // back, as the admin's controlled input does: the box never goes on showing
  // a number that is not what the rule will save. (Save lives on the summary
  // screen, so the box has always been left before Save can run.)
  const revertIfInvalid = (): void => {
    if (parseConsumableThreshold(draft).kind !== 'invalid') return
    setDraft(value === undefined ? '' : String(value))
  }
  return (
    <View style={{ gap: SPACING.sm }}>
      <Hint text={t(`${FILTERS}.consumableThreshold`)} />
      <TextInput
        testID="system-event-consumable-threshold"
        value={draft}
        onChangeText={onText}
        onBlur={revertIfInvalid}
        onSubmitEditing={revertIfInvalid}
        keyboardType="number-pad"
        placeholder={String(NC_CONSUMABLE_LOW_PERCENT_DEFAULT)}
        placeholderTextColor={colors.foregroundSubtle}
        maxLength={3}
        style={{
          color: colors.foreground,
          backgroundColor: colors.background,
          borderColor: invalid ? colors.warning : colors.border,
          borderWidth: 1,
          borderRadius: RADIUS.md,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.md,
          fontSize: 15,
          maxWidth: 120,
        }}
      />
      {invalid ? (
        <Text
          testID="system-event-consumable-threshold-invalid"
          style={{ color: colors.warning, fontSize: 12, lineHeight: 16 }}
        >
          {t(`${FILTERS}.consumableThresholdInvalid`, {
            min: NC_CONSUMABLE_THRESHOLD_MIN,
            max: NC_CONSUMABLE_THRESHOLD_MAX,
          })}
        </Text>
      ) : null}
      <Hint
        text={t(`${FILTERS}.consumableThresholdHint`, {
          defaultPercent: NC_CONSUMABLE_LOW_PERCENT_DEFAULT,
        })}
      />
    </View>
  )
}

interface SystemEventFieldProps {
  readonly descriptor: NcConditionDescriptor
  readonly value: NcSystemEventCondition | undefined
  /** Whether the SAVED rule filtered on devices — see `DevicePicker`. */
  readonly savedHadDevices: boolean
  /** The rule's family — never derived from `value` (review M1, D636). */
  readonly family: NcSystemEventFamily
  readonly onChange: (next: NcSystemEventCondition | undefined) => void
  /**
   * The rule is a scheduled STATE SUMMARY (D647): a paired class then means
   * the bad state at the scheduled time, not each change (D906).
   */
  readonly summary?: boolean
}

/** Carry `next[key]` when the patch names it, else the current value's. */
function carried<K extends keyof NcSystemEventCondition>(
  next: Partial<NcSystemEventCondition>,
  value: NcSystemEventCondition | undefined,
  key: K,
): NcSystemEventCondition[K] | undefined {
  return Object.prototype.hasOwnProperty.call(next, key) ? next[key] : value?.[key]
}

export function SystemEventField({
  descriptor,
  value,
  savedHadDevices,
  family,
  onChange,
  summary = false,
}: SystemEventFieldProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const kinds = value?.kinds ?? []
  // Which FAMILY this rule authors comes from the editor, never the value: a
  // family is offered only its own kinds.
  const groups = systemEventKindGroupsForFamily(family, descriptor.options, summary)
  const visible = familyFilterVisibility(family, kinds)
  const isAlarm = family === 'alarm'

  const patch = (next: Partial<NcSystemEventCondition>): void => {
    const nextKinds = next.kinds ?? value?.kinds
    if (nextKinds === undefined || nextKinds.length === 0) return
    // Carried across a kind change even while its control is hidden: absence
    // is "no restriction", so dropping a filter the operator cannot currently
    // see would silently WIDEN the draft. `formToInput` prunes it at save.
    const deviceIds = carried(next, value, 'deviceIds')
    const excludeDeviceIds = carried(next, value, 'excludeDeviceIds')
    const deviceTypes = carried(next, value, 'deviceTypes')
    const nodeIds = carried(next, value, 'nodeIds')
    const packageNames = carried(next, value, 'packageNames')
    const consumableLowPercent = carried(next, value, 'consumableLowPercent')
    onChange({
      kinds: nextKinds,
      ...(deviceIds !== undefined ? { deviceIds } : {}),
      ...(excludeDeviceIds !== undefined ? { excludeDeviceIds } : {}),
      ...(deviceTypes !== undefined ? { deviceTypes } : {}),
      ...(nodeIds !== undefined ? { nodeIds } : {}),
      ...(packageNames !== undefined ? { packageNames } : {}),
      ...(consumableLowPercent !== undefined ? { consumableLowPercent } : {}),
    })
  }
  // A family rule keeps at least one kind: `patch` refuses an empty list, as a
  // system rule with no kinds classifies `mixed`.
  const toggleOption = (option: NcSystemEventKindOption): void =>
    patch({ kinds: toggledSystemEventKinds(kinds, option) })
  const optionLabel = (option: NcSystemEventKindOption): string => {
    const label = t(systemEventOptionLabelKey(option, summary, kindLabelKey), {
      defaultValue: option.fallback,
    })
    return option.noSnapshot === true ? `${label} — ${t(`${FILTERS}.noSnapshot`)}` : label
  }

  return (
    <View style={{ gap: SPACING.lg }} testID="system-event-field">
      <View testID="system-event-class-hint">
        <Hint text={t(summary ? `${FILTERS}.summaryClassHint` : `${FILTERS}.instantClassHint`)} />
      </View>
      {groups.map((group) => (
        <View key={group.id} style={{ gap: SPACING.xs }} testID={`system-event-group-${group.id}`}>
          <SectionLabel level="group">
            {t(group.labelKey, { defaultValue: group.fallback })}
          </SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
            {group.options.map((option) => (
              <ToggleChip
                key={option.classId ?? option.kind}
                label={optionLabel(option)}
                selected={systemEventOptionSelected(kinds, option)}
                onPress={() => toggleOption(option)}
              />
            ))}
          </View>
        </View>
      ))}

      <FamilyLinks family={family} kinds={kinds} />

      {visible.consumableThreshold ? (
        <ConsumableThresholdField
          value={value?.consumableLowPercent}
          onChange={(next) => patch({ consumableLowPercent: next })}
        />
      ) : null}

      {batteryKindsNarrowedByType(value) ? (
        <Text
          testID="battery-device-types-warning"
          style={{ color: colors.warning, fontSize: 12, lineHeight: 16 }}
        >
          {t(`${FILTERS}.batteryTypesWarning`)}
        </Text>
      ) : null}

      {visible.devices ? (
        <View style={{ gap: SPACING.sm }}>
          <Hint text={t(isAlarm ? `${FILTERS}.cameras` : `${FILTERS}.devices`)} />
          <DevicePicker
            testID="system-event-include"
            source={isAlarm ? CAMERAS_SOURCE : FLEET_SOURCE}
            value={value?.deviceIds ?? []}
            emptyMeansAll
            savedHadDevices={savedHadDevices}
            onChange={(next) => patch({ deviceIds: next.length > 0 ? next : undefined })}
          />
        </View>
      ) : null}

      {visible.excludeDevices ? (
        <View style={{ gap: SPACING.sm }}>
          <Hint text={t(`${FILTERS}.excludeDevices`)} />
          <DevicePicker
            testID="system-event-exclude"
            source={FLEET_SOURCE}
            value={value?.excludeDeviceIds ?? []}
            emptyLabel={t(`${FILTERS}.noExcluded`)}
            onChange={(next) => patch({ excludeDeviceIds: next.length > 0 ? next : undefined })}
          />
          <Hint text={t(`${FILTERS}.excludeHint`)} />
        </View>
      ) : null}

      {visible.deviceTypes ? (
        <View style={{ gap: SPACING.sm }}>
          <Hint text={t(`${FILTERS}.deviceTypes`)} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
            {NC_DEVICE_TYPE_OPTIONS.map((option) => {
              const current = value?.deviceTypes ?? []
              const selected = current.includes(option.value)
              return (
                <ToggleChip
                  key={option.value}
                  label={t(deviceTypeLabelKey(option.value), { defaultValue: option.label })}
                  selected={selected}
                  onPress={() => {
                    // Empty list is written as ABSENT: the schema's `.min(1)`
                    // rejects `[]`, and "no restriction" is what absent means.
                    const next = selected
                      ? current.filter((type) => type !== option.value)
                      : [...current, option.value]
                    patch({ deviceTypes: next.length > 0 ? next : undefined })
                  }}
                />
              )
            })}
          </View>
        </View>
      ) : null}

      {visible.nodes ? (
        <View style={{ gap: SPACING.sm }}>
          <Hint text={t(`${FILTERS}.nodes`)} />
          <NodePicker
            value={value?.nodeIds ?? []}
            onChange={(next) => patch({ nodeIds: next.length > 0 ? next : undefined })}
            testID="system-event-nodes"
          />
        </View>
      ) : null}

      {visible.packages ? (
        <View style={{ gap: SPACING.sm }}>
          <Hint text={t(`${FILTERS}.packages`)} />
          <PackagePicker
            value={value?.packageNames ?? []}
            onChange={(next) => patch({ packageNames: next.length > 0 ? next : undefined })}
            testID="system-event-packages"
          />
        </View>
      ) : null}
    </View>
  )
}

interface MixedSystemEventSummaryProps {
  readonly value: NcSystemEventCondition | undefined
}

/**
 * A `mixed` rule's events, as one plain line (D637). It spans families, so no
 * family editor can draw it, and it is read-only — the rule row already says
 * it must be recreated. Nothing here can be ticked.
 */
export function MixedSystemEventSummary({ value }: MixedSystemEventSummaryProps) {
  const { t } = useTranslation()
  const kinds = value?.kinds ?? []
  const text =
    kinds.length > 0
      ? kinds.map((kind) => t(kindLabelKey(kind), { defaultValue: kind })).join(', ')
      : t(`${FILTERS}.mixedNone`)
  return (
    <View testID="system-event-mixed-summary">
      <Hint text={text} />
    </View>
  )
}
