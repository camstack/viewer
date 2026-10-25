/**
 * use-events-feed — the React binding over the pure engine in `events-feed.ts`.
 *
 * Owns three things and nothing else: WHEN a page is requested, WHEN a delta
 * is requested, and the request shape. Every merge/ordering/bound decision is
 * in the pure module, which is where the tests are.
 *
 * Request shape, and why:
 *  - `projection: 'slim'` — the list renders scalars only; the full row carries
 *    `positions[]` / `snapshots[]`, measured at 96 % of the payload.
 *  - `since` = the age floor. The bound RIDES the request, so the server never
 *    materialises rows the embed would discard.
 *  - NO `until`. Paging is by cursor, which bounds the upper edge exactly after
 *    the first page; an `until` would additionally hide everything detected
 *    since mount, which is the opposite of what an incremental feed wants.
 *  - `limit` = {@link resolveEventsPageLimit} — the server's own fan-out clamp,
 *    applied client-side so a short page is never mistaken for an exhausted one.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { EventsFeedClient, RecentTracksInput } from './events-client.js'
import type { EventsTrackSource } from './events-share-url'
import {
  abandonRebuild,
  appendPage,
  applyDelta,
  beginRebuild,
  deltaSince,
  EMPTY_FEED,
  type FeedState,
  type FeedTailReason,
  hasMore as feedHasMore,
  isRebuilding,
  tailReason,
  pageCursor,
  resolveEventsPageLimit,
  resolveFeedWindow,
  shouldPoll,
} from './events-feed'
import { type EventsTrackRow, toEventsTrackRows } from './events-track-row'
import { lagWindow, splitDuration, startLagSampler } from './main-thread-lag'

/**
 * How many delta pages one refresh will drain before giving up.
 *
 * A delta that comes back with a cursor means rows exist between it and the
 * head. Draining is bounded rather than unbounded because the alternative to a
 * bound is a refresh that walks the entire history when the embed has been
 * backgrounded for a day. Hitting the bound is LOGGED — the feed then has a
 * hole, and a hole nobody mentions is indistinguishable from a quiet camera.
 */
const MAX_DELTA_PAGES = 5

/**
 * How many times a failed page is retried before the surface admits an error.
 *
 * A single failure is NOT a terminal state, and treating it as one is what put
 * an error banner on screen every time the app came back from background: the
 * WebView resumes, the in-flight fetch is already dead, and the very first
 * request after resume fails once and then works. The user saw a hard error for
 * a condition that had already healed.
 */
const MAX_PAGE_ATTEMPTS = 3

/** Backoff before each retry, ms. Short on purpose — this is a resume blip, not
 *  a degraded service; by the third the surface should either be showing rows
 *  or admitting it cannot. */
const RETRY_BACKOFF_MS = [300, 900] as const
let requestSequence = 0

interface RecentTracksResponse {
  readonly tracks: unknown
  readonly nextCursor: string | null
}

/**
 * The three times a "slow request" is actually made of, kept apart.
 *
 * `ms` used to be the only number reported, and it is the SUM of all three —
 * which is why a 40 ms answer arriving on a thread that was busy for four
 * seconds was reported, correctly and uselessly, as a four-second request, and
 * pointed at the hub every time. See `main-thread-lag.ts` for the measurement.
 */
export interface RequestTiming {
  readonly requestId: string
  /** Wall time around the await. The old `ms`, kept so old and new lines are
   *  comparable. */
  readonly ms: number
  /** Time the ask waited on the CLIENT before it was issued (a `loadMore` that
   *  landed mid-request and was replayed). Zero for a poll. */
  readonly waitMs: number
  /** Lower bound on the time the JS thread was unavailable inside the request.
   *  This is contention, not latency. */
  readonly blockedMs: number
  /** What is left for the wire and the hub once contention is removed. */
  readonly netMs: number
  /** The worst single stall seen — forty 100 ms stalls and one 4 s stall sum
   *  the same and mean different things. */
  readonly maxLagMs: number
  /** Lag samples inside the window. Zero means the sampler could not run
   *  either, so `blockedMs` UNDERSTATES the block. */
  readonly lagSamples: number
}

type QueryOutcome =
  | { readonly ok: true; readonly page: RecentTracksResponse; readonly timing: RequestTiming }
  | { readonly ok: false; readonly message: string }

function isResponse(v: unknown): v is RecentTracksResponse {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return 'tracks' in o && (o.nextCursor === null || typeof o.nextCursor === 'string')
}

/** Where the feed reports what it dropped, retried or could not read. The embed
 *  forwards it to its host; the app writes it to its own log. */
export type EventsFeedLog = (message: string, data?: Record<string, unknown>) => void

export interface EventsFeedParams {
  readonly client: EventsFeedClient
  /** Diagnostics sink. Omitted ⇒ silent (specs). */
  readonly log?: EventsFeedLog
  /** Cameras to merge. Empty ⇒ the feed idles (nothing to ask for). */
  readonly deviceIds: readonly number[]
  readonly nameById: ReadonlyMap<number, string>
  readonly pageSize: number
  readonly maxRows: number
  /** Incremental-refresh cadence, ms. 0 disables polling. */
  readonly refreshMs: number
  readonly maxAgeMs: number
  /** Explicit window bounds (day navigation). Both ride the REQUEST. */
  readonly sinceMs?: number
  readonly untilMs?: number
  /**
   * Has the camera list RESOLVED yet?
   *
   * Load-bearing for the empty state, not a nicety. `deviceIds` is empty both
   * while `listDevices` is in flight AND when the token genuinely sees no
   * cameras, and the two must not look the same: treating the first as
   * "nothing to fetch" is what made every embed flash "No events" for a beat
   * before its first page arrived.
   */
  readonly devicesResolved: boolean
  /**
   * The host the embed is talking to — `lan:192.0.2.10:4443` or
   * `public:camstack.example.top`, from `describeFeedChannel` (embed) or the app's route channel.
   *
   * On every request line, because "am I on the LAN or on the tunnel?" is a
   * per-request question and the answer moves: the host app races its own
   * route while the embed is pinned to the URL it was handed at mount, so the
   * two can legitimately disagree and nothing said so.
   */
  readonly channel: string
  /** When true, `listRecentTracks` sends `includeStationary: true`. Omit/false
   *  leaves the hub's default (hide parked promotions). */
  readonly includeStationary?: boolean
  /**
   * Track SOURCES to leave out of the READ — see `EVENTS_TRACK_SOURCES`.
   * Empty/omitted sends nothing.
   *
   * It rides the request rather than narrowing a downloaded page because the
   * page size, the memory ceiling and `nextCursor` are all defined on what the
   * server returns: dropping rows afterwards would make "load older" promise
   * pages the operator never sees. The page still applies the same rule to the
   * rows for correctness against an older hub.
   */
  readonly excludeSources?: readonly EventsTrackSource[]
}

/** Stable identity so an omitted list never re-runs an effect. */
const NOOP_LOG: EventsFeedLog = () => undefined

const EMPTY_EXCLUDE_SOURCES: readonly EventsTrackSource[] = []

export interface EventsFeedResult {
  readonly rows: readonly EventsTrackRow[]
  /**
   * True until the first page SETTLES — which means a request completed, or
   * the camera list resolved to nothing to ask for. It is NOT "no rows yet":
   * an empty state must never be shown on the strength of a fetch that has not
   * happened.
   */
  readonly loading: boolean
  /**
   * A page request is IN FLIGHT while rows are already on screen — i.e. the
   * infinite scroll is fetching the next block. Distinct from `loading`, which
   * is the FIRST page: the tail indicator and the full-surface skeleton are
   * different affordances and must not be driven by one flag.
   */
  readonly loadingMore: boolean
  readonly error: string | null
  readonly hasMore: boolean
  /**
   * WHY the feed would stop, when it would. `hasMore` collapses `exhausted`
   * and `ceiling` into one boolean and the surface cannot tell them apart —
   * which is how a client-side row limit came to be drawn as "you have reached
   * the beginning". Read this for anything the operator can see.
   */
  readonly tail: FeedTailReason
  readonly loadMore: () => void
  /**
   * Lift the in-memory ceiling by one more block and keep paging.
   *
   * The ceiling is a MEMORY bound, not a statement about history, so it must
   * be liftable — otherwise the only honest thing the surface could say at 600
   * rows is "this client gives up", with no way forward. Bounded per call (one
   * block), never automatic: an unbounded auto-lift is the OOM the ceiling
   * exists to prevent.
   */
  readonly loadOlder: () => void
  /** Clear the error and re-request. The retry button, and the `refresh`
   *  fallback when the feed has nothing loaded. */
  readonly retry: () => void
  /** Incremental delta from the current head. Never restarts the feed. The
   *  promise settles when the delta does (immediately on the no-op branches) —
   *  what the `refresh` host command's `refreshed` ack is emitted on. */
  readonly refresh: () => Promise<void>
  /** Drop everything and re-page from the top. The `reload` host command only. */
  readonly reload: () => void
}

export function useEventsFeed(params: EventsFeedParams): EventsFeedResult {
  const { client, deviceIds, nameById, pageSize, maxRows, refreshMs, maxAgeMs } = params
  const log = params.log ?? NOOP_LOG
  const logRef = useRef<EventsFeedLog>(log)
  useEffect(() => {
    logRef.current = log
  }, [log])
  const { sinceMs, untilMs, devicesResolved } = params
  const includeStationary = params.includeStationary === true
  // Normalised ONCE: it is spread into two requests and it is part of the
  // reset key, and those three must never disagree about what is hidden.
  const excludeSources = params.excludeSources ?? EMPTY_EXCLUDE_SOURCES
  const excludeSourcesKey = [...excludeSources].sort().join(',')
  const [feed, setFeed] = useState<FeedState>(EMPTY_FEED)
  // "A fetch has completed", never "rows exist". Only this flips the empty
  // state on.
  const [settled, setSettled] = useState(false)
  // Mirrors `busyRef` into render state. The ref alone cannot drive UI — it is
  // deliberately not reactive, which is why the tail spinner needs this.
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generation, setGeneration] = useState(0)
  /**
   * The ceiling actually in force. Starts at `maxRows` and is raised ONE block
   * at a time by {@link EventsFeedResult.loadOlder} — the operator asking to
   * continue past a limit that was never about history. Reset with the feed: a
   * different question is asked with a fresh budget.
   */
  const [ceiling, setCeiling] = useState(maxRows)
  const ceilingRef = useRef(maxRows)
  ceilingRef.current = ceiling

  // The live feed, readable from callbacks without re-creating them on every
  // row change (an infinite-scroll observer re-subscribing per page is how a
  // scroll listener starts missing its own sentinel).
  const feedRef = useRef<FeedState>(EMPTY_FEED)
  feedRef.current = feed
  const busyRef = useRef(false)
  /**
   * A `loadMore` that arrived while a request was in flight.
   *
   * Dropping it silently is not "harmless de-duplication": the sentinel is an
   * `IntersectionObserver`, which fires on a TRANSITION. A sentinel that scrolls
   * into view during the previous page's request fires exactly once, is ignored,
   * and never fires again while it stays on screen — the feed stalls with more
   * pages available and nothing anywhere saying why. So the ask is remembered
   * and replayed once the request settles.
   */
  const pendingMoreRef = useRef(false)
  /** Consecutive failures of the CURRENT page request. Reset by any success. */
  const attemptRef = useRef(0)
  /** Pending backoff timer, so a reload/unmount can cancel a retry that is
   *  about to fire against a feed nobody is looking at any more. */
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const anchorRef = useRef(Date.now())
  const nameByIdRef = useRef(nameById)
  nameByIdRef.current = nameById
  const channelRef = useRef(params.channel)
  channelRef.current = params.channel
  /** When a deferred `loadMore` was ASKED FOR, so the replay can report how
   *  long it sat in the queue instead of charging that time to the wire. */
  const pendingSinceRef = useRef<number | null>(null)

  // The lag sampler must be running BEFORE the first request, or the first
  // request — the cold one, the slowest one, the one worth explaining — is the
  // only one with no contention estimate at all.
  useEffect(() => {
    startLagSampler()
  }, [])

  const deviceKey = deviceIds.join(',')

  /**
   * One request. Returns the outcome instead of SETTING the error — whether a
   * failure is worth showing is the caller's decision (it may be the first of
   * three attempts), and a query that writes error state directly cannot be
   * retried without flashing.
   */
  const query = useCallback(
    async (input: RecentTracksInput, waitMs = 0): Promise<QueryOutcome> => {
      const requestId = `feed-${String(++requestSequence)}`
      const startedAt = performance.now()
      try {
        const raw: unknown = await client.listRecentTracks(input)
        const finishedAt = performance.now()
        const split = splitDuration(finishedAt - startedAt, lagWindow(startedAt, finishedAt))
        const timing: RequestTiming = { requestId, waitMs: Math.round(waitMs), ...split }
        if (!isResponse(raw)) {
          logRef.current('request invalid', { ...timing, channel: channelRef.current })
          return { ok: false, message: 'unexpected response shape' }
        }
        return { ok: true, page: raw, timing }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        const finishedAt = performance.now()
        // A page that failed and said nothing reads as "there were no tracks".
        logRef.current('listRecentTracks failed', {
          error: message,
          devices: input.deviceIds.length,
          limit: input.limit,
          since: input.since,
          cursor: input.cursor ?? null,
          requestId,
          channel: channelRef.current,
          waitMs: Math.round(waitMs),
          ...splitDuration(finishedAt - startedAt, lagWindow(startedAt, finishedAt)),
        })
        return { ok: false, message }
      }
    },
    [client],
  )

  /**
   * Emit the ONE line per request that carries all four times.
   *
   * Deliberately not inside `query`: `parseMs` — turning the response into rows
   * and committing them — happens at the CALL SITE, and it is the third of the
   * three things the old `ms` was hiding. Splitting this into two lines would
   * put the halves of one request in two places in the log, which is how the
   * question "where did the 4.4 s go" became unanswerable in the first place.
   */
  const logRequest = useCallback(
    (timing: RequestTiming, extra: Record<string, unknown>): void => {
      logRef.current('request complete', { ...timing, channel: channelRef.current, ...extra })
    },
    [],
  )

  /** Fetch the next OLDER page and fold it in. An ask that arrives mid-request
   *  is REMEMBERED (see `pendingMoreRef`), never dropped. */
  const loadMore = useCallback((): void => {
    if (busyRef.current) {
      pendingMoreRef.current = true
      if (pendingSinceRef.current === null) pendingSinceRef.current = performance.now()
      return
    }
    const state = feedRef.current
    // The REF, not the `maxRows` prop: `loadOlder` raises the ceiling and
    // replays in the same tick, long before React commits. Reading the prop
    // here would refuse the very page the lift was asked for.
    if (!feedHasMore(state, ceilingRef.current)) return
    if (deviceIds.length === 0) return
    const askedAt = pendingSinceRef.current
    pendingSinceRef.current = null
    const waitMs = askedAt === null ? 0 : performance.now() - askedAt
    busyRef.current = true
    setFetching(true)
    const limit = resolveEventsPageLimit(pageSize, deviceIds.length)
    const window = resolveFeedWindow({
      anchorMs: anchorRef.current,
      maxAgeMs,
      ...(sinceMs !== undefined ? { sinceMs } : {}),
      ...(untilMs !== undefined ? { untilMs } : {}),
    })
    const paged = pageCursor(state) !== null
    void query(
      {
        deviceIds: [...deviceIds],
        since: window.since,
        limit,
        projection: 'slim',
        ...(includeStationary ? { includeStationary: true } : {}),
        ...(excludeSources.length > 0 ? { excludeSources: [...excludeSources] } : {}),
        ...(window.until !== undefined ? { until: window.until } : {}),
        // During a rebuild this is the NEW generation's cursor — see `pageCursor`.
        ...((): { cursor?: string } => {
          const cursor = pageCursor(state)
          return cursor !== null ? { cursor } : {}
        })(),
      },
      waitMs,
    )
      .then((outcome) => {
        if (outcome.ok) {
          const parseStartedAt = performance.now()
          const rows = toEventsTrackRows(outcome.page.tracks, nameByIdRef.current)
          // The REF is updated synchronously, not just the state. A deferred
          // `loadMore` replays in the `.finally` below — one microtask later,
          // long before React commits — and a replay reading the pre-commit ref
          // would re-request page ONE with no cursor, forever.
          const next = appendPage(feedRef.current, rows, outcome.page.nextCursor)
          feedRef.current = next
          setFeed(next)
          logRequest(outcome.timing, {
            rows: rows.length,
            devices: deviceIds.length,
            limit,
            paged,
            parseMs: Math.round(performance.now() - parseStartedAt),
          })
          attemptRef.current = 0
          setError(null)
          setSettled(true)
          return
        }
        // ── Failure. Not necessarily an error. ──────────────────────────────
        //
        // The resume-from-background case: the WebView wakes, the in-flight
        // fetch is already dead, and the first request after resume fails once
        // and then works. Surfacing that immediately put a hard error on screen
        // for a condition that had already healed — so retry a couple of times,
        // briefly, before admitting anything.
        const attempt = attemptRef.current
        const backoff = RETRY_BACKOFF_MS[attempt]
        if (attempt + 1 < MAX_PAGE_ATTEMPTS && backoff !== undefined) {
          attemptRef.current = attempt + 1
          logRef.current('page failed — retrying', {
            attempt: attempt + 1,
            of: MAX_PAGE_ATTEMPTS,
            backoffMs: backoff,
          })
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null
            loadMoreRef.current()
          }, backoff)
          // Deliberately NOT settled: the surface keeps its loading state
          // rather than flashing an error it is about to take back.
          return
        }
        attemptRef.current = 0
        // A reload that could not be paged in must not leave the surface stuck
        // behind a shadow nobody will ever fill: keep the generation on screen.
        const kept = abandonRebuild(feedRef.current)
        feedRef.current = kept
        setFeed(kept)
        setError(outcome.message)
        setSettled(true)
      })
      .finally(() => {
        busyRef.current = false
        setFetching(false)
        // A rebuild is not finished until it has swapped. Chaining here (rather
        // than from an effect) keeps the whole reload inside one request chain,
        // so nothing on screen can change between its pages.
        if (isRebuilding(feedRef.current)) {
          loadMoreRef.current()
          return
        }
        if (pendingMoreRef.current) {
          pendingMoreRef.current = false
          loadMoreRef.current()
        }
      })
  }, [query, logRequest, deviceIds, deviceKey, pageSize, maxAgeMs, sinceMs, untilMs, includeStationary, excludeSourcesKey])

  // Self-reference for the deferred replay above — a `useCallback` cannot name
  // itself, and capturing the previous render's closure would replay the ask
  // against a stale device set.
  const loadMoreRef = useRef(loadMore)
  loadMoreRef.current = loadMore

  /**
   * Incremental refresh: ask only for what is newer than the head, merge by
   * trackId, drain a bounded number of pages when the window was not fully
   * delivered. The paging cursor is never touched.
   */
  const refresh = useCallback((): Promise<void> => {
    if (busyRef.current) return Promise.resolve()
    if (deviceIds.length === 0) return Promise.resolve()
    const since = deltaSince(feedRef.current)
    if (since === null) {
      // Nothing loaded yet — a delta has no head to be incremental about.
      //
      // This is also the FOREGROUND hook: the host sends `refresh` when the app
      // comes back, and if the surface is sitting on an error (the resume blip
      // that outlived its retries) the right answer is to HEAL it, not to poll
      // around it. `retry` clears the error and re-requests the first page.
      retryRef.current()
      return Promise.resolve()
    }
    busyRef.current = true
    const limit = resolveEventsPageLimit(pageSize, deviceIds.length)
    return (async (): Promise<void> => {
      let cursor: string | null = null
      let pages = 0
      let gap = true
      while (gap && pages < MAX_DELTA_PAGES) {
        const outcome: QueryOutcome = await query({
          deviceIds: [...deviceIds],
          since,
          limit,
          projection: 'slim',
          ...(includeStationary ? { includeStationary: true } : {}),
          ...(excludeSources.length > 0 ? { excludeSources: [...excludeSources] } : {}),
          // The upper bound rides the DELTA too. Without it a day view polling
          // "newer than my head" would pull in tracks from AFTER the day it is
          // showing — the one way an explicit window can leak.
          ...(untilMs !== undefined ? { until: untilMs } : {}),
          ...(cursor !== null ? { cursor } : {}),
        })
        // A failed DELTA is silent on purpose: the rows already on screen are
        // still valid, and a poll that missed once will poll again. Only a
        // failed PAGE (which leaves the surface empty) is worth an error.
        if (!outcome.ok) return
        const page = outcome.page
        const parseStartedAt = performance.now()
        const rows = toEventsTrackRows(page.tracks, nameByIdRef.current)
        const result = applyDelta(feedRef.current, rows, page.nextCursor)
        feedRef.current = result.state
        setFeed(result.state)
        logRequest(outcome.timing, {
          rows: rows.length,
          devices: deviceIds.length,
          limit,
          paged: cursor !== null,
          delta: true,
          parseMs: Math.round(performance.now() - parseStartedAt),
        })
        setError(null)
        gap = result.gap
        cursor = result.deltaCursor
        pages += 1
      }
      if (gap) {
        // Bounded drain: rows between the last delta page and the head were not
        // fetched. Say so — the alternative is a feed with a hole in it and no
        // line anywhere saying a hole exists.
        logRef.current('delta drain hit its page bound — newer rows may be missing', {
          since,
          pages,
          bound: MAX_DELTA_PAGES,
        })
      }
    })().finally(() => {
      busyRef.current = false
      // A `loadMore` that landed during the delta is still owed a page.
      if (pendingMoreRef.current) {
        pendingMoreRef.current = false
        loadMoreRef.current()
      }
    })
  }, [query, logRequest, deviceIds, deviceKey, pageSize, loadMore, untilMs, includeStationary, excludeSourcesKey])

  const cancelRetry = useCallback((): void => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    attemptRef.current = 0
  }, [])

  /**
   * Raise the ceiling by one block and continue.
   *
   * `Math.max(1, maxRows)` mirrors {@link tailReason}'s own floor so a
   * pathological `maxRows: 0` still advances instead of lifting by nothing and
   * looking broken.
   */
  const loadOlder = useCallback((): void => {
    const lifted = ceilingRef.current + Math.max(1, maxRows)
    ceilingRef.current = lifted
    setCeiling(lifted)
    loadMoreRef.current()
  }, [maxRows])

  /** Clear the error and try the page again — the button behind the error
   *  state, and what a host's `refresh` falls back to when nothing loaded. */
  const retry = useCallback((): void => {
    cancelRetry()
    setError(null)
    setSettled(false)
    loadMoreRef.current()
  }, [cancelRetry])

  // Self-reference for the foreground heal above (`retry` is declared after
  // `refresh` in source order but only ever called later).
  const retryRef = useRef<() => void>(() => {})

  /**
   * Throw the loaded rows away and start from nothing — the feed is being asked
   * a DIFFERENT question (another camera set, another day), so what is on
   * screen is not an older answer to it, it is an answer to something else.
   * Returning to the top is correct here and only here.
   */
  const restart = useCallback((): void => {
    cancelRetry()
    anchorRef.current = Date.now()
    // A pending ask belongs to the feed being discarded — replaying it after a
    // restart would fetch page 2 of a feed whose page 1 has not been read yet.
    pendingMoreRef.current = false
    feedRef.current = EMPTY_FEED
    setFeed(EMPTY_FEED)
    setSettled(false)
    setFetching(false)
    setError(null)
    // A lift belongs to the feed being discarded. Carrying it into a DIFFERENT
    // question (another day, another camera set) would hand the new feed a
    // budget nobody asked for.
    ceilingRef.current = maxRows
    setCeiling(maxRows)
    setGeneration((g) => g + 1)
  }, [cancelRetry, maxRows])

  /**
   * Re-read the SAME question, keeping the operator's place.
   *
   * The rows on screen stay on screen while the replacement is paged in behind
   * them (`beginRebuild`); the swap happens in one step once the new generation
   * is at least as tall. Emptying first is what this fixes: the scroller's
   * content collapsed, the browser clamped `scrollTop` to 0, and an operator who
   * opened one event — or merely sat in its detail while the hub announced a
   * face change — came back to row one.
   *
   * `settled` is deliberately NOT cleared while rows are painted: `loading`
   * drives the host's full-surface skeleton, which would blank a list that never
   * went away.
   */
  const reload = useCallback((): void => {
    cancelRetry()
    anchorRef.current = Date.now()
    pendingMoreRef.current = false
    const next = beginRebuild(feedRef.current)
    feedRef.current = next
    setFeed(next)
    if (next.rows.length === 0) setSettled(false)
    setFetching(false)
    setError(null)
    setGeneration((g) => g + 1)
  }, [cancelRetry])

  // Camera set / age floor changed ⇒ the loaded rows answer a different
  // question. Reset rather than merge: a cursor issued for one device set is
  // meaningless against another.
  // A window change answers a DIFFERENT question, and a cursor issued for one
  // window is meaningless against another — so it resets, exactly as a camera
  // change does. This is what makes day navigation work at all.
  // Hiding a source changes WHICH rows the server will ever return, so it
  // rebuilds the feed like the window and the parked toggle do. Leaving it out
  // would append a narrowed page under a wide one already on screen.
  const resetKey = `${deviceKey}|${maxAgeMs}|${sinceMs ?? ''}|${untilMs ?? ''}|${includeStationary ? '1' : '0'}|${excludeSourcesKey}`
  const resetKeyRef = useRef(resetKey)
  useEffect(() => {
    if (resetKeyRef.current === resetKey) return
    resetKeyRef.current = resetKey
    // Resetting a feed that has NEVER loaded is a no-op that costs a page.
    //
    // On every boot the key goes `''` → `101,102,…` the moment the camera list
    // resolves, which looked like a window change and triggered a reload. The
    // reload bumps `generation`, the first-page effect re-fires on it, and by
    // then the real first request is already in flight — so the duplicate was
    // parked in `pendingMoreRef` and replayed as page TWO. Every mount fetched
    // two pages and rendered one.
    //
    // Nothing has been paged yet at that moment, so there is nothing to reset:
    // adopt the key and let the first-page effect do its single job.
    if (feedRef.current.rows.length === 0 && !settled) return
    restart()
  }, [resetKey, restart, settled])

  // First page of each generation.
  useEffect(() => {
    if (deviceIds.length === 0) {
      // Settled ONLY once the device list is known to be empty. While it is
      // still loading there is nothing to report and nothing to show.
      if (devicesResolved) setSettled(true)
      return
    }
    loadMore()
    // `loadMore` is stable per (devices, page size, floor); `generation` forces
    // a fresh first page after a reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, deviceKey, devicesResolved])

  // Light incremental polling. Not an event subscription on purpose: a track
  // becomes visible here when it is PERSISTED (at expiry), which no live event
  // announces, and a poll that asks only for `since = head` costs one short
  // query per interval.
  useEffect(() => {
    if (refreshMs <= 0 || deviceIds.length === 0) return
    // A CLOSED window in the past cannot gain rows. Polling one forever is a
    // query a minute that can only ever return the head back.
    if (!shouldPoll(untilMs, Date.now())) return
    const timer = setInterval(() => void refresh(), refreshMs)
    return () => clearInterval(timer)
  }, [refreshMs, refresh, deviceIds.length, untilMs])

  retryRef.current = retry

  // A retry scheduled against a feed that is being torn down (or replaced)
  // must not fire.
  useEffect(() => cancelRetry, [cancelRetry])

  return {
    rows: feed.rows,
    retry,
    loading: !settled,
    // Only once something is on screen — before that the full-surface skeleton
    // is the right affordance, and showing both would be two spinners for one
    // request.
    loadingMore: fetching && settled,
    error,
    hasMore: feedHasMore(feed, ceiling),
    tail: tailReason(feed, ceiling),
    loadMore,
    loadOlder,
    refresh,
    reload,
  }
}
