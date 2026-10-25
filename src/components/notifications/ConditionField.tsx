/**
 * ConditionField — the per-`valueType` widget switch for one catalog condition
 * descriptor. Mirrors the admin `NotificationRuleConditions.tsx` idiom adapted
 * to React-Native + the B3 form primitives: there is NO hardcoded per-condition
 * UI — the widget is chosen purely from `descriptor.valueType`.
 *
 *   deviceIdList / deviceIdExcludeList → NOTHING here: the device scope is
 *                           ONE field (D641), drawn by `ConditionForm` from the
 *                           editor's scope draft (`ScopeFields.tsx`). Neither
 *                           may write `conditions.devices` from this switch —
 *                           an exclusion falling into an include picker is the
 *                           rule silently widened.
 *   zones / zonesExclude, identities / identitiesExclude, labelEquals →
 *                           NOTHING here either: each is ONE scope field
 *                           ("All | Only these | All except these", the Object
 *                           classes control — operator, 2026-10-01), drawn by
 *                           `ConditionForm` from the editor's scope drafts
 *   stringList            → a taxonomy picker or tag input (sensor kinds,
 *                           event-type tokens)
 *   plates (plateMatcher) → the THREE-state recognition scope, the one
 *                           exception below
 *   number01 / number     → numeric stepper
 *   sourceSelect/packagePhase/crossingSelect → segmented control (source and
 *                           crossing are drawn in the Advanced section)
 *   sensorTransition      → "Notify when" (D640): both (absent) / raised /
 *                           cleared, the served options with a local fallback,
 *                           and the alarm rule's never-fires warning
 *   occupancy             → the composite zone/class/op/count/hold widget
 *   audio                 → the two-mode sound widget: sounds (fires at once)
 *                           OR a level floor over a sampling window
 *   schedule              → weekly-window editor
 *   polygonDraw           → the custom-zone drawing field.
 *
 * `plates` gives an EMPTY list a meaning of its own ("any readable plate")
 * that the generic list widgets cannot express — they collapse empty to
 * `undefined`, which is a DIFFERENT rule — so it has its own widget. The
 * exception is declared as data in `recognition-scope.ts`.
 */
import React, { useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Plus, X, Trash2 } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SegmentedControl, type SegmentOption } from '../ui/SegmentedControl.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import type { NcSystemEventFamily } from '@camstack/types'
import { Hint } from './FieldHint.js'
import { stateLabelFor } from '../../lib/state-label.js'
import { MixedSystemEventSummary, SystemEventField } from './SystemEventField.js'

import { CustomZoneField } from './CustomZoneField.js'
import { NumericStepper } from './NumericStepper.js'
import { OccupancyField } from './OccupancyField.js'
import { AudioField } from './AudioField.js'
import {
  NC_PLATE_MAX_DISTANCE_DEFAULT,
  NC_PLATE_MAX_DISTANCE_MAX,
  NC_PLATE_MAX_DISTANCE_MIN,
  NC_RECOGNITION_MODES,
  parseRecognitionMode,
  plateScopeMode,
  plateScopeValue,
  type NcRecognitionMode,
} from './recognition-scope.js'
import {
  NC_PACKAGE_PHASE_VALUES,
  NC_SOURCE_VALUES,
  isNumber01Key,
  isStringListKey,
  parsePackagePhase,
  parseSource,
  readNumber01,
  readStringList,
} from './rule-editor.js'
import { pickerForCondition, knownValues, type TaxonomyPicker } from './condition-taxonomy.js'
import { isNumberConditionKey } from './condition-field-keys.js'
import {
  parseSensorTransition,
  SENSOR_TRANSITION_NEVER_FIRES_KEY,
  sensorTransitionChoices,
  sensorTransitionNeverFiresFor,
  type NcSensorTransitionAlarmActions,
} from './sensor-transition.js'
import type {
  NcConditionDescriptor,
  NcConditions,
  NcPlateMatcher,
  NcScheduleWindow,
  NcDeviceStateCondition,
  NcSceneCondition,
  NcSchedule,
  NcTaxonomy,
} from '../../data/notification-center.js'
import { SectionLabel } from '../ui/SectionLabel.js'

/** Sets one condition key (or clears it when `value` is undefined). */
export type SetConditionField = <K extends keyof NcConditions>(key: K, value: NcConditions[K]) => void

interface ConditionFieldProps {
  readonly descriptor: NcConditionDescriptor
  readonly conditions: NcConditions
  /** The SAVED rule's conditions — see `ConditionForm`. */
  readonly savedConditions: NcConditions | undefined
  readonly schedule: NcSchedule | undefined
  /** Server-provided class/label vocabulary; absent → free-text everywhere. */
  readonly taxonomy: NcTaxonomy | undefined
  readonly onFieldChange: SetConditionField
  readonly onScheduleChange: (next: NcSchedule | undefined) => void
  /** The family a system rule authors (D637) — see `ConditionForm`.
   *  `undefined` on a `systemEvent` condition is a `mixed` rule: read-only,
   *  drawn as a line of its kinds (`MixedSystemEventSummary`). */
  readonly systemFamily: NcSystemEventFamily | undefined
  /** The cameras the occupancy zone picker reads its zones from (an Only device scope). */
  readonly deviceIds: readonly number[]
  /** The rule's actions (and how its sequence bindings resolve) — for
   *  "Notify when"'s alarm warning. */
  readonly alarmActions: NcSensorTransitionAlarmActions | undefined
  /** A scheduled STATE SUMMARY system rule (D647, D906) — see `SystemEventField`. */
  readonly summary?: boolean
}

export function ConditionField({
  descriptor,
  conditions,
  savedConditions,
  schedule,
  taxonomy,
  onFieldChange,
  onScheduleChange,
  systemFamily,
  deviceIds,
  alarmActions,
  summary = false,
}: ConditionFieldProps) {
  switch (descriptor.valueType) {
    // The scope fields are ONE field each, drawn by `ConditionForm` (see the
    // header) — never a second widget writing the same key.
    case 'deviceIdList':
    case 'deviceIdExcludeList':
    case 'zoneIdList':
    case 'zoneSelection':
      return null
    case 'stringList': {
      if (!isStringListKey(descriptor.id)) return null
      const key = descriptor.id
      const value = readStringList(conditions, key)
      const onChange = (next: string[]): void => onFieldChange(key, next.length > 0 ? next : undefined)
      const picker = pickerForCondition(descriptor.id, taxonomy)
      if (picker) {
        return <TaxonomyMultiSelect picker={picker} value={value} onChange={onChange} />
      }
      return <TagsInput value={value} onChange={onChange} />
    }
    case 'number01': {
      if (!isNumber01Key(descriptor.id)) return null
      const key = descriptor.id
      return (
        <NumericStepper
          value={readNumber01(conditions, key)}
          min={0}
          max={1}
          step={0.05}
          decimals={2}
          onChange={(next) => onFieldChange(key, next)}
        />
      )
    }
    case 'number': {
      if (!isNumberConditionKey(descriptor.id)) return null
      const key = descriptor.id
      return (
        <NumericStepper
          value={conditions[key]}
          min={0}
          step={1}
          decimals={0}
          onChange={(next) => onFieldChange(key, next)}
        />
      )
    }
    case 'sourceSelect':
      return <SourceField value={conditions.source} onChange={(next) => onFieldChange('source', next)} />
    case 'deviceState':
      return <DeviceStateSummary value={conditions.deviceState} />
    case 'scene':
      return <SceneGateSummary value={conditions.scene} />
    case 'systemEvent':
      // A `mixed` rule has no family and is read-only (D637): its kinds, as a line.
      if (systemFamily === undefined) return <MixedSystemEventSummary value={conditions.systemEvent} />
      return (
        <SystemEventField
          descriptor={descriptor}
          value={conditions.systemEvent}
          savedHadDevices={(savedConditions?.systemEvent?.deviceIds?.length ?? 0) > 0}
          family={systemFamily}
          onChange={(next) => onFieldChange('systemEvent', next)}
          summary={summary}
        />
      )
    case 'crossingSelect':
      return <CrossingField value={conditions.crossing} onChange={(next) => onFieldChange('crossing', next)} />
    case 'sensorTransition':
      return (
        <SensorTransitionField
          value={conditions.sensorTransition}
          options={descriptor.options}
          neverFires={sensorTransitionNeverFiresFor({ conditions, ...alarmActions })}
          onChange={(next) => onFieldChange('sensorTransition', next)}
        />
      )
    case 'packagePhase':
      return (
        <PackagePhaseField
          value={conditions.packagePhase}
          onChange={(next) => onFieldChange('packagePhase', next)}
        />
      )
    case 'plateMatcher':
      return <PlateMatcherField value={conditions.plates} onChange={(next) => onFieldChange('plates', next)} />
    case 'occupancy':
      return (
        <OccupancyField
          deviceIds={deviceIds}
          taxonomy={taxonomy}
          value={conditions.occupancy}
          onChange={(next) => onFieldChange('occupancy', next)}
        />
      )
    case 'audio':
      return (
        <AudioField
          taxonomy={taxonomy}
          value={conditions.audio}
          onChange={(next) => onFieldChange('audio', next)}
        />
      )
    case 'schedule':
      return <ScheduleField value={schedule} onChange={onScheduleChange} />
    case 'polygonDraw':
      return (
        <CustomZoneField
          value={conditions.customZones ?? []}
          onChange={(next) => onFieldChange('customZones', next.length > 0 ? next : undefined)}
        />
      )
    default:
      return null
  }
}

// ── Widgets ─────────────────────────────────────────────────────────────────

interface TagsInputProps {
  readonly value: readonly string[]
  readonly onChange: (next: string[]) => void
  readonly placeholderKey?: string
}

/** A string-array editor: removable chips + an add-on-submit input. */
export function TagsInput({ value, onChange, placeholderKey }: TagsInputProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [draft, setDraft] = useState('')

  const commit = (): void => {
    const next = draft.trim()
    if (next.length === 0 || value.includes(next)) {
      setDraft('')
      return
    }
    onChange([...value, next])
    setDraft('')
  }
  const remove = (item: string): void => onChange(value.filter((v) => v !== item))

  return (
    <View style={{ gap: SPACING.sm }}>
      {value.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
          {value.map((item) => (
            <View
              key={item}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: SPACING.xs,
                backgroundColor: colors.surfaceHover,
                borderRadius: RADIUS.md,
                paddingVertical: SPACING.xs,
                paddingHorizontal: SPACING.sm,
              }}
            >
              <Text style={{ color: colors.foreground, fontSize: 13 }}>{item}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('v2.nc.rules.editor.removeTag', { value: item })}
                onPress={() => remove(item)}
                hitSlop={6}
              >
                <X size={13} color={colors.foregroundSubtle} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={commit}
        onBlur={commit}
        blurOnSubmit={false}
        placeholder={t(placeholderKey ?? 'v2.nc.rules.editor.addValue')}
        placeholderTextColor={colors.foregroundSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          color: colors.foreground,
          backgroundColor: colors.background,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: RADIUS.md,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.md,
          fontSize: 15,
        }}
      />
    </View>
  )
}

interface TaxonomyMultiSelectProps {
  readonly picker: TaxonomyPicker
  readonly value: readonly string[]
  readonly onChange: (next: string[]) => void
}

/**
 * Grouped multi-select over the server taxonomy: tappable chips per group, plus
 * a free-text escape hatch for values the taxonomy does not know. Selected
 * unknown values are surfaced in their own "custom" group so they can be removed.
 */
export function TaxonomyMultiSelect({ picker, value, onChange }: TaxonomyMultiSelectProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [draft, setDraft] = useState('')

  const selected = new Set(value)
  const known = knownValues(picker)
  const custom = value.filter((v) => !known.has(v))

  const toggle = (option: string): void =>
    onChange(selected.has(option) ? value.filter((v) => v !== option) : [...value, option])

  const commitDraft = (): void => {
    const next = draft.trim()
    if (next.length === 0 || value.includes(next)) {
      setDraft('')
      return
    }
    onChange([...value, next])
    setDraft('')
  }

  const chip = (label: string, on: boolean, onPress: () => void, key: string): React.ReactNode => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.xs,
        borderRadius: RADIUS.md,
        paddingVertical: SPACING.xs,
        paddingHorizontal: SPACING.sm,
        borderWidth: 1,
        borderColor: on ? colors.primary : colors.border,
        backgroundColor: on ? `${colors.primary}1f` : colors.background,
      }}
    >
      <Text style={{ color: on ? colors.primary : colors.foreground, fontSize: 13 }}>{label}</Text>
      {on ? <X size={12} color={colors.primary} /> : null}
    </Pressable>
  )

  return (
    <View style={{ gap: SPACING.md }}>
      {picker.groups.map((group) => (
        <View key={group.key} style={{ gap: SPACING.sm }}>
          <SectionLabel level="group">
            {t(`v2.nc.rules.editor.taxonomy.${group.key}`, { defaultValue: group.fallbackLabel })}
          </SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
            {group.options.map((option) =>
              chip(option.label, selected.has(option.value), () => toggle(option.value), option.value),
            )}
          </View>
        </View>
      ))}

      {custom.length > 0 ? (
        <View style={{ gap: SPACING.sm }}>
          <SectionLabel level="group">
            {t('v2.nc.rules.editor.taxonomy.custom')}
          </SectionLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
            {custom.map((v) => chip(v, true, () => toggle(v), `custom:${v}`))}
          </View>
        </View>
      ) : null}

      <TextInput
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={commitDraft}
        onBlur={commitDraft}
        blurOnSubmit={false}
        placeholder={t('v2.nc.rules.editor.taxonomy.addCustom')}
        placeholderTextColor={colors.foregroundSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          color: colors.foreground,
          backgroundColor: colors.background,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: RADIUS.md,
          paddingHorizontal: SPACING.lg,
          paddingVertical: SPACING.md,
          fontSize: 15,
        }}
      />
    </View>
  )
}

interface SourceFieldProps {
  readonly value: NcConditions['source']
  readonly onChange: (next: NcConditions['source']) => void
}

function SourceField({ value, onChange }: SourceFieldProps) {
  const { t } = useTranslation()
  const options: readonly SegmentOption<string>[] = NC_SOURCE_VALUES.map((v) => ({
    value: v,
    label: t(`v2.nc.rules.editor.source.${v}`),
  }))
  return (
    <SegmentedControl<string>
      options={options}
      value={value ?? 'any'}
      onChange={(next) => onChange(parseSource(next))}
    />
  )
}

interface CrossingFieldProps {
  readonly value: NcConditions['crossing']
  readonly onChange: (next: NcConditions['crossing']) => void
}

/** The crossing choices, in the order the control draws them. */
const CROSSING_CHOICES = ['enter', 'exit', 'any'] as const
type CrossingChoice = (typeof CROSSING_CHOICES)[number]

function parseCrossing(value: string): CrossingChoice | undefined {
  return CROSSING_CHOICES.find((choice) => choice === value)
}

/**
 * Zone-crossing direction: Entering (the default), Leaving, Either — one
 * short line under it says what the choice matches (operator, 2026-10-01: no
 * long texts, no "not set"). Absent IS entering, so Entering writes nothing
 * and a rule that never chose keeps its stored shape.
 */
function CrossingField({ value, onChange }: CrossingFieldProps) {
  const { t } = useTranslation()
  const current: CrossingChoice = value ?? 'enter'
  const options: readonly SegmentOption<CrossingChoice>[] = CROSSING_CHOICES.map((choice) => ({
    value: choice,
    label: t(`v2.nc.rules.editor.crossing.${choice}`),
  }))
  return (
    <View style={{ gap: SPACING.xs }}>
      <SegmentedControl<CrossingChoice>
        options={options}
        value={current}
        onChange={(next) => {
          const parsed = parseCrossing(next)
          if (parsed === undefined) return
          onChange(parsed === 'enter' ? undefined : parsed)
        }}
      />
      <Hint text={t(`v2.nc.rules.editor.crossing.${current}Hint`)} />
    </View>
  )
}

interface SensorTransitionFieldProps {
  readonly value: NcConditions['sensorTransition']
  readonly options: NcConditionDescriptor['options']
  /** An alarm rule over openings asking for the clear — it can never fire. */
  readonly neverFires: boolean
  readonly onChange: (next: NcConditions['sensorTransition']) => void
}

/**
 * "Notify when" (D640). The hub's choices when it serves them (with a hint
 * each), in this build's words where it has them; `''` is both edges and
 * writes NOTHING — there is no stored "both". The hint under the control
 * says what the chosen edge matches.
 */
function SensorTransitionField({ value, options: served, neverFires, onChange }: SensorTransitionFieldProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const choices = sensorTransitionChoices(served)
  const current = value ?? ''
  const chosen = choices.find((choice) => choice.value === current)
  // A vertical choice list, not a segmented control: the three sentences do
  // not fit side by side on a phone, and a truncated "Only when it…" reads the
  // same for two opposite choices.
  return (
    <View style={{ gap: SPACING.sm }}>
      <View accessibilityRole="radiogroup" style={{ gap: SPACING.xs }}>
        {choices.map((choice) => {
          const active = choice.value === current
          return (
            <Pressable
              key={choice.value === '' ? 'both' : choice.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              onPress={() => onChange(parseSensorTransition(choice.value))}
              style={{
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                backgroundColor: active ? `${colors.primary}1f` : colors.background,
                borderRadius: RADIUS.md,
                paddingHorizontal: SPACING.lg,
                paddingVertical: SPACING.md,
              }}
            >
              <Text style={{ color: active ? colors.primary : colors.foreground, fontSize: 14, fontWeight: active ? '600' : '400' }}>
                {t(choice.labelKey, { defaultValue: choice.fallbackLabel })}
              </Text>
            </Pressable>
          )
        })}
      </View>
      {chosen !== undefined ? (
        <Hint text={t(chosen.hintKey, { defaultValue: chosen.hint ?? '' })} />
      ) : null}
      {neverFires ? (
        <Text style={{ color: colors.warning, fontSize: 12, lineHeight: 16 }}>
          {t(SENSOR_TRANSITION_NEVER_FIRES_KEY)}
        </Text>
      ) : null}
    </View>
  )
}

interface PackagePhaseFieldProps {
  readonly value: NcConditions['packagePhase']
  readonly onChange: (next: NcConditions['packagePhase']) => void
}

function PackagePhaseField({ value, onChange }: PackagePhaseFieldProps) {
  const { t } = useTranslation()
  const options: readonly SegmentOption<string>[] = NC_PACKAGE_PHASE_VALUES.map((v) => ({
    value: v,
    label: t(`v2.nc.rules.editor.phase.${v}`),
  }))
  return (
    <SegmentedControl<string>
      options={options}
      value={value ?? 'both'}
      onChange={(next) => onChange(parsePackagePhase(next))}
    />
  )
}

interface PlateMatcherFieldProps {
  readonly value: NcPlateMatcher | undefined
  readonly onChange: (next: NcPlateMatcher | undefined) => void
}

/**
 * Fuzzy plate matcher — a THREE-state scope over vehicles, then plate tags and a
 * max-distance stepper once the operator names plates.
 *
 *   Any vehicle → the key is ABSENT (a car with no readable plate matches)
 *   Any plate   → `{ values: [] }` — the plate WAS read, whatever it said
 *   These       → `{ values: [...] }`, matched Levenshtein-tolerantly
 *
 * The middle state used to be unreachable AND unsurvivable here: the widget
 * collapsed an empty list to `undefined`, and the mirror's `.min(1)` made a rule
 * carrying it fail to parse at all, so a rule the admin UI authored as "any
 * readable plate" simply did not appear in the app's list.
 */
function PlateMatcherField({ value, onChange }: PlateMatcherFieldProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const mode = plateScopeMode(value)
  const values = value?.values ?? []
  const maxDistance = value?.maxDistance ?? NC_PLATE_MAX_DISTANCE_DEFAULT

  const options: readonly SegmentOption<NcRecognitionMode>[] = NC_RECOGNITION_MODES.map((m) => ({
    value: m,
    label: t(`v2.nc.rules.editor.recognition.plates.${m}`),
  }))

  const setMode = (next: string): void => {
    const parsed = parseRecognitionMode(next)
    if (parsed === undefined) return
    onChange(plateScopeValue(parsed, values, maxDistance))
  }
  const setValues = (next: string[]): void => onChange(plateScopeValue('specific', next, maxDistance))
  const setDistance = (next: number): void =>
    onChange(
      plateScopeValue(
        mode,
        values,
        Math.max(NC_PLATE_MAX_DISTANCE_MIN, Math.min(NC_PLATE_MAX_DISTANCE_MAX, next)),
      ),
    )

  return (
    <View style={{ gap: SPACING.sm }}>
      <SegmentedControl<NcRecognitionMode> options={options} value={mode} onChange={setMode} />
      <Text style={{ color: colors.foregroundSubtle, fontSize: 11, lineHeight: 15 }}>
        {t(`v2.nc.rules.editor.recognition.plates.${mode}Hint`)}
      </Text>
      {mode === 'specific' ? (
        <>
          <TagsInput value={values} onChange={setValues} placeholderKey="v2.nc.rules.editor.plateText" />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
            <Text style={{ flex: 1, color: colors.foregroundSubtle, fontSize: 13 }}>
              {t('v2.nc.rules.editor.maxDistance')}
            </Text>
            <NumericStepper
              value={maxDistance}
              min={NC_PLATE_MAX_DISTANCE_MIN}
              max={NC_PLATE_MAX_DISTANCE_MAX}
              step={1}
              decimals={0}
              onChange={(n) => setDistance(n ?? NC_PLATE_MAX_DISTANCE_DEFAULT)}
            />
          </View>
        </>
      ) : null}
    </View>
  )
}

// ── Schedule (rule-level NcSchedule) ────────────────────────────────────────

const WEEKDAYS: readonly { readonly value: number; readonly labelKey: string }[] = [
  { value: 1, labelKey: 'mon' },
  { value: 2, labelKey: 'tue' },
  { value: 3, labelKey: 'wed' },
  { value: 4, labelKey: 'thu' },
  { value: 5, labelKey: 'fri' },
  { value: 6, labelKey: 'sat' },
  { value: 0, labelKey: 'sun' },
]

export interface ScheduleFieldProps {
  readonly value: NcSchedule | undefined
  readonly onChange: (next: NcSchedule | undefined) => void
}

function minutesToHhmm(minute: number): string {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function hhmmToMinutes(value: string): number {
  const [h, m] = value.split(':')
  const minute = Number(h) * 60 + Number(m)
  return Number.isFinite(minute) ? Math.max(0, Math.min(1439, minute)) : 0
}

function newWindow(): NcScheduleWindow {
  return { days: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1080 }
}

/**
 * Weekly windows. Shared with the TIMELAPSE and DIGEST editors, where the
 * schedule is REQUIRED rather than "always active when absent" — the difference
 * lives in those form models, never in this widget.
 */
export function ScheduleField({ value, onChange }: ScheduleFieldProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const windows = value?.windows ?? []
  const invert = value?.invert ?? false

  const commit = (nextWindows: NcScheduleWindow[], nextInvert: boolean): void => {
    if (nextWindows.length === 0) {
      onChange(undefined)
      return
    }
    onChange({
      windows: nextWindows,
      ...(nextInvert ? { invert: true } : {}),
      ...(value?.timezone ? { timezone: value.timezone } : {}),
    })
  }
  const addWindow = (): void => commit([...windows, newWindow()], invert)
  const removeAt = (i: number): void => commit(windows.filter((_, idx) => idx !== i), invert)
  const replaceAt = (i: number, win: NcScheduleWindow): void =>
    commit(windows.map((w, idx) => (idx === i ? win : w)), invert)

  return (
    <View style={{ gap: SPACING.sm }}>
      {windows.length === 0 ? (
        <Hint text={t('v2.nc.rules.editor.scheduleAlways')} />
      ) : (
        windows.map((win, i) => (
          <ScheduleWindowRow key={i} window={win} onChange={(w) => replaceAt(i, w)} onRemove={() => removeAt(i)} />
        ))
      )}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.lg }}>
        <Pressable
          accessibilityRole="button"
          onPress={addWindow}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: SPACING.xs,
            paddingVertical: SPACING.sm,
            paddingHorizontal: SPACING.md,
            borderRadius: RADIUS.md,
            backgroundColor: colors.surfaceHover,
          }}
        >
          <Plus size={14} color={colors.foregroundMuted} />
          <Text style={{ color: colors.foregroundMuted, fontSize: 13, fontWeight: '600' }}>
            {t('v2.nc.rules.editor.addWindow')}
          </Text>
        </Pressable>
        {windows.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: invert }}
            onPress={() => commit([...windows], !invert)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.xs }}
          >
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: RADIUS.sm,
                borderWidth: 1.5,
                borderColor: invert ? colors.primary : colors.border,
                backgroundColor: invert ? colors.primary : 'transparent',
              }}
            />
            <Text style={{ color: colors.foregroundSubtle, fontSize: 12 }}>
              {t('v2.nc.rules.editor.scheduleInvert')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

interface ScheduleWindowRowProps {
  readonly window: NcScheduleWindow
  readonly onChange: (win: NcScheduleWindow) => void
  readonly onRemove: () => void
}

function ScheduleWindowRow({ window: win, onChange, onRemove }: ScheduleWindowRowProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const toggleDay = (day: number): void => {
    const next = win.days.includes(day) ? win.days.filter((d) => d !== day) : [...win.days, day]
    if (next.length === 0) return // schema requires ≥1 day
    onChange({ ...win, days: next })
  }
  const timeInput = (value: string, onCommit: (v: string) => void): React.ReactNode => (
    <TextInput
      defaultValue={value}
      onEndEditing={(e) => onCommit(e.nativeEvent.text)}
      keyboardType="numbers-and-punctuation"
      autoCapitalize="none"
      autoCorrect={false}
      placeholder="HH:MM"
      placeholderTextColor={colors.foregroundSubtle}
      style={{
        color: colors.foreground,
        backgroundColor: colors.background,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: RADIUS.md,
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.sm,
        fontSize: 15,
        minWidth: 68,
        textAlign: 'center',
      }}
    />
  )
  return (
    <View
      style={{
        gap: SPACING.sm,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: RADIUS.md,
        padding: SPACING.md,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SPACING.md }}>
        {timeInput(minutesToHhmm(win.startMinute), (v) => onChange({ ...win, startMinute: hhmmToMinutes(v) }))}
        <Text style={{ color: colors.foregroundSubtle, fontSize: 14 }}>→</Text>
        {timeInput(minutesToHhmm(win.endMinute), (v) => onChange({ ...win, endMinute: hhmmToMinutes(v) }))}
        <View style={{ flex: 1 }} />
        <Pressable accessibilityRole="button" onPress={onRemove} hitSlop={6}>
          <Trash2 size={16} color={colors.danger} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
        {WEEKDAYS.map((d) => {
          const on = win.days.includes(d.value)
          return (
            <Pressable
              key={d.value}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => toggleDay(d.value)}
              style={{
                paddingVertical: SPACING.xs,
                paddingHorizontal: SPACING.sm,
                borderRadius: RADIUS.sm,
                backgroundColor: on ? colors.primary : colors.surfaceHover,
              }}
            >
              <Text style={{ color: on ? colors.primaryForeground : colors.foregroundSubtle, fontSize: 11, fontWeight: '600' }}>
                {t(`v2.nc.rules.editor.weekday.${d.labelKey}`)}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/**
 * The `deviceState` gate, READ-ONLY.
 *
 * The app has no global device list (only cameras), so it cannot offer the
 * device picker or resolve that device's state vocabulary — and a picker built
 * on a guessed vocabulary would offer values the engine never matches.
 *
 * So it SHOWS what the rule holds instead of hiding it. The value round-trips
 * untouched: `deviceState` is mirrored in this app's schema, so editing any
 * other part of the rule from the phone cannot strip it — which is the failure
 * that once wiped a rule's whole media policy.
 */
function DeviceStateSummary({ value }: { readonly value: NcDeviceStateCondition | undefined }) {
  const { t, i18n } = useTranslation()
  if (value === undefined) return <Hint text={t('v2.nc.rules.editor.deviceStateNone')} />
  return (
    <Hint
      text={t('v2.nc.rules.editor.deviceStateSet', {
        deviceId: value.deviceId,
        // The stored words are the wire vocabulary; the operator reads the
        // shared dictionary's labels (R7), the same the admin UI shows.
        states: value.states.map((state) => stateLabelFor(state, i18n.language)).join(', '),
      })}
    />
  )
}

/**
 * The `scene` gate, READ-ONLY — the `DeviceStateSummary` precedent, for the same
 * reason: the app has no scene list, so it SHOWS what the rule holds, and the
 * value round-trips untouched (`scene` is mirrored in this app's schema).
 *
 * One short line (operator, 2026-10-01: cut the scene text drastically); what
 * a scene gate is belongs in the scenes docs, not under the field.
 */
function SceneGateSummary({ value }: { readonly value: NcSceneCondition | undefined }) {
  const { t, i18n } = useTranslation()
  if (value === undefined) return <Hint text={t('v2.nc.rules.editor.sceneGateNone')} />
  return (
    <Hint
      text={t('v2.nc.rules.editor.sceneGateSet', {
        sceneId: value.sceneId,
        state: stateLabelFor(value.requiredState, i18n.language),
      })}
    />
  )
}
