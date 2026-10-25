/**
 * @vitest-environment jsdom
 *
 * What the review grid ASKS the hub. Status, cameras, window and sort must
 * travel in the `listRecentFaces` input so the hub applies them before
 * `limit`: client-side they ranked the newest 200 faces only, and 49 of the 50
 * best suggestions sat beyond that window. The trpc client is a spy; the
 * assertion is on the input it received.
 */
import { localDayBounds } from '../../lib/local-day.js'
import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import React from 'react'

import { useFaceReviewFaces } from '../use-face-review.js'
import {
  DEFAULT_FACE_REVIEW_FILTERS,
  DEFAULT_FACE_REVIEW_SORT,
  faceReviewListInput,
  faceReviewListInputs,
  type FaceReviewFilterState,
  type FaceReviewSort,
} from '../face-review-filters.js'

vi.mock('../../connection/ConnectionProvider.js', () => ({
  useConnection: () => ({ controller: { getSystem: () => system }, state: 'connected' }),
}))

const calls: unknown[] = []
const system = {
  trpcClient: {
    faceGallery: {
      listRecentFaces: {
        query: (input: unknown): Promise<unknown[]> => {
          calls.push(input)
          return Promise.resolve([])
        },
      },
    },
  },
}

const NOW = 1_789_936_000_000

/** The certainty order — the default since 2026-10-23. */
const CERTAINTY_DESC: FaceReviewSort = { key: 'certainty', direction: 'desc' }

function mount(filters: FaceReviewFilterState, sort: FaceReviewSort) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
  return renderHook(() => useFaceReviewFaces(true, filters, sort), { wrapper })
}

beforeEach(() => {
  calls.length = 0
})

describe('the review grid query input', () => {
  it('opens most certain first (operator, 2026-10-23)', async () => {
    expect(DEFAULT_FACE_REVIEW_SORT).toEqual(CERTAINTY_DESC)
    mount(DEFAULT_FACE_REVIEW_FILTERS, DEFAULT_FACE_REVIEW_SORT)
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(calls[0]).toMatchObject({ filter: 'unassigned', sortBy: 'suggestionConfidence', sortDirection: 'desc' })
  })

  it('by date: ONE call by date, never by certainty', async () => {
    mount(DEFAULT_FACE_REVIEW_FILTERS, { key: 'date', direction: 'desc' })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ filter: 'unassigned', sortBy: 'timestamp', sortDirection: 'desc' })
  })

  it('under certainty: unassigned, ranked by suggestion certainty descending — plus the score-less rows by date', async () => {
    mount(DEFAULT_FACE_REVIEW_FILTERS, CERTAINTY_DESC)
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[0]).toEqual({
      filter: 'unassigned',
      limit: 200,
      includeCrops: false,
      sortBy: 'suggestionConfidence',
      sortDirection: 'desc',
    })
    // The hub sorts a face with no suggestion LAST: under certainty alone a
    // page full of suggestions showed no Unassigned face at all.
    expect(calls[1]).toEqual({
      filter: 'unassigned',
      limit: 200,
      includeCrops: false,
      sortBy: 'timestamp',
      sortDirection: 'desc',
    })
  })

  it('two chips without Suggested ask by date, never by a certainty none of their rows has', () => {
    const inputs = faceReviewListInputs(
      { ...DEFAULT_FACE_REVIEW_FILTERS, statuses: ['assigned', 'unassigned'] },
      { key: 'certainty', direction: 'asc' },
      200,
    )
    expect(inputs).toEqual([expect.objectContaining({ filter: 'all', sortBy: 'timestamp', sortDirection: 'desc' })])
  })

  it('Suggested + Assigned under certainty: the assigned faces get their own call', () => {
    const inputs = faceReviewListInputs(
      { ...DEFAULT_FACE_REVIEW_FILTERS, statuses: ['assigned', 'suggested'] },
      CERTAINTY_DESC,
      200,
    )
    expect(inputs.map((input) => [input.filter, input.sortBy])).toEqual([
      ['all', 'suggestionConfidence'],
      ['identified', 'timestamp'],
    ])
  })

  it('merges the pages: an unassigned face beyond a full page of suggestions is listed, each face once', async () => {
    const suggested = Array.from({ length: 200 }, (_, i) => ({ faceId: `s${String(i)}`, deviceId: 1, trackId: `t${String(i)}`, timestamp: NOW - i, suggestedIdentityId: 'p1', suggestedMatchScore: 0.9 }))
    const plain = [{ faceId: 'u1', deviceId: 1, trackId: 'tu', timestamp: NOW }, { faceId: 's0', deviceId: 1, trackId: 't0', timestamp: NOW }]
    const original = system.trpcClient.faceGallery.listRecentFaces.query
    onTestFinished(() => {
      system.trpcClient.faceGallery.listRecentFaces.query = original
    })
    system.trpcClient.faceGallery.listRecentFaces.query = (input: unknown) => {
      calls.push(input)
      const byDate = typeof input === 'object' && input !== null && 'sortBy' in input && input.sortBy === 'timestamp'
      return Promise.resolve(byDate ? plain : suggested)
    }
    const { result } = mount(DEFAULT_FACE_REVIEW_FILTERS, CERTAINTY_DESC)
    await waitFor(() => expect(result.current.data?.length ?? 0).toBeGreaterThan(0))
    const ids = (result.current.data ?? []).map((face) => face.faceId)
    expect(ids).toContain('u1')
    expect(ids.filter((id) => id === 's0')).toHaveLength(1)
    expect(ids).toHaveLength(201)
    expect(result.current.hasMore).toBe(true)
  })

  it('sends cameras, the picked day and a date sort when narrowed', async () => {
    const day = localDayBounds(NOW)
    mount(
      { statuses: ['assigned'], deviceIds: [3, 4], dayMs: day.fromMs },
      { key: 'date', direction: 'asc' },
    )
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({
      filter: 'identified',
      sortBy: 'timestamp',
      sortDirection: 'asc',
      deviceIds: [3, 4],
    })
    expect(calls[0]).toMatchObject({ since: day.fromMs, until: day.toMs })
  })

  it('asks nothing when no status chip is on', () => {
    mount({ ...DEFAULT_FACE_REVIEW_FILTERS, statuses: [] }, CERTAINTY_DESC)
    expect(calls).toHaveLength(0)
    expect(faceReviewListInput({ ...DEFAULT_FACE_REVIEW_FILTERS, statuses: [] }, CERTAINTY_DESC, 200)).toBeNull()
  })

  it('maps all three chips to the hub "all" filter', () => {
    const input = faceReviewListInput(
      { ...DEFAULT_FACE_REVIEW_FILTERS, statuses: ['assigned', 'suggested', 'unassigned'] },
      CERTAINTY_DESC,
      200,
    )
    expect(input?.filter).toBe('all')
  })

  it('growing the window keeps the view and raises only the limit', async () => {
    const { result } = mount(DEFAULT_FACE_REVIEW_FILTERS, CERTAINTY_DESC)
    await waitFor(() => expect(calls).toHaveLength(2))
    act(() => result.current.loadMore())
    await waitFor(() => expect(calls).toHaveLength(4))
    expect(calls[2]).toEqual({ ...(calls[0] as object), limit: 400 })
    expect(calls[3]).toEqual({ ...(calls[1] as object), limit: 400 })
  })
})
