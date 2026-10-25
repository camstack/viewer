/**
 * The review pages' facets (People, Plates) for the shared
 * `LibraryFilterBar`: the date (the Library's calendar chip, with "All
 * dates"), cameras, status, and the eye — the shared `DisplayMenu`, as on
 * Events: the sort (key, direction) as segments and what a tile shows besides
 * the picture and the name (the time, the camera — `review-tile.ts`) as
 * switches.
 *
 * Both pages hold the SAME state (`face-review-filters.ts`) and differ only in
 * the words of the certainty sort ("Certainty" vs "Read confidence"), so the
 * declaration lives once. It replaces the collapsible `ReviewFilterPanel` and
 * the header's Filters button: every facet is now a chip with its answer on
 * it, opening the same anchored picker as every other Library page.
 */
import React from 'react'
import { Eye, Users } from '../../lib/icons.js'
import type { LibraryDateDef, LibraryFilterDef, LibraryToolDef } from '../ui/LibraryFilterBar.js'
import { DisplayMenu } from '../ui/DisplayMenu.js'
import { DISPLAY_MENU_WIDTH, pickValue, type DisplayMenuSection } from '../ui/display-menu.js'
import { setReviewTileDetail, type ReviewTileDisplay } from './review-tile.js'
import {
  DEFAULT_FACE_REVIEW_FILTERS,
  FACE_REVIEW_SORT_KEYS,
  FACE_REVIEW_STATUSES,
  setFaceReviewSortKey,
  toggleFaceReviewDevice,
  toggleFaceReviewStatus,
  type FaceReviewFilterState,
  type FaceReviewSort,
  type FaceReviewSortDirection,
  type FaceReviewSortKey,
} from '../../data/face-review-filters.js'
import type { FaceReviewStatus } from '../../data/face-cluster-review.js'

type Translate = (key: string) => string

const STATUS_LABEL_KEY: Readonly<Record<FaceReviewStatus, string>> = {
  assigned: 'v2.faceReview.filterAssigned',
  suggested: 'v2.faceReview.filterSuggested',
  unassigned: 'v2.faceReview.filterUnassigned',
}

const SORT_DIRECTIONS: readonly FaceReviewSortDirection[] = ['desc', 'asc']

export interface ReviewFilterBarInput {
  readonly t: Translate
  readonly filters: FaceReviewFilterState
  readonly setFilters: (update: (prev: FaceReviewFilterState) => FaceReviewFilterState) => void
  readonly sort: FaceReviewSort
  readonly setSort: (update: (prev: FaceReviewSort) => FaceReviewSort) => void
  /** The cameras the loaded window holds. */
  readonly cameras: readonly { readonly deviceId: number; readonly name: string }[]
  /** Wall-clock now, pinned by the page (the chip's "Today"). */
  readonly nowMs: number
  /** Picks a day (`null` = every day) — the page pins "now" when it does. */
  readonly onPickDay: (dayMs: number | null) => void
  /** The page's word for each sort key. */
  readonly sortKeyLabel: Readonly<Record<FaceReviewSortKey, string>>
  /** What the page's tiles show (persisted per page in the settings). */
  readonly display: ReviewTileDisplay
  readonly onDisplayChange: (next: ReviewTileDisplay) => void
  /** testID of the eye button. */
  readonly displayTestID?: string
  /** testID of the date chip. */
  readonly dateTestID?: string
}

export interface ReviewFilterBar {
  readonly date: LibraryDateDef
  readonly filters: readonly LibraryFilterDef[]
  /** The eye: sort and tile details, one menu. */
  readonly display: LibraryToolDef
  readonly onReset: () => void
}

function sameStatuses(a: readonly FaceReviewStatus[], b: readonly FaceReviewStatus[]): boolean {
  return a.length === b.length && b.every((s) => a.includes(s))
}

/** Pure: the facets and the sort for one review page. */
export function reviewFilterBar(input: ReviewFilterBarInput): ReviewFilterBar {
  const { t, filters, setFilters, sort, cameras, onPickDay, sortKeyLabel } = input
  const directionLabel = (dir: FaceReviewSortDirection): string =>
    dir === 'desc' ? t('v2.library.descending') : t('v2.library.ascending')

  const facets: readonly LibraryFilterDef[] = [
    {
      id: 'cameras',
      label: t('v2.events.cameras'),
      count: filters.deviceIds.length,
      testID: 'review-filter-cameras',
      sections: [
        {
          title: t('v2.events.cameras'),
          options: cameras.map((c) => ({ key: String(c.deviceId), label: c.name })),
          selected: filters.deviceIds.map(String),
          onToggle: (key) => {
            const deviceId = Number(key)
            if (Number.isFinite(deviceId)) setFilters((prev) => toggleFaceReviewDevice(prev, deviceId))
          },
          searchPlaceholder: t('v2.events.searchCameras'),
        },
      ],
    },
    {
      id: 'status',
      label: t('v2.library.status'),
      icon: Users,
      count: filters.statuses.length,
      // The default (Suggested + Unassigned) is a selection, not a narrowing.
      active: !sameStatuses(filters.statuses, DEFAULT_FACE_REVIEW_FILTERS.statuses),
      testID: 'review-filter-status',
      estimatedHeight: 220,
      sections: [
        {
          title: t('v2.library.status'),
          options: FACE_REVIEW_STATUSES.map((s) => ({ key: s, label: t(STATUS_LABEL_KEY[s]) })),
          selected: filters.statuses,
          onToggle: (key) => {
            const status = FACE_REVIEW_STATUSES.find((s) => s === key)
            if (status !== undefined) setFilters((prev) => toggleFaceReviewStatus(prev, status))
          },
        },
      ],
    },
  ]

  const displayDef: LibraryToolDef = {
    id: 'display',
    icon: Eye,
    label: `${t('v2.library.displayOptions')} · ${sortKeyLabel[sort.key]} · ${directionLabel(sort.direction)}`,
    menuWidth: DISPLAY_MENU_WIDTH,
    estimatedHeight: 360,
    testID: input.displayTestID,
    render: () => React.createElement(DisplayMenu, { sections: reviewDisplayMenu(input) }),
  }

  return {
    date: {
      dayMs: filters.dayMs,
      nowMs: input.nowMs,
      onPick: onPickDay,
      allowAll: true,
      testID: input.dateTestID,
    },
    filters: facets,
    display: displayDef,
    onReset: () => {
      onPickDay(null)
      setFilters(() => DEFAULT_FACE_REVIEW_FILTERS)
    },
  }
}

/**
 * The review eye's cards: Sort by (key), Direction, and what each tile shows.
 * Pure — pinned by `__tests__/review-filter-bar.spec.ts`.
 */
export function reviewDisplayMenu(
  input: Pick<ReviewFilterBarInput, 't' | 'sort' | 'setSort' | 'sortKeyLabel' | 'display' | 'onDisplayChange'>,
): readonly DisplayMenuSection[] {
  const { t, sort, setSort, sortKeyLabel, display, onDisplayChange } = input
  return [
    {
      id: 'sort-by',
      title: t('v2.library.sortBy'),
      items: [
        {
          kind: 'choice',
          id: 'sort-key',
          options: FACE_REVIEW_SORT_KEYS.map((k) => ({ value: k, label: sortKeyLabel[k] })),
          value: sort.key,
          onChange: (v) => {
            const key = pickValue(FACE_REVIEW_SORT_KEYS, v)
            if (key !== undefined) setSort((prev) => setFaceReviewSortKey(prev, key))
          },
        },
      ],
    },
    {
      id: 'direction',
      title: t('v2.library.direction'),
      items: [
        {
          kind: 'choice',
          id: 'sort-direction',
          options: SORT_DIRECTIONS.map((d) => ({
            value: d,
            label: d === 'desc' ? t('v2.library.descending') : t('v2.library.ascending'),
          })),
          value: sort.direction,
          onChange: (v) => {
            const direction = pickValue(SORT_DIRECTIONS, v)
            if (direction !== undefined) setSort((prev) => ({ key: prev.key, direction }))
          },
        },
      ],
    },
    {
      id: 'on-tile',
      title: t('v2.library.onEachTile'),
      items: [
        {
          kind: 'toggle',
          id: 'date',
          label: t('v2.library.showDate'),
          value: display.showDate,
          onChange: (v) => onDisplayChange(setReviewTileDetail(display, 'date', v)),
        },
        {
          kind: 'toggle',
          id: 'camera',
          label: t('v2.library.showCamera'),
          value: display.showCamera,
          onChange: (v) => onDisplayChange(setReviewTileDetail(display, 'camera', v)),
        },
      ],
    },
  ]
}
