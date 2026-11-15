/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FRAME_SETTLE_MS, SCRUB_FRAME_INTERVAL_MS } from '../cursor-frames.js'
import { useSettledInstant } from '../use-settled-instant.js'

afterEach(() => vi.useRealTimers())

describe('stills while scrubbing', () => {
  it('keep the settled instant for the whole drag, whatever the cursor does', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ instant, scrubbing }) => useSettledInstant(instant, scrubbing),
      { initialProps: { instant: 1000, scrubbing: false } },
    )
    rerender({ instant: 2000, scrubbing: true })
    rerender({ instant: 3000, scrubbing: true })
    act(() => {
      vi.advanceTimersByTime(FRAME_SETTLE_MS * 4)
    })
    expect(result.current).toBe(1000)
    rerender({ instant: 3000, scrubbing: false })
    act(() => {
      vi.advanceTimersByTime(FRAME_SETTLE_MS + 1)
    })
    expect(result.current).toBe(3000)
  })

  it('follow a drag on a live-scrub scope, at most once per interval, ending on the last position', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(
      ({ instant, scrubbing }) => useSettledInstant(instant, scrubbing, true),
      { initialProps: { instant: 1000, scrubbing: false } },
    )
    vi.advanceTimersByTime(SCRUB_FRAME_INTERVAL_MS * 2)
    rerender({ instant: 2000, scrubbing: true })
    act(() => {
      vi.advanceTimersByTime(1)
    })
    // The first move after a quiet spell commits at once.
    expect(result.current).toBe(2000)
    // Moves inside the interval wait for it.
    rerender({ instant: 3000, scrubbing: true })
    act(() => {
      vi.advanceTimersByTime(SCRUB_FRAME_INTERVAL_MS / 2)
    })
    rerender({ instant: 4000, scrubbing: true })
    expect(result.current).toBe(2000)
    act(() => {
      vi.advanceTimersByTime(SCRUB_FRAME_INTERVAL_MS)
    })
    expect(result.current).toBe(4000)
  })
})
