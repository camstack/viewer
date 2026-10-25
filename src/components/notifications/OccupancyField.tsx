/**
 * OccupancyField — the composite occupancy widget (the viewer port of the admin
 * `notification-condition-widgets.tsx` `OccupancyField`).
 *
 * Zone + class + op + count + hold are edited TOGETHER because they only mean
 * anything as a set: a threshold without its op is not a condition. The engine
 * behind it — the debounced per-(device, zone, class, threshold) watcher with
 * durable edge state — shipped complete; the missing widget is the only reason
 * the feature was unreachable from the phone.
 *
 * Two things it does that a select alone would not:
 *  - a stored zone the hub no longer serves renders as an explicitly-unknown,
 *    removable chip, never folded into "— whole frame —";
 *  - a 0-second hold is reachable but announced: it fires on the first frame
 *    that crosses, which is the chatter the debounce exists to prevent.
 *
 * Scope selection uses tappable chips rather than a cycling `SelectRow`: a
 * camera can carry a dozen zones and cycling through them one tap at a time is
 * not a picker.
 */
import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, RADIUS } from '../../theme/tokens.js'
import { SegmentedControl, type SegmentOption } from '../ui/SegmentedControl.js'
import { NumericStepper } from './NumericStepper.js'
import { useZoneRefs } from '../../data/use-zones.js'
import {
  NC_OCCUPANCY_OP_VALUES,
  NC_OCCUPANCY_SUSTAIN_MAX_SEC,
  NC_OCCUPANCY_SUSTAIN_MIN_SEC,
  occupancyClassChoices,
  occupancyCountLabelKey,
  occupancyOrDefaults,
  occupancySustainIsInstant,
  occupancyZoneChoices,
  parseOccupancyOp,
  patchOccupancy,
  type NcOccupancyChoice,
  type NcOccupancyPatch,
} from './occupancy-condition.js'
import type { NcOccupancyCondition, NcTaxonomy } from '../../data/notification-center.js'

interface OccupancyFieldProps {
  /** The rule's selected cameras — the zones are the union of THEIR zones. */
  readonly deviceIds: readonly number[]
  /** Server class/label vocabulary; absent → no class scope offered. */
  readonly taxonomy: NcTaxonomy | undefined
  readonly value: NcOccupancyCondition | undefined
  readonly onChange: (next: NcOccupancyCondition | undefined) => void
}

export function OccupancyField({ deviceIds, taxonomy, value, onChange }: OccupancyFieldProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const zonesQuery = useZoneRefs(deviceIds)
  const current = occupancyOrDefaults(value)
  const patch = (next: NcOccupancyPatch): void => onChange(patchOccupancy(value, next))

  const { choices: zoneChoices, unknownZoneId } = occupancyZoneChoices(
    zonesQuery.data ?? [],
    current.zoneId,
  )
  const { choices: classChoices, unknownClassName } = occupancyClassChoices(
    taxonomy,
    current.className,
  )

  const opOptions: readonly SegmentOption<string>[] = NC_OCCUPANCY_OP_VALUES.map((op) => ({
    value: op,
    label: t(`v2.nc.rules.editor.occupancy.op.${op}`),
  }))

  return (
    <View style={{ gap: SPACING.lg }}>
      <ScopePicker
        label={t('v2.nc.rules.editor.occupancy.zoneLabel')}
        anyLabel={t('v2.nc.rules.editor.occupancy.wholeFrame')}
        emptyHint={
          deviceIds.length === 0
            ? t('v2.nc.rules.editor.occupancy.zonesNeedCamera')
            : zonesQuery.isLoading
              ? t('v2.nc.rules.editor.occupancy.zonesLoading')
              : t('v2.nc.rules.editor.occupancy.zonesNone')
        }
        choices={zoneChoices}
        selected={current.zoneId}
        onSelect={(next) => patch({ zoneId: next })}
      />
      {unknownZoneId !== undefined ? (
        <Text style={{ color: colors.warning, fontSize: 11, lineHeight: 15 }}>
          {t('v2.nc.rules.editor.occupancy.zoneMissing', { id: unknownZoneId })}
        </Text>
      ) : null}

      <ScopePicker
        label={t('v2.nc.rules.editor.occupancy.classLabel')}
        anyLabel={t('v2.nc.rules.editor.occupancy.anyClass')}
        emptyHint={t('v2.nc.rules.editor.occupancy.classesNone')}
        choices={classChoices}
        selected={current.className}
        onSelect={(next) => patch({ className: next })}
      />
      {unknownClassName !== undefined ? (
        <Text style={{ color: colors.warning, fontSize: 11, lineHeight: 15 }}>
          {t('v2.nc.rules.editor.occupancy.classMissing', { name: unknownClassName })}
        </Text>
      ) : null}

      <View style={{ gap: SPACING.sm }}>
        <FieldLabel text={t('v2.nc.rules.editor.occupancy.opLabel')} />
        <SegmentedControl<string>
          options={opOptions}
          value={current.op}
          onChange={(next) => {
            const op = parseOccupancyOp(next)
            if (op !== undefined) patch({ op })
          }}
        />
      </View>

      <View style={{ gap: SPACING.sm }}>
        <FieldLabel
          text={t(`v2.nc.rules.editor.occupancy.${occupancyCountLabelKey(current.op)}Label`)}
        />
        <NumericStepper
          value={current.count}
          min={0}
          step={1}
          decimals={0}
          clearable={false}
          onChange={(next) => patch({ count: next ?? 0 })}
        />
      </View>

      <View style={{ gap: SPACING.sm }}>
        <FieldLabel text={t('v2.nc.rules.editor.occupancy.sustainLabel')} />
        <NumericStepper
          value={current.sustainSeconds}
          min={NC_OCCUPANCY_SUSTAIN_MIN_SEC}
          max={NC_OCCUPANCY_SUSTAIN_MAX_SEC}
          step={5}
          decimals={0}
          clearable={false}
          onChange={(next) => patch({ sustainSeconds: next ?? 0 })}
        />
        {occupancySustainIsInstant(value) ? (
          <Text style={{ color: colors.warning, fontSize: 11, lineHeight: 15 }}>
            {t('v2.nc.rules.editor.occupancy.sustainInstantHint')}
          </Text>
        ) : null}
      </View>

      <Text style={{ color: colors.foregroundSubtle, fontSize: 11, lineHeight: 15 }}>
        {t('v2.nc.rules.editor.occupancy.hint')}
      </Text>

      {value !== undefined ? (
        <Pressable accessibilityRole="button" onPress={() => onChange(undefined)} hitSlop={6}>
          <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>
            {t('v2.nc.rules.editor.clear')}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

interface ScopePickerProps {
  readonly label: string
  /** The "no scope" chip — whole frame / any class. Always offered first. */
  readonly anyLabel: string
  readonly emptyHint: string
  readonly choices: readonly NcOccupancyChoice[]
  readonly selected: string | undefined
  readonly onSelect: (next: string | undefined) => void
}

/** Single-choice chip row: the unscoped option, then the catalogue, then any
 *  stored value the catalogue does not know (marked, and removable by picking
 *  something else). */
function ScopePicker({ label, anyLabel, emptyHint, choices, selected, onSelect }: ScopePickerProps) {
  const { colors } = useTheme()

  const chip = (
    key: string,
    text: string,
    on: boolean,
    unknown: boolean,
    onPress: () => void,
  ): React.ReactNode => (
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
        borderStyle: unknown ? 'dashed' : 'solid',
        borderColor: unknown ? colors.warning : on ? colors.primary : colors.border,
        backgroundColor: on ? `${colors.primary}1f` : colors.background,
      }}
    >
      <Text
        style={{
          color: unknown ? colors.warning : on ? colors.primary : colors.foreground,
          fontSize: 13,
        }}
      >
        {text}
      </Text>
      {on && unknown ? <X size={12} color={colors.warning} /> : null}
    </Pressable>
  )

  return (
    <View style={{ gap: SPACING.sm }}>
      <FieldLabel text={label} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm }}>
        {chip('__any__', anyLabel, selected === undefined, false, () => onSelect(undefined))}
        {choices.map((choice) =>
          chip(choice.value, choice.label, selected === choice.value, choice.unknown, () =>
            onSelect(selected === choice.value ? undefined : choice.value),
          ),
        )}
      </View>
      {choices.length === 0 ? <Hint text={emptyHint} /> : null}
    </View>
  )
}

function FieldLabel({ text }: { readonly text: string }) {
  const { colors } = useTheme()
  return (
    <Text style={{ color: colors.foregroundSubtle, fontSize: 12, fontWeight: '600' }}>{text}</Text>
  )
}

function Hint({ text }: { readonly text: string }) {
  const { colors } = useTheme()
  return <Text style={{ color: colors.foregroundSubtle, fontSize: 12, lineHeight: 16 }}>{text}</Text>
}
