import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The bound that keeps a thumbnail request off its own timeout.
 *
 * Baseline v1.0.358 (2026-08-20, native, fresh session): tiles resolved, but
 * `thumbnail ready` reported `headersMs ≈ 6838` on a burst of dozens — against
 * 30-240 ms for the same URL fetched alone. The bytes were never slow; the
 * QUEUE was. Sixty cards mount at once and each issues its own fetch, so the
 * work piles up behind the WebView's connection limit and the plane's own
 * serialisation, and a request that waits 6.8 s blows through a 5 s per-attempt
 * timeout it never deserved — aborting, retrying, and adding its own load to
 * the queue it was already stuck in.
 *
 * The cap therefore cannot live in the preloader: `PRELOAD_CONCURRENCY` was
 * already 4, and the burst came from the CARDS, which call the loader directly.
 * One gate, shared by both, is the only thing that can bound it.
 */

const eventsLog = vi.fn()
vi.mock('../events-messages', () => ({ eventsLog }))

const {
  AUTHED_IMAGE_TIMEOUT_MS,
  MEDIA_FETCH_CONCURRENCY,
  loadAuthedImage,
  resetAuthedImageCache,
} = await import('../use-authed-image')
const { PRELOAD_CONCURRENCY } = await import('../use-image-preloader')

/**
 * A fetch stub that never settles on its own — the test decides when.
 *
 * It HONOURS the abort signal, and that is not a detail. The first version of
 * this file ignored it, so the timeout test passed against an implementation
 * that armed the abort timer before queueing — the exact bug it claimed to
 * cover. A stub that cannot abort proves nothing about aborting.
 */
function deferredFetch() {
  const settlers: Array<() => void> = []
  let peak = 0
  let live = 0
  const fetchMock = vi.fn(
    (_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        live += 1
        peak = Math.max(peak, live)
        init?.signal?.addEventListener('abort', () => {
          live -= 1
          const err = new Error('The operation was aborted.')
          err.name = 'AbortError'
          reject(err)
        })
        settlers.push(() => {
          if (init?.signal?.aborted === true) return
          live -= 1
          resolve({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) })
        })
      }),
  )
  return {
    fetchMock,
    settleAll: (): void => {
      const pending = settlers.splice(0, settlers.length)
      for (const s of pending) s()
    },
    peak: (): number => peak,
    started: (): number => fetchMock.mock.calls.length,
  }
}

describe('the media fetch gate', () => {
  beforeEach(() => {
    eventsLog.mockClear()
    resetAuthedImageCache()
    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = () => `blob:${Math.random()}`
      URL.revokeObjectURL = () => {}
    }
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    resetAuthedImageCache()
  })

  it('is small enough that a queued tile never waits behind a screenful', () => {
    // Total time is bounded by the plane, not by concurrency — sixty tiles cost
    // the same server work at any width. A NARROW gate therefore buys latency
    // per request for free, and costs nothing in throughput.
    expect(MEDIA_FETCH_CONCURRENCY).toBeGreaterThanOrEqual(3)
    expect(MEDIA_FETCH_CONCURRENCY).toBeLessThanOrEqual(6)
  })

  it('leaves the viewport at least half the gate — a preload is speculative', () => {
    expect(PRELOAD_CONCURRENCY * 2).toBeLessThanOrEqual(MEDIA_FETCH_CONCURRENCY)
  })

  it('NEVER exceeds the cap, however many cards mount at once', async () => {
    const { fetchMock, settleAll, peak, started } = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)

    const all = Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        loadAuthedImage(`https://hub/addon/pipeline-analytics/event-media/e${i}`, 'jwt'),
      ),
    )
    // Let every caller reach the gate.
    await Promise.resolve()
    await Promise.resolve()
    expect(started()).toBe(MEDIA_FETCH_CONCURRENCY)

    // Drain, releasing waiters in waves, and watch the ceiling hold.
    for (let wave = 0; wave < 40 && started() < 30; wave += 1) {
      settleAll()
      await Promise.resolve()
      await Promise.resolve()
    }
    settleAll()
    await all
    expect(peak()).toBeLessThanOrEqual(MEDIA_FETCH_CONCURRENCY)
    expect(fetchMock).toHaveBeenCalledTimes(30)
  })

  it('does NOT arm a request timeout while it is still queued', async () => {
    // The defect this fixes: the abort timer used to be armed before the
    // request could run, so a tile queued 6.8 s behind a screenful aborted at
    // 5 s having never been sent — then retried into the queue it was stuck in.
    //
    // Asserted on the TIMER, not on the outcome. An outcome test has to advance
    // the clock past the timeout, which also expires the requests holding the
    // gate, and then it passes or fails for the wrong reason — the first draft
    // of this test did exactly that and survived the mutation it existed to
    // catch.
    vi.useFakeTimers()
    const { fetchMock, settleAll, started } = deferredFetch()
    vi.stubGlobal('fetch', fetchMock)

    const all = Array.from({ length: MEDIA_FETCH_CONCURRENCY + 3 }, (_, i) =>
      loadAuthedImage(`https://hub/t-${i}`, 'jwt'),
    )
    await Promise.resolve()
    await Promise.resolve()

    // Only the running requests own a timer. The three waiting ones own none:
    // their clock has not started.
    expect(started()).toBe(MEDIA_FETCH_CONCURRENCY)
    expect(vi.getTimerCount()).toBe(MEDIA_FETCH_CONCURRENCY)

    settleAll()
    await vi.advanceTimersByTimeAsync(0)
    settleAll()
    await vi.advanceTimersByTimeAsync(0)
    for (const p of all) expect(await p).not.toBeNull()
  })

  it('reports the queue SEPARATELY from the server — or the fix cannot be verified', async () => {
    // `headersMs` folding in queue time is what made 6838 ms unreadable. After
    // the gate the two must be distinguishable, otherwise "headersMs is small
    // now" proves only that the waiting moved somewhere unlogged.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) })),
    )
    await loadAuthedImage('https://hub/addon/pipeline-analytics/event-media/solo', 'jwt')
    const ready = eventsLog.mock.calls.find((c) => c[0] === 'thumbnail ready')
    expect(ready?.[1]).toMatchObject({ attempt: 1 })
    expect(ready?.[1]).toHaveProperty('queuedMs')
    expect(typeof (ready?.[1] as { queuedMs: unknown }).queuedMs).toBe('number')
  })
})
