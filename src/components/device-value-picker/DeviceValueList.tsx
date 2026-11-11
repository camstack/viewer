/**
 * The device list of the device → value picker (page 1 of the sheet, and the
 * same list inline where a screen IS the picker — the grid builder, the
 * accessory "+" sheet): search, "{Capability} · N of M", the three facet
 * chips, then suggestions, recents and the rest grouped by type.
 *
 * The facets are exactly three and generic — Location, Integration, Type —
 * each COLLAPSED by default and stating its choice ("any"); a tap opens its
 * options under the chips (top ones with counts, "N more"), a second tap on
 * the chip closes it. Loading, failed, nothing-compatible and a search miss
 * are four different screens (D315); a failure offers Retry.
 *
 * It reads through the {@link DeviceValueBrowse} its caller holds, so a page
 * pushed over it (the value page) finds it as it was on Back.
 */
import React, { useMemo } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import type { DeviceSearchFacets, DeviceSearchItem } from '@camstack/types'

import { useTheme } from '../../theme/theme-provider.js'
import { SPACING, TYPOGRAPHY } from '../../theme/tokens.js'
import { ChipMultiselect } from '../ui/ChipMultiselect.js'
import { EmptyState, ErrorState } from '../ui/EmptyState.js'
import { FilterChip } from '../ui/FilterChip.js'
import { PickerSearchRow } from '../ui/PickerSheet.js'
import { SkeletonBox } from '../ui/SkeletonBox.js'
import { capabilityListLabel } from './capability-label.js'
import {
  facetSummary,
  FACET_KEYS,
  topFacetOptions,
  type FacetKey,
  type ListSection,
  type PickedValue,
  type PickerState,
  type PickKind,
} from './device-value-picker-model.js'
import { DEVICE_VALUE_ROW_HEIGHT, DeviceRow, SectionHeading, useDeviceTypeLabel } from './DeviceValueRows.js'
import type { DeviceValueBrowse } from './use-device-value-browse.js'

const UI = 'v2.deviceValuePicker'

/** How many options an opened facet shows before "N more". */
export const FACET_TOP = 6

export interface DeviceValueListProps {
  readonly browse: DeviceValueBrowse
  /** The capabilities the field asks for; empty = any device. */
  readonly caps: readonly string[]
  readonly kind: PickKind
  readonly multiple: boolean
  readonly picked: readonly PickedValue[]
  readonly onPick: (value: PickedValue) => void
  readonly onDrill: (item: DeviceSearchItem) => void
  /** A caller's extra fact for a row's second line (a container's name). */
  readonly detailOf?: (item: DeviceSearchItem) => string | null
  /** Scrolls with the list, above the search (a screen's own fields). */
  readonly header?: React.ReactElement
  readonly testID?: string
}

type ListRow =
  | { readonly key: string; readonly kind: 'heading'; readonly section: ListSection }
  | { readonly key: string; readonly kind: 'device'; readonly item: DeviceSearchItem }

function flatten(sections: readonly ListSection[]): readonly ListRow[] {
  const rows: ListRow[] = []
  for (const section of sections) {
    rows.push({ key: `h:${section.id}`, kind: 'heading', section })
    for (const item of section.items) rows.push({ key: `d:${String(item.id)}`, kind: 'device', item })
  }
  return rows
}

export function DeviceValueList({
  browse,
  caps,
  kind,
  multiple,
  picked,
  onPick,
  onDrill,
  detailOf,
  header,
  testID,
}: DeviceValueListProps): React.JSX.Element {
  const { t } = useTranslation()
  const capLabel = capabilityListLabel(caps, (key, o) => t(key, o), t(`${UI}.or`))
  const rows = useMemo(() => flatten(browse.sections), [browse.sections])

  const controls = (
    <View style={styles.controls}>
      <PickerSearchRow
        testID="dvp-search"
        search={{ value: browse.text, onChange: browse.setText, placeholder: t(`${UI}.search`) }}
      />
      <CountLine browse={browse} capLabel={capLabel} hasCap={caps.length > 0} />
      {browse.first !== undefined ? <FacetChips browse={browse} facets={browse.first.facets} /> : null}
    </View>
  )

  return (
    <View style={styles.root} testID={testID}>
      {header === undefined ? controls : null}
      {browse.state.kind !== 'ready' ? (
        <>
          {header}
          {header !== undefined ? controls : null}
          <ListStateView browse={browse} state={browse.state} capLabel={capLabel} hasCap={caps.length > 0} />
        </>
      ) : (
        <FlatList<ListRow>
          testID="dvp-list"
          data={rows}
          keyExtractor={(row) => row.key}
          ListHeaderComponent={
            header !== undefined ? (
              <>
                {header}
                {controls}
              </>
            ) : null
          }
          renderItem={({ item: row }) =>
            row.kind === 'heading' ? (
              <SectionHeading section={row.section} />
            ) : (
              <DeviceRow
                item={row.item}
                kind={kind}
                multiple={multiple}
                picked={picked}
                onPick={onPick}
                onDrill={onDrill}
                detail={detailOf?.(row.item) ?? null}
              />
            )
          }
          initialNumToRender={20}
          windowSize={7}
          onEndReached={browse.fetchNextPage}
          onEndReachedThreshold={0.5}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListFooterComponent={
            browse.isFetchingNextPage ? <SkeletonBox style={styles.footerSkeleton} /> : null
          }
        />
      )}
    </View>
  )
}

/** "{Capability} · N matches of M", and the way to the devices that do not provide it. */
function CountLine({
  browse,
  capLabel,
  hasCap,
}: {
  readonly browse: DeviceValueBrowse
  readonly capLabel: string
  readonly hasCap: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const first = browse.first
  if (first === undefined) return <SkeletonBox style={styles.countSkeleton} />
  return (
    <View style={styles.countRow}>
      <Text testID="dvp-count" style={[styles.count, { color: colors.foregroundMuted }]}>
        {hasCap
          ? t(`${UI}.matchesOf`, { cap: capLabel, count: first.compatibleTotal, total: first.fleetTotal })
          : t(`${UI}.devicesCount`, { count: first.total })}
      </Text>
      {first.hiddenIncompatible > 0 ? (
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => browse.setShowIncompatible(!browse.showIncompatible)}
        >
          <Text style={[styles.count, { color: colors.primary }]}>
            {browse.showIncompatible
              ? t(`${UI}.hideIncompatible`)
              : t(`${UI}.showIncompatible`, { count: first.hiddenIncompatible })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

interface FacetOption {
  readonly value: string
  readonly label: string
  readonly count: number
}

function facetOptions(facets: DeviceSearchFacets, key: FacetKey, typeLabel: (t: string) => string): readonly FacetOption[] {
  switch (key) {
    case 'locations':
      return facets.locations.map((f) => ({ value: f.value, label: f.value, count: f.count }))
    case 'integrationIds':
      return facets.integrations.map((f) => ({ value: f.id, label: f.label, count: f.count }))
    case 'types':
      return facets.types.map((f) => ({ value: f.value, label: typeLabel(f.value), count: f.count }))
  }
}

const FACET_LABEL: Readonly<Record<FacetKey, string>> = {
  locations: `${UI}.facet.location`,
  integrationIds: `${UI}.facet.integration`,
  types: `${UI}.facet.type`,
}

/** The three facets as chips; the open one lists its options under them. */
function FacetChips({
  browse,
  facets,
}: {
  readonly browse: DeviceValueBrowse
  readonly facets: DeviceSearchFacets
}): React.JSX.Element {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const typeLabel = useDeviceTypeLabel()
  const [expanded, setExpanded] = React.useState(false)
  const open = browse.openFacet
  const options = open === null ? [] : facetOptions(facets, open, typeLabel)
  const labelOf = (key: FacetKey) => {
    const all = facetOptions(facets, key, typeLabel)
    return (value: string) => all.find((o) => o.value === value)?.label ?? value
  }
  const top = topFacetOptions(options, FACET_TOP, expanded)
  return (
    <View style={styles.facets}>
      <View style={styles.chips}>
        {FACET_KEYS.map((key) => (
          <FilterChip
            key={key}
            label={t(FACET_LABEL[key])}
            value={facetSummary(browse.facets[key], t(`${UI}.facet.any`), labelOf(key))}
            menu
            active={browse.facets[key].length > 0 || open === key}
            accessibilityLabel={t(FACET_LABEL[key])}
            onPress={() => {
              setExpanded(false)
              browse.setOpenFacet(open === key ? null : key)
            }}
          />
        ))}
      </View>
      {open !== null ? (
        <View testID={`dvp-facet-${open}`} style={styles.facetOptions}>
          {options.length === 0 ? (
            <Text style={[styles.count, { color: colors.foregroundSubtle }]}>{t(`${UI}.facet.none`)}</Text>
          ) : (
            <ChipMultiselect<string>
              options={top.shown.map((o) => ({ value: o.value, label: `${o.label} ${String(o.count)}` }))}
              selected={browse.facets[open]}
              onToggle={(value) => browse.toggleFacet(open, value)}
            />
          )}
          {top.more > 0 ? (
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setExpanded(true)}>
              <Text style={[styles.count, { color: colors.primary }]}>
                {t(`${UI}.facet.more`, { count: top.more })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/** Loading, failed, nothing compatible, search miss — never alike (D315). */
function ListStateView({
  browse,
  state,
  capLabel,
  hasCap,
}: {
  readonly browse: DeviceValueBrowse
  readonly state: PickerState
  readonly capLabel: string
  readonly hasCap: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  if (state.kind === 'loading') {
    return (
      <View testID="dvp-loading" accessibilityState={{ busy: true }} style={styles.skeletons}>
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBox key={i} style={{ height: DEVICE_VALUE_ROW_HEIGHT - SPACING.lg }} />
        ))}
      </View>
    )
  }
  if (state.kind === 'failed') {
    return (
      <ErrorState
        testID="dvp-failed"
        fill={false}
        title={t(`${UI}.failed`)}
        body={t(`${UI}.failedBody`)}
        onRetry={browse.refetch}
      />
    )
  }
  if (state.kind === 'empty') {
    const hidden = browse.first?.hiddenIncompatible ?? 0
    return (
      <EmptyState
        testID="dvp-empty"
        fill={false}
        title={hasCap ? t(`${UI}.empty`, { cap: capLabel }) : t(`${UI}.emptyAny`)}
        {...(hidden > 0 && !browse.showIncompatible
          ? { action: { label: t(`${UI}.showAll`), onPress: () => browse.setShowIncompatible(true) } }
          : {})}
      />
    )
  }
  const title =
    browse.query === ''
      ? hasCap
        ? t(`${UI}.filterMiss`, { cap: capLabel })
        : t(`${UI}.filterMissAny`)
      : hasCap
        ? t(`${UI}.searchMiss`, { cap: capLabel, query: browse.query })
        : t(`${UI}.searchMissAny`, { query: browse.query })
  return (
    <EmptyState
      testID="dvp-search-miss"
      fill={false}
      title={title}
      action={{ label: t(`${UI}.clearSearch`), onPress: browse.clear }}
    />
  )
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  controls: { gap: SPACING.md, paddingBottom: SPACING.sm },
  count: { fontSize: TYPOGRAPHY.size.sm },
  countRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: SPACING.lg,
    rowGap: SPACING.xs,
    paddingHorizontal: SPACING.lg,
  },
  countSkeleton: { height: 14, width: 160, marginHorizontal: SPACING.lg },
  facetOptions: { gap: SPACING.sm },
  facets: { gap: SPACING.md, paddingHorizontal: SPACING.lg },
  footerSkeleton: { height: 32, margin: SPACING.lg },
  root: { flexShrink: 1, minHeight: 0 },
  skeletons: { gap: SPACING.md, padding: SPACING.lg },
})
