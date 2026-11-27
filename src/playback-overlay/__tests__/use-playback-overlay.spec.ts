/**
 * @vitest-environment jsdom
 *
 * The overlay hook's presented-frame wiring (planning#728 P2): a seek clears
 * the presented ref, a report landing while a seek awaits its anchor is
 * dropped, and the 200 ms tick takes a fresh report into the clock.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: { stub: true } }) }))
vi.mock('../../connection/ConnectionProvider.js', () => ({
  useConnection: () => ({ controller: { getSystem: () => null }, state: 'disconnected' }),
}))
// The frame IS the time the hook settled on.
vi.mock('../playback-window-read.js', async (orig) => ({
  ...(await orig<typeof import('../playback-window-read.js')>()),
  frameFromWindow: (_d: unknown, t: number) => ({ availability: 'known', t }),
}))

import { usePlaybackOverlay, type PlaybackOverlayInput } from '../use-playback-overlay.js'
import type { PresentedReport } from '../playback-clock.js'

const BASE: PlaybackOverlayInput = {
  deviceId: 1,
  enabled: true,
  playhead: 100_000,
  seekTarget: null,
  seekAnchor: null,
  scrubbing: false,
  paused: false,
  rate: 1,
}
const timeOf = (r: { current: unknown }): number => (r.current as { t: number }).t

describe('usePlaybackOverlay — presented frame', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })
  afterEach(() => vi.useRealTimers())

  it('the tick takes the presented report over the send cursor', () => {
    const presentedRef: { current: PresentedReport | null } = { current: null }
    const { result } = renderHook(() => usePlaybackOverlay({ ...BASE, presentedRef }))
    presentedRef.current = { epochMs: 99_800, atWall: Date.now() }
    act(() => void vi.advanceTimersByTime(200))
    // anchored at 99 800 on the presented frame, not the cursor's 100 000
    expect(timeOf(result)).toBe(99_800 + 200 - 0)
  })

  it('a seek clears the presented ref', () => {
    const presentedRef: { current: PresentedReport | null } = {
      current: { epochMs: 5, atWall: Date.now() },
    }
    const { rerender } = renderHook((p: PlaybackOverlayInput) => usePlaybackOverlay(p), {
      initialProps: { ...BASE, presentedRef },
    })
    presentedRef.current = { epochMs: 5, atWall: Date.now() }
    rerender({ ...BASE, presentedRef, seekAnchor: 500_000 })
    expect(presentedRef.current).toBeNull()
  })

  it('drops a report that lands while the seek awaits its anchor', () => {
    const presentedRef: { current: PresentedReport | null } = { current: null }
    const { result, rerender } = renderHook((p: PlaybackOverlayInput) => usePlaybackOverlay(p), {
      initialProps: { ...BASE, presentedRef },
    })
    rerender({ ...BASE, presentedRef, seekAnchor: 500_000 })
    presentedRef.current = { epochMs: 100_000, atWall: Date.now() } // old pointer
    act(() => void vi.advanceTimersByTime(200))
    expect(timeOf(result)).toBeGreaterThanOrEqual(500_000)
    expect(timeOf(result)).toBeLessThan(501_000)
  })
})
