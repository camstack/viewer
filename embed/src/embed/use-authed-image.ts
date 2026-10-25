/**
 * use-authed-image — render bytes from an AUTHENTICATED data plane in an `<img>`.
 *
 * The event-media plane requires `Authorization: Bearer …` (or the hub session
 * cookie). A browser `<img src>` can carry neither: the native viewer solves
 * this by handing `expo-image` a `headers` option, and there is no web
 * equivalent. Left alone, every tile renders the broken-image glyph — which is
 * exactly how the viewer's detail strip went blank the first time URL-backed
 * media shipped.
 *
 * So the bytes are fetched with the header and turned into an object URL. The
 * cost is bounded and small:
 *  - the plane serves `cache-control: public, max-age=31536000, immutable`
 *    plus an ETag, so a repeat fetch of the same id is served from the HTTP
 *    cache — the object URL is the only new allocation;
 *  - the object-URL cache is a bounded LRU that REVOKES what it evicts, so a
 *    long infinite scroll cannot accumulate blobs for the life of the session.
 *
 * The cache is keyed by URL (which already encodes id + variant + size), and
 * concurrent requests for one URL share a single in-flight promise — an
 * infinite-scroll list mounts many cells at once and would otherwise issue the
 * same fetch several times.
 *
 * The token is NOT part of the key: a mounted embed has exactly one identity
 * (see `eventsConfigPatchSchema`, which refuses to patch `token`). It may also
 * be ABSENT — behind an authenticating relay the header is supplied server-side
 * and the page holds no credential at all (`transport-auth.ts`).
 */
import { useEffect, useState } from 'react'
import { eventsLog } from './events-messages'
import { authorizationHeaders } from './transport-auth'
import { lagWindow, splitDuration } from '../../../shared/events/main-thread-lag'
import { networkTimingFor } from './resource-timing'

/** Object URLs held at once. ~250 tiles is several screens of scrollback in
 *  either layout; beyond that the oldest are revoked. */
const CACHE_MAX = 250

const cache = new Map<string, string>()
type AuthedImageLoadResult =
  | { readonly status: 'ready'; readonly src: string }
  | { readonly status: 'missing' }
  | { readonly status: 'transient-failure' }

const inflight = new Map<string, Promise<AuthedImageLoadResult>>()

/**
 * Media fetches allowed to be in flight at once, ACROSS the whole surface.
 *
 * Measured on the hub, 2026-08-20: one thumbnail answers in 30-240 ms. The same
 * URLs, requested as a burst of dozens by a screenful of cards, reported
 * `headersMs ≈ 6838`. The bytes did not get slower — the requests queued, behind
 * the WebView's per-host connection limit and the plane's own serialisation.
 *
 * The cap could not live in the preloader. `PRELOAD_CONCURRENCY` was already 4,
 * and the burst came from the CARDS: each mounts and calls
 * {@link loadAuthedImage} directly, so sixty visible tiles issue sixty fetches
 * no background queue ever sees. This gate is the one place both paths pass
 * through.
 *
 * Six. This is the SAFETY NET, not the mechanism: the window that decides what
 * gets fetched at all is the viewport policy (`use-in-viewport` for the visible
 * half, `galleryPreloadWindow` / `reelPreloadWindow` for the background half).
 * The gate exists so that a surface which somehow asks for a hundred tiles —
 * a host rendering with no layout, a future view that forgets its window —
 * degrades into a queue instead of into timeouts.
 *
 * Six rather than more because total time to fill a page is bounded by the
 * plane's throughput, not by how many requests are outstanding: sixty tiles
 * cost the same server work at any width. Width only decides whether any single
 * request waits long enough to abort. It also bounds concurrent blob
 * allocations, which matters on a device the OS has been memory-killing.
 */
export const MEDIA_FETCH_CONCURRENCY = 6

/**
 * How long ONE attempt may take once it is actually running.
 *
 * Raised from 5 s, and the number is only half the fix: the timer now starts
 * AFTER the gate is acquired. Queue time used to count against the request, so
 * a tile waiting 6.8 s behind a screenful aborted at 5 s having never been
 * sent — then retried, adding its own load to the queue it was stuck in. With
 * queueing excluded this bounds real server time, where the measured worst case
 * for a single request is well under a second; the slack is for a cold media
 * resolve over the remote tunnel, not for a queue.
 */
export const AUTHED_IMAGE_TIMEOUT_MS = 10_000
/** A transiently failed visible card must retry. The first preload wave can
 *  coincide with hub startup/GC pressure; latching that failure forever leaves
 *  exactly the first `PRELOAD_CONCURRENCY` cards as permanent skeletons. */
export const AUTHED_IMAGE_RETRY_MS = 5_000
const RETRY_BACKOFF_MS = [250, 750] as const
/**
 * How many thumbnail timings ship per embed LOAD, regardless of speed.
 *
 * It was 40, and the embed reloads far more often than "once" — every face
 * assignment used to re-page it — so the hub measured 38 `thumbnail ready`
 * lines in thirty minutes, the single noisiest message the app shipped
 * (D437). A baseline sample is worth having; forty of them is a transcript.
 *
 * The SLOW path (`totalMs >= 500`) is untouched: that one is the actionable
 * signal and it is rare by construction.
 */
let traceBudget = 5

/** How much of an unparseable URL is worth printing before it is just noise. */
const UNPARSEABLE_PREFIX_CHARS = 32

/** A media URL reduced to what a diagnostic may say about it. */
export interface AuthedImageUrlDescription {
  /** The base the embed was actually handed — `(unparseable)` when there was
   *  none, which is what a missing host-bridge base URL looks like. */
  readonly origin: string
  /** Path with the media id replaced by `<id>`. */
  readonly path: string
  /** Query string, verbatim — `kind` / `variant` / `size` are the ask itself. */
  readonly query: string
}

/**
 * Describe a media URL for a log line: enough to tell a bad base URL from a bad
 * server, without putting a media id into the hub's log stream.
 *
 * Exported because the ONE thing the 2026-08-20 blackout needed and did not
 * have was the origin the embed was fetching against — see the spec.
 */
export function describeAuthedImageUrl(url: string): AuthedImageUrlDescription {
  try {
    const parsed = new URL(url)
    const cut = parsed.pathname.lastIndexOf('/')
    const path = cut >= 0 ? `${parsed.pathname.slice(0, cut)}/<id>` : parsed.pathname
    return { origin: parsed.origin, path, query: parsed.search }
  } catch {
    const head = url.slice(0, UNPARSEABLE_PREFIX_CHARS)
    return {
      origin: '(unparseable)',
      path: url.length > UNPARSEABLE_PREFIX_CHARS ? `${head}…` : head,
      query: '',
    }
  }
}

/** What the last attempt actually hit. Both null means "never got that far". */
interface AuthedImageFailureCause {
  readonly lastStatus: number | null
  readonly errorName: string | null
  readonly errorMessage: string | null
}

function describeError(error: unknown): Pick<AuthedImageFailureCause, 'errorName' | 'errorMessage'> {
  if (error instanceof Error) return { errorName: error.name, errorMessage: error.message }
  return { errorName: 'unknown', errorMessage: String(error) }
}

// ── the gate ────────────────────────────────────────────────────────────────
// A plain counting semaphore. A slot is HANDED to the next waiter rather than
// released and re-taken: decrementing first would let a fresh caller slip into
// the free slot before the woken waiter resumes, and the cap would drift up by
// one for every handoff.

let activeFetches = 0
let waiters: Array<() => void> = []

async function acquireFetchSlot(): Promise<void> {
  if (activeFetches < MEDIA_FETCH_CONCURRENCY) {
    activeFetches += 1
    return
  }
  await new Promise<void>((resolve) => {
    waiters.push(resolve)
  })
  // The slot was transferred, not re-acquired — `activeFetches` already counts it.
}

function releaseFetchSlot(): void {
  const next = waiters.shift()
  if (next !== undefined) {
    next()
    return
  }
  activeFetches = Math.max(0, activeFetches - 1)
}

function remember(url: string, objectUrl: string): void {
  cache.set(url, objectUrl)
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next()
    if (oldest.done === true) break
    const evicted = cache.get(oldest.value)
    cache.delete(oldest.value)
    if (evicted !== undefined) URL.revokeObjectURL(evicted)
  }
}

/**
 * Fetch (or reuse) the object URL for an authenticated media URL. Resolves to
 * null on any failure — the caller renders its placeholder. Never throws.
 */
async function loadAuthedImageResult(
  url: string,
  token: string | undefined,
): Promise<AuthedImageLoadResult> {
  const cached = cache.get(url)
  if (cached !== undefined) {
    // Touch: re-inserting moves the key to the end of the LRU order.
    cache.delete(url)
    cache.set(url, cached)
    return { status: 'ready', src: cached }
  }
  const pending = inflight.get(url)
  if (pending !== undefined) return pending

  const promise = (async (): Promise<AuthedImageLoadResult> => {
    const requestStartedAt = performance.now()
    const where = describeAuthedImageUrl(url)
    // The last thing that went wrong, carried out of the loop. Overwritten on
    // every attempt so the final line describes the attempt that gave up.
    let cause: AuthedImageFailureCause = {
      lastStatus: null,
      errorName: null,
      errorMessage: null,
    }
    /** Time spent waiting for the gate, summed over attempts. Reported apart
     *  from `headersMs` so "the server got faster" and "we stopped queueing
     *  sixty at once" can never be mistaken for one another. */
    let queuedMs = 0
    try {
      for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
        // Wait for a slot BEFORE arming the abort timer. The whole point is
        // that queue time is not charged to the request — see
        // AUTHED_IMAGE_TIMEOUT_MS. A retry re-queues rather than holding its
        // slot across the backoff, so a sleeping request never blocks a
        // visible one.
        const queueStartedAt = performance.now()
        await acquireFetchSlot()
        queuedMs += performance.now() - queueStartedAt
        const attemptStartedAt = performance.now()
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), AUTHED_IMAGE_TIMEOUT_MS)
        try {
          const res = await fetch(url, {
            // Empty behind an authenticating relay: it strips whatever the
            // page sends and injects the share token itself, so this fetch is
            // authenticated without the page ever holding a credential.
            headers: authorizationHeaders(token),
            signal: controller.signal,
          })
          if (res.ok) {
            // Measured from when this attempt STARTED, so it is the plane's
            // time and nothing else. It used to run from `requestStartedAt`,
            // which folded the queue into it — that is how a 240 ms fetch
            // reported 6838 ms and read as a slow server.
            const headersMs = Math.round(performance.now() - attemptStartedAt)
            const blob = await res.blob()
            const totalMs = Math.round(performance.now() - requestStartedAt)
            const attemptMs = Math.round(performance.now() - attemptStartedAt)
            const objectUrl = URL.createObjectURL(blob)
            remember(url, objectUrl)
            if (traceBudget > 0 || totalMs >= 500) {
              traceBudget = Math.max(0, traceBudget - 1)
              // The three-way split, and the one part of it that is NOT an
              // estimate: `net` comes from the browser's own Resource Timing,
              // recorded in the networking stack, so a JS thread that was busy
              // for four seconds cannot inflate it. `blockedMs` is what the
              // thread stole; `headersMs - net.totalMs` is the same quantity
              // arrived at independently, and the two disagreeing is itself
              // worth knowing.
              const net = networkTimingFor(url, attemptStartedAt)
              const thread = splitDuration(
                performance.now() - attemptStartedAt,
                lagWindow(attemptStartedAt, performance.now()),
              )
              eventsLog(
                'thumbnail ready',
                {
                  ms: totalMs,
                  queuedMs: Math.round(queuedMs),
                  headersMs,
                  blobMs: attemptMs - headersMs,
                  blockedMs: thread.blockedMs,
                  maxLagMs: thread.maxLagMs,
                  netTotalMs: net?.totalMs ?? null,
                  netQueuedMs: net?.queuedMs ?? null,
                  netTtfbMs: net?.ttfbMs ?? null,
                  bytes: blob.size,
                  attempt: attempt + 1,
                  serverTiming: res.headers?.get('server-timing') ?? null,
                },
                'media',
              )
            }
            return { status: 'ready', src: objectUrl }
          }
          // Auth and missing-media failures are deterministic. Retrying them
          // only delays the fallback and adds load to the hub.
          if (res.status === 401 || res.status === 403 || res.status === 404) {
            eventsLog(
              'thumbnail missing',
              {
                ms: Math.round(performance.now() - requestStartedAt),
                queuedMs: Math.round(queuedMs),
                status: res.status,
                attempt: attempt + 1,
                ...where,
              },
              'media',
            )
            return { status: 'missing' }
          }
          // A 5xx / 429 / anything else retries below — and used to vanish into
          // the same mute line a thrown fetch produced. Keep the status.
          cause = { lastStatus: res.status, errorName: null, errorMessage: null }
        } catch (error: unknown) {
          // Timeout/network failures are transient and use the bounded retry
          // below. The final attempt falls through to the failed placeholder —
          // carrying the real error, which is the only thing that separates a
          // CORS/TLS refusal from an abort from an unreachable base URL.
          cause = { lastStatus: null, ...describeError(error) }
        } finally {
          clearTimeout(timeout)
          releaseFetchSlot()
        }

        const backoff = RETRY_BACKOFF_MS[attempt]
        if (backoff !== undefined) {
          await new Promise<void>((resolve) => setTimeout(resolve, backoff))
        }
      }
      eventsLog(
        'thumbnail transient failure',
        {
          ms: Math.round(performance.now() - requestStartedAt),
          queuedMs: Math.round(queuedMs),
          attempts: RETRY_BACKOFF_MS.length + 1,
          ...cause,
          ...where,
        },
        'media',
      )
      return { status: 'transient-failure' }
    } finally {
      inflight.delete(url)
    }
  })()
  inflight.set(url, promise)
  return promise
}

export async function loadAuthedImage(
  url: string,
  token: string | undefined,
): Promise<string | null> {
  const result = await loadAuthedImageResult(url, token)
  return result.status === 'ready' ? result.src : null
}

export type AuthedImageState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly src: string }
  | { readonly status: 'failed' }

/**
 * React binding. `url === null` stays in `loading` (the caller has nothing to
 * resolve yet) — a null URL is "not known", not "not available".
 */
export function useAuthedImage(url: string | null, token: string | undefined): AuthedImageState {
  const [state, setState] = useState<AuthedImageState>({ status: 'loading' })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (url === null) {
      setState({ status: 'loading' })
      return
    }
    const cached = cache.get(url)
    if (cached !== undefined) {
      setState({ status: 'ready', src: cached })
      return
    }
    let alive = true
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    setState({ status: 'loading' })
    void loadAuthedImageResult(url, token).then((result) => {
      if (!alive) return
      if (result.status === 'ready') {
        setState({ status: 'ready', src: result.src })
        return
      }
      if (result.status === 'missing') {
        setState({ status: 'failed' })
        return
      }
      // Network, timeout and 5xx failures are not media facts. Keep the
      // backing skeleton and retry while the visible card remains mounted.
      retryTimer = setTimeout(() => setRetry((value) => value + 1), AUTHED_IMAGE_RETRY_MS)
    })
    return () => {
      alive = false
      if (retryTimer !== undefined) clearTimeout(retryTimer)
    }
  }, [url, token, retry])
  return state
}

/** Drop and revoke everything. Test-only seam — a module-level cache that
 *  survives between specs makes the second spec's assertions meaningless. */
export function resetAuthedImageCache(): void {
  for (const objectUrl of cache.values()) URL.revokeObjectURL(objectUrl)
  cache.clear()
  inflight.clear()
  traceBudget = 40
  // The gate is module state too: a spec that left waiters parked would hang
  // the next one, and a leaked slot would silently narrow the cap.
  activeFetches = 0
  waiters = []
}
