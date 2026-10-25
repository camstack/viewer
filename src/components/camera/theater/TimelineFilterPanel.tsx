/**
 * TimelineFilterPanel — the activity filter, as a panel that TAKES OVER the
 * timeline body: the motion/audio KIND chips, an "All" reset, and the full
 * macro→sub event-kind tree (`EventKindTreeSection`, shared with the events
 * page) — with the flat loaded-window class list only as the fallback for a
 * hub that advertises no taxonomy.
 *
 * It used to be a bar floating above the FAB stack, offset by a constant that
 * had to be kept in step with the stack's height — the class of arrangement
 * this layout retires. Owning the body, it wraps as far as it needs to and
 * scrolls; nothing has to know what is under it, because nothing is.
 *
 * Presentational + controlled: filter state lives in `TheaterTimeline`.
 */
import React, { memo } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Activity, Volume2, ListFilter } from '../../../lib/icons.js'

import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { MOTION_COLOR, AUDIO_COLOR } from './event-highlights.js'
import type { EventKindDescriptor } from '../../../data/event-kinds.js'
import { TimelinePanelHost } from './TimelinePanelHost.js'
import { EventKindTreeSection } from '../../events/EventKindTree.js'
import { ALL_BAR_KINDS, isFilterAll, type ActivityFilter, type TimelineBarKind } from './mock-data.js'

/** Motion → green, audio → cyan (the shared activity accents). */
const KIND_COLOR: Readonly<Record<TimelineBarKind, string>> = {
  motion: MOTION_COLOR,
  audio: AUDIO_COLOR,
}

export interface TimelineFilterPanelProps {
  readonly filter: ActivityFilter
  /** Toggle a single activity class on/off. */
  readonly onToggleKind: (kind: TimelineBarKind) => void
  /** Detection classes present in the loaded window (distinct, sorted). */
  readonly classes: readonly string[]
  /** Selected detection classes — EMPTY means "all classes". */
  readonly classFilter: ReadonlySet<string>
  /** Toggle a single detection class on/off. */
  readonly onToggleClass: (className: string) => void
  /** Replace the whole class selection at once (macro-level select/deselect). */
  readonly onSetClasses: (classes: readonly string[]) => void
  /** Reset to "show everything" (kinds AND classes). */
  readonly onReset: () => void
  /** The hub's event-kind taxonomy for this camera — `undefined` while the
   *  query is still in flight (the tree section shows a loading row then). */
  readonly eventKinds?: readonly EventKindDescriptor[]
  /** Hand the body back to the timeline. */
  readonly onClose: () => void
}

export const TimelineFilterPanel = memo(function TimelineFilterPanel({
  filter,
  onToggleKind,
  classes,
  classFilter,
  onSetClasses,
  onToggleClass,
  onReset,
  eventKinds,
  onClose,
}: TimelineFilterPanelProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const kindsAll = isFilterAll(filter)
  const allActive = kindsAll && classFilter.size === 0

  return (
    <TimelinePanelHost title={t('v2.theater.filterTitle')} onClose={onClose}>
      <View style={styles.chips}>
        {/* "All" reset chip. */}
        <Pressable
          onPress={onReset}
          hitSlop={4}
          accessibilityRole="button"
          accessibilityState={{ selected: allActive }}
          style={[
            styles.chip,
            {
              backgroundColor: allActive ? colors.primary : colors.backgroundElevated,
              borderColor: allActive ? colors.primary : colors.border,
            },
          ]}
        >
          <ListFilter size={13} color={allActive ? colors.primaryForeground : colors.foregroundMuted} />
          <Text
            style={[styles.chipText, { color: allActive ? colors.primaryForeground : colors.foregroundMuted }]}
          >
            {t('v2.theater.filterAll')}
          </Text>
        </Pressable>

        {/* Per-kind chips. */}
        {ALL_BAR_KINDS.map((kind) => {
          const on = !kindsAll && filter.has(kind)
          const Icon = kind === 'audio' ? Volume2 : Activity
          const accent = KIND_COLOR[kind]
          return (
            <Pressable
              key={kind}
              onPress={() => onToggleKind(kind)}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[
                styles.chip,
                {
                  backgroundColor: on ? `${accent}26` : colors.backgroundElevated,
                  borderColor: on ? accent : colors.border,
                },
              ]}
            >
              <Icon size={13} color={on ? accent : colors.foregroundMuted} />
              <Text style={[styles.chipText, { color: on ? colors.foreground : colors.foregroundMuted }]}>
                {t(`v2.theater.filter_${kind}`)}
              </Text>
            </Pressable>
          )
        })}

      </View>

      {/* The FULL taxonomy, the same tree the events page shows.
          It used to be a flat chip row built from the classes present in the
          loaded window — so a class that had not happened on this camera today
          was un-selectable, and "show me deliveries" could not be expressed at
          all on a quiet camera. `classes` — those loaded-window classes — now
          ride alongside: a class the taxonomy omits but the timeline is
          showing gets its own row (the hub advertised no detection class for
          a camera armed on motion, 2026-09-11), and on a hub that advertises
          no descriptors at all they are the whole list, as before.
          `eventKinds` goes through UN-defaulted: `undefined` means the query
          is still in flight and the section shows a loading row — `?? []`
          here made every cold open render the flat list instead. */}
      <EventKindTreeSection
        descriptors={eventKinds}
        observedClasses={classes}
        selected={[...classFilter]}
        onToggleClass={onToggleClass}
        onSetClasses={onSetClasses}
      />
    </TimelinePanelHost>
  )
})

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 1,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
  },
})
