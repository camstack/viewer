/**
 * @vitest-environment jsdom
 *
 * The Motion order reshuffles at most once per 5 s: the first update applies at
 * once, later ones inside the window coalesce into ONE trailing application
 * carrying the newest recency.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import { useCoalescedRecency } from '../use-motion-recency.js'
import { MOTION_REORDER_INTERVAL_MS } from '../motion-recency.js'

// Hoisted by vitest above the imports: the hook module imports the real
// ConnectionProvider, which must not open a socket under test.
vi.mock('../../connection/ConnectionProvider.js', async () =>
  (await import('../../testing/connection-stub.js')).connectionStubModule(),
)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useCoalescedRecency', () => {
  it('applies the first update immediately', () => {
    const { result } = renderHook(() => useCoalescedRecency(true))
    act(() => result.current.push([{ deviceId: 1, at: 10 }]))
    expect([...result.current.applied.entries()]).toEqual([[1, 10]])
  })

  it('coalesces updates inside the window into one trailing application', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders += 1
      return useCoalescedRecency(true)
    })
    act(() => result.current.push([{ deviceId: 1, at: 10 }]))
    const appliedOnce = result.current.applied
    const rendersAfterFirst = renders

    act(() => {
      vi.advanceTimersByTime(1_000)
      result.current.push([{ deviceId: 2, at: 20 }])
      vi.advanceTimersByTime(1_000)
      result.current.push([{ deviceId: 3, at: 30 }])
      vi.advanceTimersByTime(1_000)
      result.current.push([{ deviceId: 2, at: 40 }])
    })
    // Still inside the window: nothing new applied, nothing re-rendered.
    expect(result.current.applied).toBe(appliedOnce)
    expect(renders).toBe(rendersAfterFirst)

    act(() => vi.advanceTimersByTime(MOTION_REORDER_INTERVAL_MS - 3_000 - 1))
    expect(result.current.applied).toBe(appliedOnce)

    act(() => vi.advanceTimersByTime(1))
    expect([...result.current.applied.entries()]).toEqual([[1, 10], [2, 40], [3, 30]])
    expect(renders).toBe(rendersAfterFirst + 1)
  })

  it('applies at once again once a full window has passed quietly', () => {
    const { result } = renderHook(() => useCoalescedRecency(true))
    act(() => result.current.push([{ deviceId: 1, at: 10 }]))
    act(() => vi.advanceTimersByTime(MOTION_REORDER_INTERVAL_MS))
    act(() => result.current.push([{ deviceId: 2, at: 20 }]))
    expect(result.current.applied.get(2)).toBe(20)
  })

  it('never applies more than once per window under a continuous stream', () => {
    let applications = 0
    let last: unknown = null
    const { result } = renderHook(() => useCoalescedRecency(true))
    for (let i = 0; i < 200; i += 1) {
      act(() => {
        result.current.push([{ deviceId: i % 7, at: i }])
        vi.advanceTimersByTime(100)
      })
      if (result.current.applied !== last) {
        applications += 1
        last = result.current.applied
      }
    }
    // 20 s of motion every 100 ms → at most one application per 5 s window.
    expect(applications).toBeLessThanOrEqual(Math.ceil(20_000 / MOTION_REORDER_INTERVAL_MS) + 1)
    expect(applications).toBeGreaterThanOrEqual(4)
  })

  it('forgets everything and cancels the pending application when disabled', () => {
    const { result, rerender } = renderHook(({ on }) => useCoalescedRecency(on), {
      initialProps: { on: true },
    })
    act(() => result.current.push([{ deviceId: 1, at: 10 }]))
    act(() => result.current.push([{ deviceId: 2, at: 20 }]))
    rerender({ on: false })
    expect(result.current.applied.size).toBe(0)
    act(() => vi.advanceTimersByTime(MOTION_REORDER_INTERVAL_MS * 2))
    expect(result.current.applied.size).toBe(0)
  })
})
