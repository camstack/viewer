/**
 * ItemPicker — the picker's RENDER half over a GIVEN list (D636, D637): the
 * selection as removable chips — EVERY one of them, never folded behind a
 * "+N more / Show fewer" toggle (operator, 2026-09-26: "always show them all,
 * there is enough space"; the shared model's `chipOverflow` is not used
 * here) — the widening warning, and the searchable grouped sheet (`DevicePickerSheet`)
 * opened only to change it.
 *
 * It reads nothing. The caller hands it the list (`items`, with whether it
 * answered) and its verdict on every selected id the list does not hold
 * (`judged`, from `offListSelections` — D315 lives there, not here). It is
 * generic over the id: `DevicePicker` is `ItemPicker<number>` over its
 * sources, and the system family's node and package pickers
 * (`ScopePickers.tsx`) are `ItemPicker<string>`.
 *
 * A chip is the list's name for the id; otherwise the caller's verdict —
 * `removedLabel(id)` when an answered list lacks it, else the name the verdict
 * found or `unknownLabel(id)`. Every chip is removable (D49).
 */
import React, { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Plus, X } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import type { PickerGroup, PickerId, PickerItem } from './device-picker-model.js'
import {
  emptyDevicesWidens,
  type DeviceListState,
  type SelectedDeviceRow,
} from './device-selection.js'
import { DevicePickerSheet, type PickerGroupingControl } from './DevicePickerSheet.js'

const UI = 'v2.nc.rules.editor'
const PICKER = 'v2.nc.devicePicker'

export interface ItemPickerProps<Id extends PickerId> {
  /** The list the sheet draws; undefined while it has not answered. */
  readonly items: readonly PickerItem<Id>[] | undefined
  readonly state: DeviceListState
  /** The verdict on every selected id `items` does not hold. */
  readonly judged: readonly SelectedDeviceRow<Id>[]
  readonly value: readonly Id[]
  readonly onChange: (next: Id[]) => void
  /** Empty means ALL (a rule's devices, a system filter). */
  readonly emptyMeansAll?: boolean
  /** Whether the SAVED rule had a selection here — the widening warning survives a remount. */
  readonly savedHadDevices?: boolean
  /** What an empty selection reads as. */
  readonly emptyLabel?: string
  /** The sheet's title. */
  readonly title?: string
  readonly disabled?: boolean
  readonly testID?: string
  /** A selected id an ANSWERED list lacks. */
  readonly removedLabel: (id: Id) => string
  /** A selected id nothing could name. */
  readonly unknownLabel: (id: Id) => string
  /** A sheet group header's text; the default is "<type> · <room>". */
  readonly groupTitle?: (group: PickerGroup<Id>) => string
  /** The widening warning's text; the default speaks of cameras. */
  readonly widensLabel?: string
  /** What the sheet says when the list FAILED; the default speaks of cameras. */
  readonly unavailableLabel?: string
  /** The sheet's search placeholder; the default speaks of devices. */
  readonly searchLabel?: string
  /** What the sheet says when a search matches nothing; the default speaks of devices. */
  readonly noMatchesLabel?: string
  /** A warning line above the chips (a failed list). */
  readonly notice?: string
  /** Told when the sheet opens or closes — a source read only while open. */
  readonly onOpenChange?: (open: boolean) => void
  /** The sheet's "Group by" — the device picker only (`DevicePicker`). */
  readonly grouping?: PickerGroupingControl
  /** Exactly one choice: a tap in the sheet replaces the value and closes it; chips are not removable. */
  readonly single?: boolean
}

/** One selected id as a chip. */
interface PickerChip<Id extends PickerId> {
  readonly id: Id
  readonly label: string
  readonly removed: boolean
}

export function ItemPicker<Id extends PickerId>({
  items,
  state,
  judged,
  value,
  onChange,
  emptyMeansAll = false,
  savedHadDevices = false,
  emptyLabel,
  title,
  disabled = false,
  testID,
  removedLabel,
  unknownLabel,
  groupTitle,
  widensLabel,
  unavailableLabel,
  searchLabel,
  noMatchesLabel,
  notice,
  onOpenChange,
  grouping,
  single = false,
}: ItemPickerProps<Id>): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpenState] = useState(false)
  const [hadDevices, setHadDevices] = useState(savedHadDevices || value.length > 0)
  if ((value.length > 0 || savedHadDevices) && !hadDevices) setHadDevices(true)

  const setOpen = (next: boolean): void => {
    setOpenState(next)
    onOpenChange?.(next)
  }

  const listed = state === 'answered' ? items : undefined
  const byId = new Map((listed ?? []).map((item) => [item.id, item.name]))
  const judgedById = new Map(judged.map((row) => [row.id, row]))
  const chips: readonly PickerChip<Id>[] = value.map((id) => {
    const name = byId.get(id)
    if (name !== undefined) return { id, label: name, removed: false }
    const row = judgedById.get(id) ?? { id, removed: false }
    if (row.removed) return { id, label: removedLabel(id), removed: true }
    return { id, label: row.name ?? unknownLabel(id), removed: false }
  })
  const widening = emptyDevicesWidens(emptyMeansAll, value.length, hadDevices)

  const remove = (id: Id): void => onChange(value.filter((v) => v !== id))
  const empty = emptyLabel ?? t(emptyMeansAll ? `${PICKER}.everyDevice` : `${PICKER}.none`)

  return (
    <View style={{ gap: SPACING.sm }} testID={testID}>
      {notice !== undefined ? <PickerLine text={notice} warning /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs }}>
        {chips.length === 0 ? <PickerLine text={empty} /> : null}
        {chips.map((chip) => (
          <Chip
            key={String(chip.id)}
            chip={chip}
            disabled={disabled || single}
            onRemove={() => remove(chip.id)}
          />
        ))}
        <SmallButton
          testID="device-picker-add"
          label={t(value.length === 0 ? `${PICKER}.add` : `${PICKER}.edit`)}
          onPress={() => setOpen(true)}
          disabled={disabled}
          icon
        />
      </View>
      {widening ? <PickerLine text={widensLabel ?? t(`${UI}.devicesEmptyWidens`)} warning /> : null}
      {open ? (
        <DevicePickerSheet<Id>
          title={title ?? t(`${PICKER}.title`)}
          devices={items}
          state={state}
          value={value}
          onChange={onChange}
          {...(groupTitle !== undefined ? { groupTitle } : {})}
          {...(unavailableLabel !== undefined ? { unavailableLabel } : {})}
          {...(searchLabel !== undefined ? { searchLabel } : {})}
          {...(noMatchesLabel !== undefined ? { noMatchesLabel } : {})}
          {...(grouping !== undefined ? { grouping } : {})}
          single={single}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </View>
  )
}

interface ChipProps<Id extends PickerId> {
  readonly chip: PickerChip<Id>
  readonly disabled: boolean
  readonly onRemove: () => void
}

/** A selected item: tap to remove. A removed item is drawn in warning colour. */
function Chip<Id extends PickerId>({ chip, disabled, onRemove }: ChipProps<Id>) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const tone = chip.removed ? colors.warning : colors.primary
  return (
    <Pressable
      testID={`picker-chip-${String(chip.id)}`}
      accessibilityRole="button"
      accessibilityLabel={t(`${PICKER}.remove`, { name: chip.label })}
      disabled={disabled}
      onPress={onRemove}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        maxWidth: '100%',
        paddingHorizontal: SPACING.sm,
        paddingVertical: SPACING.xs,
        borderRadius: RADIUS.md,
        backgroundColor: `${tone}1f`,
      }}
    >
      <Text numberOfLines={1} style={{ color: tone, fontSize: 13, flexShrink: 1 }}>
        {chip.label}
      </Text>
      {!disabled ? <X size={12} color={tone} /> : null}
    </Pressable>
  )
}

interface SmallButtonProps {
  readonly label: string
  readonly onPress: () => void
  readonly disabled?: boolean
  readonly icon?: boolean
  readonly testID?: string
}

function SmallButton({ label, onPress, disabled = false, icon = false, testID }: SmallButtonProps) {
  const { colors } = useTheme()
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: SPACING.sm,
        paddingVertical: SPACING.xs,
        borderRadius: RADIUS.md,
        borderWidth: 1,
        borderStyle: icon ? 'dashed' : 'solid',
        borderColor: colors.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon ? <Plus size={12} color={colors.foreground} /> : null}
      <Text style={{ color: colors.foreground, fontSize: 13 }}>{label}</Text>
    </Pressable>
  )
}

export interface PickerLineProps {
  readonly text: string
  readonly warning?: boolean
}

/** A one-line hint or warning under or beside a picker. */
export function PickerLine({ text, warning }: PickerLineProps) {
  const { colors } = useTheme()
  return (
    <Text
      style={{
        color: warning ? colors.warning : colors.foregroundSubtle,
        fontSize: 12,
        lineHeight: 16,
      }}
    >
      {text}
    </Text>
  )
}
