/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FRAME_SETTLE_MS } from '../cursor-frames.js'
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
})
