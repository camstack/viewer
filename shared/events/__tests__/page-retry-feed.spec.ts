/**
 * @vitest-environment jsdom
 *
 * The feed already owned the retry. These pin the policy the reel and the
 * gallery share: a blip stays on the skeleton, a terminal answer is shown at
 * once, and the retry button starts the cycle over.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { EventsFeedClient } from '../events-client.js'
import { useEventsFeed } from '../use-events-feed.js'

function feedParams(listRecentTracks: EventsFeedClient['listRecentTracks']) {
  return {
    client: { listRecentTracks },
    deviceIds: [1] as const,
    nameById: new Map<number, string>([[1, 'Front']]),
    pageSize: 20,
    maxRows: 40,
    refreshMs: 0,
    maxAgeMs: 86_400_000,
    devicesResolved: true,
    channel: 'test',
  }
}

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe('the events feed honours the page retry', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps loading through the backoff and admits the error only on the last attempt', async () => {
    vi.useFakeTimers()
    let calls = 0
    const listRecentTracks = (): Promise<unknown> => {
      calls += 1
      return Promise.reject(new Error('socket hang up'))
    }
    const { result } = renderHook(() => useEventsFeed(feedParams(listRecentTracks)))
    await settle()
    expect(calls).toBe(1)
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(true)

    // Below the shortest first wait (800 ms). The old 300 ms backoff would
    // already have fired a second request here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(calls).toBe(1)
    expect(result.current.loading).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000)
    })
    expect(calls).toBe(4)
    expect(result.current.error).toBe('socket hang up')
    expect(result.current.loading).toBe(false)
  })

  it('shows an auth or not-found failure at once', async () => {
    vi.useFakeTimers()
    let calls = 0
    const listRecentTracks = (): Promise<unknown> => {
      calls += 1
      return Promise.reject(
        Object.assign(new Error('NOT_FOUND: listRecentTracks'), {
          data: { code: 'NOT_FOUND', httpStatus: 404 },
        }),
      )
    }
    const { result } = renderHook(() => useEventsFeed(feedParams(listRecentTracks)))
    await settle()
    expect(calls).toBe(1)
    expect(result.current.error).toBe('NOT_FOUND: listRecentTracks')
    expect(result.current.loading).toBe(false)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(calls).toBe(1)
  })

  it('a manual retry starts the cycle again', async () => {
    vi.useFakeTimers()
    let calls = 0
    const listRecentTracks = (): Promise<unknown> => {
      calls += 1
      return Promise.reject(new Error('socket hang up'))
    }
    const { result } = renderHook(() => useEventsFeed(feedParams(listRecentTracks)))
    await settle()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000)
    })
    expect(calls).toBe(4)
    expect(result.current.error).toBe('socket hang up')

    act(() => {
      result.current.retry()
    })
    await settle()
    expect(calls).toBe(5)
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000)
    })
    expect(calls).toBe(8)
    expect(result.current.error).toBe('socket hang up')
  })
})
