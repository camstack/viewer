/**
 * EventsFilterBar — the Events page's facets, drawn by the shared
 * {@link LibraryFilterBar} (day cursor, then one chip per facet, each
 * opening the same anchored picker). This file only DECLARES the facets over
 * `useEventsFilterStore`; how a Library page filters is that one component.
 * There is no general Filters button and no full-page sheet.
 *
 * Faces/Plates live in the Classes menu (a sibling axis of the kind tree).
 * Parked and operator flags live in More.
 *
 * There is NO separate control for track provenance. The kind tree already
 * lists Audio, Sensor and Control beside the detection macros, and the
 * operator reads those as eight equal rows; a second row in More answering the
 * same question was two controls for one question, and it shipped once. The
 * tree drives both dimensions now — `classes` for the pipeline nodes,
 * `excludeSources` for the synthetic ones — routed by the node's own taxonomy
 * category in `track-filter.ts`, never by a list of names here. Groups keeps that page without
 * the track-only facets (Faces/Plates, flags, share). Search is the page's
 * SemanticSearchBar, not a second chip.
 */
import React, { memo, useMemo } from 'react'
import { View, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import {
  Car,
  Eye,
  Link2,
  ListFilter,
  ScanFace,
} from '../../lib/icons.js'
import { useTheme } from '../../theme/theme-provider.js'
import { SPACING } from '../../theme/tokens.js'
import { resolveEventsClasses, useEventsFilterStore } from '../../store/events-filter-store.js'
import { useIsAdmin } from '../../data/use-me.js'
import { useEventKinds } from '../../data/use-event-kinds.js'
import {
  visibleFlagFilters,
  type FlagFilterKey,
} from '../../data/track-events.js'
import { EVENTS_ATTRIBUTES, type EventsAttribute } from '../../../shared/events/events-share-url.js'
import { facetCounts } from '../../store/track-filter.js'
import {
  LibraryFilterBar,
  type LibraryFilterDef,
  type LibraryDateDef,
  type LibraryToolDef,
} from '../ui/LibraryFilterBar.js'
import { CheckRow, EventKindTreeSection } from './EventKindTree.js'
import { SectionLabel } from '../ui/SectionLabel.js'
import { EventsDisplayMenu } from './EventsDisplayMenu.js'
import { DISPLAY_MENU_WIDTH } from '../ui/display-menu.js'


/**
 * One camera row in the Cameras menu.
 *
 * It used to live in `EventsFilterPanel`, which was the page's ORIGINAL filter
 * UI and had been dead since this bar replaced it — the panel and its sheet had
 * no caller left, and `events-share-dialog-wiring.spec.ts` asserts the screen does not
 * reach them. Both were deleted when the source row came out of the More menu:
 * a leftover that still described the design we had just moved away from (a
 * flat class list, its own Parked row) is worse than nothing, because it reads
 * as verification.
 */
export interface CameraOption {
  readonly id: number
  readonly name: string
}

const ATTRIBUTE_ICONS = {
  face: ScanFace,
  plate: Car,
} as const

export interface EventsFilterBarProps {
  readonly cameras: readonly CameraOption[]
  readonly availableClasses: readonly string[]
  /** The day the feed starts from — the Library date chip (navigation). */
  readonly date: LibraryDateDef
  readonly onOpenShare: () => void
  /** The count line under the row ("24 events"); a blank keeps its height. */
  readonly summary: string
}

export const EventsFilterBar = memo(function EventsFilterBar({
  cameras,
  availableClasses,
  date,
  onOpenShare,
  summary,
}: EventsFilterBarProps) {
  const { colors } = useTheme()
  const { t } = useTranslation()
  const filter = useEventsFilterStore((s) => s.filter)
  const toggleCamera = useEventsFilterStore((s) => s.toggleCamera)
  const toggleClass = useEventsFilterStore((s) => s.toggleClass)
  const setClasses = useEventsFilterStore((s) => s.setClasses)
  const setFilterDebug = useEventsFilterStore((s) => s.setFilterDebug)
  const setFilterTrain = useEventsFilterStore((s) => s.setFilterTrain)
  const setFilterFavourited = useEventsFilterStore((s) => s.setFilterFavourited)
  const setShowStationary = useEventsFilterStore((s) => s.setShowStationary)
  const useDefaultClasses = useEventsFilterStore((s) => s.useDefaultClasses)
  const toggleAttribute = useEventsFilterStore((s) => s.toggleAttribute)
  const reset = useEventsFilterStore((s) => s.reset)

  const scopedDeviceIds = useMemo(
    () => (filter.cameraIds.length > 0 ? filter.cameraIds : cameras.map((c) => c.id)),
    [filter.cameraIds, cameras],
  )
  const eventKinds = useEventKinds(scopedDeviceIds)
  const isAdmin = useIsAdmin()
  const flagChips = visibleFlagFilters(isAdmin)
  const flagOn: Record<FlagFilterKey, boolean> = {
    debug: filter.filterDebug,
    markForTrain: filter.filterTrain,
    favourited: filter.filterFavourited,
  }
  const flagToggle: Record<FlagFilterKey, (on: boolean) => void> = {
    debug: setFilterDebug,
    markForTrain: setFilterTrain,
    favourited: setFilterFavourited,
  }
  const flagLabel: Record<FlagFilterKey, string> = {
    debug: t('v2.tracks.debugFlag', 'Debug'),
    markForTrain: t('v2.tracks.markForTraining', 'Mark for training'),
    favourited: t('v2.tracks.favourited', 'Favourited'),
  }

  const countLabel = (n: number): string => (n > 0 ? String(n) : t('v2.events.all', 'All'))

  /**
   * The ticks the tree renders — the stored selection, or the default preset
   * resolved against the taxonomy that has loaded. This is the ONE place the
   * page turns "what is stored" into "what is on screen", and both the tree
   * and the chip read it, so they can never disagree about what is narrowed.
   */
  const resolvedClasses = resolveEventsClasses(filter.classes, eventKinds.data)

  /**
   * The numbers on this control, and there are exactly two of them.
   *
   * The menu holds two sections — the attribute rows and the kind tree — so
   * each section states its own count and the chip states their SUM. Every
   * number is then derivable from what is on screen. MACROS and not ids
   * remains right for the kind half: a macro toggle sweeps its subs into the
   * stored list, so a raw length reads "30" for a default that unticked
   * exactly one row.
   */
  const counts = facetCounts(resolvedClasses, eventKinds.data, filter.attributes.length)
  const attrCount = counts.attributes
  const moreCount =
    (filter.showStationary ? 1 : 0) +
    (filter.filterFavourited ? 1 : 0) +
    (isAdmin && filter.filterDebug ? 1 : 0) +
    (isAdmin && filter.filterTrain ? 1 : 0)

  const classesBody = (): React.ReactNode => (
    <>
      <View style={styles.menuSection}>
        {/* Its own count, so the chip's number is the sum of two things
            the operator can both see. */}
        <SectionLabel level="group" value={countLabel(attrCount)} style={styles.sectionLabel}>
          {t('v2.events.attributes', 'Detected')}
        </SectionLabel>
        {EVENTS_ATTRIBUTES.map((attribute: EventsAttribute) => {
          const on = filter.attributes.includes(attribute)
          const Icon = ATTRIBUTE_ICONS[attribute]
          const label =
            attribute === 'face' ? t('v2.events.attrFaces', 'Faces') : t('v2.events.attrPlates', 'Plates')
          // The SAME row as the kind tree under it (`CheckRow`): this list used
          // its own smaller row and checkbox, so one menu drew two scales.
          return (
            <CheckRow
              key={attribute}
              label={label}
              icon={Icon}
              iconColor={on ? colors.primary : colors.foregroundMuted}
              selected={on}
              onPress={() => { toggleAttribute(attribute) }}
            />
          )
        })}
      </View>
      <EventKindTreeSection
        descriptors={eventKinds.data}
        observedClasses={availableClasses}
        // The RESOLVED ticks, so the default renders as what it is: every
        // row ticked except Audio.
        selected={resolvedClasses}
        onToggleClass={(kind) => {
          toggleClass(kind, resolvedClasses)
        }}
        onSetClasses={setClasses}
        onReset={useDefaultClasses}
        resetLabel={t('v2.events.useDefaultClasses', 'Default')}
        resetActive={filter.classes === null}
      />
    </>
  )

  const filters: readonly LibraryFilterDef[] = [
    {
      id: 'cameras',
      label: t('v2.events.cameras', 'Cameras'),
      count: filter.cameraIds.length,
      sections: [
        {
          title: t('v2.events.cameras', 'Cameras'),
          options: cameras.map((c) => ({ key: String(c.id), label: c.name })),
          selected: filter.cameraIds.map(String),
          onToggle: (key) => { toggleCamera(Number(key)) },
          searchPlaceholder: t('v2.events.searchCameras', 'Search cameras…'),
        },
      ],
    },
    {
      id: 'classes',
      label: t('v2.events.classes', 'Classes'),
      count: counts.narrowed ? counts.total : 0,
      render: classesBody,
      menuWidth: 300,
      estimatedHeight: 480,
    },
    {
      id: 'more',
      label: t('v2.events.more', 'More'),
      icon: ListFilter,
      count: moreCount,
      estimatedHeight: 280,
      sections: [
        {
          title: t('v2.events.parked', 'Parked'),
          options: [{ key: 'stationary', label: t('v2.events.showStationary', 'Show stationary') }],
          selected: filter.showStationary ? ['stationary'] : [],
          onToggle: () => { setShowStationary(!filter.showStationary) },
        },
        {
          title: t('v2.events.flaggedOnly', 'Flagged'),
          options: flagChips.map((key) => ({ key, label: flagLabel[key] })),
          selected: flagChips.filter((key) => flagOn[key]),
          onToggle: (key) => {
            const flag = flagChips.find((k) => k === key)
            if (flag !== undefined) flagToggle[flag](!flagOn[flag])
          },
        },
      ],
    },
  ]

  // Display and Share are TOOLS at the row's end, like every Library page's
  // sort and ⋯ — not chips among the facets. The grid density lives in the
  // Display menu with the other tile preferences.
  const tools: readonly LibraryToolDef[] = [
    {
      id: 'display',
      icon: Eye,
      label: t('v2.events.displayOptions'),
      render: () => <EventsDisplayMenu />,
      menuWidth: DISPLAY_MENU_WIDTH,
      estimatedHeight: 420,
      testID: 'events-display-tool',
    },
    { id: 'share', icon: Link2, label: t('v2.eventsShare.chip'), onPress: onOpenShare, testID: 'events-share-tool' },
  ]

  return (
    <LibraryFilterBar
      date={date}
      filters={filters}
      tools={tools}
      summary={summary}
      summaryTestID="events-count"
      onReset={reset}
      testID="events-filter-bar"
    />
  )
})

const styles = StyleSheet.create({
  menuSection: { gap: SPACING.xs, paddingBottom: SPACING.sm },
  sectionLabel: { marginTop: SPACING.xs },
})
