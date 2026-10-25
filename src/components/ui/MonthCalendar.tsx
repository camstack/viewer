/**
 * MonthCalendar — THE month calendar of the viewer: `‹ Month YYYY ›`, a
 * "Today" row, the weekday initials and a 6×7 grid of days, Monday first.
 *
 * Extracted from the timeline's date panel (`TimelineDatePanel`) so the
 * Library's date control (`LibraryFilterBar` → `date`) is the same calendar
 * without the time (operator, 2026-10-23). What a tap MEANS belongs to the
 * caller: the timeline STAGES the day and seeks from its time section; the
 * Library picks it and closes.
 *
 * The month is controlled (`monthAnchorMs` + `onChangeMonth`); future days are
 * disabled. `markedDays` draws a dot under a day (the timeline: days with
 * footage) — `null` means the caller has no ANSWER for this month, which is
 * never the same as an empty set, so no day is dotted. `loading` overlays a
 * spinner and `notice` is a line above the grid (a failed or partial month).
 */
import React, { memo, useMemo, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from '../../lib/icons.js'
import { useDateLocale, weekdayInitials } from '../../lib/date-locale.js'
import { useTheme } from '../../theme/theme-provider.js'
import { RADIUS, SPACING, TYPOGRAPHY } from '../../theme/tokens.js'
import { buildMonthGrid } from './calendar-grid.js'

export interface MonthCalendarProps {
  /** Any ms within the month to display. */
  readonly monthAnchorMs: number
  readonly onChangeMonth: (deltaMonths: number) => void
  /** The highlighted day (a local midnight), or none. */
  readonly selectedDayMs: number | null
  /** Wall-clock now: flags future (disabled) cells and today's border. */
  readonly nowMs: number
  /** A day was tapped (or the Today row): its local midnight. */
  readonly onSelectDay: (dayMs: number) => void
  /** Days drawn with a dot; `null` = the month is unanswered (no dots at all). */
  readonly markedDays?: ReadonlySet<number> | null
  /** Overlay a spinner on the grid while `markedDays` loads. */
  readonly loading?: boolean
  /**
   * A page that can show EVERY day (the Library's People and Plates) gets an
   * "All dates" button beside Today; it reads as picked while `selectedDayMs`
   * is `null`. Absent ⇒ there is always a day.
   */
  readonly allDates?: { readonly label: string; readonly onSelect: () => void }
  /** A line between the weekday row and the grid. */
  readonly notice?: ReactNode
  readonly testID?: string
}

/** A full-width shortcut above the grid (Today, All dates). */
function QuickButton({
  label,
  picked,
  onPress,
}: {
  readonly label: string
  readonly picked: boolean
  readonly onPress: () => void
}) {
  const { colors } = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: picked }}
      onPress={onPress}
      style={[
        styles.quickButton,
        { borderColor: picked ? colors.primary : colors.border, backgroundColor: picked ? colors.primary : 'transparent' },
      ]}
    >
      <Text numberOfLines={1} style={[styles.quickText, { color: picked ? colors.primaryForeground : colors.primary }]}>
        {label}
      </Text>
    </Pressable>
  )
}

/** One seventh of the row — the grid is width-relative, never cell-sized. */
const COLUMN = '14.2857%' as const

export const MonthCalendar = memo(function MonthCalendar({
  monthAnchorMs,
  onChangeMonth,
  selectedDayMs,
  nowMs,
  onSelectDay,
  markedDays = null,
  loading = false,
  allDates,
  notice,
  testID,
}: MonthCalendarProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  // The language the APP speaks, never the runtime's (`lib/date-locale.ts`).
  const dateLocale = useDateLocale()
  const anchor = new Date(monthAnchorMs)
  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const cells = useMemo(() => buildMonthGrid(year, month, nowMs), [year, month, nowMs])
  const weekdays = useMemo(() => weekdayInitials(dateLocale), [dateLocale])
  const monthTitle = anchor.toLocaleDateString(dateLocale, { month: 'long', year: 'numeric' })
  const todayMid = new Date(nowMs)
  todayMid.setHours(0, 0, 0, 0)
  const todayMs = todayMid.getTime()
  const todaySelected = selectedDayMs === todayMs

  return (
    <View testID={testID}>
      <View style={styles.header}>
        <Pressable
          style={styles.navBtn}
          onPress={() => onChangeMonth(-1)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('v2.calendar.prevMonth')}
        >
          <ChevronLeft size={18} color={colors.foregroundMuted} />
        </Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>{monthTitle}</Text>
        <Pressable
          style={styles.navBtn}
          onPress={() => onChangeMonth(1)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={t('v2.calendar.nextMonth')}
        >
          <ChevronRight size={18} color={colors.foregroundMuted} />
        </Pressable>
      </View>

      {/* One tap to today, so nobody hunts the bordered cell in a six-week grid
          after stepping to another month — and, where the page allows it, one
          tap back to every day. */}
      <View style={styles.quickRow}>
        <QuickButton label={t('v2.calendar.today')} picked={todaySelected} onPress={() => onSelectDay(todayMs)} />
        {allDates !== undefined ? (
          <QuickButton label={allDates.label} picked={selectedDayMs === null} onPress={allDates.onSelect} />
        ) : null}
      </View>

      <View style={styles.weekRow}>
        {weekdays.map((w, i) => (
          <Text key={i} style={[styles.weekday, { color: colors.foregroundSubtle }]}>
            {w}
          </Text>
        ))}
      </View>

      {notice}

      <View style={styles.grid}>
        {loading ? (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : null}
        {cells.map((c) => {
          const isSelected = c.epoch === selectedDayMs
          const isToday = c.epoch === todayMs
          const marked = markedDays !== null && markedDays.has(c.epoch)
          return (
            <Pressable
              key={c.epoch}
              style={[
                styles.cell,
                isSelected && { backgroundColor: colors.primary },
                !isSelected && isToday && { borderColor: colors.primary, borderWidth: 1 },
              ]}
              disabled={c.isFuture}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected, disabled: c.isFuture }}
              onPress={() => onSelectDay(c.epoch)}
            >
              <Text
                style={[
                  styles.cellText,
                  {
                    color: c.isFuture
                      ? colors.foregroundSubtle
                      : isSelected
                        ? colors.primaryForeground
                        : c.inMonth
                          ? colors.foreground
                          : colors.foregroundMuted,
                  },
                ]}
              >
                {new Date(c.epoch).getDate()}
              </Text>
              {marked && !isSelected ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
            </Pressable>
          )
        })}
      </View>
    </View>
  )
})

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: TYPOGRAPHY.size.md, fontWeight: TYPOGRAPHY.weight.bold, textTransform: 'capitalize' },
  quickRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.xs },
  quickButton: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.xs,
    alignItems: 'center',
  },
  quickText: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.bold },
  weekRow: { flexDirection: 'row' },
  weekday: { width: COLUMN, textAlign: 'center', fontSize: TYPOGRAPHY.size.xs, fontWeight: TYPOGRAPHY.weight.medium },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  // Compact rows: six weeks of square cells were taller than the timeline body
  // on a phone.
  cell: { width: COLUMN, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.md },
  cellText: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.medium },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 1 },
})
