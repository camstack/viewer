/**
 * useEventsGalleryFeed — the rows the native events surfaces (gallery, reel,
 * and the detail's prev/next) draw, from the hub.
 *
 * It owns NO feed logic. Paging, the incremental delta, the day window, the
 * ceiling, the retry — all of it is `shared/events` (`useEventsFeed`), the very
 * hook the hub-hosted embed runs, so the two cannot drift. This module is the
 * app's half: where the cameras and the taxonomy come from (React Query, the
 * same hooks every other screen uses), how a semantic search is asked, and the
 * pipeline that turns loaded rows into shown rows — device names, operator
 * flag overlay, filters, search merge, sort — each step a shared pure function.
 *
 * ## Why the page requests do not ride `useInfiniteQuery`
 *
 * A cursor page is only half of what this feed does. `applyDelta` prepends rows
 * newer than the head WITHOUT touching the paging cursor, `beginRebuild`
 * re-pages behind the painted rows and swaps once the replacement is as tall,
 * and a reorder the delta cannot prove forces a reset. None of that is
 * expressible as `pages[]`, so an infinite query would have to re-implement it
 * — a second copy of the one thing that must not exist twice. React Query owns
 * what is a plain keyed read here: the cameras, the taxonomy, the semantic hits
 * and the track-by-id upgrade.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'

import { useConnection } from '../connection/ConnectionProvider.js'
import { useScreenActive } from '../hooks/use-screen-active.js'
import { useCameras } from './use-cameras.js'
import { useEventKinds } from './use-event-kinds.js'
import { BULK_QUERY_DEADLINE_MS, capQuery } from './cap-query.js'
import { createEventsFeedClient, logEventsFeed } from './events-feed-client.js'
import { registerEventsFeed } from '../events/events-feed-registry.js'
import { useTrackFlagOverlayStore } from '../store/track-flag-overlay-store.js'
import {
  dayWindowFor,
  sortRows,
  type FeedTailReason,
} from '../../shared/events/events-feed.js'
import {
  DEFAULT_EVENTS_MAX_AGE_MS,
  DEFAULT_EVENTS_MAX_ROWS,
  DEFAULT_EVENTS_PAGE_SIZE,
  REEL_EVENTS_MAX_ROWS,
} from '../../shared/events/events-feed-limits.js'
import { mergeSearchRows, semanticSearchRequest, toSemanticRows } from '../../shared/events/events-semantic.js'
import {
  applyDeviceNames,
  applyTrackFlagPatches,
  filterRows,
  type EventsTrackRow,
} from '../../shared/events/events-track-row.js'
import { classToMacroFromKinds, iconIdsFromKinds } from '../../shared/events/events-taxonomy.js'
import type {
  EventsAttribute,
  EventsSearchMode,
  EventsSort,
  EventsTrackSource,
} from '../../shared/events/events-share-url.js'
import { useEventsFeed } from '../../shared/events/use-events-feed.js'

/** Which surface asks — it only changes the row ceiling. */
export type EventsFeedView = 'gallery' | 'reel'

/** CLIP hits requested per query (the embed's default). */
const SEMANTIC_LIMIT = 50
/** A semantic result is a complete set, kept briefly: the same text asked again
 *  (back from a detail, a day arrow and back) must not pay a second CLIP pass. */
const SEMANTIC_STALE_MS = 60_000

export interface EventsGalleryQuery {
  readonly view: EventsFeedView
  /** EMPTY = every camera the viewer lists. */
  readonly deviceIds: readonly number[]
  readonly classes: readonly string[]
  readonly attrs: readonly EventsAttribute[]
  /** The APPLIED query (confirmed, never the keystroke draft). */
  readonly search: string
  readonly searchMode: EventsSearchMode
  readonly sort: EventsSort
  readonly filterDebug?: boolean
  readonly filterTrain?: boolean
  readonly filterFavourited?: boolean
  readonly showStationary?: boolean
  readonly excludeSources?: readonly EventsTrackSource[]
  readonly reviewedTrackIds?: readonly string[]
  /** 0 = the live day; N > 0 = N days back. */
  readonly dayOffset?: number
  /** Seeded ONCE by the screen so the feed's key is stable across renders. */
  readonly anchorMs: number
  /** Age floor (ms). Defaults to the feed's 30 days; the reel passes 24 h. */
  readonly maxAgeMs?: number
}

export type EventsGalleryMode = 'feed' | 'semantic'

export interface EventsGalleryFeed {
  /** Shown rows, in display order — also the detail's prev/next collection. */
  readonly rows: readonly EventsTrackRow[]
  /** First page not settled yet (full-surface skeleton). */
  readonly loading: boolean
  /** A further page is in flight under rows that are already painted. */
  readonly loadingMore: boolean
  readonly error: string | null
  readonly tail: FeedTailReason
  readonly mode: EventsGalleryMode
  readonly semanticLoading: boolean
  /** `kind → glyph id` from the hub's descriptors. */
  readonly iconIds: ReadonlyMap<string, string>
  readonly loadMore: () => void
  readonly loadOlder: () => void
  readonly refresh: () => Promise<void>
  readonly retry: () => void
}

const EMPTY_IDS: readonly number[] = []
const EMPTY_ROWS: readonly EventsTrackRow[] = []

export function useEventsGalleryFeed(query: EventsGalleryQuery): EventsGalleryFeed {
  const { controller, state } = useConnection()
  const screenActive = useScreenActive()
  const { data: cameras, isSuccess: camerasResolved } = useCameras({ includeHidden: true })

  const nameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const camera of cameras ?? []) map.set(camera.id, camera.name)
    return map
  }, [cameras])

  const deviceIds = useMemo<readonly number[]>(() => {
    if (query.deviceIds.length > 0) return query.deviceIds
    return cameras === undefined ? EMPTY_IDS : cameras.map((camera) => camera.id)
  }, [query.deviceIds, cameras])

  const kinds = useEventKinds(deviceIds).data
  const classToMacro = useMemo(() => classToMacroFromKinds(kinds ?? []), [kinds])
  const iconIds = useMemo(() => iconIdsFromKinds(kinds ?? []), [kinds])

  const client = useMemo(
    () => createEventsFeedClient(() => controller.getSystem()?.trpcClient ?? null),
    [controller],
  )

  const dayOffset = query.dayOffset ?? 0
  const window = useMemo(() => dayWindowFor(dayOffset, query.anchorMs), [dayOffset, query.anchorMs])
  const reel = query.view === 'reel'

  const feed = useEventsFeed({
    client,
    log: logEventsFeed,
    // Nothing to ask until the connection is up: a request fired into a
    // disconnected controller would burn its three attempts on a dead socket.
    deviceIds: state === 'connected' ? deviceIds : EMPTY_IDS,
    nameById,
    pageSize: DEFAULT_EVENTS_PAGE_SIZE,
    maxRows: reel ? REEL_EVENTS_MAX_ROWS : DEFAULT_EVENTS_MAX_ROWS,
    // New tracks arrive through the hub's events (`registerEventsFeed` below)
    // and the foreground/focus refresh, not a timer: a poll is a request a
    // minute per open screen for a hub that already says when something moved.
    refreshMs: 0,
    maxAgeMs: query.maxAgeMs ?? DEFAULT_EVENTS_MAX_AGE_MS,
    channel: 'app',
    devicesResolved: state === 'connected' && (query.deviceIds.length > 0 || camerasResolved),
    ...(query.showStationary === true ? { includeStationary: true } : {}),
    ...(query.excludeSources !== undefined ? { excludeSources: query.excludeSources } : {}),
    ...(window.sinceMs !== undefined ? { sinceMs: window.sinceMs } : {}),
    ...(window.untilMs !== undefined ? { untilMs: window.untilMs } : {}),
  })

  const { refresh, reload } = feed
  const reloadVoid = useCallback((): void => reload(), [reload])
  const refreshVoid = useCallback((): void => void refresh(), [refresh])

  // Hub announcements (a face assigned, a track persisted) reach every mounted
  // events surface through ONE registry — only a surface somebody can see.
  useEffect(() => {
    if (!screenActive) return
    return registerEventsFeed({ refresh: refreshVoid, reload: reloadVoid })
  }, [screenActive, refreshVoid, reloadVoid])

  // Coming back to the screen (focus, or the app foregrounded) is ONE delta —
  // never a reload, which would blank rows that are still correct. The first
  // activation is a cold mount already loading its first page.
  const wasActive = useRef(screenActive)
  useEffect(() => {
    if (screenActive && !wasActive.current) void refresh()
    wasActive.current = screenActive
  }, [screenActive, refresh])

  // ── CLIP semantic search ────────────────────────────────────────────────────
  // A server query, so it REPLACES the feed's reach instead of filtering it:
  // it can surface tracks the feed never paged to. Empty query ⇒ inert.
  const semanticText = query.searchMode === 'semantic' ? query.search.trim() : ''
  const semantic = useQuery<readonly EventsTrackRow[]>({
    queryKey: ['v2', 'events-semantic', semanticText, [...deviceIds].sort((a, b) => a - b), window.untilMs ?? null],
    enabled: state === 'connected' && semanticText.length > 0 && deviceIds.length > 0,
    staleTime: SEMANTIC_STALE_MS,
    queryFn: async () => {
      const system = controller.getSystem()
      if (!system) return EMPTY_ROWS
      const raw = await capQuery(
        system.trpcClient as Record<string, unknown>,
        'pipelineAnalytics',
        'searchObjectEvents',
        semanticSearchRequest(semanticText, deviceIds, { semanticLimit: SEMANTIC_LIMIT, ...window }),
        { deadlineMs: BULK_QUERY_DEADLINE_MS, rethrow: true },
      )
      return toSemanticRows(raw, nameById)
    },
  })
  const semanticActive = semanticText.length > 0

  // ── loaded rows → shown rows ────────────────────────────────────────────────
  const flagPatches = useTrackFlagOverlayStore((s) => s.patches)
  const reviewed = useMemo(() => new Set(query.reviewedTrackIds ?? []), [query.reviewedTrackIds])
  const decorate = useCallback(
    (list: readonly EventsTrackRow[]): readonly EventsTrackRow[] => {
      const named = applyTrackFlagPatches(applyDeviceNames(list, nameById), flagPatches)
      return reviewed.size === 0
        ? named
        : named.map((row) => (reviewed.has(row.trackId) ? { ...row, reviewed: true } : row))
    },
    [nameById, flagPatches, reviewed],
  )

  const feedRows = feed.rows
  const semanticRows = semantic.data
  const { classes, attrs, search, sort, excludeSources } = query
  const flagFilters = useMemo(
    () => ({
      debug: query.filterDebug,
      train: query.filterTrain,
      favourited: query.filterFavourited,
      reviewedTrackIds: query.reviewedTrackIds ?? [],
    }),
    [query.filterDebug, query.filterTrain, query.filterFavourited, query.reviewedTrackIds],
  )
  const rows = useMemo(() => {
    const textMatches = filterRows(
      decorate(feedRows), classes, search, classToMacro, attrs, flagFilters, excludeSources,
    )
    if (!semanticActive) return sortRows(textMatches, sort)
    // A CLIP query is blind to everything non-visual a track knows, so the same
    // query also runs as free text over the loaded feed and the two are unioned
    // (`mergeSearchRows` owns the order, and it is the page's own sort).
    const clip = filterRows(
      decorate(semanticRows ?? EMPTY_ROWS), classes, '', classToMacro, attrs, flagFilters, excludeSources,
    )
    return mergeSearchRows(clip, textMatches, sort)
  }, [decorate, feedRows, semanticRows, semanticActive, classes, search, classToMacro, attrs, flagFilters, excludeSources, sort])

  return {
    rows,
    loading: feed.loading,
    loadingMore: feed.loadingMore,
    error: feed.error,
    tail: feed.tail,
    mode: semanticActive ? 'semantic' : 'feed',
    semanticLoading: semanticActive && semantic.isFetching,
    iconIds,
    loadMore: feed.loadMore,
    loadOlder: feed.loadOlder,
    refresh: feed.refresh,
    retry: feed.retry,
  }
}
