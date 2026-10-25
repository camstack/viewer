/**
 * DevicePickerSheet — the searchable, grouped, VIRTUALISED list the device
 * picker opens (`DevicePicker.tsx`, D636).
 *
 * Built for hundreds of devices of one type (a fleet of HA sensors): the
 * search is debounced, groups are (type, room) and big ones start collapsed
 * with a count and select-all / clear, and the rows are ONE `FlatList` with a
 * fixed row height (`getItemLayout`) and a render window of `PICKER_WINDOW` —
 * a 500-device list never mounts 500 rows. Every decision is
 * `device-picker-model.ts`, shared byte-for-byte with the admin UI.
 *
 * The search, the Type / Zone / Location chips and "Reset filters" are
 * `DeviceFilterBar` (D697); the sheet holds the `PickerFilters` (clean each
 * time it opens) and applies them. A selected device the filters hide is
 * counted in a line below the list, never dropped.
 *
 * A tap moves the value at once (the editor it sits in has its own Save);
 * "Done" only closes.
 *
 * Generic over the id since D637: the system family's node and package
 * pickers (`ScopePickers.tsx`) open this same sheet over string ids, with
 * their own group titles (`groupTitle`).
 *
 * "Group by" (Zone | Location | None) is the DEVICE picker's only: given a
 * {@link PickerGroupingControl}, the sheet draws the control at its top and
 * groups by site zone, location or nothing (`groupPickerDevicesBy`); without
 * one it keeps the (type, room) groups the node and package pickers use. A
 * zone read that has not answered groups by location with a one-line note —
 * never "No zone" from a read that did not answer (D315).
 */
import React, { useCallback, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Check, ChevronDown, ChevronRight } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { PickerSheet, PickerSheetButton } from '../ui/PickerSheet.js'
import { DeviceFilterBar } from './DeviceFilterBar.js'
import {
  clearPickerGroup,
  applyPickerFilters,
  flattenPickerGrouping,
  flattenPickerRows,
  groupPickerDevices,
  groupPickerDevicesBy,
  PICKER_NO_FILTERS,
  PICKER_WINDOW,
  pickerFacetOptions,
  pickerHiddenSelectedCount,
  pickerQueryTokens,
  pickerRowFacts,
  selectPickerGroup,
  togglePickerDevice,
  type PickerGroup,
  type PickerFilters,
  type PickerGroupBy,
  type PickerGroupHeading,
  type PickerGrouping,
  type PickerId,
  type PickerItem,
  type PickerRow,
  type PickerZonesRead,
} from './device-picker-model.js'
import { pickSingle } from './single-pick.js'
import type { DeviceListState } from './device-selection.js'

const UI = 'v2.nc.devicePicker'

/** An answered read with no zones: what the pickers without "Group by" are judged against. */
const NO_ZONES: PickerZonesRead = { state: 'answered', zones: [] }

/** Every row — header or device — is this tall, so the list can skip measuring. */
export const PICKER_ROW_HEIGHT = 48

/** The device picker's "Group by": the chosen mode, how to change it, and the zone read. */
export interface PickerGroupingControl {
  readonly groupBy: PickerGroupBy
  readonly onGroupByChange: (next: PickerGroupBy) => void
  readonly zones: PickerZonesRead
}

export interface DevicePickerSheetProps<Id extends PickerId = number> {
  readonly title: string
  /** The list, once answered; undefined while it is not. */
  readonly devices: readonly PickerItem<Id>[] | undefined
  readonly state: DeviceListState
  readonly value: readonly Id[]
  readonly onChange: (next: Id[]) => void
  /** A group header's text; the default is "<type> · <room>". */
  readonly groupTitle?: (group: PickerGroup<Id>) => string
  /** What a FAILED list says; the default speaks of cameras. */
  readonly unavailableLabel?: string
  /** The search field's placeholder; the default speaks of devices. */
  readonly searchLabel?: string
  /** What a search that matches nothing says; the default speaks of devices. */
  readonly noMatchesLabel?: string
  /** "Group by" — the device picker only; absent keeps the (type, room) groups. */
  readonly grouping?: PickerGroupingControl
  /** Pick exactly one: a tap replaces the value and closes the sheet; no per-group select/clear. */
  readonly single?: boolean
  readonly onClose: () => void
}

/** Where a row sits — every row is {@link PICKER_ROW_HEIGHT} tall. */
interface PickerRowLayout {
  readonly length: number
  readonly offset: number
  readonly index: number
}

/** What `FlatList` hands `renderItem`. */
interface PickerRenderInfo<Id extends PickerId> {
  readonly item: PickerRow<Id>
}

function rowLayout<Id extends PickerId>(
  _data: ArrayLike<PickerRow<Id>> | null | undefined,
  index: number,
): PickerRowLayout {
  return { length: PICKER_ROW_HEIGHT, offset: PICKER_ROW_HEIGHT * index, index }
}

export function DevicePickerSheet<Id extends PickerId = number>({
  title,
  devices,
  state,
  value,
  onChange,
  groupTitle,
  unavailableLabel,
  searchLabel,
  noMatchesLabel,
  grouping,
  single = false,
  onClose,
}: DevicePickerSheetProps<Id>): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // The sheet is mounted only while open, so the filters start clean each time.
  const [filters, setFilters] = useState<PickerFilters>(PICKER_NO_FILTERS)
  const [toggles, setToggles] = useState<ReadonlyMap<string, boolean>>(new Map())
  const searching = pickerQueryTokens(filters.query).length > 0
  const groupBy = grouping?.groupBy
  // The node and package pickers have no zones, and their `location` is a
  // liveness, not a place: they are judged against an answered, empty read so
  // Zone and Location draw nothing for them.
  const zones: PickerZonesRead = grouping?.zones ?? NO_ZONES
  const list = useMemo((): readonly PickerItem<Id>[] => devices ?? [], [devices])
  const matches = useMemo(() => applyPickerFilters(list, filters, zones), [list, filters, zones])
  const grouped = useMemo(
    (): PickerGrouping<Id> | null =>
      groupBy !== undefined ? groupPickerDevicesBy(matches, value, groupBy, zones) : null,
    [matches, value, groupBy, zones],
  )
  const typeOptions = useMemo(
    () => pickerFacetOptions(list, 'type', filters.types, zones),
    [list, filters.types, zones],
  )
  const zoneOptions = useMemo(
    () => pickerFacetOptions(list, 'zone', filters.zones, zones),
    [list, filters.zones, zones],
  )
  const locationOptions = useMemo(
    () => (grouping === undefined ? [] : pickerFacetOptions(list, 'location', filters.locations, zones)),
    [list, filters.locations, zones, grouping],
  )
  const hiddenSelected = useMemo(
    () => pickerHiddenSelectedCount(value, list, matches),
    [list, value, matches],
  )
  const rows = useMemo(
    () =>
      grouped !== null
        ? flattenPickerGrouping(grouped, value, toggles, searching)
        : flattenPickerRows(groupPickerDevices(matches, value), value, toggles, searching),
    [grouped, matches, value, toggles, searching],
  )
  const shownBy = grouped?.groupBy ?? null
  const toggleGroup = useCallback((group: PickerGroup<Id>, expanded: boolean): void => {
    setToggles((current) => new Map([...current, [group.key, !expanded]]))
  }, [])

  const renderItem = useCallback(
    ({ item }: PickerRenderInfo<Id>) =>
      item.kind === 'header' ? (
        <GroupHeader<Id>
          group={item.group}
          expanded={item.expanded}
          {...(groupTitle !== undefined ? { title: groupTitle } : {})}
          onToggle={toggleGroup}
          single={single}
          onSelectAll={() => onChange(selectPickerGroup(value, item.group))}
          onClear={() => onChange(clearPickerGroup(value, item.group))}
        />
      ) : (
        <DeviceRow<Id>
          device={item.device}
          selected={item.selected}
          groupBy={shownBy}
          onPress={() => {
            if (single) {
              onChange(pickSingle(item.device.id))
              onClose()
              return
            }
            onChange(togglePickerDevice(value, item.device.id))
          }}
        />
      ),
    [groupTitle, onChange, onClose, single, toggleGroup, value, shownBy],
  )

  const answered = state === 'answered' && devices !== undefined
  return (
    <PickerSheet
      title={title}
      onClose={onClose}
      testID="device-picker-sheet"
      headerRight={
        <PickerSheetButton onPress={onClose} label={t(`${UI}.done`)} primary>
          <Check size={18} color={colors.primaryForeground} />
        </PickerSheetButton>
      }
    >
      {!answered ? (
        <View style={styles.centered}>
          {state === 'failed' ? (
            <Text style={[styles.hint, { color: colors.warning }]}>
              {unavailableLabel ?? t('v2.nc.rules.editor.devicesUnavailable')}
            </Text>
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
        </View>
      ) : (
        <>
          <DeviceFilterBar
            filters={filters}
            onFiltersChange={setFilters}
            typeOptions={typeOptions}
            zoneOptions={zoneOptions}
            locationOptions={locationOptions}
            zones={zones}
            {...(grouping !== undefined
              ? {
                  grouping: {
                    groupBy: grouping.groupBy,
                    onGroupByChange: grouping.onGroupByChange,
                    fallback: grouped?.fallback ?? null,
                  },
                }
              : {})}
            searchPlaceholder={searchLabel ?? t(`${UI}.search`)}
          />
          <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
            {t(`${UI}.shown`, {
              shown: matches.length,
              total: devices.length,
              selected: value.length,
            })}
          </Text>
          <FlatList<PickerRow<Id>>
            testID="device-picker-list"
            data={rows}
            keyExtractor={(row) => row.key}
            renderItem={renderItem}
            getItemLayout={rowLayout}
            initialNumToRender={PICKER_WINDOW}
            maxToRenderPerBatch={PICKER_WINDOW}
            windowSize={5}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            ListEmptyComponent={
              <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>
                {noMatchesLabel ?? t(`${UI}.noMatches`)}
              </Text>
            }
          />
          {hiddenSelected > 0 ? (
            <Text
              testID="picker-hidden-selected"
              style={[styles.hint, { color: colors.foregroundSubtle }]}
            >
              {t(`${UI}.hiddenSelected`, { count: hiddenSelected })}
            </Text>
          ) : null}
        </>
      )}
    </PickerSheet>
  )
}

interface GroupHeaderProps<Id extends PickerId> {
  readonly group: PickerGroup<Id>
  readonly expanded: boolean
  readonly title?: (group: PickerGroup<Id>) => string
  readonly onToggle: (group: PickerGroup<Id>, expanded: boolean) => void
  /** A single-choice sheet has no bulk select / clear. */
  readonly single: boolean
  readonly onSelectAll: () => void
  readonly onClear: () => void
}

function GroupHeader<Id extends PickerId>({
  group,
  expanded,
  title,
  onToggle,
  single,
  onSelectAll,
  onClear,
}: GroupHeaderProps<Id>) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const text =
    title !== undefined
      ? title(group)
      : group.heading !== undefined
        ? headingText(group.heading, t)
        : `${group.type ?? t(`${UI}.noType`)} · ${group.location ?? t(`${UI}.noRoom`)}`
  const Chevron = expanded ? ChevronDown : ChevronRight
  return (
    <View
      testID={`device-picker-group-${group.key}`}
      style={[styles.row, { borderBottomColor: colors.borderSubtle, backgroundColor: colors.surface }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={text}
        onPress={() => onToggle(group, expanded)}
        style={styles.headerToggle}
      >
        <Chevron size={16} color={colors.foregroundSubtle} />
        <Text numberOfLines={1} style={[styles.headerText, { color: colors.foreground }]}>
          {text}
        </Text>
        <Text style={[styles.count, { color: colors.foregroundSubtle }]}>
          {`${String(group.selectedCount)}/${String(group.devices.length)}`}
        </Text>
      </Pressable>
      {single ? null : (
        <>
          <Pressable accessibilityRole="button" onPress={onSelectAll} hitSlop={6}>
            <Text style={[styles.action, { color: colors.primary }]}>{t(`${UI}.selectAll`)}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onClear} hitSlop={6}>
            <Text style={[styles.action, { color: colors.foregroundSubtle }]}>{t(`${UI}.clear`)}</Text>
          </Pressable>
        </>
      )}
    </View>
  )
}

interface DeviceRowProps<Id extends PickerId> {
  readonly device: PickerItem<Id>
  readonly selected: boolean
  /** The "Group by" mode the list is drawn in; null for (type, room) groups. */
  readonly groupBy: PickerGroupBy | null
  readonly onPress: () => void
}

/** The second line: under "Group by" the room (where the header lacks it) and type, then the container. */
function secondLine<Id extends PickerId>(
  device: PickerItem<Id>,
  groupBy: PickerGroupBy | null,
): string | undefined {
  if (groupBy === null) return device.detail
  const facts = pickerRowFacts(device, groupBy)
  const parts = [facts.location, facts.type, device.detail ?? null].filter(
    (part): part is string => part !== null,
  )
  return parts.length > 0 ? parts.join(' · ') : undefined
}

function DeviceRow<Id extends PickerId>({
  device,
  selected,
  groupBy,
  onPress,
}: DeviceRowProps<Id>) {
  const { colors } = useTheme()
  const second = secondLine(device, groupBy)
  return (
    <Pressable
      testID={`device-picker-row-${String(device.id)}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={device.name}
      onPress={onPress}
      style={[
        styles.row,
        {
          borderBottomColor: colors.borderSubtle,
          backgroundColor: selected ? `${colors.primary}14` : 'transparent',
        },
      ]}
    >
      <View
        style={[
          styles.box,
          {
            borderColor: selected ? colors.primary : colors.border,
            backgroundColor: selected ? colors.primary : 'transparent',
          },
        ]}
      >
        {selected ? <Check size={12} color={colors.primaryForeground} /> : null}
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 14 }}>
          {device.name}
        </Text>
        {second !== undefined ? (
          <Text
            numberOfLines={1}
            style={{ color: colors.foregroundSubtle, fontSize: 11 }}
          >
            {second}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

type Translate = ReturnType<typeof useTranslation>['t']

function headingText(heading: PickerGroupHeading, t: Translate): string {
  switch (heading.kind) {
    case 'zone':
    case 'location':
      return heading.label
    case 'no-zone':
      return t(`${UI}.groupBy.noZone`)
    case 'no-location':
      return t(`${UI}.groupBy.noLocation`)
  }
}

const styles = StyleSheet.create({
  action: { fontSize: 12, fontWeight: '600', paddingHorizontal: SPACING.xs },
  box: {
    width: 18,
    height: 18,
    borderRadius: RADIUS.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: { paddingVertical: SPACING['2xl'] * 2, alignItems: 'center', justifyContent: 'center' },
  count: { fontSize: 12 },
  headerText: { flex: 1, fontSize: 13, fontWeight: '600' },
  headerToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  hint: { fontSize: 12, lineHeight: 17, paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm },
  row: {
    height: PICKER_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
  },
  rowText: { flex: 1, justifyContent: 'center' },
})
