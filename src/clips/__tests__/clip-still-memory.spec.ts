/**
 * @vitest-environment jsdom
 *
 * *"le thumbnail non arrivano nonostante prima dovrebbe già averle
 * scaricate"* — a still the app already held, asked for again (D574).
 *
 * ## What the app kept, before this
 *
 * Nothing. `useClipStill` held the bytes in `useState`, so a tile that left
 * the mount band dropped them; the band moves every 160 px of scroll
 * (`timeline-window.ts`), so scrolling a clip list and scrolling back threw
 * away every still on the way out and re-asked for every one of them on the
 * way in. Leaving the surface and returning did the same, and so did the
 * operator's flick that widened the window.
 *
 * That is not a free re-ask. The provider mints ON DEMAND behind a lane 16
 * deep, one in flight per camera (`clip-thumb-queue.ts`, THUMB_QUEUE_CAPACITY):
 * a re-ask for a still that has not yet been minted rejoins that queue and
 * comes back 204 `queue-full`, and the tile spends its four-attempt budget
 * (D563/D573) to get back to where it already was. The still the operator
 * "already downloaded" is exactly the one most likely not to arrive the second
 * time.
 *
 * ## Why the assertions are counts
 *
 * The phase a tile reports is right at every step: `loading` really is loading
 * and `ready` really is ready. What was wrong is HOW MANY TIMES the app asked
 * for the same bytes over a sequence — mount, unmount, remount. So the
 * sequence is the test and the request count is the assertion, the same shape
 * `clip-publish-loop.spec.ts` needed for the render cycle on this surface.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

import {
  CLIP_STILL_MEMORY_MAX_BYTES,
  CLIP_STILL_MEMORY_MAX_ENTRIES,
  clipStillMemorySize,
  forgetClipStills,
  rememberClipStill,
  recallClipStill,
} from '../clip-still-memory.js'
import { useClipStill } from '../use-clip-still.js'
import type { ClipStillOutcome } from '../clip-still.js'

const URL_A = 'https://hub/addon/provider-reolink/clip-thumb/592/687d6b38'
const URL_B = 'https://hub/addon/provider-reolink/clip-thumb/592/91ac0f12'

/** ~32 KB of base64, the size the hub really sends (measured, D573). */
const STILL = `data:image/jpeg;base64,${'A'.repeat(43_000)}`

function served(uri: string): ClipStillOutcome {
  return { kind: 'served', uri }
}

function deferred(): ClipStillOutcome {
  return {
    kind: 'deferred',
    code: 'queue-full',
    reason: 'queue-full: 16 thumbnail mints already waiting for host 192.0.2.80',
    retryAfterMs: 16_000,
  }
}

describe('a still that has been fetched survives the tile that fetched it', () => {
  beforeEach(() => {
    forgetClipStills()
  })

  it('a remount after a scroll draws it with NO second request', async () => {
    const fetchStill = vi.fn(async () => served(STILL))
    const first = renderHook(() => useClipStill(URL_A, null, { fetchStill }))
    await act(async () => {})
    expect(first.result.current.phase).toBe('ready')
    expect(fetchStill).toHaveBeenCalledTimes(1)

    // Scrolled out of the mount band.
    first.unmount()

    // …and back in. The FIRST render is what matters: a tile that reports
    // `loading` here has already re-entered the provider's queue, and that is
    // the frame the operator sees as "the thumbnail did not come back".
    const second = renderHook(() => useClipStill(URL_A, null, { fetchStill }))
    expect(second.result.current.phase).toBe('ready')
    expect(second.result.current.uri).toBe(STILL)
    expect(fetchStill).toHaveBeenCalledTimes(1)

    // And it is still true after the effects have run — the effect must not
    // re-ask behind the synchronous answer.
    await act(async () => {})
    expect(fetchStill).toHaveBeenCalledTimes(1)
    second.unmount()
  })

  it('two tiles on the same still make ONE request, not two', async () => {
    // A remount that races the first request — scroll away and back inside one
    // second — must not put a second ask into a 16-deep lane for bytes already
    // on their way.
    let release: ((outcome: ClipStillOutcome) => void) | null = null
    const fetchStill = vi.fn(
      async () =>
        await new Promise<ClipStillOutcome>((resolve) => {
          release = resolve
        }),
    )
    const a = renderHook(() => useClipStill(URL_A, null, { fetchStill }))
    const b = renderHook(() => useClipStill(URL_A, null, { fetchStill }))
    await act(async () => {})
    expect(fetchStill).toHaveBeenCalledTimes(1)

    await act(async () => {
      release?.(served(STILL))
    })
    expect(a.result.current.phase).toBe('ready')
    expect(b.result.current.phase).toBe('ready')
    a.unmount()
    b.unmount()
  })

  it('remembers nothing a tile never got — a deferral is not an answer', async () => {
    vi.useFakeTimers()
    try {
      const fetchStill = vi.fn(async () => deferred())
      const r = renderHook(() => useClipStill(URL_B, null, { fetchStill, random: () => 0.5 }))
      await act(async () => {})
      expect(r.result.current.phase).toBe('loading')
      expect(recallClipStill(URL_B)).toBeNull()
      r.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('what the memory is bounded by', () => {
  beforeEach(() => {
    forgetClipStills()
  })

  it('drops the least recently used tile rather than growing without limit', () => {
    // 592 holds 357 clips of four hours; a day is thousands. "Keep everything"
    // is 30-50 KB each and is not an answer either.
    for (let i = 0; i < CLIP_STILL_MEMORY_MAX_ENTRIES + 20; i++) {
      rememberClipStill(`${URL_A}/${i}`, STILL)
    }
    expect(clipStillMemorySize().entries).toBeLessThanOrEqual(CLIP_STILL_MEMORY_MAX_ENTRIES)
    expect(clipStillMemorySize().bytes).toBeLessThanOrEqual(CLIP_STILL_MEMORY_MAX_BYTES)
    // The oldest went; the newest stayed.
    expect(recallClipStill(`${URL_A}/0`)).toBeNull()
    expect(recallClipStill(`${URL_A}/${CLIP_STILL_MEMORY_MAX_ENTRIES + 19}`)).toBe(STILL)
  })

  it('a recall is a USE — the tile the operator keeps coming back to stays', () => {
    for (let i = 0; i < CLIP_STILL_MEMORY_MAX_ENTRIES; i++) {
      rememberClipStill(`${URL_A}/${i}`, STILL)
    }
    // Touch the oldest, then push the memory one past full.
    expect(recallClipStill(`${URL_A}/0`)).toBe(STILL)
    rememberClipStill(URL_B, STILL)
    expect(recallClipStill(`${URL_A}/0`)).toBe(STILL)
    expect(recallClipStill(`${URL_A}/1`)).toBeNull()
  })

  it('is bounded in BYTES as well as entries, because a still is not a fixed size', () => {
    const huge = `data:image/jpeg;base64,${'A'.repeat(CLIP_STILL_MEMORY_MAX_BYTES)}`
    rememberClipStill(URL_A, huge)
    rememberClipStill(URL_B, huge)
    expect(clipStillMemorySize().bytes).toBeLessThanOrEqual(CLIP_STILL_MEMORY_MAX_BYTES)
  })
})
