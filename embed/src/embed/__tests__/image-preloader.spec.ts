import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTHED_IMAGE_RETRY_MS, loadAuthedImage, resetAuthedImageCache } from '../use-authed-image'
import { PRELOAD_CONCURRENCY, SCROLL_IDLE_MS, useImagePreloader } from '../use-image-preloader'

/**
 * The preloader's contract, exercised through `loadAuthedImage` — the same
 * entry point the cards use, which is what makes a preloaded tile free when it
 * finally mounts.
 */
describe('preload budget', () => {
  it('is small enough to leave the viewport room', () => {
    // Measured: 12 concurrent thumbnails returned in 659 ms, 60 took 13.6 s.
    // Four in the background cannot recreate that, and still warms a screenful
    // in well under a second.
    expect(PRELOAD_CONCURRENCY).toBeLessThanOrEqual(6)
    expect(PRELOAD_CONCURRENCY).toBeGreaterThanOrEqual(2)
  })

  it('resumes soon enough after a scroll to be useful', () => {
    expect(SCROLL_IDLE_MS).toBeLessThanOrEqual(500)
  })

  it('does not permanently latch a transiently failed first preload wave', () => {
    expect(AUTHED_IMAGE_RETRY_MS).toBeLessThanOrEqual(5_000)
  })
})

describe('loadAuthedImage — the shared cache the preloader fills', () => {
  beforeEach(() => {
    resetAuthedImageCache()
    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = () => `blob:${Math.random()}`
      URL.revokeObjectURL = () => {}
    }
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    resetAuthedImageCache()
  })

  it('DEDUPES concurrent requests for one URL into a single fetch', async () => {
    // A card mounting mid-preload must join the in-flight promise, not race it.
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const url = 'https://hub/addon/pipeline-analytics/event-media/a?variant=thumb&size=212'
    const [a, b, c] = await Promise.all([
      loadAuthedImage(url, 'jwt'),
      loadAuthedImage(url, 'jwt'),
      loadAuthedImage(url, 'jwt'),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('serves a second request for the same URL from cache — a preloaded tile is free', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const url = 'https://hub/addon/pipeline-analytics/event-media/b?variant=thumb&size=212'
    await loadAuthedImage(url, 'jwt')
    await loadAuthedImage(url, 'jwt')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('carries the bearer token — the plane is authenticated', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, blob: () => Promise.resolve(new Blob(['x'])) }),
    )
    vi.stubGlobal('fetch', fetchMock)
    await loadAuthedImage('https://hub/x', 'jwt-123')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hub/x',
      expect.objectContaining({
        headers: { Authorization: 'Bearer jwt-123' },
        signal: expect.any(AbortSignal),
      }),
    )
  })

  it('resolves null on failure instead of throwing into the render tree', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: false, status: 404 })),
    )
    expect(await loadAuthedImage('https://hub/nope', 'jwt')).toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    )
    expect(await loadAuthedImage('https://hub/boom', 'jwt')).toBeNull()
  })
})

/**
 * The ENFORCED cap, not the constant.
 *
 * This used to be asserted only from `events-embed-wiring.spec.ts`, over the
 * whole mounted page — where the number it measured was every media fetch on
 * the surface, the cards' included, and therefore the SHARED gate
 * (`MEDIA_FETCH_CONCURRENCY`, 6) rather than this queue's own 3. It held only
 * while the timing kept the cards out of it, and an unrelated change to the row
 * normaliser was enough to tip it. Asserted here instead: one hook, its own
 * module state, no page and no cards, so the number can only be this queue's.
 */
describe('useImagePreloader — the cap it actually enforces', () => {
  beforeEach(() => {
    resetAuthedImageCache()
    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = () => `blob:${Math.random()}`
      URL.revokeObjectURL = () => {}
    }
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    resetAuthedImageCache()
  })

  it('never runs more than PRELOAD_CONCURRENCY fetches at once', async () => {
    let active = 0
    let peak = 0
    // Requests that never settle: everything the queue starts stays counted,
    // so `peak` is the real high-water mark rather than a sampling artefact.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            active += 1
            peak = Math.max(peak, active)
            init?.signal?.addEventListener(
              'abort',
              () => {
                active -= 1
                reject(new DOMException('aborted', 'AbortError'))
              },
              { once: true },
            )
          }),
      ),
    )
    const urls = Array.from({ length: 30 }, (_, i) => `https://hub.test/thumb-${String(i)}`)
    renderHook(() => useImagePreloader({ urls, token: 'jwt', paused: false, enabled: true }))
    await waitFor(() => expect(peak).toBeGreaterThan(0))
    await act(async () => {
      await Promise.resolve()
    })
    expect(peak).toBeLessThanOrEqual(PRELOAD_CONCURRENCY)
  })

  it('issues NOTHING while the user is scrolling', async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetchMock)
    const urls = Array.from({ length: 10 }, (_, i) => `https://hub.test/paused-${String(i)}`)
    renderHook(() => useImagePreloader({ urls, token: 'jwt', paused: true, enabled: true }))
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
