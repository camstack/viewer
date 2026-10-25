/**
 * TimelineDatePanel — the month calendar for recorded playback, as a panel that
 * TAKES OVER the timeline body.
 *
 * It was a `Modal` with a dimmed backdrop and a fixed 7×40pt card. A card of a
 * fixed size over an arbitrary surface is the same guess as every other float
 * here: on the landscape drawer it covered the video it was supposed to help
 * navigate. Filling the body, the grid gets whatever width the column has.
 *
 * The parent owns the anchored month (`monthAnchorMs`) and supplies `daysSet`
 * (local-midnight epochs that have footage) for it. Every day is selectable;
 * days with footage show a dot; future days are disabled. The month itself is
 * the kit's `MonthCalendar`, which the Library's date control shares without
 * the time section.
 *
 * ## Day, then time
 *
 * Tapping a day STAGES it (highlight moves, panel stays); the jump happens from
 * the time section below: an hour cell seeks to that day at that hour
 * (`onPickTime`), and the "same time of day" row keeps the panel's original
 * one-decision behaviour (`onPick` — the parent maps it through
 * `dayAtSameTime`). Hours, not minutes, on purpose: the timeline itself is the
 * fine scrubber, and a minute grid here would be 60 cells of false precision
 * over footage the operator has not seen yet.
 */
import React, { memo, useMemo, useState } from 'react'
import { useDateLocale } from '../../../lib/date-locale.js'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Clock } from '../../../lib/icons.js'

import { useTheme } from '../../../theme/theme-provider.js'
import { RADIUS, SPACING } from '../../../theme/tokens.js'
import { buildHourGrid } from '../../ui/calendar-grid.js'
import { MonthCalendar } from '../../ui/MonthCalendar.js'
import type { RecordingDaysStatus } from './recording-days-status.js'
import { TimelinePanelHost } from './TimelinePanelHost.js'

/** The "this month is incomplete" line. Its own testID because RNW hides style
 *  in class names: a muted notice and a danger one are not distinguishable from
 *  the DOM without one. */
export const RECORDING_DAYS_PARTIAL_TEST_ID = 'recording-days-partial'

export interface TimelineDatePanelProps {
  /** Any ms within the month to display. */
  readonly monthAnchorMs: number
  /** Currently-selected day (local-midnight epoch), highlighted. */
  readonly selectedDayMs: number
  /** Local-midnight epochs that have footage in the displayed month. */
  readonly daysSet: ReadonlySet<number>
  /**
   * What the grid may claim about days it has not read — see
   * {@link resolveRecordingDaysStatus}. `loading` overlays a spinner (an
   * un-dotted grid reads as "this month has no footage"), and `failed` says so
   * outright, because suppressing the dots silently makes the SAME claim.
   */
  readonly daysStatus: RecordingDaysStatus
  /** Current wall-clock — flags future (disabled) cells + "today". */
  readonly nowMs: number
  readonly onChangeMonth: (deltaMonths: number) => void
  /** Jump to this day at the SAME time of day as the current playhead. */
  readonly onPick: (dayEpoch: number) => void
  /** Jump to this exact epoch (a staged day at a chosen hour). */
  readonly onPickTime: (epochMs: number) => void
  readonly onClose: () => void
}

export const TimelineDatePanel = memo(function TimelineDatePanel(props: TimelineDatePanelProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()

  // The day the time section operates on. Local on purpose: nothing outside
  // this panel changes until the operator picks a TIME (or the same-time row),
  // so a staged day the panel is closed on costs nothing.
  const [stagedDayMs, setStagedDayMs] = useState<number | null>(null)
  const effectiveDayMs = stagedDayMs ?? props.selectedDayMs

  const hourCells = useMemo(
    () => buildHourGrid(effectiveDayMs, props.nowMs),
    [effectiveDayMs, props.nowMs],
  )
  // The language the APP is speaking, never the runtime's (`lib/date-locale.ts`).
  const dateLocale = useDateLocale()
  const dayTitle = new Date(effectiveDayMs).toLocaleDateString(dateLocale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  // Never a dot while the month is unread — `daysSet` is empty in that state,
  // and a dot inferred from an empty set is the false claim. `partial` keeps
  // the dots: they came from cameras that ANSWERED, so suppressing them would
  // hide real footage to avoid over-claiming about the cameras that did not.
  // The notice above the grid carries the incompleteness instead.
  const answered = props.daysStatus === 'ready' || props.daysStatus === 'partial'

  return (
    <TimelinePanelHost title={t('v2.theater.selectDate')} onClose={props.onClose}>
      {/* The month: the kit calendar the Library's date control shares. A tap
          STAGES the day; the time section below decides the seek. */}
      <MonthCalendar
        monthAnchorMs={props.monthAnchorMs}
        onChangeMonth={props.onChangeMonth}
        selectedDayMs={effectiveDayMs}
        nowMs={props.nowMs}
        onSelectDay={setStagedDayMs}
        markedDays={answered ? props.daysSet : null}
        loading={props.daysStatus === 'loading'}
        notice={
          <>
            {/* The month could not be READ. Said out loud, above the grid: the
                dots are the only thing that distinguishes a day with footage
                from one without, so a grid that quietly drops them has told
                the operator this month is empty. Not a retry chip — React
                Query already retried, and reopening the panel refetches. */}
            {props.daysStatus === 'failed' ? (
              <Text style={[styles.daysFault, { color: colors.danger }]}>
                {t('v2.theater.recordingDaysFailed')}
              </Text>
            ) : null}
            {/* Some cameras answered, some could not: the dots are REAL but
                INCOMPLETE. Muted, not danger — nothing failed, nothing to retry. */}
            {props.daysStatus === 'partial' ? (
              <Text
                testID={RECORDING_DAYS_PARTIAL_TEST_ID}
                style={[styles.daysFault, { color: colors.foregroundMuted }]}
              >
                {t('v2.theater.recordingDaysPartial')}
              </Text>
            ) : null}
          </>
        }
      />

      {/* ── Time within the staged day ─────────────────────────────────── */}
      <View style={styles.timeHeader}>
        <Clock size={14} color={colors.foregroundMuted} />
        <Text style={[styles.timeTitle, { color: colors.foreground }]}>
          {t('v2.theater.selectTime')} — {dayTitle}
        </Text>
      </View>

      {/* The one-decision jump the panel always had: this day, same time of
          day as the playhead. Kept as a row so picking a day is still two
          quick taps, never a hunt for the right hour. */}
      <Pressable
        accessibilityRole="button"
        onPress={() => props.onPick(effectiveDayMs)}
        style={[styles.sameTimeRow, { borderColor: colors.border }]}
      >
        <Text style={[styles.sameTimeText, { color: colors.primary }]}>
          {t('v2.theater.goSameTime')}
        </Text>
      </Pressable>

      {/* 24 hour cells, 6 per row — the calendar's own cell language. */}
      <View style={styles.grid}>
        {hourCells.map((h) => (
          <Pressable
            key={h.hour}
            style={styles.hourCell}
            disabled={h.isFuture}
            accessibilityRole="button"
            accessibilityState={{ disabled: h.isFuture }}
            onPress={() => props.onPickTime(h.epoch)}
          >
            <Text
              style={[
                styles.cellText,
                { color: h.isFuture ? colors.foregroundSubtle : colors.foreground },
              ]}
            >
              {String(h.hour).padStart(2, '0')}
            </Text>
          </Pressable>
        ))}
      </View>
    </TimelinePanelHost>
  )
})

/** One sixth of the row — the hour grid is 6×4, width-relative like the month. */
const HOUR_COLUMN = '16.6666%' as const

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cellText: { fontSize: 12, fontWeight: '600' },
  daysFault: { fontSize: 11, fontWeight: '600', paddingBottom: SPACING.xs },
  timeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingTop: SPACING.sm,
  },
  timeTitle: { fontSize: 13, fontWeight: '700', textTransform: 'capitalize' },
  sameTimeRow: {
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.xs,
    alignItems: 'center',
    marginVertical: SPACING.xs,
  },
  sameTimeText: { fontSize: 13, fontWeight: '600' },
  hourCell: {
    width: HOUR_COLUMN,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: RADIUS.md,
  },
})
