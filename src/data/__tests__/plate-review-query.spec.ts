/**
 * @vitest-environment jsdom
 *
 * What the Plates grid ASKS the hub. `plateGallery.listPlates` takes only
 * `{ deviceId?, limit?, includeCrops? }`: ONE camera and the window size travel
 * in the request; status, several cameras, the picked day and sort are applied in
 * the app and must NOT leak into the wire (a key the hub does not know is
 * stripped, and would make every filter change look like a refetch). The trpc
 * client is a spy; the assertion is on the input it received.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import React from 'react'

import { usePlateReviewPlates } from '../use-plate-review.js'
import { DEFAULT_FACE_REVIEW_FILTERS, type FaceReviewFilterState } from '../face-review-filters.js'
import { plateReviewListInput } from '../plate-review-filters.js'

vi.mock('../../connection/ConnectionProvider.js', () => ({
  useConnection: () => ({ controller: { getSystem: () => system }, state: 'connected' }),
}))

const calls: unknown[] = []
const system = {
  trpcClient: {
    plateGallery: {
      listPlates: {
        query: (input: unknown) => {
          calls.push(input)
          return Promise.resolve([])
        },
      },
    },
  },
}

function mount(filters: FaceReviewFilterState) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
  return renderHook(() => usePlateReviewPlates(true, filters), { wrapper })
}

beforeEach(() => {
  calls.length = 0
})

describe('the Plates grid query input', () => {
  it('opens on one page of metadata only', async () => {
    mount(DEFAULT_FACE_REVIEW_FILTERS)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ limit: 200, includeCrops: false })
  })

  it('pushes ONE selected camera to the hub', async () => {
    mount({ ...DEFAULT_FACE_REVIEW_FILTERS, deviceIds: [7] })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ limit: 200, includeCrops: false, deviceId: 7 })
  })

  it('keeps several cameras, status and the day in the app', async () => {
    mount({ statuses: ['assigned'], deviceIds: [3, 4], dayMs: Date.UTC(2026, 9, 1) })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ limit: 200, includeCrops: false })
    expect(
      plateReviewListInput({ statuses: ['assigned', 'suggested'], deviceIds: [], dayMs: Date.UTC(2026, 9, 1) }, 200),
    ).toEqual({ limit: 200, includeCrops: false })
  })

  it('growing the window keeps the view and raises only the limit', async () => {
    const { result } = mount({ ...DEFAULT_FACE_REVIEW_FILTERS, deviceIds: [7] })
    await waitFor(() => expect(calls).toHaveLength(1))
    act(() => result.current.loadMore())
    await waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]).toEqual({ ...(calls[0] as object), limit: 400 })
  })
})
