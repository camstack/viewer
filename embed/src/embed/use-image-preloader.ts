/**
 * use-image-preloader — fill the cache DOWNWARD, in idle, a few at a time.
 *
 * ## Where this sits
 *
 * Viewport gating fixed the disaster (60 concurrent thumbnails: 13.6 s, against
 * 659 ms for twelve) but left the opposite edge: scroll fast enough and you
 * outrun the observer, so tiles resolve under the thumb.
 *
 * So the surface now does two things at once, and the split is the whole design:
 *
 *  - **the viewport loads on demand**, at one screen of margin — the user's own
 *    request, always first;
 *  - **everything below is preloaded in order, in the background**, with a small
 *    concurrency cap, so by the time the user reaches a tile its bytes are
 *    already in the blob cache.
 *
 * Both go through `loadAuthedImage`, which dedupes in flight and caches by URL —
 * so a preloaded tile costs the card nothing when it mounts, and a card that
 * mounts mid-preload joins the same promise rather than issuing a second fetch.
 *
 * ## What this is NOT
 *
 * It is not the bound. For two months this docblock claimed the surface never
 * recreates "the 60-concurrent stampede" while `EmbedEventsPage` handed the
 * gallery branch `rows` — the entire feed — so opening Events queued every
 * loaded tile at once. The claim read as verification and hid the defect until
 * the operator asked why a reel does not just load what you can see.
 *
 * What bounds the work is upstream and downstream of here:
 *  - upstream, `galleryPreloadWindow` / `reelPreloadWindow` decide WHICH tiles
 *    are candidates — the visible rows plus one screen, never the feed;
 *  - downstream, `MEDIA_FETCH_CONCURRENCY` gates every media fetch on the
 *    surface, including the ones the cards issue directly and this queue never
 *    sees. That is where the 2026-08-20 `headersMs ≈ 6838` came from: sixty
 *    cards, none of them routed through here.
 *
 * ## Why the cap is small
 *
 * {@link PRELOAD_CONCURRENCY} is 3 — at most half the shared gate, so a
 * speculative background walk can never starve the tiles the user is actually
 * looking at. Measured: twelve concurrent returned in 659 ms, sixty took
 * 13.6 s.
 *
 * ## Why it yields to scrolling
 *
 * A preload is speculative; a visible tile is not. While the user is scrolling
 * the preloader stops issuing new work, so the in-viewport fetches have the
 * connection to themselves. It resumes — from where it left off, never from the
 * start — once scrolling settles.
 */
import { useEffect, useRef } from 'react'
import { loadAuthedImage } from './use-authed-image'

/** Background fetches in flight at once. Deliberately small — see the note. */
export const PRELOAD_CONCURRENCY = 3

/** How long after the last scroll event the preloader resumes. */
export const SCROLL_IDLE_MS = 250

export interface ImagePreloaderOptions {
  /** Thumbnail URLs in RENDER order — the preloader walks them downward, which
   *  is the direction the user reads. */
  readonly urls: readonly string[]
  /** Absent behind an authenticating relay — see `transport-auth.ts`. */
  readonly token: string | undefined
  /** Suspend issuing new work (the user is scrolling, or the surface is idle
   *  for another reason). In-flight requests are allowed to finish. */
  readonly paused: boolean
  readonly enabled: boolean
}

/**
 * Walks `urls` in order with a bounded number of concurrent fetches.
 *
 * Position is kept in a ref, so pausing and resuming continues rather than
 * restarting, and a longer `urls` (the next page landed) simply extends the
 * walk. Returns nothing: the effect is the warmed cache.
 */
export function useImagePreloader(options: ImagePreloaderOptions): void {
  const { urls, token, paused, enabled } = options
  /** Index of the next URL to consider. Never rewinds — a rewind would refetch
   *  what the cache already holds and undo the point of the exercise. */
  const cursorRef = useRef(0)
  const inFlightRef = useRef(0)
  const stoppedRef = useRef(false)
  const urlsRef = useRef<readonly string[]>(urls)
  const firstUrlRef = useRef(urls[0] ?? '')
  urlsRef.current = urls

  // A day/window reload can replace the whole list without changing its
  // length. Continuing from the old cursor would then skip every new image.
  const firstUrl = urls[0] ?? ''
  if (firstUrlRef.current !== firstUrl) {
    firstUrlRef.current = firstUrl
    cursorRef.current = 0
  }

  useEffect(() => {
    stoppedRef.current = false
    if (!enabled || paused) return

    let cancelled = false

    const pump = (): void => {
      if (cancelled || stoppedRef.current) return
      while (inFlightRef.current < PRELOAD_CONCURRENCY) {
        const list = urlsRef.current
        const i = cursorRef.current
        if (i >= list.length) return
        cursorRef.current = i + 1
        const url = list[i]
        if (url === undefined || url.length === 0) continue
        inFlightRef.current += 1
        void loadAuthedImage(url, token).finally(() => {
          inFlightRef.current = Math.max(0, inFlightRef.current - 1)
          // One slot freed, one more started — a self-clocking queue that can
          // never exceed the cap and never stalls with work left.
          pump()
        })
      }
    }

    pump()
    return () => {
      cancelled = true
      stoppedRef.current = true
    }
  }, [enabled, paused, token, urls.length])
}
