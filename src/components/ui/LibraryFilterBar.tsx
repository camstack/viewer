/**
 * LibraryFilterBar — THE filter bar of every Library page (Events, Media,
 * People, Plates, Retrain). The pages stay separate; only how they filter is
 * one thing. Layout agreed with the operator on 2026-10-21 (second pass, the
 * same day — a header in ONE row under the scope bar):
 *
 *   [📅 date ▾] [Cameras 3 ▾] [Classes ▾] [Reset ✕] [actions…] →|  (eye) (⋯) (+)
 *   200 faces                                                   ← summary
 *
 * The chips scroll; the right end does not. It holds the page's tools (icons
 * that open their menu — the review pages' eye holds the order), its `⋯` menu (`HeaderOverflowMenu`) and its
 * ONE primary action as "+" — labelled only where there is room (tablet and
 * desktop widths). The pages used to spend three rows on this (a header with
 * ⋯ + the labelled action, a lone sort row, the chips) before the first tile.
 *
 * Each page passes a DECLARATIVE list of facets and keeps its filter state
 * where it already lives; the bar only draws it. Every facet is a
 * {@link FilterChip} stating its own count, and every chip opens the SAME
 * picker idiom: an {@link AnchoredMenu} on the chip holding one or more
 * {@link SectionMultiselect} lists (searchable when the list is long), or —
 * for the one facet that is a tree (Events' kinds) — the page's own body.
 *
 * The date chip (`date`) is the timeline's date control without the time
 * (operator, 2026-10-23): a calendar chip that opens the kit's
 * {@link MonthCalendar} in the same anchored menu; a pick applies and closes.
 * On Events and Media it is navigation (the day the feed starts from) and
 * never counts towards Reset; on People and Plates it is a filter with an
 * "All dates" answer, and Reset clears it.
 *
 * Reset appears only when something is narrowed or typed, and sits AFTER the
 * facets so its arrival never moves a chip the operator is reaching for. It
 * clears the typed searches too: those live here, not in the page's state.
 *
 * A page's secondary TOOLS (Events' Display and Share, the review pages' eye
 * with their sort and tile details) are icon buttons at the right end — never
 * chips among the filters, where they read as one more facet. An order lives
 * in such a tool and is never part of Reset: an order is not a filter. An
 * action — a tool or the primary — may open a menu of its own through the
 * same idiom.
 */
import React, { memo, useCallback, useRef, useState, type ReactNode } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Calendar, Plus, X, type LucideIcon } from '../../lib/icons.js'
import { SCREEN_GUTTER, SPACING, TYPOGRAPHY } from '../../theme/tokens.js'
import { useTheme } from '../../theme/theme-provider.js'
import { useViewportSize } from '../../hooks/use-viewport-size.js'
import { HeaderActionCluster, type HeaderAction } from '../ScreenHeader.js'
import { AnchoredMenu } from './AnchoredMenu.js'
import { useHeaderOverflowMenu, type OverflowMenuItem } from './HeaderOverflowMenu.js'
import { libraryPrimaryShowsLabel } from './library-grid.js'
import type { AnchorRect } from './dropdown-placement.js'
import { MonthCalendar } from './MonthCalendar.js'
import { libraryDateLabel, startOfLocalDay } from '../../lib/local-day.js'
import { useDateLocale } from '../../lib/date-locale.js'
import { FilterChip, type FilterChipIcon } from './FilterChip.js'
import { SectionMultiselect } from '../events/EventKindTree.js'

/** One pickable answer. */
export interface LibraryFilterOption {
  readonly key: string
  readonly label: string
}

/** One checkbox list inside a facet's menu. */
export interface LibraryFilterSection {
  readonly title: string
  readonly options: readonly LibraryFilterOption[]
  readonly selected: readonly string[]
  /** The page decides what a tap means (multi, or single-pick). */
  readonly onToggle: (key: string) => void
  /** A search box over the list — for a list the operator scrolls (cameras). */
  readonly searchPlaceholder?: string
  /** Close the menu after a pick — a DESTINATION list, not a selection. */
  readonly closeOnPick?: boolean
  /** A line above the list saying what a pick does. */
  readonly hint?: string
}

/** What a chip opens: lists in the shared idiom, or the page's own body. */
interface LibraryMenuContent {
  readonly sections?: readonly LibraryFilterSection[]
  /** A body the lists cannot express (Events' kind tree); `close` dismisses. */
  readonly render?: (close: () => void) => ReactNode
  readonly menuWidth?: number
  readonly estimatedHeight?: number
}

/** One facet: a chip with its count, and its menu. */
export interface LibraryFilterDef extends LibraryMenuContent {
  readonly id: string
  readonly label: string
  readonly icon?: FilterChipIcon
  /** How many answers are picked; written on the chip when > 0. */
  readonly count: number
  /**
   * Whether this facet narrows the page AWAY FROM ITS DEFAULT — highlights the
   * chip and offers Reset. Absent ⇒ `count > 0`. A facet whose default is
   * itself a selection (the review pages' Suggested + Unassigned) states its
   * count but is not "active" until the operator moves it.
   */
  readonly active?: boolean
  readonly testID?: string
}

/** A chip that DOES something rather than narrowing (New export, Share). */
export interface LibraryActionDef extends LibraryMenuContent {
  readonly id: string
  readonly label: string
  readonly icon?: FilterChipIcon
  /** Plain action; absent ⇒ the chip opens its menu. */
  readonly onPress?: () => void
  readonly testID?: string
}

/** A secondary tool: an icon button at the row's right end (Display, Share, the eye). */
export interface LibraryToolDef extends LibraryMenuContent {
  readonly id: string
  readonly icon: LucideIcon
  /** The accessible name (the button has no visible label). */
  readonly label: string
  /** Plain action; absent ⇒ the button opens its menu. */
  readonly onPress?: () => void
  readonly testID?: string
}

/** The page's ONE primary action: a glass "+" (or its own glyph) at the row's end. */
export interface LibraryPrimaryDef extends Omit<LibraryActionDef, 'icon'> {
  readonly icon?: LucideIcon
}

/**
 * The page's date: a chip with the picked day that opens a month calendar
 * (`MonthCalendar`, the timeline's, without the time).
 */
export interface LibraryDateDef {
  /** The picked day (a local midnight), or `null` for every day (`allowAll`). */
  readonly dayMs: number | null
  /** Wall-clock now, pinned by the page: "Today", and no future day. */
  readonly nowMs: number
  /** A pick — a local midnight, or `null` for "All dates". */
  readonly onPick: (dayMs: number | null) => void
  /**
   * The page can show every day (People, Plates): the menu offers "All dates",
   * and a picked day is a NARROWING (highlighted, cleared by Reset). Absent ⇒
   * the date is navigation (Events, Media): always a day, never in Reset.
   */
  readonly allowAll?: boolean
  readonly testID?: string
}

export interface LibraryFilterBarProps {
  /** The date chip, first in the row. */
  readonly date?: LibraryDateDef
  readonly filters: readonly LibraryFilterDef[]
  readonly actions?: readonly LibraryActionDef[]
  /** Secondary tools as icon buttons at the right end. */
  readonly tools?: readonly LibraryToolDef[]
  /** The page's ONE primary action, drawn as "+" at the right end. */
  readonly primary?: LibraryPrimaryDef
  /** The page's `⋯` menu items, at the right end (absent / empty ⇒ no `⋯`). */
  readonly more?: readonly OverflowMenuItem[]
  readonly moreTestID?: string
  /** The small line under the row ("200 faces"). A blank keeps its height. */
  readonly summary?: string
  readonly summaryTestID?: string
  /** Clear every facet. The bar clears its own typed searches. */
  readonly onReset: () => void
  readonly testID?: string
}

type OpenMenu = { readonly kind: 'filter' | 'action' | 'date'; readonly id: string }

/** The date menu: the calendar's 7 columns at a comfortable tap size. */
const DATE_MENU_WIDTH = 300
const DATE_MENU_HEIGHT = 330

/** The right-end glass buttons: a size between the chips' and the app bar's. */
const END_BUTTON_SIZE = 34

export const LibraryFilterBar = memo(function LibraryFilterBar({
  date,
  filters,
  actions = [],
  tools = [],
  primary,
  more = [],
  moreTestID,
  summary,
  summaryTestID,
  onReset,
  testID,
}: LibraryFilterBarProps) {
  const { t } = useTranslation()
  const { colors } = useTheme()
  const { width } = useViewportSize()
  const overflow = useHeaderOverflowMenu(more, moreTestID)
  const anchors = useRef(new Map<string, React.RefObject<View | null>>())
  const [open, setOpen] = useState<OpenMenu | null>(null)
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
  const [queries, setQueries] = useState<Readonly<Record<string, string>>>({})
  // The month the date menu shows: set to the picked day's month on open.
  const [monthMs, setMonthMs] = useState(0)
  const dateLocale = useDateLocale()

  const refFor = (key: string): React.RefObject<View | null> => {
    const found = anchors.current.get(key)
    if (found !== undefined) return found
    const created = React.createRef<View>()
    anchors.current.set(key, created)
    return created
  }

  const openMenu = (menu: OpenMenu): void => {
    refFor(`${menu.kind}:${menu.id}`).current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height })
      setOpen(menu)
    })
  }
  const close = useCallback(() => setOpen(null), [])

  const typed = Object.values(queries).some((q) => q.trim().length > 0)
  const isActive = (f: LibraryFilterDef): boolean => f.active ?? f.count > 0
  const dateNarrows = date !== undefined && date.allowAll === true && date.dayMs !== null
  const narrowed = filters.some(isActive) || dateNarrows
  const resetAll = useCallback(() => {
    onReset()
    setQueries({})
  }, [onReset])

  const openDate = (): void => {
    if (date === undefined) return
    setMonthMs(date.dayMs ?? date.nowMs)
    openMenu({ kind: 'date', id: 'date' })
  }
  const pickDate = (dayMs: number | null): void => {
    close()
    date?.onPick(dayMs === null ? null : startOfLocalDay(dayMs))
  }
  const changeMonth = (delta: number): void => {
    setMonthMs((prev) => {
      const d = new Date(prev)
      return new Date(d.getFullYear(), d.getMonth() + delta, 1, 0, 0, 0, 0).getTime()
    })
  }
  const dateMenu: LibraryMenuContent | undefined =
    date === undefined
      ? undefined
      : {
          menuWidth: DATE_MENU_WIDTH,
          estimatedHeight: DATE_MENU_HEIGHT,
          render: () => (
            <View style={styles.dateMenu}>
              <MonthCalendar
                monthAnchorMs={monthMs}
                onChangeMonth={changeMonth}
                selectedDayMs={date.dayMs}
                nowMs={date.nowMs}
                onSelectDay={pickDate}
                {...(date.allowAll === true
                  ? { allDates: { label: t('v2.library.allDates'), onSelect: () => pickDate(null) } }
                  : {})}
                testID="library-date-calendar"
              />
            </View>
          ),
        }

  const content: LibraryMenuContent | undefined =
    open === null
      ? undefined
      : open.kind === 'date'
        ? dateMenu
        : open.kind === 'filter'
        ? filters.find((f) => f.id === open.id)
        : [...actions, ...tools, ...(primary !== undefined ? [primary] : [])].find((a) => a.id === open.id)
  const menuKey = open === null ? '' : `${open.kind}:${open.id}`

  // The right end: the tools, `⋯`, then the primary "+" (labelled where there is room).
  const endActions: HeaderAction[] = []
  for (const tool of tools) {
    endActions.push({
      id: tool.id,
      icon: tool.icon,
      label: tool.label,
      anchorRef: refFor(`action:${tool.id}`),
      active: open?.kind === 'action' && open.id === tool.id,
      onPress: tool.onPress ?? (() => openMenu({ kind: 'action', id: tool.id })),
      testID: tool.testID,
    })
  }
  if (more.length > 0) endActions.push(overflow.action)
  if (primary !== undefined) {
    endActions.push({
      id: primary.id,
      icon: primary.icon ?? Plus,
      label: primary.label,
      showLabel: libraryPrimaryShowsLabel(width),
      anchorRef: refFor(`action:${primary.id}`),
      onPress: primary.onPress ?? (() => openMenu({ kind: 'action', id: primary.id })),
      testID: primary.testID,
    })
  }

  return (
    <View style={styles.wrap} testID={testID}>
      <View style={styles.row}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.chipScroll}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          {date !== undefined ? (
            <View testID={date.testID}>
              <FilterChip
                anchorRef={refFor('date:date')}
                label={libraryDateLabel(date.dayMs, date.nowMs, dateLocale, {
                  today: t('v2.calendar.today'),
                  yesterday: t('v2.calendar.yesterday'),
                  allDates: t('v2.library.allDates'),
                })}
                icon={Calendar}
                menu
                active={dateNarrows}
                onPress={openDate}
              />
            </View>
          ) : null}
          {filters.map((f) => (
            <View key={f.id} testID={f.testID}>
              <FilterChip
                anchorRef={refFor(`filter:${f.id}`)}
                label={f.label}
                icon={f.icon}
                count={f.count}
                menu
                active={isActive(f)}
                onPress={() => openMenu({ kind: 'filter', id: f.id })}
              />
            </View>
          ))}
          {narrowed || typed ? (
            <FilterChip label={t('common.reset')} icon={X} active={false} onPress={resetAll} />
          ) : null}
          {actions.map((a) => (
            <View key={a.id} testID={a.testID}>
              <FilterChip
                anchorRef={refFor(`action:${a.id}`)}
                label={a.label}
                icon={a.icon}
                menu={a.onPress === undefined}
                active={false}
                onPress={a.onPress ?? (() => openMenu({ kind: 'action', id: a.id }))}
              />
            </View>
          ))}
        </ScrollView>
        {endActions.length > 0 ? <HeaderActionCluster actions={endActions} size={END_BUTTON_SIZE} /> : null}
      </View>

      {summary !== undefined ? (
        <Text style={[styles.summary, { color: colors.foregroundMuted }]} numberOfLines={1} testID={summaryTestID}>
          {summary}
        </Text>
      ) : null}

      <AnchoredMenu
        visible={content !== undefined}
        onRequestClose={close}
        anchor={anchor}
        align={tools.some((tool) => tool.id === open?.id) ? 'end' : 'start'}
        minWidth={content?.menuWidth ?? 280}
        estimatedHeight={content?.estimatedHeight ?? 420}
      >
        <View style={styles.menuBody}>
          {content?.render !== undefined
            ? content.render(close)
            : (content?.sections ?? []).map((section, i) => {
                const qKey = `${menuKey}:${String(i)}`
                const q = (queries[qKey] ?? '').trim().toLowerCase()
                const shown = q ? section.options.filter((o) => o.label.toLowerCase().includes(q)) : section.options
                return (
                  <View key={qKey}>
                  {section.hint !== undefined ? (
                    <Text style={[styles.hint, { color: colors.foregroundSubtle }]}>{section.hint}</Text>
                  ) : null}
                  <SectionMultiselect
                    title={section.title}
                    emptyLabel={t('v2.events.all')}
                    items={shown.map((o) => ({
                      key: o.key,
                      label: o.label,
                      selected: section.selected.includes(o.key),
                    }))}
                    onToggle={(key) => {
                      if (section.closeOnPick === true) close()
                      section.onToggle(key)
                    }}
                    {...(section.searchPlaceholder !== undefined
                      ? {
                          query: queries[qKey] ?? '',
                          onQuery: (next: string) => setQueries((prev) => ({ ...prev, [qKey]: next })),
                          placeholder: section.searchPlaceholder,
                        }
                      : {})}
                  />
                  </View>
                )
              })}
        </View>
      </AnchoredMenu>
      {overflow.menu}
    </View>
  )
})

const styles = StyleSheet.create({
  wrap: { gap: SPACING.xs, paddingHorizontal: SCREEN_GUTTER, paddingTop: SPACING.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  chipScroll: { flex: 1 },
  chips: { gap: SPACING.sm, alignItems: 'center', paddingRight: SPACING.md },
  // One fixed line, so the count appearing never moves the grid.
  summary: { fontSize: TYPOGRAPHY.size.sm, fontWeight: TYPOGRAPHY.weight.regular, minHeight: 16, paddingBottom: SPACING.xs },
  // No minWidth of its own: the card's width (`menuWidth`) owns it — a body
  // wider than the card was cut at the card's right edge (the review eye, 240).
  menuBody: { paddingHorizontal: SPACING.md, paddingBottom: SPACING.sm },
  hint: { fontSize: 11, lineHeight: 16, paddingTop: SPACING.sm },
  dateMenu: { paddingTop: SPACING.sm },
})
