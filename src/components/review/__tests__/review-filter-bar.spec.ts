/**
 * @vitest-environment jsdom
 *
 * The review pages' (People, Plates) Library bar: the eye is the shared
 * `DisplayMenu` in the Events style (operator, 2026-10-23) — titled cards,
 * the sort as segments, the tile details as switches — and the date is the
 * Library calendar chip with "All dates", replacing the old Period list.
 */
import React from 'react'
import { act, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mountScreen } from '../../../testing/mount.js'
import { DisplayMenu } from '../../ui/DisplayMenu.js'
import { reviewDisplayMenu, reviewFilterBar, type ReviewFilterBarInput } from '../review-filter-bar.js'
import {
  DEFAULT_FACE_REVIEW_FILTERS,
  DEFAULT_FACE_REVIEW_SORT,
  type FaceReviewFilterState,
  type FaceReviewSort,
} from '../../../data/face-review-filters.js'
import { TYPOGRAPHY } from '../../../theme/tokens.js'

vi.mock('../../../connection/ConnectionProvider.js', async () =>
  (await import('../../../testing/connection-stub.js')).connectionStubModule(),
)
afterEach(cleanup)

const t = (key: string): string => `T:${key}`
const NOW = new Date(2026, 9, 23, 12).getTime()

function input(overrides: Partial<ReviewFilterBarInput> = {}): ReviewFilterBarInput {
  return {
    t,
    filters: DEFAULT_FACE_REVIEW_FILTERS,
    setFilters: vi.fn(),
    sort: DEFAULT_FACE_REVIEW_SORT,
    setSort: vi.fn(),
    cameras: [{ deviceId: 1, name: 'Front door' }],
    nowMs: NOW,
    onPickDay: vi.fn(),
    sortKeyLabel: { certainty: 'MARK-Certainty', date: 'MARK-Date' },
    display: { showDate: true, showCamera: false },
    onDisplayChange: vi.fn(),
    ...overrides,
  }
}

describe.each([
  ['People', { certainty: 'Certainty', date: 'Date' }],
  ['Plates', { certainty: 'Read confidence', date: 'Date' }],
])('%s — the eye', (_page, sortKeyLabel) => {
  const sections = reviewDisplayMenu(input({ sortKeyLabel }))

  it('three titled cards: Sort by, Direction, On each tile', () => {
    expect(sections.map((s) => s.title)).toEqual([
      'T:v2.library.sortBy',
      'T:v2.library.direction',
      'T:v2.library.onEachTile',
    ])
  })

  it('the sort key and the direction are segments in the page\'s words', () => {
    const [sortBy, direction] = sections
    const key = sortBy?.items[0]
    const dir = direction?.items[0]
    if (key?.kind !== 'choice' || dir?.kind !== 'choice') throw new Error('not choices')
    expect(key.options.map((o) => o.label)).toEqual([sortKeyLabel.certainty, sortKeyLabel.date])
    expect(key.value).toBe('certainty')
    expect(dir.options.map((o) => [o.value, o.label])).toEqual([
      ['desc', 'T:v2.library.descending'],
      ['asc', 'T:v2.library.ascending'],
    ])
    expect(dir.value).toBe('desc')
  })

  it('the tile details are switches, date first', () => {
    const items = sections[2]?.items ?? []
    expect(items.map((i) => [i.kind, i.id, i.value])).toEqual([
      ['toggle', 'date', true],
      ['toggle', 'camera', false],
    ])
  })
})

describe('the eye writes the sort and the details', () => {
  it('a segment sets the key, the other the direction; an unknown value writes nothing', () => {
    let sort: FaceReviewSort = DEFAULT_FACE_REVIEW_SORT
    const setSort = (update: (prev: FaceReviewSort) => FaceReviewSort): void => { sort = update(sort) }
    const [sortBy, direction] = reviewDisplayMenu(input({ setSort }))
    const key = sortBy?.items[0]
    const dir = direction?.items[0]
    if (key?.kind !== 'choice' || dir?.kind !== 'choice') throw new Error('not choices')
    key.onChange('certainty')
    dir.onChange('asc')
    key.onChange('nonsense')
    expect(sort).toEqual({ key: 'certainty', direction: 'asc' })
  })

  it('a switch writes its own detail only', () => {
    const onDisplayChange = vi.fn()
    const camera = reviewDisplayMenu(input({ onDisplayChange }))[2]?.items[1]
    if (camera?.kind !== 'toggle') throw new Error('not a toggle')
    camera.onChange(true)
    expect(onDisplayChange).toHaveBeenCalledWith({ showDate: true, showCamera: true })
  })

  it('mounted: the cards draw segments and switches at the chips\' type size', () => {
    const { getByText, getAllByRole } = mountScreen(
      React.createElement(DisplayMenu, { sections: reviewDisplayMenu(input()) }),
    )
    expect(getAllByRole('switch')).toHaveLength(2)
    expect(getComputedStyle(getByText('MARK-Certainty')).fontSize).toBe(`${String(TYPOGRAPHY.size.sm)}px`)
    expect(getComputedStyle(getByText('T:v2.library.showCamera')).fontSize).toBe(`${String(TYPOGRAPHY.size.sm)}px`)
    const setSort = vi.fn()
    cleanup()
    const mounted = mountScreen(React.createElement(DisplayMenu, { sections: reviewDisplayMenu(input({ setSort })) }))
    act(() => { fireEvent.click(mounted.getByText('MARK-Certainty')) })
    expect(setSort).toHaveBeenCalledTimes(1)
  })
})

describe('the date replaces the Period list', () => {
  it('no Period facet is left among the chips', () => {
    expect(reviewFilterBar(input()).filters.map((f) => f.id)).toEqual(['cameras', 'status'])
  })

  it('the date chip is the page\'s picked day, with "All dates" allowed', () => {
    const day = new Date(2026, 9, 20).getTime()
    const filters: FaceReviewFilterState = { ...DEFAULT_FACE_REVIEW_FILTERS, dayMs: day }
    const onPickDay = vi.fn()
    const bar = reviewFilterBar(input({ filters, onPickDay }))
    expect(bar.date).toMatchObject({ dayMs: day, nowMs: NOW, allowAll: true })
    bar.date.onPick(null)
    expect(onPickDay).toHaveBeenCalledWith(null)
  })

  it('Reset clears the day and restores the default filters', () => {
    const onPickDay = vi.fn()
    let filters: FaceReviewFilterState = { statuses: ['assigned'], deviceIds: [3], dayMs: 1 }
    const setFilters = (update: (prev: FaceReviewFilterState) => FaceReviewFilterState): void => { filters = update(filters) }
    reviewFilterBar(input({ onPickDay, setFilters })).onReset()
    expect(onPickDay).toHaveBeenCalledWith(null)
    expect(filters).toEqual(DEFAULT_FACE_REVIEW_FILTERS)
  })
})
