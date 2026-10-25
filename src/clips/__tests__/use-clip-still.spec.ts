/**
 * @vitest-environment jsdom
 *
 * A tile that was told "you are in the queue" comes back — and one that was
 * told "never" does not (D563, D573).
 *
 * Every assertion here is made with NOTHING awaited beyond the tick the answer
 * arrives on. That is the specific gap the admin surface's first pass had: its
 * honest-state specs all passed while the wire lied, because each one warmed
 * the state before asserting it. A first paint is asserted from the state a
 * first paint is actually in.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import {
  CLIP_STILL_DISPOSITION_HEADER,
  CLIP_STILL_REASON_CODE_HEADER,
  CLIP_STILL_REASON_HEADER,
  CLIP_STILL_RETRY_ATTEMPTS,
  type ClipStillOutcome,
} from '../clip-still.js'
import { fetchClipStill, useClipStill } from '../use-clip-still.js'
import { forgetClipStills } from '../clip-still-memory.js'

const URL_592 = 'https://hub/addon/provider-reolink/clip-thumb/592/687d6b38'

/** The hub's real deferral, headers and all. */
function deferred(): ClipStillOutcome {
  return {
    kind: 'deferred',
    code: 'queue-full',
    reason: 'queue-full: 16 thumbnail mints already waiting for host 192.0.2.80',
    retryAfterMs: 16_000,
  }
}

function served(): ClipStillOutcome {
  return { kind: 'served', uri: 'data:image/jpeg;base64,AAAA' }
}


/**
 * Module-level state outlives a test file's mounts (D574): a still held from
 * one case, or a request still in the air when its tile unmounted, would be
 * handed to the next case and the ladder assertions below would count zero
 * requests. Every spec that drives `useClipStill` must start from an empty
 * memory.
 */
beforeEach(() => {
  forgetClipStills()
})

describe('fetchClipStill reads the answer off the wire', () => {
  it('a 204 is never asked for a body, and carries its three headers through', async () => {
    const response = new Response(null, {
      status: 204,
      headers: {
        [CLIP_STILL_DISPOSITION_HEADER]: 'deferred',
        [CLIP_STILL_REASON_CODE_HEADER]: 'queue-full',
        [CLIP_STILL_REASON_HEADER]: 'queue-full: 16 thumbnail mints already waiting for host 192.0.2.80',
        'retry-after': '16',
      },
    })
    const outcome = await fetchClipStill(URL_592, null, async () => response)
    expect(outcome.kind).toBe('deferred')
    if (outcome.kind !== 'deferred') return
    expect(outcome.code).toBe('queue-full')
    expect(outcome.retryAfterMs).toBe(16_000)
  })

  it('a thrown fetch is DEFERRED — a lost race must not blank a tile for ever', async () => {
    const outcome = await fetchClipStill(URL_592, null, async () => {
      throw new Error('Network request failed')
    })
    expect(outcome.kind).toBe('deferred')
    if (outcome.kind !== 'deferred') return
    expect(outcome.reason).toBe('Network request failed')
    expect(outcome.retryAfterMs).toBeNull()
  })

  it('sends the session token when there is one, and nothing else', async () => {
    let seen: RequestInit | undefined
    await fetchClipStill(URL_592, 'Bearer abc', async (_url, init) => {
      seen = init
      return new Response(null, { status: 204 })
    })
    expect(seen?.headers).toEqual({ Authorization: 'Bearer abc' })
  })
})

describe('a deferred tile comes back, under a bound', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a NAMED wait on the first paint — never a blank box', async () => {
    const fetchStill = vi.fn(async () => deferred())
    const { result } = renderHook(() =>
      useClipStill(URL_592, null, { fetchStill, random: () => 0.5 }),
    )
    // Nothing awaited: this is the state the tile is painted in.
    expect(result.current.phase).toBe('loading')
    await act(async () => {})
    expect(result.current.phase).toBe('loading')
    expect(result.current.messageKey).toBe('v2.clips.still.queueFull')
    expect(fetchStill).toHaveBeenCalledTimes(1)
  })

  it('serves the still on the second request, as the real hub did for 43 of 60 tiles', async () => {
    const fetchStill = vi
      .fn<() => Promise<ClipStillOutcome>>()
      .mockResolvedValueOnce(deferred())
      .mockResolvedValue(served())
    const { result } = renderHook(() =>
      useClipStill(URL_592, null, { fetchStill, random: () => 0.5 }),
    )
    await act(async () => {})
    expect(result.current.phase).toBe('loading')
    // The hub's `retry-after: 16` beats the 4 s curve, so the tile waits 16 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
    })
    expect(fetchStill).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(fetchStill).toHaveBeenCalledTimes(2)
    expect(result.current.phase).toBe('ready')
    expect(result.current.uri).toBe('data:image/jpeg;base64,AAAA')
  })

  it('STOPS, and says so — a tile that asks for ever shows nothing either', async () => {
    const fetchStill = vi.fn(async () => deferred())
    const { result } = renderHook(() =>
      useClipStill(URL_592, null, { fetchStill, random: () => 0.5 }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000)
    })
    expect(fetchStill).toHaveBeenCalledTimes(CLIP_STILL_RETRY_ATTEMPTS + 1)
    expect(result.current.phase).toBe('refused')
    expect(result.current.messageKey).toBe('v2.clips.still.gaveUp')
    // And it stays stopped.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000)
    })
    expect(fetchStill).toHaveBeenCalledTimes(CLIP_STILL_RETRY_ATTEMPTS + 1)
  })

  it('latches a FINAL refusal on the first answer and never asks again', async () => {
    const fetchStill = vi.fn<() => Promise<ClipStillOutcome>>().mockResolvedValue({
      kind: 'refused',
      code: 'sleeping',
      reason: 'sleeping: a still would cost a wake',
    })
    const { result } = renderHook(() =>
      useClipStill(URL_592, null, { fetchStill, random: () => 0.5 }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000)
    })
    expect(fetchStill).toHaveBeenCalledTimes(1)
    expect(result.current.phase).toBe('refused')
    expect(result.current.messageKey).toBe('v2.clips.still.sleeping')
  })

  it('renders the provider’s own words for a code this build never heard of', async () => {
    const fetchStill = vi.fn<() => Promise<ClipStillOutcome>>().mockResolvedValue({
      kind: 'refused',
      code: 'firmware-said-no',
      reason: 'the camera is reindexing its card',
    })
    const { result } = renderHook(() =>
      useClipStill(URL_592, null, { fetchStill, random: () => 0.5 }),
    )
    await act(async () => {})
    expect(result.current.messageKey).toBeNull()
    expect(result.current.reason).toBe('the camera is reindexing its card')
  })

  it('asks nothing at all when the clip offers no mint', async () => {
    const fetchStill = vi.fn(async () => served())
    const { result } = renderHook(() =>
      useClipStill(null, null, { fetchStill, random: () => 0.5 }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(fetchStill).not.toHaveBeenCalled()
    expect(result.current.phase).toBe('idle')
  })

  it('drops its pending retry when the tile goes away', async () => {
    const fetchStill = vi.fn(async () => deferred())
    const { unmount } = renderHook(() =>
      useClipStill(URL_592, null, { fetchStill, random: () => 0.5 }),
    )
    await act(async () => {})
    expect(fetchStill).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000)
    })
    expect(fetchStill).toHaveBeenCalledTimes(1)
  })
})
