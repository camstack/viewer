/**
 * @vitest-environment jsdom
 *
 * `answered` — THIS window has come back (2026-11-17).
 *
 * The clips walk steps one day back per answered EMPTY window. Both reads keep
 * the previous window's rows as a placeholder while a wider window loads, so
 * `isSuccess` alone stays true across a window change and would claim the new
 * window answered with the old rows: the walk would run ahead of its reads.
 * `answered` must go false on the key change and true only when the new
 * window resolves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React from 'react'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

interface Deferred {
  readonly promise: Promise<unknown>
  readonly resolve: (v: unknown) => void
}
function deferred(): Deferred {
  let resolve: (v: unknown) => void = () => undefined
  const promise = new Promise<unknown>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

const pending: Deferred[] = []
function nextAnswer(): Promise<unknown> {
  const d = deferred()
  pending.push(d)
  return d.promise
}
async function resolveAll(value: unknown): Promise<void> {
  await act(async () => {
    while (pending.length > 0) pending.shift()?.resolve(value)
    await Promise.resolve()
  })
}

vi.mock('../../connection/ConnectionProvider.js', () => ({
  useConnection: () => ({
    controller: { getSystem: () => ({ trpcClient: {} }) },
    state: 'connected',
  }),
}))
vi.mock('../cap-query.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../cap-query.js')>()
  return { ...orig, capQuery: () => nextAnswer() }
})
vi.mock('../use-recording-provider-plan.js', () => ({
  useRecordingProviderPlan: () => ({ ours: [7], pinned: [], unresolved: [], ready: true }),
  recordingPlanKey: () => 'ours:7',
  fetchAvailabilityRows: () => nextAnswer(),
}))

const { useDeviceTracks } = await import('../use-device-tracks.js')
const { useTimelineActivity } = await import('../use-timeline-activity.js')

// Two whole days, long past: neither read has a live tail.
const DAY = 86_400_000
const UNTIL = Date.UTC(2026, 0, 10)
const ONE_DAY = UNTIL - DAY
const TWO_DAYS = UNTIL - 2 * DAY

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client }, children)
  }
}

let client: QueryClient
beforeEach(() => {
  pending.length = 0
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})
afterEach(() => {
  cleanup()
  client.clear()
})

describe('useDeviceTracks().answered', () => {
  it('is false under the previous window placeholder, true once the new window resolves', async () => {
    const { result, rerender } = renderHook(
      ({ from }: { from: number }) => useDeviceTracks(7, from, UNTIL, true, null, { pollLive: false }),
      { wrapper: wrapper(client), initialProps: { from: ONE_DAY } },
    )
    expect(result.current.answered).toBe(false)
    await waitFor(() => expect(pending.length).toBeGreaterThan(0))
    await resolveAll([])
    await waitFor(() => expect(result.current.answered).toBe(true))

    // The walk widens the window: same camera, older `since`.
    rerender({ from: TWO_DAYS })
    expect(result.current.isLoading).toBe(false) // the placeholder stands…
    expect(result.current.answered).toBe(false) // …and is not an answer
    await waitFor(() => expect(pending.length).toBeGreaterThan(0))
    expect(result.current.answered).toBe(false)
    await resolveAll([])
    await waitFor(() => expect(result.current.answered).toBe(true))
  })
})

describe('useTimelineActivity().answered', () => {
  it('is false under the previous window placeholder, true once the new window resolves', async () => {
    const { result, rerender } = renderHook(
      ({ from }: { from: number }) => useTimelineActivity(7, from, UNTIL, true),
      { wrapper: wrapper(client), initialProps: { from: ONE_DAY } },
    )
    expect(result.current.answered).toBe(false)
    await waitFor(() => expect(pending.length).toBe(2))
    await resolveAll(null)
    await waitFor(() => expect(result.current.answered).toBe(true))

    rerender({ from: TWO_DAYS })
    expect(result.current.loading).toBe(false)
    expect(result.current.answered).toBe(false)
    await waitFor(() => expect(pending.length).toBe(2))
    expect(result.current.answered).toBe(false)
    await resolveAll(null)
    await waitFor(() => expect(result.current.answered).toBe(true))
  })
})
