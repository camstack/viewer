import { act, cleanup, render } from '@testing-library/react'
import { createElement, useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_STALL_MS, useStallWatchdog } from '../use-stall-watchdog'

/**
 * The watchdog driven end to end against a fake `<video>`: frames advance, then
 * stop, and the recovery must fire ONCE — not once per tick.
 */
interface HarnessProps {
  readonly playing: boolean
  readonly onRecover: () => void
}

function Harness({ playing, onRecover }: HarnessProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const state = useStallWatchdog({ containerRef: ref, playing, onRecover })
  return createElement(
    'div',
    {
      ref,
      'data-recovering': state.recovering ? 'true' : 'false',
      'data-attempts': state.attempts,
    },
    createElement('video'),
  )
}

/** Advance `currentTime` so the fallback path sees frames being presented. */
function advanceFrames(video: HTMLVideoElement, seconds: number): void {
  Object.defineProperty(video, 'currentTime', { value: seconds, configurable: true })
}

describe('useStallWatchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Force the `currentTime` fallback: rVFC does not exist in jsdom anyway,
    // but being explicit keeps the test honest about which path it exercises.
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      value: 0,
      writable: true,
      configurable: true,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    cleanup()
  })

  it('does NOT recover while frames keep advancing', () => {
    const onRecover = vi.fn()
    const { container } = render(createElement(Harness, { playing: true, onRecover }))
    const video = container.querySelector('video') as HTMLVideoElement

    // 30 seconds of healthy 1 fps — three times the stall window.
    for (let i = 1; i <= 30; i += 1) {
      act(() => {
        advanceFrames(video, i)
        vi.advanceTimersByTime(1_000)
      })
    }
    expect(onRecover).not.toHaveBeenCalled()
  })

  it('does NOT recover before the first frame — a stream that never started', () => {
    const onRecover = vi.fn()
    render(createElement(Harness, { playing: true, onRecover }))
    act(() => {
      vi.advanceTimersByTime(DEFAULT_STALL_MS * 3)
    })
    expect(onRecover).not.toHaveBeenCalled()
  })

  it('recovers ONCE on a stall, not once per tick', () => {
    const onRecover = vi.fn()
    const { container } = render(createElement(Harness, { playing: true, onRecover }))
    const video = container.querySelector('video') as HTMLVideoElement

    // Frames flow, so the watchdog arms…
    for (let i = 1; i <= 3; i += 1) {
      act(() => {
        advanceFrames(video, i)
        vi.advanceTimersByTime(1_000)
      })
    }
    expect(onRecover).not.toHaveBeenCalled()

    // …then they stop dead.
    act(() => {
      vi.advanceTimersByTime(DEFAULT_STALL_MS + 1_000)
    })
    expect(onRecover).toHaveBeenCalledTimes(1)
    expect(container.firstElementChild?.getAttribute('data-recovering')).toBe('true')

    // The stall continues; the backoff must hold the second attempt back.
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    expect(onRecover).toHaveBeenCalledTimes(1)
  })

  it('does not run at all while the player is not playing', () => {
    const onRecover = vi.fn()
    render(createElement(Harness, { playing: false, onRecover }))
    act(() => {
      vi.advanceTimersByTime(DEFAULT_STALL_MS * 5)
    })
    expect(onRecover).not.toHaveBeenCalled()
  })

  it('a SUCCESSFUL recovery clears the attempt counter', () => {
    const onRecover = vi.fn()
    const { container } = render(createElement(Harness, { playing: true, onRecover }))
    const video = container.querySelector('video') as HTMLVideoElement
    const root = () => container.firstElementChild

    act(() => {
      advanceFrames(video, 1)
      vi.advanceTimersByTime(1_000)
    })
    act(() => {
      vi.advanceTimersByTime(DEFAULT_STALL_MS + 1_000)
    })
    expect(onRecover).toHaveBeenCalledTimes(1)
    expect(root()?.getAttribute('data-attempts')).toBe('1')

    // Frames resume — the tile was repaired, so the next unrelated stall must
    // start from a clean budget rather than finding it half spent.
    let t = 2
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        advanceFrames(video, t)
        t += 1
        vi.advanceTimersByTime(1_000)
      })
    }
    expect(root()?.getAttribute('data-attempts')).toBe('0')
  })
})
