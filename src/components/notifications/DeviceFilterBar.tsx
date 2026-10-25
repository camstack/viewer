/**
 * DeviceFilterBar — the controls above a picker sheet's list (D697): the
 * search field, "Group by" (when the list offers it), the Type / Zone /
 * Location chips and "Reset filters".
 *
 * It owns no filter state: the sheet holds `PickerFilters` and applies them
 * (`applyPickerFilters`); this only draws the controls and reports changes.
 * The search box keeps its own text so typing is instant and tells the sheet
 * `PICKER_SEARCH_DEBOUNCE_MS` after the last keystroke. The decisions — which
 * chip is drawn, when the zone filter is paused, what Reset clears — are
 * `device-picker-model.ts`, shared with the admin UI.
 *
 * The Zone and Location chips are provisional (operator answer Q1): to drop
 * them, delete the two chip uses below and their option props.
 *
 *  - D315: a zones read that has not answered draws the Zone chip DISABLED
 *    ("Loading zones…" / "Zones unavailable"), never empty, and a chosen zone
 *    is reported as paused, not as matching nothing.
 *  - "Reset filters" clears search, Type, Zone and Location and leaves the
 *    Group-by choice alone.
 */
import React, { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { Check, Search } from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../theme/tokens.js'
import { AnchoredMenu } from '../ui/AnchoredMenu.js'
import { FilterChip } from '../ui/FilterChip.js'
import { SegmentedControl, type SegmentOption } from '../ui/SegmentedControl.js'
import type { AnchorRect } from '../ui/dropdown-placement.js'
import {
  PICKER_GROUP_BY_MODES,
  PICKER_NONE_KEY,
  PICKER_SEARCH_DEBOUNCE_MS,
  pickerFacetFilterShown,
  pickerFiltersActive,
  pickerZoneFilterSuspended,
  resetPickerFilters,
  togglePickerKey,
  type PickerFacet,
  type PickerFacetOption,
  type PickerFilters,
  type PickerGroupBy,
  type PickerZonesFallback,
  type PickerZonesRead,
} from './device-picker-model.js'
import { deviceTypeLabel, deviceTypeLabelKey } from './rule-editor.js'

const UI = 'v2.nc.devicePicker'

export interface DeviceFilterBarGrouping {
  readonly groupBy: PickerGroupBy
  readonly onGroupByChange: (next: PickerGroupBy) => void
  /** Set when Zone mode is showing locations because the zones had not answered. */
  readonly fallback?: PickerZonesFallback | null
}

export interface DeviceFilterBarProps {
  readonly filters: PickerFilters
  readonly onFiltersChange: (next: PickerFilters) => void
  readonly typeOptions: readonly PickerFacetOption[]
  readonly zoneOptions: readonly PickerFacetOption[]
  readonly locationOptions: readonly PickerFacetOption[]
  /** The zones read — decides whether the Zone chip is enabled and what it says. */
  readonly zones: PickerZonesRead
  readonly grouping?: DeviceFilterBarGrouping
  readonly searchPlaceholder: string
  readonly disabled?: boolean
}

type Translate = ReturnType<typeof useTranslation>['t']

function optionLabel(facet: PickerFacet, option: PickerFacetOption, t: Translate): string {
  if (option.key === PICKER_NONE_KEY || option.label === null) {
    return t(`${UI}.filter.${facet === 'type' ? 'noType' : facet === 'zone' ? 'noZone' : 'noLocation'}`)
  }
  return facet === 'type'
    ? t(deviceTypeLabelKey(option.label), { defaultValue: deviceTypeLabel(option.label) })
    : option.label
}

/** What the Zone chip says while the read has not answered, or null once it has. */
function zoneUnavailable(zones: PickerZonesRead, t: Translate): string | null {
  if (zones.state === 'pending') return t(`${UI}.filter.zonesLoading`)
  if (zones.state === 'failed') return t(`${UI}.filter.zonesUnavailable`)
  return null
}

interface GroupByControlProps {
  readonly grouping: DeviceFilterBarGrouping
}

/** "Group by: Zone | Location | None", and why Zone is showing locations. */
function GroupByControl({ grouping }: GroupByControlProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const options: readonly SegmentOption<PickerGroupBy>[] = PICKER_GROUP_BY_MODES.map((mode) => ({
    value: mode,
    label: t(`${UI}.groupBy.${mode}`),
  }))
  const fallback = grouping.fallback ?? null
  return (
    <View style={styles.groupBy} testID="device-picker-grouping">
      <Text style={[styles.groupByLabel, { color: colors.foregroundSubtle }]}>
        {t(`${UI}.groupBy.label`)}
      </Text>
      <SegmentedControl<PickerGroupBy>
        options={options}
        value={grouping.groupBy}
        onChange={grouping.onGroupByChange}
      />
      {fallback !== null ? (
        <Text style={[styles.note, { color: colors.foregroundSubtle }]}>
          {t(fallback === 'pending' ? `${UI}.groupBy.zonesPending` : `${UI}.groupBy.zonesUnavailable`)}
        </Text>
      ) : null}
    </View>
  )
}

interface FacetChipProps {
  readonly facet: PickerFacet
  readonly chosen: readonly string[]
  /** Why the chip cannot be used (the zones read), shown as its value. */
  readonly unavailable: string | null
  readonly disabled: boolean
  readonly onOpen: (facet: PickerFacet, ref: React.RefObject<View | null>) => void
}

function FacetChip({ facet, chosen, unavailable, disabled, onOpen }: FacetChipProps) {
  const { t } = useTranslation()
  const ref = useRef<View>(null)
  const value =
    unavailable ??
    (chosen.length === 0 ? t(`${UI}.filter.all`) : t(`${UI}.filter.selected`, { count: chosen.length }))
  return (
    <View testID={`picker-filter-${facet}`}>
      <FilterChip
        anchorRef={ref}
        label={t(`${UI}.filter.${facet}`)}
        value={value}
        active={chosen.length > 0}
        disabled={disabled || unavailable !== null}
        onPress={() => onOpen(facet, ref)}
      />
    </View>
  )
}

interface FacetMenuProps {
  readonly facet: PickerFacet
  readonly options: readonly PickerFacetOption[]
  readonly chosen: readonly string[]
  readonly onChange: (next: string[]) => void
}

function FacetMenuRows({ facet, options, chosen, onChange }: FacetMenuProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  return (
    <View>
      {options.map((option) => {
        const selected = chosen.includes(option.key)
        const label = optionLabel(facet, option, t)
        return (
          <Pressable
            key={option.key}
            testID={`picker-filter-${facet}-option-${option.key}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={label}
            onPress={() => onChange(togglePickerKey(chosen, option.key))}
            style={styles.menuRow}
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
            <Text numberOfLines={1} style={[styles.menuLabel, { color: colors.foreground }]}>
              {label}
            </Text>
            <Text style={[styles.menuCount, { color: colors.foregroundSubtle }]}>
              {`(${String(option.count)})`}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export function DeviceFilterBar({
  filters,
  onFiltersChange,
  typeOptions,
  zoneOptions,
  locationOptions,
  zones,
  grouping,
  searchPlaceholder,
  disabled = false,
}: DeviceFilterBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const [text, setText] = useState(filters.query)
  const [menu, setMenu] = useState<PickerFacet | null>(null)
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
  // The latest filters, for the debounce timer: it fires after other facets may have changed.
  const latest = useRef({ filters, onFiltersChange })
  useEffect(() => {
    latest.current = { filters, onFiltersChange }
  })

  useEffect(() => {
    if (text === latest.current.filters.query) return
    const timer = setTimeout(
      () => latest.current.onFiltersChange({ ...latest.current.filters, query: text }),
      PICKER_SEARCH_DEBOUNCE_MS,
    )
    return () => clearTimeout(timer)
  }, [text])

  const openMenu = (facet: PickerFacet, ref: React.RefObject<View | null>): void => {
    ref.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height })
      setMenu(facet)
    })
  }

  const unavailable = zoneUnavailable(zones, t)
  const zoneShown = unavailable !== null || pickerFacetFilterShown(zoneOptions, filters.zones)
  const active = pickerFiltersActive(filters) || text.trim() !== ''

  return (
    <View style={styles.bar} testID="device-filter-bar">
      {grouping !== undefined ? <GroupByControl grouping={grouping} /> : null}
      <View style={[styles.searchRow, { backgroundColor: colors.surface }]}>
        <Search size={14} color={colors.foregroundMuted} />
        <TextInput
          value={text}
          onChangeText={setText}
          autoCorrect={false}
          placeholder={searchPlaceholder}
          placeholderTextColor={colors.foregroundSubtle}
          accessibilityLabel={searchPlaceholder}
          style={[styles.searchInput, { color: colors.foreground }]}
        />
      </View>
      <View style={styles.chips}>
        {pickerFacetFilterShown(typeOptions, filters.types) ? (
          <FacetChip
            facet="type"
            chosen={filters.types}
            unavailable={null}
            disabled={disabled}
            onOpen={openMenu}
          />
        ) : null}
        {zoneShown ? (
          <FacetChip
            facet="zone"
            chosen={filters.zones}
            unavailable={unavailable}
            disabled={disabled}
            onOpen={openMenu}
          />
        ) : null}
        {pickerFacetFilterShown(locationOptions, filters.locations) ? (
          <FacetChip
            facet="location"
            chosen={filters.locations}
            unavailable={null}
            disabled={disabled}
            onOpen={openMenu}
          />
        ) : null}
        {active ? (
          <View testID="picker-reset-filters">
            <FilterChip
              label={t(`${UI}.resetFilters`)}
              active={false}
              onPress={() => {
                setText('')
                setMenu(null)
                onFiltersChange(resetPickerFilters())
              }}
            />
          </View>
        ) : null}
      </View>
      {pickerZoneFilterSuspended(filters, zones) ? (
        <Text style={[styles.note, { color: colors.foregroundSubtle }]} testID="picker-zone-filter-paused">
          {t(`${UI}.filter.zonePaused`)}
        </Text>
      ) : null}
      <AnchoredMenu
        visible={menu !== null}
        onRequestClose={() => setMenu(null)}
        anchor={anchor}
        minWidth={240}
        estimatedHeight={320}
      >
        {menu === 'type' ? (
          <FacetMenuRows
            facet="type"
            options={typeOptions}
            chosen={filters.types}
            onChange={(types) => onFiltersChange({ ...filters, types })}
          />
        ) : null}
        {menu === 'zone' ? (
          <FacetMenuRows
            facet="zone"
            options={zoneOptions}
            chosen={filters.zones}
            onChange={(next) => onFiltersChange({ ...filters, zones: next })}
          />
        ) : null}
        {menu === 'location' ? (
          <FacetMenuRows
            facet="location"
            options={locationOptions}
            chosen={filters.locations}
            onChange={(locations) => onFiltersChange({ ...filters, locations })}
          />
        ) : null}
      </AnchoredMenu>
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { gap: SPACING.xs },
  box: {
    width: 18,
    height: 18,
    borderRadius: RADIUS.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.lg,
  },
  groupBy: { gap: SPACING.xs, paddingHorizontal: SPACING.lg, paddingTop: SPACING.sm },
  groupByLabel: { fontSize: 12, fontWeight: '600' },
  menuCount: { fontSize: 12 },
  menuLabel: { flex: 1, fontSize: 14 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  note: { fontSize: 12, lineHeight: 16, paddingHorizontal: SPACING.lg },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: SPACING.xs },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginHorizontal: SPACING.lg,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
  },
})
