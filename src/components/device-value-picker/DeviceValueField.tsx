/**
 * A field holding device(s) or device values (issue #496): the picked ones as
 * removable chips — the first five, then "+N" — and Add / Edit opening the
 * {@link DeviceValueSheet}.
 *
 * Each chip is resolved by `deviceManager.search({ ids })`: "Name › value ·
 * reading", "(offline)" when the hub says so, and "Device #id not found" ONLY
 * when the answered resolve lists the id as missing (D315). Until then a chip
 * reads "Device #id". Every chip is removable, a gone one included (D49).
 */
import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Plus, X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY, withAlpha } from '../../theme/tokens.js'
import { emptyDevicesWidens } from '../notifications/device-selection.js'
import { PickerLine } from '../notifications/ItemPicker.js'
import {
  describePicked,
  indexResolved,
  removeValue,
  splitChips,
  valueKey,
  type PickedDescription,
  type PickedValue,
} from './device-value-picker-model.js'
import { DeviceValueSheet, type DeviceValueAsk } from './DeviceValueSheet.js'
import { useResolvedDevices } from './use-device-search.js'

const UI = 'v2.deviceValuePicker'

export interface DeviceValueFieldProps extends DeviceValueAsk {
  readonly value: readonly PickedValue[]
  readonly onChange: (next: readonly PickedValue[]) => void
  /** One pick replaces the value; default: several. */
  readonly multiple?: boolean
  /** The sheet's title; default: the capability's name. */
  readonly title?: string
  /** What an empty field reads as. */
  readonly emptyLabel?: string
  /** Empty means ALL (a rule's devices, a system filter): emptying a non-empty field warns. */
  readonly emptyMeansAll?: boolean
  /** Whether the SAVED value held devices — the widening warning survives a remount. */
  readonly savedHadValues?: boolean
  readonly widensLabel?: string
  readonly disabled?: boolean
  readonly testID?: string
}

/** A chip's words. */
function chipLabel(
  d: PickedDescription,
  t: (key: string, o?: Record<string, unknown>) => string,
  withReading: boolean,
): string {
  if (d.status === 'gone') return t(`${UI}.gone`, { id: d.deviceId })
  const name = d.deviceName ?? t(`${UI}.deviceId`, { id: d.deviceId })
  const value = d.valueName !== null ? `${name} › ${d.valueName}` : name
  const reading = withReading && d.reading !== null ? `${value} · ${d.reading}` : value
  return d.status === 'offline' ? `${reading} (${t(`${UI}.offline`)})` : reading
}

export function DeviceValueField({
  value,
  onChange,
  multiple = true,
  title,
  emptyLabel,
  emptyMeansAll = false,
  savedHadValues = false,
  widensLabel,
  disabled = false,
  testID,
  ...ask
}: DeviceValueFieldProps): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [hadValues, setHadValues] = useState(savedHadValues || value.length > 0)
  if ((value.length > 0 || savedHadValues) && !hadValues) setHadValues(true)

  const resolved = useResolvedDevices(
    value.map((v) => v.deviceId),
    ask.requires,
  )
  const { byId, missing } = indexResolved(resolved.result)
  const all = value.map((v) => ({ value: v, description: describePicked(v, byId.get(v.deviceId), missing) }))
  const { shown, hidden } = expanded ? { shown: all, hidden: 0 } : splitChips(all)
  const widening = emptyDevicesWidens(emptyMeansAll, value.length, hadValues)
  const empty = emptyLabel ?? t(emptyMeansAll ? 'v2.nc.devicePicker.everyDevice' : 'v2.nc.devicePicker.none')

  return (
    <View style={styles.root} testID={testID}>
      {resolved.isError ? <PickerLine text={t(`${UI}.resolveFailed`)} warning /> : null}
      <View style={styles.chips}>
        {all.length === 0 ? <PickerLine text={empty} /> : null}
        {shown.map((chip) => (
          <Chip
            key={valueKey(chip.value)}
            testID={`dvp-chip-${String(chip.value.deviceId)}`}
            label={chipLabel(chip.description, t, ask.kind === 'value')}
            warning={chip.description.status === 'gone'}
            disabled={disabled}
            onRemove={() => onChange(removeValue(value, chip.value))}
          />
        ))}
        {hidden > 0 ? (
          <SmallButton
            testID="dvp-chips-more"
            label={t(`${UI}.moreChips`, { count: hidden })}
            onPress={() => setExpanded(true)}
          />
        ) : null}
        <SmallButton
          testID="dvp-add"
          label={t(value.length === 0 ? 'v2.nc.devicePicker.add' : 'v2.nc.devicePicker.edit')}
          onPress={() => setOpen(true)}
          disabled={disabled}
          dashed
        />
      </View>
      {widening ? <PickerLine text={widensLabel ?? t('v2.nc.rules.editor.devicesEmptyWidens')} warning /> : null}
      {open ? (
        <DeviceValueSheet
          {...ask}
          {...(title !== undefined ? { title } : {})}
          multiple={multiple}
          value={value}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </View>
  )
}

interface ChipProps {
  readonly label: string
  readonly warning: boolean
  readonly disabled: boolean
  readonly onRemove: () => void
  readonly testID: string
}

/** A picked device or value: tap to remove. A gone one is drawn in the warning colour. */
function Chip({ label, warning, disabled, onRemove, testID }: ChipProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const tone = warning ? colors.warning : colors.primary
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('v2.nc.devicePicker.remove', { name: label })}
      disabled={disabled}
      onPress={onRemove}
      style={[styles.chip, { backgroundColor: withAlpha(tone, 0.12) }]}
    >
      <Text numberOfLines={1} style={[styles.chipText, { color: tone }]}>
        {label}
      </Text>
      {!disabled ? <X size={12} color={tone} /> : null}
    </Pressable>
  )
}

interface SmallButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly disabled?: boolean
  readonly dashed?: boolean
  readonly testID: string
}

function SmallButton({ label, onPress, disabled = false, dashed = false, testID }: SmallButtonProps): React.JSX.Element {
  const { colors } = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        { borderStyle: dashed ? 'dashed' : 'solid', borderColor: colors.border, opacity: disabled ? 0.4 : 1 },
      ]}
    >
      {dashed ? <Plus size={12} color={colors.foreground} /> : null}
      <Text style={[styles.chipText, { color: colors.foreground }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    maxWidth: '100%',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.md,
  },
  chipText: { fontSize: TYPOGRAPHY.size.sm + 1, flexShrink: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs },
  root: { gap: SPACING.sm },
})
