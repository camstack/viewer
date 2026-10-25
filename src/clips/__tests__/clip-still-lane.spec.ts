/**
 * @vitest-environment jsdom
 *
 * One still request at a time PER CAMERA, and a still that failed is not asked
 * for again this session.
 *
 * 2026-09-25, Amcrest 3836: every mounted tile fired at once, each deferral
 * came back on its own 4/8/16/30 s ladder, and a remount re-asked for stills
 * that had just failed — a chain of `/cam/playback` sessions next to the
 * live view until the camera stopped answering its keepalives. The count of
 * requests IN THE AIR is the assertion, because that is what the camera pays.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import type { ClipStillOutcome } from '../clip-still.js'
import { clipStillLaneKey } from '../clip-still-lane.js'
import { forgetClipStills } from '../clip-still-memory.js'
import { useClipStill } from '../use-clip-still.js'

const CAM_A_1 = 'https://hub/addon/provider-amcrest/clip-thumb/3836/1790224000-1790224100'
const CAM_A_2 = 'https://hub/addon/provider-amcrest/clip-thumb/3836/1790224100-1790224200'
const CAM_A_3 = 'https://hub/addon/provider-amcrest/clip-thumb/3836/1790224200-1790224300'
const CAM_B_1 = 'https://hub/addon/provider-amcrest/clip-thumb/1436/1790224000-1790224100'

function served(): ClipStillOutcome {
  return { kind: 'served', uri: 'data:image/jpeg;base64,AAAA' }
}

function refused(): ClipStillOutcome {
  return {
    kind: 'refused',
    code: 'camera-refused',
    reason: 'the camera produced no frame within 5000 ms: ffmpeg said nothing',
  }
}

/** A fetch that answers only when the spec says so, and counts what is open. */
interface ControlledFetch {
  readonly fetchStill: (url: string) => Promise<ClipStillOutcome>
  readonly asked: string[]
  inFlight(): number
  answer(url: string, outcome: ClipStillOutcome): void
}

function controlledFetch(): ControlledFetch {
  const asked: string[] = []
  const open = new Map<string, (outcome: ClipStillOutcome) => void>()
  return {
    asked,
    fetchStill: async (url) =>
      await new Promise<ClipStillOutcome>((resolve) => {
        asked.push(url)
        open.set(url, resolve)
      }),
    inFlight: () => open.size,
    answer: (url, outcome) => {
      const resolve = open.get(url)
      if (resolve === undefined) throw new Error(`nothing asked for ${url}`)
      open.delete(url)
      resolve(outcome)
    },
  }
}

beforeEach(() => {
  forgetClipStills()
})

describe('the lane key', () => {
  it('is the camera: the mint URL without its clip key', () => {
    expect(clipStillLaneKey(CAM_A_1)).toBe(clipStillLaneKey(CAM_A_2))
    expect(clipStillLaneKey(CAM_A_1)).not.toBe(clipStillLaneKey(CAM_B_1))
  })
})

describe('one still request at a time per camera', () => {
  it('asks for the second tile only once the first has been answered', async () => {
    const f = controlledFetch()
    const a = renderHook(() => useClipStill(CAM_A_1, null, { fetchStill: f.fetchStill }))
    const b = renderHook(() => useClipStill(CAM_A_2, null, { fetchStill: f.fetchStill }))
    const c = renderHook(() => useClipStill(CAM_A_3, null, { fetchStill: f.fetchStill }))
    await act(async () => {})
    expect(f.asked).toEqual([CAM_A_1])
    expect(b.result.current.phase).toBe('loading')

    await act(async () => {
      f.answer(CAM_A_1, served())
    })
    expect(a.result.current.phase).toBe('ready')
    expect(f.asked).toEqual([CAM_A_1, CAM_A_2])
    expect(f.inFlight()).toBe(1)

    await act(async () => {
      f.answer(CAM_A_2, served())
    })
    expect(f.asked).toEqual([CAM_A_1, CAM_A_2, CAM_A_3])
    a.unmount()
    b.unmount()
    c.unmount()
  })

  it('does not make one camera wait for another', async () => {
    const f = controlledFetch()
    const a = renderHook(() => useClipStill(CAM_A_1, null, { fetchStill: f.fetchStill }))
    const b = renderHook(() => useClipStill(CAM_B_1, null, { fetchStill: f.fetchStill }))
    await act(async () => {})
    expect(f.asked).toEqual([CAM_A_1, CAM_B_1])
    a.unmount()
    b.unmount()
  })

  it('never asks for a tile that unmounted while it was queued', async () => {
    const f = controlledFetch()
    const a = renderHook(() => useClipStill(CAM_A_1, null, { fetchStill: f.fetchStill }))
    const b = renderHook(() => useClipStill(CAM_A_2, null, { fetchStill: f.fetchStill }))
    await act(async () => {})
    b.unmount()
    await act(async () => {
      f.answer(CAM_A_1, served())
    })
    expect(f.asked).toEqual([CAM_A_1])
    a.unmount()
  })
})

describe('a deferral rests the CAMERA, not just the tile', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('holds the next tile of that camera until the server’s retry-after', async () => {
    const f = controlledFetch()
    const a = renderHook(() =>
      useClipStill(CAM_A_1, null, { fetchStill: f.fetchStill, random: () => 0.5 }),
    )
    const b = renderHook(() =>
      useClipStill(CAM_A_2, null, { fetchStill: f.fetchStill, random: () => 0.5 }),
    )
    await act(async () => {})
    await act(async () => {
      f.answer(CAM_A_1, {
        kind: 'deferred',
        code: 'camera-backoff',
        reason: 'camera-backoff: clip stills are paused',
        retryAfterMs: 20_000,
      })
    })
    // The next tile would get the same answer instantly: it waits instead.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_000)
    })
    expect(f.asked).toEqual([CAM_A_1])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })
    expect(f.asked).toContain(CAM_A_2)
    a.unmount()
    b.unmount()
  })
})

describe('a failed still is remembered for the session', () => {
  it('a remount after a final refusal asks nobody and shows the refusal', async () => {
    const f = controlledFetch()
    const first = renderHook(() => useClipStill(CAM_A_1, null, { fetchStill: f.fetchStill }))
    await act(async () => {})
    await act(async () => {
      f.answer(CAM_A_1, refused())
    })
    expect(first.result.current.phase).toBe('refused')
    first.unmount()

    const again = renderHook(() => useClipStill(CAM_A_1, null, { fetchStill: f.fetchStill }))
    // On the FIRST render, not after an effect: no loading frame.
    expect(again.result.current.phase).toBe('refused')
    expect(again.result.current.messageKey).toBe('v2.clips.still.cameraRefused')
    await act(async () => {})
    expect(f.asked).toEqual([CAM_A_1])
    again.unmount()
  })
})

describe('review round 1', () => {
  it('a tile that GAVE UP on deferrals is asked again on its next mount — only final refusals latch', async () => {
    vi.useFakeTimers()
    try {
      const fetchStill = vi.fn(
        async (): Promise<ClipStillOutcome> => ({
          kind: 'deferred',
          code: 'camera-backoff',
          reason: 'camera-backoff: clip stills are paused',
          retryAfterMs: 20_000,
        }),
      )
      const first = renderHook(() => useClipStill(CAM_A_1, null, { fetchStill, random: () => 0.5 }))
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300_000)
      })
      expect(first.result.current.phase).toBe('refused')
      const asked = fetchStill.mock.calls.length
      first.unmount()

      const again = renderHook(() => useClipStill(CAM_A_1, null, { fetchStill, random: () => 0.5 }))
      expect(again.result.current.phase).not.toBe('refused')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000)
      })
      expect(fetchStill.mock.calls.length).toBeGreaterThan(asked)
      again.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('aborts a request already in the air once its only tile goes away', async () => {
    const signals: AbortSignal[] = []
    const fetchStill = vi.fn(
      async (_url: string, _auth: string | null, signal?: AbortSignal) =>
        await new Promise<ClipStillOutcome>((resolve) => {
          if (signal !== undefined) signals.push(signal)
          signal?.addEventListener('abort', () => {
            resolve({ kind: 'deferred', code: null, reason: 'aborted', retryAfterMs: null })
          })
        }),
    )
    const a = renderHook(() => useClipStill(CAM_A_1, null, { fetchStill }))
    await act(async () => {})
    expect(signals).toHaveLength(1)
    expect(signals[0]?.aborted).toBe(false)
    a.unmount()
    expect(signals[0]?.aborted).toBe(true)
    // The camera's lane is free again: the next tile is asked at once.
    const b = renderHook(() => useClipStill(CAM_A_2, null, { fetchStill }))
    await act(async () => {})
    expect(fetchStill).toHaveBeenCalledTimes(2)
    b.unmount()
  })

  it('a shared request survives one of its two tiles going away', async () => {
    const f = controlledFetch()
    let seen: AbortSignal | null = null
    const fetchStill = async (url: string, _auth: string | null, signal?: AbortSignal) => {
      seen = signal ?? null
      return await f.fetchStill(url)
    }
    const a = renderHook(() => useClipStill(CAM_A_1, null, { fetchStill }))
    const b = renderHook(() => useClipStill(CAM_A_1, null, { fetchStill }))
    await act(async () => {})
    expect(f.asked).toEqual([CAM_A_1])
    a.unmount()
    // Still wanted by the other tile: NOT aborted.
    expect((seen as AbortSignal | null)?.aborted).toBe(false)
    await act(async () => {
      f.answer(CAM_A_1, served())
    })
    expect(b.result.current.phase).toBe('ready')
    b.unmount()
  })
})
