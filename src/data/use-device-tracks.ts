/**
 * useDeviceTracks — TRACK feed for one device's theater timeline, shaped as the
 * timeline's `ObjectEvent` items.
 *
 * WHY tracks, not raw events: after the server's track-centric rework, stored
 * media follows the TRACK (`bestEventId ?? trackId` on the event-media
 * data-plane); most raw `getObjectEvents` row ids no longer resolve any media
 * (probed live: 5/6 raw ids → HTTP 404 + empty `getEventMedia`, every track id
 * → 200 incl. `?kind=crop`). The timeline therefore lists ONE item per track,
 * with `id = bestEventId` so its crop thumbnail always resolves — mirroring the
 * reel / events page.
 *
 * Replaces the retired `useObjectEvents` (raw-event feed). Live tail
 * invalidates off `pipeline-analytics.track-lifecycle` (start/end);
 * `RECONCILE_MS` is the D8 backstop, not the mechanism.
 *
 * Empty and UNREADABLE are not the same answer. `[]` here means the hub has no
 * tracks (or no such cap); a call that failed or never answered REJECTS, so
 * React Query records an error and the previous rows stay on screen. It used to
 * return `[]` for all of it, which is how a camera with 380 tracks was painted
 * as a quiet one — see {@link buildDeviceTracksRequest} for the payload that
 * caused it.
 */
import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { log } from '../lib/logger.js'
import { BULK_QUERY_DEADLINE_MS, capQuery, isRecord } from './cap-query.js'
import {
  idsFromScopeKey,
  planScopeAsk,
  scopeIdsKey,
  scopeToIds,
  type TimelineScope,
} from '../components/camera/theater/timeline-scope-read.js'
import { RECONCILE_MS } from './reconcile.js'
import { toTrackSummary, type TrackSummary } from './track-events.js'
import type { ObjectEvent } from '../components/camera/theater/event-cluster.js'
import {
  parseNormalizedEnvelope,
  parsePositionBoxes,
  type PixelRect,
  type ZoneRect,
  type ZoneShape,
} from '../components/camera/theater/zone-filter.js'
import type { ZonePoint } from '../components/camera/theater/zone-polygon.js'

/** Per-window track cap (tracks are far sparser than raw events).
 *  One page of 500 newest-first used to DROP the morning of a busy day
 *  (hall 21 ago 2026: 102 tracks, 8:00 vanished). Pages walk older. */
export const TRACKS_PAGE_SIZE = 500
/** Backward-compatible name — the per-request page, not the day's cap. */
export const TRACKS_LIMIT = TRACKS_PAGE_SIZE
/**
 * The bound on ONE `collectTrackPages` walk (~10 `listTracks` pages) — no
 * longer a hard stop on the operator's history. It used to be: a busy camera
 * over 5 000 tracks lost everything older with nothing on screen to say so,
 * "no more footage" and "more footage, not fetched" reading as the identical
 * timeline. `useDeviceTracks`'s history query is now an `useInfiniteQuery`
 * whose page size is exactly this bound: hitting it sets `hasMoreHistory`
 * true and logs (`log.warn`, see `fetchHalf`) instead of silently truncating,
 * and `loadMoreHistory` walks the NEXT chunk from exactly where this one
 * stopped. Kept at a size that still covers a typical busy day in one chunk —
 * raising it would only move the ceiling, not remove it.
 */
export const TRACKS_MAX_ROWS = 5_000

/**
 * The `zone` argument `listTracks` accepts — the server's MaskShape vocabulary,
 * normalised 0..1 of the camera frame.
 *
 * Restated here rather than imported from the SDK because the spelling is the
 * whole point: the server says `width`/`height`, the viewer's `ZoneRect` says
 * `w`/`h`, and Zod STRIPS unknown keys instead of rejecting them. Sending the
 * viewer's spelling would arrive as a zero-sized zone and answer with nothing —
 * a filter that silently matches nothing, which is the exact failure mode this
 * whole module has already been burned by twice.
 */
export type ServerTrackZone =
  | {
      readonly kind: 'rect'
      readonly x: number
      readonly y: number
      readonly width: number
      readonly height: number
    }
  | { readonly kind: 'polygon'; readonly points: readonly ZonePoint[] }

/** Translate the drawn shape into the server's spelling. Null when none drawn. */
export function toServerTrackZone(zone: ZoneShape | null): ServerTrackZone | null {
  if (zone === null) return null
  if (zone.kind === 'polygon') return { kind: 'polygon', points: zone.points }
  const { x, y, w, h } = zone.rect
  return { kind: 'rect', x, y, width: w, height: h }
}

/** The exact `listTracks` input the theater sends — also its query key. */
export interface DeviceTracksRequest {
  readonly deviceId: number
  readonly since: number
  readonly until: number
  readonly limit: number
  /** See {@link buildDeviceTracksRequest} — chosen, never defaulted. */
  readonly projection: 'slim' | 'full'
  /** Server-side spatial prefilter; absent when no zone is drawn. */
  readonly zone?: ServerTrackZone
  /**
   * Server-side class prefilter; absent when the operator has narrowed
   * nothing — or when the macro map is not loaded yet, see
   * {@link expandSelectionToServerClasses}. Already EXPANDED to concrete
   * classes: the legend is macro-only and the server has no macro map.
   */
  readonly classes?: readonly string[]
}

/**
 * Build the request — and CHOOSE the projection rather than inheriting one.
 *
 * ## Why this is a function with a docblock instead of an object literal
 *
 * The server's default is `full`, which returns every row's frame-rate
 * `positions[]` history and its `snapshots[]` references. Measured against the
 * live hub on 2026-08-14 for device 104 over one day: **7 955 866 bytes** for
 * 380 rows (31 667 positions, 1 066 snapshots). The same query with
 * `projection: 'slim'` — every scalar the timeline renders, `envelope`
 * included — is **374 343 bytes**. Twenty-one times smaller, and the timeline
 * reads NOTHING from `snapshots[]` at all.
 *
 * That is not merely wasteful, it is the bug: `capQuery` bounds every cap call,
 * a payload that size does not deserialize on a phone inside the bound, and the
 * timeline then drew an empty day for a camera the hub had 380 tracks for. The
 * operator's device shipped both halves of the proof within five minutes of
 * each other — `"pipelineAnalytics.listTracks" hit its deadline { deviceId:
 * 104, deadlineMs: 6000 }` and `render state { objectEvents: 0, clusters: 0 }`,
 * then `render state { objectEvents: 380, clusters: 19 }` once a refetch
 * happened to win the race.
 *
 * `full` is therefore reserved for the ONE thing that reads `positions[]`: the
 * drawn zone filter's exact per-position test (`trackMatchesZone`). And even
 * then the zone rides the request, so the server prefilters on its persisted
 * envelope columns first — 104/today answers 380 rows unfiltered, 305 for the
 * right half of the frame, 45 for a left strip. Drawing a zone can no longer
 * put the whole day's positions back on the wire.
 */
export function buildDeviceTracksRequest(
  deviceId: number,
  fromMs: number,
  toMs: number,
  zone: ZoneShape | null,
  classes: readonly string[] | null = null,
): DeviceTracksRequest {
  const serverZone = toServerTrackZone(zone)
  return {
    deviceId,
    since: fromMs,
    until: toMs,
    limit: TRACKS_PAGE_SIZE,
    projection: serverZone === null ? 'slim' : 'full',
    ...(serverZone !== null ? { zone: serverZone } : {}),
    ...(classes !== null && classes.length > 0 ? { classes } : {}),
  }
}

/**
 * The zone filter's two halves, read off the SAME raw row.
 *
 * They are one parameter and not two because neither is much use alone: the
 * pixel boxes carry the precision and the normalised envelope carries the
 * scale, and it is dividing one by the other that pins the detection frame.
 * Passing the boxes while forgetting the envelope is exactly the defect that
 * left the filter comparing two different coordinate spaces (zone-filter.ts).
 */
export interface TrackTimelineGeometry {
  readonly positionBoxes: readonly PixelRect[]
  readonly normalizedEnvelope: ZoneRect | null
}

/**
 * Map one {@link TrackSummary} onto the timeline's `ObjectEvent` shape:
 *   • `id` = `bestEventId` (already `?? trackId` from `toTrackSummary`) — the id
 *     the event-media plane resolves the crop against;
 *   • `timestamp` = `firstSeen` (when the object appeared; the seek target);
 *   • `trackId` kept for the detail modal's track grouping;
 *   • `audioLabels` (when any) for the motion/audio activity filter;
 *   • `positionBoxes` + `normalizedEnvelope` for the client-side zone filter.
 * Pure — unit-tested in `__tests__/use-device-tracks.spec.ts`.
 */
export function trackToTimelineEvent(
  track: TrackSummary,
  geometry?: TrackTimelineGeometry,
): ObjectEvent {
  const boxes = geometry?.positionBoxes ?? []
  const envelope = geometry?.normalizedEnvelope ?? null
  return {
    id: track.bestEventId,
    deviceId: track.deviceId,
    timestamp: track.firstSeen,
    endTimestamp: track.lastSeen,
    className: track.className,
    label: track.label,
    ...(track.subLabel !== undefined ? { subLabel: track.subLabel } : {}),
    importance: track.importance,
    trackId: track.trackId,
    ...(track.audioLabels.length > 0 ? { audioLabels: track.audioLabels } : {}),
    ...(boxes.length > 0 ? { positionBoxes: boxes } : {}),
    ...(envelope !== null ? { normalizedEnvelope: envelope } : {}),
  }
}

export interface CollectTrackPagesOpts<T> {
  readonly until: number
  readonly pageSize: number
  readonly maxRows: number
  readonly fetchPage: (args: { until: number; limit: number }) => Promise<readonly T[]>
  readonly firstSeen: (row: T) => number
  readonly id: (row: T) => string
}

export interface CollectTrackPagesResult<T> {
  readonly rows: T[]
  /**
   * True when the walk stopped at `maxRows` with older rows still unread —
   * false whenever it stopped because the window is genuinely exhausted (a
   * short page, a page that added nothing new, or a cursor that stopped
   * moving). The caller MUST tell these apart: `[]`-shaped truncation is how
   * a busy camera's history used to read as "nothing older exists" (D-none,
   * the `TRACKS_MAX_ROWS` silent ceiling).
   */
  readonly hasMore: boolean
  /** The `until` a follow-up call should resume from to continue past what
   *  this call returned. Null whenever `hasMore` is false. */
  readonly nextUntil: number | null
}

/**
 * Walk newest-first `listTracks` pages until a short page (the window is
 * exhausted) or `opts.maxRows`. Each next `until` is exclusive of the oldest
 * `firstSeen` already collected so BETWEEN-inclusive queries do not re-return
 * the same page.
 *
 * Returns `hasMore`/`nextUntil` rather than silently truncating at `maxRows`:
 * the caller (`useDeviceTracks`) turns that into `hasMoreHistory` +
 * `loadMoreHistory`, an actual load-on-demand continuation, not a ceiling the
 * operator cannot see past.
 */
export async function collectTrackPages<T>(
  opts: CollectTrackPagesOpts<T>,
): Promise<CollectTrackPagesResult<T>> {
  const out: T[] = []
  const seen = new Set<string>()
  let until = opts.until
  while (out.length < opts.maxRows) {
    const page = await opts.fetchPage({ until, limit: opts.pageSize })
    if (page.length === 0) return { rows: out, hasMore: false, nextUntil: null }
    let oldest = until
    let added = 0
    for (const row of page) {
      const id = opts.id(row)
      if (seen.has(id)) continue
      seen.add(id)
      out.push(row)
      added += 1
      const ts = opts.firstSeen(row)
      if (ts < oldest) oldest = ts
      if (out.length >= opts.maxRows) {
        return { rows: out, hasMore: true, nextUntil: oldest - 1 }
      }
    }
    if (page.length < opts.pageSize) return { rows: out, hasMore: false, nextUntil: null }
    if (added === 0) return { rows: out, hasMore: false, nextUntil: null }
    const nextUntil = oldest - 1
    if (nextUntil >= until) return { rows: out, hasMore: false, nextUntil: null }
    until = nextUntil
  }
  return { rows: out, hasMore: true, nextUntil: until }
}

function mapRawTrackRows(raw: unknown): { events: ObjectEvent[]; withEnvelope: number } {
  if (!Array.isArray(raw)) return { events: [], withEnvelope: 0 }
  const events: ObjectEvent[] = []
  let withEnvelope = 0
  for (const row of raw) {
    const track = toTrackSummary(row, '')
    if (track === null) continue
    const normalizedEnvelope = parseNormalizedEnvelope(row)
    if (normalizedEnvelope !== null) withEnvelope += 1
    events.push(
      trackToTimelineEvent(track, {
        positionBoxes: parsePositionBoxes(row),
        normalizedEnvelope,
      }),
    )
  }
  return { events, withEnvelope }
}

/**
 * Rebuild a {@link TrackSummary} from a timeline `ObjectEvent` (the INVERSE of
 * {@link trackToTimelineEvent}). The theater cluster detail reuses the SAME
 * track-shaped events the timeline card renders, so the detail's per-track view
 * resolves media against the identical `bestEventId` (= the event's `id`) — the
 * two surfaces can never diverge. `firstSeen`/`lastSeen` come from the event's
 * `timestamp`/`endTimestamp`; fields the slim timeline projection does not carry
 * (`state`, `active`, `zonesVisited`) default. Pure — unit-tested.
 */
export function timelineEventToTrackSummary(
  ev: ObjectEvent,
  deviceId: number,
  cameraName = '',
): TrackSummary {
  return {
    trackId: ev.trackId ?? ev.id,
    deviceId,
    cameraName,
    className: ev.className,
    ...(ev.label !== undefined ? { label: ev.label } : {}),
    ...(ev.importance !== undefined ? { importance: ev.importance } : {}),
    firstSeen: ev.timestamp,
    lastSeen: ev.endTimestamp ?? ev.timestamp,
    state: 'idle',
    active: false,
    zonesVisited: [],
    zoneNames: [],
    audioLabels: ev.audioLabels !== undefined ? [...ev.audioLabels] : [],
    bestEventId: ev.id,
  }
}

/** How far behind `now` a window must END before it counts as settled history.
 *  Two minutes: long enough that a just-closed track has been persisted, short
 *  enough that yesterday is never polled. */
export const PAST_WINDOW_SETTLE_MS = 120_000

/** True when `toMs` is still inside the live settle margin — "today" as the
 *  theater draws it (midnight-tomorrow) is always live; yesterday never is. */
export function isDeviceTracksLiveWindow(toMs: number, nowMs: number): boolean {
  return toMs >= nowMs - PAST_WINDOW_SETTLE_MS
}

/**
 * Union of the settled-history page and the live tail. Tail wins on id so a
 * track that closed in the last two minutes is not shown twice, and a track
 * still growing is shown at its newest `lastSeen`.
 */
export function mergeDeviceTrackWindows(
  history: readonly ObjectEvent[] | undefined,
  tail: readonly ObjectEvent[] | undefined,
): ObjectEvent[] | undefined {
  if (history === undefined) {
    if (tail === undefined || tail.length === 0) return undefined
    return [...tail]
  }
  if (tail === undefined || tail.length === 0) return [...history]
  const byId = new Map<string, ObjectEvent>()
  for (const ev of history) byId.set(ev.id, ev)
  for (const ev of tail) byId.set(ev.id, ev)
  return [...byId.values()]
}

export interface DeviceTracksResult {
  readonly data: ObjectEvent[] | undefined
  readonly isError: boolean
  readonly isFetching: boolean
  readonly isLoading: boolean
  readonly refetch: () => Promise<unknown>
  /**
   * True when the settled-history read stopped at its per-chunk row bound
   * (`TRACKS_MAX_ROWS`) with OLDER tracks in the window still unread — never
   * true for a window that is genuinely exhausted. This is the fact
   * `TRACKS_MAX_ROWS` used to hide: to the operator a truncated list and an
   * actually-quiet stretch of history read as the exact same picture.
   */
  readonly hasMoreHistory: boolean
  /** A fetch for the next chunk of older history is in flight. */
  readonly isLoadingMoreHistory: boolean
  /**
   * Ask for the next chunk of older history — load-on-demand REPLACING the
   * silent ceiling, not raising it. No-op when `hasMoreHistory` is false or a
   * fetch is already in flight.
   */
  readonly loadMoreHistory: () => void
}

interface FetchDeviceTracksOpts {
  readonly since: number
  readonly until: number
  readonly half: 'history' | 'tail'
}

/** One walk's outcome, carried through the query cache. */
interface DeviceTracksChunk {
  readonly events: ObjectEvent[]
  readonly hasMore: boolean
  readonly nextUntil: number | null
  /** Where a scoped walk resumes. Null on the single-camera path, which
   *  resumes by `nextUntil` instead — see {@link HistoryResume}. */
  readonly nextCursor: string | null
}

const EMPTY_CHUNK: DeviceTracksChunk = {
  events: [],
  hasMore: false,
  nextUntil: null,
  nextCursor: null,
}

/**
 * Where the next chunk of older history resumes.
 *
 * Two shapes because the two wires page differently, and pretending otherwise
 * is how a resume lands in the wrong place: `listTracks` is walked newest-first
 * by an exclusive `until` this client computes, while `listRecentTracks` merges
 * N cameras server-side and hands back an OPAQUE cursor encoding a
 * `(lastSeen, trackId)` position no client may reconstruct. A discriminated
 * union rather than an optional field, so a resume can never carry both or be
 * read as the wrong one.
 */
export type HistoryResume =
  | { readonly kind: 'until'; readonly untilMs: number }
  | { readonly kind: 'cursor'; readonly cursor: string }

/** Page size for a scoped walk. The hub caps `listRecentTracks` at 1000 per
 *  page; 500 matches {@link TRACKS_PAGE_SIZE} so both walks pay the same
 *  per-page deserialisation cost on the JS thread. */
export const RECENT_TRACKS_PAGE_SIZE = 500

/** The exact `listRecentTracks` input a scoped timeline sends — also its key. */
export interface ScopeTracksRequest {
  readonly deviceIds: readonly number[]
  readonly since: number
  readonly until: number
  readonly limit: number
  readonly projection: 'slim' | 'full'
  /** The feed lists passages, not parking records — the same choice the
   *  single-camera request makes by relying on the server default. */
  readonly includeStationary: false
  /** Server-side class prefilter, expanded to concrete classes. Absent when
   *  the operator has narrowed nothing, or the macro map is not loaded. */
  readonly classes?: readonly string[]
}

/**
 * Build the scoped request.
 *
 * `listRecentTracks` takes the CLASS filter (added 2026-09-03, so a class chip
 * costs the same on twelve cameras as on one) but still has NO `zone`
 * parameter, so the server-side spatial prefilter the single-camera path
 * enjoys does not exist here. The drawn zone
 * therefore has to be applied client-side (`filterEventsByZone`), and that test
 * reads `positions[]` — which is exactly what `slim` drops. So a scope with a
 * zone drawn asks for `full`, the same trade the single-camera request makes,
 * and a scope with no zone keeps the cheap projection.
 */
export function buildScopeTracksRequest(
  deviceIds: readonly number[],
  fromMs: number,
  toMs: number,
  zone: ZoneShape | null,
  classes: readonly string[] | null = null,
): ScopeTracksRequest {
  return {
    deviceIds,
    since: fromMs,
    until: toMs,
    limit: RECENT_TRACKS_PAGE_SIZE,
    projection: zone === null ? 'slim' : 'full',
    includeStationary: false,
    ...(classes !== null && classes.length > 0 ? { classes } : {}),
  }
}

/**
 * Where a chunk says the next one resumes — `undefined` when the window is
 * exhausted. A scoped chunk resumes by cursor, a single-camera one by `until`;
 * a chunk that claims `hasMore` with neither is treated as exhausted rather
 * than re-fetching the same page forever.
 */
function nextHistoryResume(last: DeviceTracksChunk): HistoryResume | undefined {
  if (!last.hasMore) return undefined
  if (last.nextCursor !== null) return { kind: 'cursor', cursor: last.nextCursor }
  if (last.nextUntil !== null) return { kind: 'until', untilMs: last.nextUntil }
  return undefined
}

/** The `{ tracks, nextCursor }` page `listRecentTracks` answers with. */
function parseRecentTracksPage(raw: unknown): { rows: unknown; nextCursor: string | null } {
  if (!isRecord(raw)) return { rows: [], nextCursor: null }
  return {
    rows: raw.tracks,
    nextCursor: typeof raw.nextCursor === 'string' ? raw.nextCursor : null,
  }
}

/**
 * One walk of the SCOPED feed: `listRecentTracks`, N cameras merged
 * server-side, paged by the hub's opaque `(lastSeen, trackId)` cursor.
 *
 * The single-camera walk computes its own next `until` from the oldest row it
 * saw; that arithmetic is meaningless here — a k-way merge's oldest row does
 * not bound the other cameras' unread pages, and a client that guessed would
 * skip whole cameras' histories. So this walk carries the server's cursor and
 * nothing else, and stops on `nextCursor: null` (exhausted) or
 * {@link TRACKS_MAX_ROWS} (the same per-chunk memory bound, reported as
 * `hasMore` rather than silently truncating).
 */
async function fetchScopedHalf(
  client: unknown,
  request: ScopeTracksRequest,
  half: FetchDeviceTracksOpts,
  resume?: HistoryResume,
): Promise<DeviceTracksChunk> {
  const events: ObjectEvent[] = []
  const seen = new Set<string>()
  let cursor: string | undefined = resume?.kind === 'cursor' ? resume.cursor : undefined
  let pages = 0
  let withEnvelope = 0

  while (events.length < TRACKS_MAX_ROWS) {
    pages += 1
    const raw = await capQuery(
      client as Record<string, unknown>,
      'pipelineAnalytics',
      'listRecentTracks',
      {
        ...request,
        since: half.since,
        until: half.until,
        ...(cursor !== undefined ? { cursor } : {}),
      },
      { deadlineMs: BULK_QUERY_DEADLINE_MS, rethrow: true },
    )
    const page = parseRecentTracksPage(raw)
    const mapped = mapRawTrackRows(page.rows)
    withEnvelope += mapped.withEnvelope
    for (const ev of mapped.events) {
      if (seen.has(ev.id)) continue
      seen.add(ev.id)
      events.push(ev)
    }
    if (page.nextCursor === null) {
      log.info('device-tracks', 'listRecentTracks', {
        deviceId: request.deviceIds[0],
        scope: request.deviceIds.length,
        count: events.length,
        pages,
        withEnvelope,
        projection: request.projection,
        half: half.half,
        hasMore: false,
      })
      return { events, hasMore: false, nextUntil: null, nextCursor: null }
    }
    cursor = page.nextCursor
    if (events.length >= TRACKS_MAX_ROWS) break
  }
  // Same discipline as the single-camera walk: the bound is a per-chunk memory
  // ceiling, and `log.warn` always ships, so a truncated chunk is never
  // invisible on the hub side either.
  log.warn('device-tracks', 'listRecentTracks hit its per-chunk row bound', {
    deviceId: request.deviceIds[0],
    scope: request.deviceIds.length,
    count: events.length,
    pages,
    withEnvelope,
    projection: request.projection,
    half: half.half,
    hasMore: true,
  })
  return { events, hasMore: true, nextUntil: null, nextCursor: cursor ?? null }
}

/**
 * Query the device's TRACKS in `[fromMs, toMs)` mapped to timeline items.
 *
 * A live window is TWO queries, not one. Putting tomorrow-midnight in `until`
 * made `isImmutablePast` forever false on today, so the whole lookback was
 * re-fetched every 30 s (~10 listTracks/min + SuperJSON on the JS thread
 * mid-scrub). History is keyed `until: 'history'` and fetched once; the tail
 * is the last {@link PAST_WINDOW_SETTLE_MS} and is the only half that may poll.
 */
export function useDeviceTracks(
  scope: TimelineScope,
  fromMs: number,
  toMs: number,
  /**
   * Hold the query until the caller says the screen is ready.
   *
   * These are the two heaviest fetches on the camera screen — paged track
   * history plus a three-call activity bundle — and they used to race the WebRTC
   * negotiation on the SAME socket, so the timeline's data competed with the
   * seconds that decide how fast the picture appears. Defaults to true so no
   * other caller changes behaviour.
   */
  ready = true,
  /**
   * The drawn zone, which now rides the REQUEST (see
   * {@link buildDeviceTracksRequest}) instead of being applied only after the
   * rows land. Defaults to null so a caller that draws no zone gets the cheap
   * `slim` projection without opting in.
   */
  zone: ZoneShape | null = null,
  opts: {
    readonly pollLive?: boolean
    /**
     * The class selection, already expanded to concrete classes by
     * {@link expandSelectionToServerClasses}. `null`/absent sends no class
     * filter — which is also what an unloaded macro map must produce.
     */
    readonly classes?: readonly string[] | null
  } = {},
): DeviceTracksResult {
  const { pollLive = true, classes = null } = opts
  const { controller, state } = useConnection()
  const ask = planScopeAsk(scopeToIds(scope))
  const scoped = ask.asked.length > 1
  const deviceId = ask.asked[0] ?? 0
  // `scopeKey` IS the identity of `ask.asked` — the array itself is a fresh
  // literal every render, so BOTH memos below depend on the key rather than on
  // the list, and neither reminds its request (and therefore its query key) on
  // a render that changed nothing.
  const scopeKey = scopeIdsKey(ask.asked)
  // Same reason as `scopeKey`: the caller hands a fresh array every render, so
  // the memo (and therefore the query key) depends on the CONTENT, not on the
  // identity. Keying on the array would remint the request on every render and
  // refetch a day of tracks for a selection that never changed.
  const classesKey = classes === null ? '' : [...classes].sort().join(',')
  // The request IS the key: `projection` and `zone` change what comes back, so
  // a key that named only the window would serve the previous zone's rows —
  // and, worse, would serve a `slim` page to the per-position test that needs
  // `positions[]`.
  const request = useMemo(
    () =>
      buildDeviceTracksRequest(
        idsFromScopeKey(scopeKey)[0] ?? 0,
        fromMs,
        toMs,
        zone,
        classesKey === '' ? null : classesKey.split(','),
      ),
    [scopeKey, fromMs, toMs, zone, classesKey],
  )
  // The scoped twin.
  const scopeRequest = useMemo(
    () =>
      buildScopeTracksRequest(
        idsFromScopeKey(scopeKey),
        fromMs,
        toMs,
        zone,
        classesKey === '' ? null : classesKey.split(','),
      ),
    [scopeKey, fromMs, toMs, zone, classesKey],
  )
  const liveWindow = isDeviceTracksLiveWindow(toMs, Date.now())

  const fetchHalf = async (
    half: FetchDeviceTracksOpts,
    resume?: HistoryResume,
  ): Promise<DeviceTracksChunk> => {
    const system = controller.getSystem()
    if (!system) return EMPTY_CHUNK
    if (half.until <= half.since) return EMPTY_CHUNK
    if (scoped) {
      return fetchScopedHalf(system.trpcClient, scopeRequest, half, resume)
    }
    let withEnvelope = 0
    let pages = 0
    const { rows: events, hasMore, nextUntil } = await collectTrackPages<ObjectEvent>({
      until: half.until,
      pageSize: TRACKS_PAGE_SIZE,
      maxRows: TRACKS_MAX_ROWS,
      firstSeen: (e) => e.timestamp,
      id: (e) => e.id,
      fetchPage: async ({ until, limit }) => {
        pages += 1
        const raw = await capQuery(
          system.trpcClient as Record<string, unknown>,
          'pipelineAnalytics',
          'listTracks',
          { ...request, since: half.since, until, limit },
          { deadlineMs: BULK_QUERY_DEADLINE_MS, rethrow: true },
        )
        const mapped = mapRawTrackRows(raw)
        withEnvelope += mapped.withEnvelope
        return mapped.events
      },
    })
    const logFields = {
      deviceId,
      count: events.length,
      pages,
      withEnvelope,
      projection: request.projection,
      zoned: request.zone !== undefined,
      half: half.half,
      hasMore,
    }
    if (hasMore) {
      // TRACKS_MAX_ROWS is a per-chunk memory bound, not a ceiling on the
      // operator's history — `hasMoreHistory`/`loadMoreHistory` (below) are
      // the on-demand continuation. This line is the one place that bound
      // being hit is recorded; log.warn ALWAYS ships (see logger.ts), so a
      // truncated chunk is never invisible on the hub side either.
      log.warn('device-tracks', 'listTracks hit its per-chunk row bound', logFields)
    } else {
      log.info('device-tracks', 'listTracks', logFields)
    }
    return { events, hasMore, nextUntil, nextCursor: null }
  }

  // History is an INFINITE query, one page = one `collectTrackPages` walk
  // (up to TRACKS_MAX_ROWS rows). Almost always exactly one page — the walk
  // already reaches TRACKS_MAX_ROWS before a single day's typical camera
  // does — but a camera busy enough to fill it gets `hasNextPage: true`
  // instead of a silently shorter list, and `fetchNextPage` (exposed below as
  // `loadMoreHistory`) continues from exactly where the last chunk stopped.
  // The key names the SCOPE, not only the window: a page of five cameras and a
  // page of one answer different questions over the same hours, and sharing an
  // entry between them would serve the wall's rows to the single camera the
  // moment the view emptied.
  const keyRequest = scoped ? scopeRequest : request
  const historyQuery = useInfiniteQuery<DeviceTracksChunk>({
    queryKey: ['v2', 'analytics', 'device-tracks', { ...keyRequest, until: 'history' }],
    placeholderData: (previous) => previous,
    enabled: ready && state === 'connected' && ask.asked.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    refetchInterval: false,
    initialPageParam: undefined as HistoryResume | undefined,
    queryFn: async ({ pageParam }): Promise<DeviceTracksChunk> => {
      const now = Date.now()
      const boundary = liveWindow ? now - PAST_WINDOW_SETTLE_MS : request.until
      const resume = pageParam as HistoryResume | undefined
      const until = resume?.kind === 'until' ? resume.untilMs : boundary
      return fetchHalf({ since: request.since, until, half: 'history' }, resume)
    },
    getNextPageParam: (last) => nextHistoryResume(last),
  })

  const tailQuery = useQuery<DeviceTracksChunk>({
    queryKey: ['v2', 'analytics', 'device-tracks', { ...keyRequest, until: 'tail' }],
    placeholderData: (previous) => previous,
    enabled: ready && state === 'connected' && liveWindow && ask.asked.length > 0,
    staleTime: RECONCILE_MS,
    refetchInterval: pollLive && liveWindow ? RECONCILE_MS : false,
    queryFn: async (): Promise<DeviceTracksChunk> => {
      const now = Date.now()
      return fetchHalf({
        since: now - PAST_WINDOW_SETTLE_MS,
        until: Math.min(request.until, now),
        half: 'tail',
      })
    },
  })

  const historyEvents = useMemo(
    () => historyQuery.data?.pages.flatMap((page) => page.events),
    [historyQuery.data],
  )
  const hasMoreHistory = historyQuery.hasNextPage ?? false
  const isLoadingMoreHistory = historyQuery.isFetchingNextPage
  const fetchNextHistoryPage = historyQuery.fetchNextPage
  const loadMoreHistory = useCallback((): void => {
    if (hasMoreHistory && !isLoadingMoreHistory) void fetchNextHistoryPage()
  }, [hasMoreHistory, isLoadingMoreHistory, fetchNextHistoryPage])

  return {
    data: mergeDeviceTrackWindows(historyEvents, tailQuery.data?.events),
    isError: historyQuery.isError || tailQuery.isError,
    isFetching: historyQuery.isFetching || tailQuery.isFetching,
    isLoading: historyQuery.isLoading || (liveWindow && tailQuery.isLoading),
    refetch: async () => {
      await Promise.all([historyQuery.refetch(), tailQuery.refetch()])
    },
    hasMoreHistory,
    isLoadingMoreHistory,
    loadMoreHistory,
  }
}
