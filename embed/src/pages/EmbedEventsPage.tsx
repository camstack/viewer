/**
 * EmbedEventsPage — the chrome-less TRACK/EVENT surface of the embed bundle.
 *
 * Served with the Viewer at `/viewer/camstack/embed/index.html?mode=events`
 * (see `EmbedApp`), exactly like the grid and player: one bundle, one data-plane
 * prefix, one auth story. Everything about the distribution model is inherited —
 * this file only adds a mode.
 *
 * Two layouts, one feed:
 *   • `view: 'reel'`    — a compact horizontally-scrolling strip of `rows` rows.
 *   • `view: 'gallery'` — a vertically-scrolling grid of `columns` columns.
 *
 * ## Contract
 *
 *   IN  (native, before load):  window.__CAMSTACK_EVENTS__ = { serverUrl, token, … }
 *   IN  (web iframe):           `embed-ready` → `embed-config` handshake
 *   IN  (standalone / iframe):  `?mode=events&v=1&…` query params + `#t=<token>`
 *   IN  (runtime):              window.__camstackEvents = { setConfig, refresh,
 *                                 reload, loadMore, scrollToTop }
 *                               …or `postMessage({type:'embed-command', command})`
 *   OUT (postMessage):          ready / error / state / trackClick / countChanged
 *                               — all versioned (`v: 1`), see `events-messages.ts`
 *
 * ## What it deliberately does NOT do
 *
 * No anchor-bumped restart. A refresh asks only for what is newer than the head
 * (`since = rows[0].lastSeen`) and merges by trackId; the paging cursor is never
 * invalidated, so scrollback is not rebuilt behind the user. And no reload ever
 * empties the grid: an empty grid has no height, the browser clamps `scrollTop`
 * to 0, and the operator loses their place. See `events-feed.ts`.
 */

import { createSystem } from '@camstack/sdk'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EventsCard } from '../components/EventsCard'
import { PaletteBridge } from '../embed/PaletteBridge'
import {
  createEventsDataClient,
  type EventsDataClient,
  type EventsDeviceRow,
} from '../embed/events-client'
import {
  applyEventsConfigPatch,
  cardEdgePx,
  type EventsConfig,
  eventsString,
  parseEventsConfig,
  reelCardHeightPx,
  REEL_LIST_PADDING_V,
  resolveDeviceName,
  resolveMaxRows,
  thumbEdgeForCardPx,
} from '../embed/events-config'
import { resolveEventsLabels } from '../../../shared/events/events-labels'
import { buildTrackThumbUrl } from '../../../shared/events/events-media-url'
import { resolveTileDisplay } from '../../../shared/events/events-tile-display'
import {
  countChangedMsg,
  type EventsCommand,
  eventsErrorMsg,
  eventsHeartbeatMsg,
  eventsLog,
  eventsReadyMsg,
  eventsRefreshedMsg,
  eventsScrollMsg,
  eventsStateMsg,
  type EventsTrackFlagPatch,
  parseEventsCommand,
  postToEventsHost,
  trackClickMsg,
  windowCommandToPatch,
} from '../embed/events-messages'
import { createTrackListReporter } from '../embed/events-track-list'
import { mergeSearchRows, semanticSearchRequest, toSemanticRows } from '../../../shared/events/events-semantic'
import { galleryGeometry, galleryPreloadWindow, reelPreloadWindow } from '../../../shared/events/events-reel-window'
import { reelCardGeometry } from '../../../shared/events/events-reel-geometry'
import { useGalleryRows } from '../embed/use-gallery-rows'
import {
  buildClassToMacro,
  buildKindIconIds,
  buildKindLabels,
  iconIdForClass,
} from '../../../shared/events/events-taxonomy'
import { type EventsPalette, resolvePalette } from '../embed/events-theme'
import {
  applyDeviceNames,
  applyTrackFlagPatches,
  type EventsTrackRow,
  filterRows,
  isAudioSourceRow,
  resolveCameraIds,
} from '../../../shared/events/events-track-row'
import { mergeUrlPatch, readEventsUrlConfig, readEventsUrlPatch } from '../embed/events-url-config'
import { onHostCommand, useEmbedConfig } from '../embed/host-bridge'
import { describeFeedChannel } from '../embed/feed-channel'
import { useEventsFeed } from '../../../shared/events/use-events-feed'
import { SCROLL_IDLE_MS, useImagePreloader } from '../embed/use-image-preloader'
import { PULL_THRESHOLD_PX, internalPullGestureEnabled, usePullToRefresh } from '../embed/use-pull-to-refresh'

declare global {
  interface Window {
    __CAMSTACK_EVENTS__?: unknown
    __camstackEvents?: {
      setConfig: (patch: unknown) => void
      setWindow: (window: { sinceMs?: number | null; untilMs?: number | null }) => void
      refresh: () => void
      reload: () => void
      loadMore: () => void
      scrollToTop: () => void
      ping: () => void
      setTrackFlagPatches: (patches: unknown) => void
      setTrackListMode: (mode: unknown) => void
    }
  }
}

/** Gap between cards, px. Shared by both layouts so a host switching `view`
 *  does not see the density change under it. */
const GAP_PX = 8
/** Gallery only: the pictures are the content, so the grid is tight — a few px
 *  between tiles and at the edges (the viewer's Events grid is as dense). */
const GALLERY_GAP_PX = 3
/** Outer padding of the scroll container, px. */
const PAD_PX = 10
/** Gallery outer padding, px. */
const GALLERY_PAD_PX = 4
/**
 * Floor for the prefetch margin, px — what is used when the scroller has no
 * measurable extent yet (a mount before layout, a host that has not sized the
 * frame). Never the whole policy: see {@link sentinelMarginPx}.
 */
const SENTINEL_MARGIN_MIN_PX = 400

/**
 * How far ahead of the scroll edge the next page is requested — ONE full
 * scroller ahead, measured, not a constant.
 *
 * The same reasoning the image preloader already runs on: a fixed 400 px is
 * two and a half card rows on a phone and less than half a row on a wall
 * display, i.e. two different policies wearing one number. Measured from the
 * scroller it is one policy everywhere — the operator always has a screenful
 * of loaded rows below them, so the next page starts while they are
 * APPROACHING the end instead of when they arrive at it.
 *
 * An unmeasured scroller (0) falls back to the floor rather than to 0: a
 * margin of zero fetches exactly at the wall, which is the behaviour being
 * fixed.
 */
export function sentinelMarginPx(extentPx: number): number {
  return Math.max(SENTINEL_MARGIN_MIN_PX, Math.round(extentPx))
}

/**
 * Shared look for the two ACTIONABLE tails (continue past the ceiling, retry a
 * failed page), and the shape `tail-end` mirrors.
 *
 * The REEL's tails flow inside its grid, at the right-hand end of the strip.
 * The GALLERY's sit BELOW the virtualized rows — a full-width block after the
 * bottom spacer, not a grid cell: with the list windowed there is no single
 * grid left for them to span.
 */
function tailBlockStyle(isReel: boolean, cardWidth: number): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: isReel ? '0 12px' : '10px 0',
    width: isReel ? 'max-content' : '100%',
    height: isReel ? cardWidth : undefined,
    ...(isReel ? { gridColumn: 'auto' } : {}),
    whiteSpace: 'nowrap',
  }
}

function tailActionStyle(
  isReel: boolean,
  cardWidth: number,
  palette: EventsPalette,
): React.CSSProperties {
  return {
    ...tailBlockStyle(isReel, cardWidth),
    font: 'inherit',
    fontSize: 12,
    color: palette.text,
    background: palette.card,
    border: `1px solid ${palette.border}`,
    borderRadius: 8,
    cursor: 'pointer',
  }
}
/** Pages the surface will auto-request to fill a viewport the first page did
 *  not. Bounded so a feed that simply has few rows stops asking. */
const MAX_AUTO_FILL_PAGES = 8

function FatalError({ message, palette }: { message: string; palette: EventsPalette }) {
  useEffect(() => {
    postToEventsHost(eventsErrorMsg(message))
    postToEventsHost(eventsStateMsg('error', message))
  }, [message])
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: palette.background,
        color: 'var(--color-danger)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        padding: 16,
        textAlign: 'center',
      }}
    >
      Events embed config error: {message}
    </div>
  )
}

export interface EventsProps {
  readonly client: EventsDataClient
  readonly initialConfig: EventsConfig
}

/** The mounted surface. Exported so the integration spec can drive it with an
 *  ordinary fake client — no SDK, no casts. */
export function Events({ client, initialConfig }: EventsProps) {
  const [config, setConfig] = useState<EventsConfig>(initialConfig)
  const [flagPatches, setFlagPatches] = useState<Readonly<Record<string, EventsTrackFlagPatch>>>(
    {},
  )
  const [prefersDark, setPrefersDark] = useState(
    () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true,
  )
  const [now, setNow] = useState(() => Date.now())

  // Cameras. An EMPTY `deviceIds` means "every camera the token can see", which
  // has to be RESOLVED before a single request can be made — `listRecentTracks`
  // takes an explicit device list and answers `[]` for an empty one.
  const [cameras, setCameras] = useState<readonly EventsDeviceRow[] | null>(null)
  useEffect(() => {
    let cancelled = false
    void client
      .listDevices()
      .then((devices) => {
        if (!cancelled) setCameras(devices)
      })
      .catch(() => {
        // Best-effort: an explicit deviceIds list still works without names.
        if (!cancelled) setCameras([])
      })
    return () => {
      cancelled = true
    }
  }, [client])

  // The camera-name map the whole surface renders from — server names with the
  // host's local RENAMES applied on top. Built once here so the cards, the
  // search results and the free-text haystack cannot disagree about what a
  // camera is called.
  const nameById = useMemo(() => {
    const map = new Map<number, string>()
    for (const d of cameras ?? []) {
      map.set(d.id, resolveDeviceName(d.id, d.name ?? `Camera ${d.id}`, config.deviceNames))
    }
    // A rename for a camera the device list did not return still applies — a
    // share link carries its own dictionary and may name a camera the token
    // can see rows for but whose row the list projection dropped.
    for (const [key, name] of Object.entries(config.deviceNames)) {
      const id = Number(key)
      if (Number.isInteger(id) && !map.has(id) && name.trim().length > 0) map.set(id, name)
    }
    return map
  }, [cameras, config.deviceNames])

  // The class→macro taxonomy, from the server's own kind descriptors. Failing
  // to load it NARROWS the class filter to an exact-id compare; it never empties
  // the feed, which is why this is best-effort and unblocking.
  const [classToMacro, setClassToMacro] = useState<ReadonlyMap<string, string>>(
    () => new Map<string, string>(),
  )
  // kind → declared glyph id, from the same descriptors. A class the hub learns
  // tomorrow gets the right icon with no embed redeploy.
  const [kindIconIds, setKindIconIds] = useState<ReadonlyMap<string, string>>(
    () => new Map<string, string>(),
  )

  // The host's TRANSLATED taxonomy (`kind → label`). The embed has no i18n of
  // its own, so this dictionary is the only reason a card can say `Auto`
  // instead of `Car` inside an Italian app. Rebuilt when the host re-sends it,
  // which is what a language switch does.
  const kindLabels = useMemo(() => buildKindLabels(config.kindLabels), [config.kindLabels])

  // The surface's OWN words (`events-labels.ts`) — the pills a card draws for
  // itself and the tail placeholder's name. Merged over the English ONCE: the
  // English is what an older host and every external iframe still get, per
  // label, and resolving per card per render would rebuild seven strings on
  // every frame.
  const labels = useMemo(() => resolveEventsLabels(config.labels), [config.labels])

  const deviceIds = useMemo<readonly number[]>(() => {
    if (config.deviceIds.length > 0) return config.deviceIds
    if (cameras === null) return []
    // CAMERAS, not every device — see `resolveCameraIds`. Forwarding all 318
    // devices of a deployment to read 17 cameras' tracks caps the page at six
    // rows via the server's fan-out budget.
    return resolveCameraIds(cameras)
  }, [config.deviceIds, cameras])

  useEffect(() => {
    if (deviceIds.length === 0) return
    let cancelled = false
    void client
      .listEventKinds([...deviceIds])
      .then((raw) => {
        if (cancelled) return
        setClassToMacro(buildClassToMacro(raw))
        setKindIconIds(buildKindIconIds(raw))
      })
      .catch(() => {
        // A hub too old for listEventKindsBatch, or a failure. Say so — a class
        // filter that silently stops expanding looks like a data problem.
        eventsLog('event-kind taxonomy unavailable — class filter is exact-id only')
      })
    return () => {
      cancelled = true
    }
  }, [client, deviceIds])

  const feed = useEventsFeed({
    client,
    log: eventsLog,
    deviceIds,
    nameById,
    pageSize: config.pageSize,
    // The GALLERY's bound is memory; the reel's is still the DOM, because only
    // the gallery is virtualized. One field, resolved per view.
    maxRows: resolveMaxRows(config),
    refreshMs: config.refreshMs,
    maxAgeMs: config.maxAgeMs,
    // Which route the EMBED is on. Not necessarily the host app's: the app
    // races its candidates and pivots, the embed keeps the URL it was injected
    // with at mount. Reported per request so the two can be compared.
    channel: describeFeedChannel(config.serverUrl),
    // An explicit host-provided list is already sufficient to query. Waiting
    // for the embed's duplicate listDevices call added a full round-trip to
    // every cold Reel/Events paint.
    devicesResolved: config.deviceIds.length > 0 || cameras !== null,
    ...(config.showStationary ? { includeStationary: true } : {}),
    // Hidden provenance rides the READ, so the rows never arrive and the
    // cursor counts what the operator can actually see.
    excludeSources: config.excludeSources,
    ...(config.sinceMs !== undefined ? { sinceMs: config.sinceMs } : {}),
    ...(config.untilMs !== undefined ? { untilMs: config.untilMs } : {}),
  })

  // ── CLIP semantic search (passthrough) ────────────────────────────────────
  // A server query, so it is NOT a filter over the feed: it replaces the rows
  // and can surface tracks the feed never paged to. Empty query ⇒ inert.
  const semanticQuery = config.searchMode === 'semantic' ? config.search.trim() : ''
  const [semantic, setSemantic] = useState<{
    readonly query: string
    readonly rows: readonly EventsTrackRow[]
    readonly loading: boolean
  }>({ query: '', rows: [], loading: false })

  useEffect(() => {
    if (semanticQuery.length === 0 || deviceIds.length === 0) {
      setSemantic({ query: '', rows: [], loading: false })
      return
    }
    let cancelled = false
    setSemantic((prev) => ({ ...prev, query: semanticQuery, loading: true }))
    void client
      .searchObjectEvents(
        semanticSearchRequest(semanticQuery, deviceIds, {
          semanticLimit: config.semanticLimit,
          semanticMinScore: config.semanticMinScore,
          sinceMs: config.sinceMs,
          untilMs: config.untilMs,
        }),
      )
      .then((raw) => {
        if (cancelled) return
        setSemantic({ query: semanticQuery, rows: toSemanticRows(raw, nameById), loading: false })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        eventsLog('searchObjectEvents failed', {
          error: e instanceof Error ? e.message : String(e),
        })
        setSemantic({ query: semanticQuery, rows: [], loading: false })
      })
    return () => {
      cancelled = true
    }
  }, [
    client,
    semanticQuery,
    deviceIds,
    nameById,
    config.semanticLimit,
    config.semanticMinScore,
    config.sinceMs,
    config.untilMs,
  ])

  const semanticActive = semanticQuery.length > 0

  /**
   * Re-apply the CURRENT camera names to already-loaded rows.
   *
   * `toEventsTrackRow` bakes `cameraName` in at fetch time, so a rename that
   * arrives later — a `setConfig({deviceNames})` from the host — would never
   * reach a row that is already on screen. Re-mapping here makes the rename a
   * RENDER-time fact, which is what it is, and it happens before the filters so
   * the free-text haystack searches the name the operator can actually see.
   *
   * Allocates only for rows whose name actually changed.
   */
  const reviewedSet = useMemo(() => new Set(config.reviewedTrackIds), [config.reviewedTrackIds])
  const stampReviewed = (list: readonly EventsTrackRow[]): EventsTrackRow[] => {
    if (reviewedSet.size === 0) return [...list]
    return list.map((row) => (reviewedSet.has(row.trackId) ? { ...row, reviewed: true } : row))
  }
  const namedRows = useMemo(
    () =>
      stampReviewed(applyTrackFlagPatches(applyDeviceNames(feed.rows, nameById), flagPatches)),
    [feed.rows, nameById, reviewedSet, flagPatches],
  )
  const namedSemanticRows = useMemo(
    () =>
      stampReviewed(applyTrackFlagPatches(applyDeviceNames(semantic.rows, nameById), flagPatches)),
    [semantic.rows, nameById, reviewedSet, flagPatches],
  )

  const rows = useMemo(() => {
    // The class filter always applies — it is a display choice, not a query.
    const flagFilters = {
      debug: config.filterDebug,
      train: config.filterTrain,
      favourited: config.filterFavourited,
      reviewedTrackIds: config.reviewedTrackIds,
    }
    const textMatches = filterRows(
      namedRows,
      config.classes,
      config.search,
      classToMacro,
      config.attrs,
      flagFilters,
      config.excludeSources,
    )
    if (semanticActive) {
      // A CLIP query is blind to everything non-visual a track knows (audio
      // labels, zone names, plate text, the camera name), so the SAME query is
      // also run as free text over the loaded feed and the two are unioned.
      // Typing `cry` used to return CLIP noise while 92 tracks carrying the
      // `crying` audio label sat in the feed unmatched.
      //
      // `mergeSearchRows` owns the ORDER, and it is newest first, always —
      // the hub's relevance ranking selects the rows (`minScore` + `limit`)
      // and stops there. A score-ranked list under a control that says
      // "newest", on cards that show a time and no score, is what the operator
      // reported as "the dates are all over the place".
      // The CLIP passthrough is a SECOND server query and `searchObjectEvents`
      // has no source dimension, so this is the only thing standing between a
      // semantic search and every audio marker the page just hid.
      const clip = filterRows(
        namedSemanticRows,
        config.classes,
        '',
        classToMacro,
        config.attrs,
        flagFilters,
        config.excludeSources,
      )
      return mergeSearchRows(clip, textMatches, 'time')
    }
    // The feed arrives in the server's order — newest first — and stays in it.
    return textMatches
  }, [
    semanticActive,
    namedSemanticRows,
    namedRows,
    config.classes,
    config.attrs,
    config.filterDebug,
    config.filterTrain,
    config.filterFavourited,
    config.reviewedTrackIds,
    config.search,
    config.excludeSources,
    classToMacro,
  ])

  const palette = resolvePalette(config.theme, prefersDark)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // The scroller as STATE, not just a ref: the cards' viewport observers are
  // rooted on it, and a ref does not re-render them when it is finally set.
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  /**
   * Do not treat a zero-sized scroller as permission to load every image.
   * OTA-local HTML executes before the native WebView receives its final
   * geometry, so `0×0` is a normal transient mount state. IntersectionObserver
   * will report visible cards once layout settles; environments without the API
   * already fail open inside `useInViewport`.
   */
  const sentinelRef = useRef<HTMLDivElement | null>(null)

  // ── host command surface (native injected JS + web postMessage) ───────────
  const loadMoreRef = useRef(feed.loadMore)
  loadMoreRef.current = feed.loadMore
  const refreshRef = useRef(feed.refresh)
  refreshRef.current = feed.refresh
  const reloadRef = useRef(feed.reload)
  reloadRef.current = feed.reload

  // What the host has been told about the ordered collection. Created once and
  // never replaced, so `runCommand` below stays identity-stable — the injected
  // API and the postMessage listener are registered against it exactly once.
  const [trackListReporter] = useState(() => createTrackListReporter(postToEventsHost))

  const runCommand = useCallback((command: EventsCommand): void => {
    if (command.type === 'setConfig') {
      setConfig((prev) => applyEventsConfigPatch(prev, command.patch))
      return
    }
    if (command.type === 'setWindow') {
      // Sugar over the same two config bounds — one conversion, so the command
      // and `setConfig({sinceMs, untilMs})` cannot disagree.
      setConfig((prev) => applyEventsConfigPatch(prev, windowCommandToPatch(command)))
      return
    }
    if (command.type === 'setTrackFlagPatches') {
      setFlagPatches(command.patches)
      return
    }
    if (command.type === 'setTrackListMode') {
      // Adopting the mode ALWAYS posts a fresh full baseline, so this same
      // command is what a host that detected drift re-sends to recover. Reads
      // the rows through a ref: `runCommand` is built once (the injected API
      // and the postMessage listener both close over it), and re-creating it
      // per feed change would re-register both on every page.
      trackListReporter.setMode(command.mode)
      return
    }
    if (command.type === 'refresh') {
      // Acked when the delta SETTLES (success or not) — a native RefreshControl
      // has nothing else to close its spinner on. The no-op branches (busy,
      // nothing loaded) ack immediately, which reads as an instant refresh
      // rather than a stranded spinner.
      void refreshRef.current().finally(() => postToEventsHost(eventsRefreshedMsg()))
      return
    }
    if (command.type === 'reload') {
      reloadRef.current()
      return
    }
    if (command.type === 'loadMore') {
      loadMoreRef.current()
      return
    }
    if (command.type === 'ping') {
      postToEventsHost(eventsHeartbeatMsg())
      return
    }
    scrollRef.current?.scrollTo({ top: 0, left: 0, behavior: 'smooth' })
  }, [trackListReporter])

  useEffect(() => {
    window.__camstackEvents = {
      setConfig: (patch) => {
        const command = parseEventsCommand({ type: 'setConfig', patch })
        if (command !== null) runCommand(command)
      },
      setWindow: (w) => {
        const command = parseEventsCommand({ type: 'setWindow', ...w })
        if (command !== null) runCommand(command)
      },
      setTrackFlagPatches: (patches) => {
        const command = parseEventsCommand({ type: 'setTrackFlagPatches', patches })
        if (command !== null) runCommand(command)
      },
      setTrackListMode: (mode) => {
        const command = parseEventsCommand({ type: 'setTrackListMode', mode })
        if (command !== null) runCommand(command)
      },
      refresh: () => runCommand({ type: 'refresh' }),
      reload: () => runCommand({ type: 'reload' }),
      loadMore: () => runCommand({ type: 'loadMore' }),
      scrollToTop: () => runCommand({ type: 'scrollToTop' }),
      ping: () => runCommand({ type: 'ping' }),
    }
    return onHostCommand((raw) => {
      const command = parseEventsCommand(raw)
      if (command !== null) runCommand(command)
    })
  }, [runCommand])

  // ── host reporting ────────────────────────────────────────────────────────
  useEffect(() => {
    postToEventsHost(eventsReadyMsg(config.view))
    // Once per mount — the view is reported again by the state message below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // In semantic mode the counts describe CLIP hits, and `hasMore` is false —
    // a search result set is complete, not a page. Reporting the feed's counts
    // there would tell the host the wrong thing about what is on screen.
    postToEventsHost(
      semanticActive
        ? countChangedMsg(semantic.rows.length, rows.length, false, 'semantic')
        : countChangedMsg(feed.rows.length, rows.length, feed.hasMore, 'feed'),
    )
  }, [feed.rows.length, rows.length, feed.hasMore, semanticActive, semantic.rows.length])

  // The shown rows IN DISPLAY ORDER — the collection a host detail view
  // navigates with prev/next. The reporter decides how much of it goes out:
  // nothing while the id sequence is unchanged, a `trackListDelta` when the
  // host asked to accumulate and the change is provable, a full list
  // otherwise. See `events-track-list.ts`.
  //
  // Keyed on `rows`, which is memoised on the filter/sort inputs — a scroll
  // frame re-renders this component (the viewport is state) but does not
  // change `rows`, so nothing here runs per frame. This used to build a
  // ~1 MB `join('|')` of every id to answer the same question.
  useEffect(() => {
    trackListReporter.report(rows)
  }, [trackListReporter, rows])

  useEffect(() => {
    if (feed.error !== null && !semanticActive) {
      postToEventsHost(eventsStateMsg('error', feed.error))
      return
    }
    if (semanticActive ? semantic.loading : feed.loading) {
      postToEventsHost(eventsStateMsg('loading'))
      return
    }
    postToEventsHost(eventsStateMsg(rows.length === 0 ? 'empty' : 'ready'))
  }, [feed.loading, feed.error, rows.length, semanticActive, semantic.loading])

  // ── environment ───────────────────────────────────────────────────────────
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const listener = (e: MediaQueryListEvent): void => setPrefersDark(e.matches)
    mq.addEventListener('change', listener)
    return () => mq.removeEventListener('change', listener)
  }, [])

  // The page's own surface: `index.css` hard-codes a black body for the video
  // modes, which would frame a light events embed in black.
  useEffect(() => {
    document.documentElement.style.colorScheme = palette.colorScheme
    document.body.style.background = palette.background
  }, [palette])

  // The tail spinner's rotation. A <style> element rather than a Tailwind
  // class: this page styles inline throughout (so no utility it emits can be
  // dropped by a content scan that never sees this file), and a keyframe has
  // nowhere else to live.
  useEffect(() => {
    const id = 'camstack-events-keyframes'
    if (document.getElementById(id) !== null) return
    const style = document.createElement('style')
    style.id = id
    style.textContent = '@keyframes camstack-spin{to{transform:rotate(360deg)}}'
    document.head.appendChild(style)
  }, [])

  // Clock for the time labels. One tick a minute — the labels are minute-grained.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // ── infinite scroll ───────────────────────────────────────────────────────
  /**
   * The scroller's own extent, in the direction it scrolls. The prefetch margin
   * is derived from it (`sentinelMarginPx`), and `rootMargin` is fixed at
   * construction — so this is what rebuilds the observer when the frame is
   * resized (rotation, a split-view host, a window drag).
   *
   * `ResizeObserver` is optional on purpose: it is absent in jsdom and in old
   * WebViews, and its absence must degrade to "measured once at mount", never
   * to a crash on a surface whose only job is to draw a list.
   */
  const [layoutExtent, setLayoutExtent] = useState(0)
  useEffect(() => {
    const root = scrollEl
    if (root === null) return
    const measure = (): void => {
      const extent = config.view === 'reel' ? root.clientWidth : root.clientHeight
      setLayoutExtent((prev) => (prev === extent ? prev : extent))
    }
    measure()
    if (typeof ResizeObserver !== 'function') return
    const ro = new ResizeObserver(measure)
    ro.observe(root)
    return () => ro.disconnect()
  }, [scrollEl, config.view])

  /**
   * Has the FEED landed anything — not "did anything survive the filters".
   *
   * This used to read the filtered `rows`, and that is how a client-side
   * filter could starve the pager that would have found its own matches. Every
   * filter on this page runs over the rows already fetched (classes,
   * attributes, text, flags), so a narrow one legitimately keeps NONE of an
   * early page: measured on the live hub (101/104/102, one day, newest-first)
   * the first row carrying a plate is at index 205, four pages in. Ticking
   * Plates alone emptied `rows`, which switched off the observer below AND the
   * auto-fill effect — so nothing ever asked for page two, the surface said
   * "no events" while holding a live `nextCursor`, and there was no tail to
   * press either. Faces looked fine only because its first match happens to be
   * at index 4.
   *
   * The anti-double-fetch reason the gate exists is unaffected: at mount, with
   * page one in flight, the FEED is empty too.
   */
  const loadedRows = feed.rows.length
  const hasRows = loadedRows > 0
  // IntersectionObserver against the SCROLL container (not the viewport): both
  // layouts scroll inside their own element, and a viewport-rooted observer
  // would fire once and never again.
  useEffect(() => {
    const root = scrollRef.current
    const sentinel = sentinelRef.current
    if (!root || !sentinel) return
    // Semantic results are a complete set, not a page — scrolling to the end
    // of them must not start paging the time feed in behind them.
    if (semanticActive) return
    // NOT while the feed is still empty. The sentinel lives inside the grid,
    // which renders unconditionally — so on an empty feed it sits at the TOP
    // of an empty scroller, and `IntersectionObserver` reports its current
    // state once at `observe()`. That report is `isIntersecting: true` about
    // 3 ms into the mount, while page one is still in flight: `loadMore` finds
    // `busyRef` set, PARKS the ask, and `.finally` replays it. Every open
    // fetched two pages — 120 rows where ~12 are visible — and nobody scrolled.
    // Measured over 7 opens (2026-08-25 hub logs): 7/7 showed `feed-2` with
    // `waitMs ≈ feed-1.ms`, median 606 ms of extra hub work per open, and —
    // the part that actually hurts — double the cards feeding the 6-wide
    // thumbnail gate, whose queue is the bucket that dominates the page.
    //
    // Nothing depended on this: the auto-fill effect below is what covers a
    // page too short to fill the scroller, and it already refuses to run on
    // `rows.length === 0`. `hasRows` (not `rows.length`) is the dependency on
    // purpose — it flips false→true exactly once, so the observer is built
    // when page one lands and NOT rebuilt per page. Rebuilding per page would
    // re-report the current state each time and reintroduce the same spurious
    // ask from the other end.
    if (!hasRows) return
    // Measured at the moment the observer is built — one scroller ahead in the
    // direction this view actually scrolls. `rootMargin` cannot be changed on
    // a live observer, so a resize rebuilds it via `layoutExtent`.
    const margin = sentinelMarginPx(config.view === 'reel' ? root.clientWidth : root.clientHeight)
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMoreRef.current()
      },
      { root, rootMargin: `${margin}px` },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [config.view, feed.hasMore, semanticActive, hasRows, layoutExtent])

  /**
   * Keep loading until the content actually FILLS the scroller.
   *
   * An `IntersectionObserver` reports the current state once at `observe()` and
   * then only on TRANSITIONS. When the first page is too short to fill the
   * viewport the sentinel is visible from the start and never transitions
   * again — so the feed stops at page one and the screen has empty space under
   * it, with more rows available and nothing asking for them. It is the same
   * fire-on-transition trap as the dropped `loadMore`, in a different disguise.
   *
   * Measured, and this is why it surfaced now: on this deployment a page is six
   * rows (the fan-out budget over every device), which fills nothing. The
   * device-vs-camera fix makes pages large again, but a short page is still
   * reachable — a narrow window, a quiet day, a tall screen — so the surface
   * must not depend on a page happening to be big enough.
   *
   * Bounded: at most `MAX_AUTO_FILL_PAGES` per settle, so a feed that can never
   * fill (a handful of rows in total) stops asking instead of looping.
   */
  const autoFillRef = useRef(0)
  const autoFillSeenRef = useRef(0)
  useEffect(() => {
    if (semanticActive || feed.loading || feed.loadingMore || !feed.hasMore) return
    const root = scrollRef.current
    if (!root) return
    // The FEED, not the filtered rows — see `loadedRows`. A page the client
    // filter kept nothing from is still a page: the scroller is empty, more
    // exist, and this is the only thing that will ask for them.
    if (loadedRows === 0) return
    const reel = config.view === 'reel'
    // An UNMEASURED scroller (zero extent) cannot answer "is it full" — a
    // hidden WebView, a container the host has not sized yet, or a test
    // environment with no layout. Asking for pages against a box of unknown
    // size is how an off-screen surface quietly pages the whole history.
    const extent = reel ? root.clientWidth : root.clientHeight
    if (extent === 0) return
    const filled = reel
      ? root.scrollWidth > root.clientWidth + 1
      : root.scrollHeight > root.clientHeight + 1
    if (filled) {
      autoFillRef.current = 0
      autoFillSeenRef.current = loadedRows
      return
    }
    /**
     * The budget counts UNPRODUCTIVE asks, not asks.
     *
     * It was "asks per settle, reset when the scroller fills", which is the
     * right shape while every fetched row is drawn — but a hard client filter
     * draws none of them, so the scroller never fills and the walk stopped
     * after `MAX_AUTO_FILL_PAGES` however much history was left. A page that
     * ADDED rows is progress whether or not the filter kept any, so it resets
     * the budget; the bound then still catches the thing it was written for —
     * a feed that answers without growing (an all-duplicate page) — instead of
     * catching a legitimate walk.
     */
    if (loadedRows > autoFillSeenRef.current) {
      autoFillRef.current = 0
      autoFillSeenRef.current = loadedRows
    }
    if (autoFillRef.current >= MAX_AUTO_FILL_PAGES) return
    autoFillRef.current += 1
    loadMoreRef.current()
  }, [
    rows.length,
    loadedRows,
    feed.loading,
    feed.loadingMore,
    feed.hasMore,
    semanticActive,
    config.view,
  ])

  /**
   * Pull-to-refresh. Gallery only: the reel scrolls horizontally, and a
   * vertical drag there is not a gesture the user is making on purpose.
   *
   * Wired to the INCREMENTAL refresh, not a reload — the whole point of the
   * feed is that it never rebuilds scrollback, and a pull is a request for
   * what is new, not for a different feed.
   */
  const pull = usePullToRefresh({
    root: scrollEl,
    enabled: internalPullGestureEnabled(config.view, semanticActive, config.nativePullToRefresh),
    onRefresh: () => void refreshRef.current(),
  })

  /**
   * Native-refresh arming reports. Only when the HOST took the pull gesture
   * (`nativePullToRefresh`): tell it, on TRANSITIONS, whether its
   * RefreshControl may arm — scroller at the top of a gallery feed, and not
   * over semantic results. Without this the host can only choose between a
   * control that steals mid-list scrolls and one that never fires; this report
   * is what retired that dilemma (see use-pull-to-refresh's module note).
   */
  const atTopSentRef = useRef<boolean | null>(null)
  useEffect(() => {
    const root = scrollEl
    if (!config.nativePullToRefresh || root === null) {
      atTopSentRef.current = null
      return
    }
    const report = (): void => {
      const atTop = config.view === 'gallery' && !semanticActive && root.scrollTop <= 0
      if (atTopSentRef.current === atTop) return
      atTopSentRef.current = atTop
      postToEventsHost(eventsScrollMsg(atTop))
    }
    report()
    root.addEventListener('scroll', report, { passive: true })
    return () => root.removeEventListener('scroll', report)
  }, [scrollEl, config.nativePullToRefresh, config.view, semanticActive])

  const isReel = config.view === 'reel'

  /**
   * Background preload, downward, bounded — the other half of the viewport
   * policy. The eager observer covers the screen plus one; this warms the rest
   * in render order so a fast scroll lands on cached bytes instead of a fresh
   * request, without ever recreating the 60-concurrent stampede.
   *
   * It yields while the user scrolls: a visible tile's fetch is a request, a
   * preload is a guess, and the request wins.
   */
  const [scrolling, setScrolling] = useState(false)
  const [viewport, setViewport] = useState({
    scrollLeft: 0,
    scrollTop: 0,
    viewportWidth: 0,
    viewportHeight: 0,
  })
  useEffect(() => {
    const root = scrollEl
    if (root === null) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const updateViewport = (): void => {
      setViewport({
        scrollLeft: root.scrollLeft,
        scrollTop: root.scrollTop,
        viewportWidth: root.clientWidth,
        viewportHeight: root.clientHeight,
      })
    }
    const onScroll = (): void => {
      updateViewport()
      setScrolling(true)
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => setScrolling(false), SCROLL_IDLE_MS)
    }
    updateViewport()
    root.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', updateViewport)
    return () => {
      root.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', updateViewport)
      if (timer !== null) clearTimeout(timer)
    }
  }, [scrollEl])

  /**
   * The card edge. The gallery's is the preset (its columns stretch the cards).
   * The reel's is computed from the measured box on a desktop-wide frame, so
   * the preview covers the whole width instead of stopping wherever fixed
   * tiles land; below `REEL_FIT_MIN_WIDTH_PX` it is the preset, unchanged —
   * the host reserved its band from that number. See `events-reel-geometry.ts`.
   */
  const reelGeometry = useMemo(
    () =>
      reelCardGeometry({
        viewportWidth: viewport.viewportWidth,
        viewportHeight: viewport.viewportHeight,
        rows: config.rows,
        presetEdge: cardEdgePx(config.thumbSize),
        gap: GAP_PX,
        padX: PAD_PX,
      }),
    [viewport.viewportWidth, viewport.viewportHeight, config.rows, config.thumbSize],
  )
  const cardWidth = isReel ? reelGeometry.edge : cardEdgePx(config.thumbSize)
  const reelCardHeight = isReel ? reelGeometry.cardHeight : reelCardHeightPx(config.thumbSize)
  // Physical pixels, not CSS: a 2x WebView showing an 80 px tile wants 160 px
  // of image. Measured from the running view, never assumed.
  const thumbPx = thumbEdgeForCardPx(cardWidth, window.devicePixelRatio || 1)

  /**
   * The gallery's column geometry — ONE authority.
   *
   * The grid used to be `repeat(auto-fill, minmax(cardWidth, 1fr))` and CSS
   * alone decided how many columns there were. Virtualization has to chunk the
   * flat row list into GRID ROWS, and a column count JS merely guessed at would
   * put the spacers at the wrong offsets. So the same arithmetic `auto-fill`
   * runs is done here and the tracks are rendered explicitly from it.
   */
  const geometry = useMemo(
    () =>
      galleryGeometry({
        viewportWidth: viewport.viewportWidth - 2 * GALLERY_PAD_PX,
        cardWidth,
        gap: GALLERY_GAP_PX,
        columns: config.columns,
      }),
    [viewport.viewportWidth, cardWidth, config.columns],
  )
  // The viewer's tile settings, resolved once (explicit setting, else the
  // legacy `fields` flag) — the cards and the row-height key read this.
  const tileDisplay = useMemo(
    () =>
      resolveTileDisplay(config.fields, {
        tileLabelMode: config.tileLabelMode,
        tileDetailCamera: config.tileDetailCamera,
        tileDetailZone: config.tileDetailZone,
      }),
    [config.fields, config.tileLabelMode, config.tileDetailCamera, config.tileDetailZone],
  )
  const galleryRowCount = isReel ? 0 : Math.ceil(rows.length / geometry.columns)
  /**
   * Gallery virtualization: only the rows near the viewport are mounted, and
   * two spacers stand in for the rest so the scrollbar still describes the
   * WHOLE list. This is what removed the 600-row ceiling — the cost of a long
   * feed is now the retained rows, not the DOM.
   *
   * The reel is deliberately NOT windowed: it renders every card it holds, and
   * it is bounded for exactly that reason (`REEL_EVENTS_MAX_ROWS`).
   */
  const gallery = useGalleryRows({
    rowCount: galleryRowCount,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.viewportHeight,
    fallbackRowPx: geometry.rowStridePx,
    geometryKey: `${geometry.columns}|${cardWidth}|${config.fields.sublabel ? 's' : ''}${tileDisplay.tileDetailCamera ? 'c' : ''}${tileDisplay.tileDetailZone ? 'z' : ''}`,
  })

  const preloadRows = useMemo(
    () =>
      isReel
        ? reelPreloadWindow(rows, {
            scrollLeft: viewport.scrollLeft,
            viewportWidth: viewport.viewportWidth,
            cardWidth,
            gap: GAP_PX,
            rowsPerColumn: config.rows,
          })
        : // Derived from the RENDER window — see `galleryPreloadWindow`. The
          // background half and the visible half now agree on where the
          // operator is, because they read one window.
          galleryPreloadWindow(rows, gallery.window, geometry.columns),
    [isReel, rows, viewport.scrollLeft, viewport.viewportWidth, cardWidth, config.rows, gallery.window, geometry.columns],
  )
  /**
   * The preload warms the SAME url the card will ask for, which means the same
   * OWNER: `row.trackId`.
   *
   * It used to pass `row.bestEventId`, and that is an object-event id — an
   * opaque pointer, never an address (D482, and `events-semantic.ts` says so
   * in as many words). `buildTrackThumbUrl` mints `/o/track/<id>`, so an event
   * id arrived at the track table and the plane answered 404. Measured on the
   * live hub 2026-09-13: `/o/track/107461` → 404, `/o/object/107461` → 200,
   * `/o/track/<trackId>` → 200 — and on device 101 every row's `bestEventId`
   * differs from its `trackId`, so EVERY preload 404'd.
   *
   * That cost twice. The blob cache is keyed by url, so a preload that never
   * matched the card's url warmed nothing and every tile paid a full fetch on
   * scroll-in; and each miss emitted an `events:media thumbnail missing` line,
   * which is the 404 noise the operator reported.
   */
  const preloadUrls = useMemo(
    () => preloadRows.map((r) => buildTrackThumbUrl(config.serverUrl, r.trackId, thumbPx)),
    [preloadRows, config.serverUrl, thumbPx],
  )
  useImagePreloader({
    urls: preloadUrls,
    token: config.token,
    paused: scrolling,
    enabled: !feed.loading && rows.length > 0,
  })

  const postTrackClick = useCallback(
    (row: EventsTrackRow, intent?: 'assign-face'): void => {
      postToEventsHost(
        trackClickMsg({
          trackId: row.trackId,
          deviceId: row.deviceId,
          bestEventId: row.bestEventId,
          className: row.className,
          firstSeen: row.firstSeen,
          lastSeen: row.lastSeen,
          ...(intent === undefined ? {} : { intent }),
        }),
      )
    },
    [],
  )
  const onCardClick = useCallback(
    (row: EventsTrackRow): void => postTrackClick(row),
    [postTrackClick],
  )
  /** The "?" chip: the same open, carrying WHY. */
  const onAssignFace = useCallback(
    (row: EventsTrackRow): void => postTrackClick(row, 'assign-face'),
    [postTrackClick],
  )

  // Reel: a fixed-row grid flowing into columns → horizontal scroll.
  // Gallery: ONE grid per virtualized row, at the resolved column count. The
  // trailing gap lives inside the row (`paddingBottom`) rather than between
  // rows, so a measured row height already includes the space below it and the
  // spacers do not have to account for gaps separately.
  const gridStyle: React.CSSProperties = isReel
    ? {
        display: 'grid',
        gridTemplateRows: `repeat(${config.rows}, ${reelCardHeight}px)`,
        gridAutoFlow: 'column',
        gridAutoColumns: `${cardWidth}px`,
        gap: GAP_PX,
        alignContent: 'start',
      }
    : {
        display: 'grid',
        gridTemplateColumns: `repeat(${geometry.columns}, minmax(0, 1fr))`,
        columnGap: GALLERY_GAP_PX,
        // Inert for a virtualized row (it holds exactly `columns` cards and
        // never wraps); it is what spaces the multi-row loading skeleton, which
        // shares this style.
        rowGap: GALLERY_GAP_PX,
        paddingBottom: GALLERY_GAP_PX,
        alignContent: 'start',
      }

  /**
   * The three states, kept genuinely distinct.
   *
   * `loading` is "no fetch has settled yet" — NOT "no rows yet". The old
   * condition (`!loading && rows.length === 0`) went true for a beat on every
   * boot, because `deviceIds` is empty while the camera list is still in
   * flight and the feed reported itself not-loading with nothing to fetch. So
   * every embed flashed "No events" before its first page landed.
   *
   * Error wins over empty: "the node did not answer" and "this camera was
   * quiet" are different sentences and only one of them is worth acting on.
   */
  const busy = semanticActive ? semantic.loading : feed.loading
  /**
   * The TAIL affordances. Both are about the next block, so both are false in
   * semantic mode (a CLIP result set is complete, not paged) and while the
   * FIRST page is still loading (the full-surface skeleton owns that moment).
   */
  // `loadedRows`, not `rows`: with a filter that keeps nothing there are no
  // cards, and the operator still has to be able to see that a page is on its
  // way rather than an empty screen that has given up.
  const showTailLoader = !semanticActive && feed.loadingMore && loadedRows > 0
  const failed = !semanticActive && feed.error !== null
  /**
   * The tail is a SENTENCE about why the list stops, and the three reasons are
   * not interchangeable:
   *
   * | tail        | reason                          | sentence                |
   * | ---         | ---                             | ---                     |
   * | `tail-end`  | the server said `nextCursor: null` | "that was everything" |
   * | `tail-more` | this client hit its row ceiling | "there is more — continue" |
   * | `tail-error`| the page request failed         | "it broke — retry"      |
   *
   * A failure outranks both: a feed that could not fetch knows NOTHING about
   * whether more exist, and drawing "you have reached the beginning" over a
   * dead request is the one thing this tail must never do.
   */
  /**
   * …and the same for the tail SENTENCE. Gated on the filtered rows, an empty
   * filtered view had no tail at all: no "that was everything", and — worse —
   * no "load older" button. The one surface that most needs a way forward was
   * the one surface with none.
   */
  const tailIdle = !semanticActive && !feed.loadingMore && loadedRows > 0
  const showTailError = tailIdle && failed
  const showEndOfList = tailIdle && !failed && feed.tail === 'exhausted'
  const showLoadOlder = tailIdle && !failed && feed.tail === 'ceiling'
  // The full-surface error belongs to an EMPTY surface. With rows on screen it
  // would cover a list the operator is still reading, to say something the
  // tail says in place.
  const showFatalError = failed && rows.length === 0
  // Not while a page is on its way: during the drain the surface is loading,
  // not answered, and "no events" over an in-flight request is the same lie in
  // miniature.
  const empty = !busy && !failed && !feed.loadingMore && rows.length === 0
  /**
   * "Nothing matches this filter" and "this camera was quiet" are different
   * sentences, and only one of them is about something the operator can undo.
   * Distinguished by whether the FEED holds rows the filters removed.
   */
  const emptyBecauseFiltered = empty && loadedRows > 0

  /**
   * One card. Extracted because the two layouts no longer share a container:
   * the reel flows its cards through one grid, the gallery mounts them a
   * virtualized row at a time. `index` stays the index in the WHOLE list — it
   * is what decides which tiles load eagerly, and a per-row index would make
   * the first card of every row eager forever.
   */
  const renderCard = (row: EventsTrackRow, index: number): React.ReactElement => (
    <EventsCard
      key={row.trackId}
      row={row}
      eagerImages={!isReel && index < 8}
      serverUrl={config.serverUrl}
      token={config.token}
      thumbPx={thumbPx}
      // Reel columns are fixed-width; gallery cards fill their grid column
      // (an explicit `minmax(0, 1fr)` track — see `galleryGeometry`).
      width={isReel ? `${cardWidth}px` : '100%'}
      heroPx={isReel ? cardWidth : geometry.columnWidth}
      variant={isReel ? 'reel' : 'gallery'}
      iconId={iconIdForClass(row.className, kindIconIds, isAudioSourceRow(row))}
      kindLabels={kindLabels}
      labels={labels}
      scrollRoot={scrollEl}
      fields={config.fields}
      display={tileDisplay}
      showAdminFlags={config.showAdminFlags === true}
      palette={palette}
      nowMs={now}
      onClick={onCardClick}
      onAssignFace={onAssignFace}
    />
  )

  /**
   * The three tails plus the paging sentinel — ONE definition for both layouts,
   * so virtualizing the gallery could not quietly change what the end of the
   * list says. Which of them renders is decided above; this is only where.
   */
  const tails = (
    <>
      {showTailLoader && (
        <div
          data-testid="tail-loading"
          aria-label={labels.loadingMore}
          style={{
            width: isReel ? cardWidth : '100%',
            height: isReel ? reelCardHeight : undefined,
            aspectRatio: isReel ? undefined : '1 / 1',
            borderRadius: 10,
            background: palette.skeleton,
            border: `1px solid ${palette.border}`,
            boxSizing: 'border-box',
            opacity: 0.6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              border: `2px solid ${palette.chip}`,
              borderTopColor: palette.textMuted,
              animation: 'camstack-spin 700ms linear infinite',
            }}
          />
        </div>
      )}
      {showEndOfList && (
        <div
          data-testid="tail-end"
          style={{
            ...tailBlockStyle(isReel, cardWidth),
            color: palette.textMuted,
            fontSize: 11,
            opacity: 0.75,
          }}
        >
          {eventsString(config, 'end')}
        </div>
      )}
      {/* The ceiling — NOT the end. The server still has rows; this client
          stopped holding them. One press buys one more block. */}
      {showLoadOlder && (
        <button
          type="button"
          data-testid="tail-more"
          onClick={() => feed.loadOlder()}
          style={tailActionStyle(isReel, cardWidth, palette)}
        >
          {eventsString(config, 'loadOlder')}
        </button>
      )}
      {/* The page request failed. Distinct from both of the above, and it
          says so — an operator must be able to tell "it broke" from "that
          was everything" without reloading to find out. */}
      {showTailError && (
        <button
          type="button"
          data-testid="tail-error"
          onClick={() => feed.retry()}
          style={{ ...tailActionStyle(isReel, cardWidth, palette), color: 'var(--color-danger)' }}
        >
          {eventsString(config, 'retry')}
        </button>
      )}
      {/* Scroll sentinel — at the true end of the list in both flow
          directions: inside the reel's grid, and BELOW the gallery's bottom
          spacer (so a windowed list does not put it a screen from the top and
          page the whole feed in). Zero-area elements are never reported as
          intersecting, hence the 1px. */}
      <div
        ref={sentinelRef}
        style={{ width: 1, height: 1, gridRow: isReel ? 1 : 'auto' }}
        aria-hidden
      />
    </>
  )

  return (
    <div
      ref={(el) => {
        scrollRef.current = el
        setScrollEl((prev) => (prev === el ? prev : el))
      }}
      data-testid="events-scroller"
      // The reel row is a zero-slack slot: a classic horizontal scrollbar takes
      // its ~15 px out of the CONTENT box and cuts the footer's time line in
      // half. See `.events-reel-scroller` in `index.css` for the whole account.
      className={isReel ? 'events-reel-scroller' : undefined}
      style={{
        position: 'fixed',
        inset: 0,
        background: palette.background,
        color: palette.text,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflowX: isReel ? 'auto' : 'hidden',
        overflowY: isReel ? 'hidden' : 'auto',
        // The reel's padding is the native list's (SPACING.sm), because the
        // host reserves `cardWidth + 6 + 14 + 8` and nothing more. The gallery
        // scrolls freely and can afford the roomier inset.
        padding: isReel ? `${REEL_LIST_PADDING_V}px ${PAD_PX}px` : GALLERY_PAD_PX,
        boxSizing: 'border-box',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {/* Pull indicator — follows the finger, and completes (full opacity, no
          longer growing) exactly at the threshold, so "release now" is visible
          rather than guessed. It sits ABOVE the content and does not displace
          it: translating the grid would fight the browser's own rubber-band. */}
      {pull.distance > 0 && (
        <div
          data-testid="pull-indicator"
          data-armed={pull.armed ? 'true' : 'false'}
          aria-hidden
          style={{
            position: 'absolute',
            top: Math.max(0, pull.distance - 28),
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            pointerEvents: 'none',
            zIndex: 2,
            opacity: Math.min(1, pull.distance / PULL_THRESHOLD_PX),
          }}
        >
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 999,
              border: `2px solid ${palette.chip}`,
              borderTopColor: palette.textMuted,
              background: palette.card,
              // ui-check-ok: neutral drop shadow of the pull disc; the theme has no shadow token
              boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
              // Rotates with the pull, then spins once the refresh is running.
              transform: `rotate(${pull.distance * 4}deg)`,
              animation: feed.loadingMore ? 'camstack-spin 700ms linear infinite' : undefined,
            }}
          />
        </div>
      )}
      {showFatalError && (
        <div
          data-testid="state-error"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            color: 'var(--color-danger)',
            fontSize: 13,
            padding: 16,
            textAlign: 'center',
          }}
        >
          <span>{eventsString(config, 'error')}</span>
          <button
            type="button"
            data-testid="state-retry"
            onClick={() => feed.retry()}
            style={{
              marginTop: 10,
              font: 'inherit',
              fontSize: 12,
              color: palette.text,
              background: palette.card,
              border: `1px solid ${palette.border}`,
              borderRadius: 8,
              padding: '5px 14px',
              cursor: 'pointer',
            }}
          >
            {eventsString(config, 'retry')}
          </button>
        </div>
      )}
      {empty && (
        <div
          data-testid={emptyBecauseFiltered ? 'state-empty-filtered' : 'state-empty'}
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: palette.textMuted,
            fontSize: 13,
            padding: '0 24px',
            textAlign: 'center',
          }}
        >
          {eventsString(config, emptyBecauseFiltered ? 'emptyFiltered' : 'empty')}
        </div>
      )}
      {/* Skeleton tiles while the first fetch is in flight — the same shape the
          real cards will take, so the surface does not jump when they land.
          Deliberately NOT a spinner: the grid/player embeds show the shape of
          what is coming (a poster, a tile) rather than an abstract wait. */}
      {busy && rows.length === 0 && (
        <div data-testid="state-loading" style={gridStyle}>
          {Array.from({ length: isReel ? 8 : 12 }, (_, i) => (
            <div
              key={`skeleton-${i}`}
              style={{
                width: isReel ? cardWidth : '100%',
                height: isReel ? reelCardHeight : undefined,
                aspectRatio: isReel ? undefined : '1 / 1',
                borderRadius: 10,
                background: palette.skeleton,
                border: `1px solid ${palette.border}`,
                boxSizing: 'border-box',
                opacity: 0.6,
              }}
            />
          ))}
        </div>
      )}
      {/* Tail affordance — the user must be able to tell "more is coming"
          from "that was everything". Reel: it sits at the right-hand end of
          the strip, inside the grid the cards flow in. Gallery: below the
          virtualized rows and the bottom spacer, which is the true end of the
          list.

          Never in semantic mode: a CLIP result set is complete, and a
          "loading more" there would promise a page that will never come. */}
      {isReel ? (
        <div style={gridStyle}>
          {rows.map(renderCard)}
          {tails}
        </div>
      ) : (
        /* The virtualized gallery. Only the rows near the viewport are in the
           DOM; the two spacers carry the height of everything else, so
           `scrollHeight` — and therefore the scrollbar — still describes the
           whole list. This is what let the 600-row ceiling go. */
        <div data-testid="events-gallery">
          <div data-testid="gallery-pad-top" style={{ height: gallery.window.padTopPx }} aria-hidden />
          {Array.from({ length: gallery.window.endRow - gallery.window.startRow }, (_, offset) => {
            const rowIndex = gallery.window.startRow + offset
            const from = rowIndex * geometry.columns
            return (
              <div
                key={rowIndex}
                data-row-index={rowIndex}
                ref={gallery.measureRow(rowIndex)}
                style={gridStyle}
              >
                {rows
                  .slice(from, from + geometry.columns)
                  .map((row, column) => renderCard(row, from + column))}
              </div>
            )
          })}
          <div
            data-testid="gallery-pad-bottom"
            style={{ height: gallery.window.padBottomPx }}
            aria-hidden
          />
          {tails}
        </div>
      )}
    </div>
  )
}

export function EmbedEventsPage() {
  // Config sources, in precedence order:
  //   1. native host global (`window.__CAMSTACK_EVENTS__`)
  //   2. a URL that carries BOTH v1 params and a `#t=` token — works standalone
  //      AND inside an iframe (`urlFirst`), because `<iframe src=…#t=…>` is the
  //      entire integration for a host with a token and no message plumbing
  //   3. the iframe handshake, with the URL's layout params applied on top
  const configResult = useEmbedConfig(
    'events',
    () => (window as unknown as { __CAMSTACK_EVENTS__?: unknown }).__CAMSTACK_EVENTS__,
    parseEventsConfig,
    readEventsUrlConfig,
    { urlFirst: true },
  )
  const urlPatch = useMemo(() => readEventsUrlPatch(), [])
  const merged = useMemo(
    () => (configResult === null ? null : mergeUrlPatch(configResult, urlPatch)),
    [configResult, urlPatch],
  )

  // System AND the narrow client are built together and memoised together: the
  // client's identity is a dependency of the feed's effects, so minting a fresh
  // one per render would re-subscribe (and re-request) on every render.
  const built = useMemo(() => {
    if (merged === null || !merged.ok) return null
    const system = createSystem({
      serverUrl: merged.config.serverUrl,
      token: merged.config.token,
    })
    return { system, client: createEventsDataClient(system) }
  }, [merged])

  useEffect(() => {
    if (!built) return
    return () => built.system.close()
  }, [built])

  const palette = resolvePalette(
    merged !== null && merged.ok ? merged.config.theme : 'auto',
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true,
  )

  if (merged === null) return null
  if (!merged.ok) return <FatalError message={merged.error} palette={palette} />
  if (!built)
    return <FatalError message="Failed to initialise the events embed" palette={palette} />

  return (
    <>
      <PaletteBridge system={built.system} />
      <Events client={built.client} initialConfig={merged.config} />
    </>
  )
}
