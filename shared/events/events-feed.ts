/**
 * events-feed — the PURE paging + incremental-refresh engine of the events embed.
 *
 * The feed is `pipelineAnalytics.listRecentTracks` with `projection: 'slim'`:
 * ONE merged request per page across every selected camera, ordered by
 * (`lastSeen` DESC, `trackId` DESC), continued by an OPAQUE cursor.
 *
 * ## Why the cursor, not time windows
 *
 * The viewer's feed walks fixed 12-hour windows backwards and asks for
 * `perCamera × cameras` rows per window. When a window fills its budget the
 * older tracks INSIDE it are never shown, and the screen cannot tell that from
 * "there were no more" — the hook has to log a warning about it. `nextCursor`
 * has no such failure mode: the server returns exactly the rows after the last
 * one delivered, and `null` means exhausted. Infinite scroll follows the
 * cursor; nothing is silently dropped.
 *
 * ## The fan-out budget is the client's problem too
 *
 * `TrackStore.queryRecent` caps what it will MATERIALISE at
 * {@link RECENT_FANOUT_ROW_BUDGET} rows (`deviceCount × limit`) and quietly
 * serves a SHORTER page when the ask exceeds it. A client that asks for 200
 * rows across 20 cameras gets 100 and, reading only the length, concludes the
 * page was partial for some other reason. {@link resolveEventsPageLimit}
 * mirrors the server rule so the ask is honest to begin with — and the page's
 * `nextCursor`, never its length, decides whether more exist.
 *
 * ## Incremental refresh, never a restart
 *
 * A refresh asks ONLY for what is newer than the head:
 * `since = rows[0].lastSeen` (INCLUSIVE, so same-millisecond ties cannot slip
 * through) and merges by `trackId`. Rows already held are REPLACED — an active
 * track's `lastSeen` advances between polls and a naive prepend would show it
 * twice. Nothing already paged is refetched and no cursor is invalidated.
 *
 * If a delta page comes back with a non-null `nextCursor` there are rows
 * between it and the head that were not delivered: {@link applyDelta} reports
 * `gap: true` and hands back the cursor to follow, so the caller drains it
 * (bounded) instead of pretending the head is contiguous.
 *
 * ## A reload REPLACES, it never blanks
 *
 * `reload` is the other half: the only thing that re-reads a row whose
 * `lastSeen` did not move (a face reassignment rewrites a label, not a
 * timestamp). It must NOT empty the feed to do it — the surface is a scroller,
 * an empty grid has no height, and the browser clamps `scrollTop` to 0. That is
 * how an operator who opened one event came back to row one. So a reload pages
 * the new generation into {@link FeedRebuild} behind the visible rows and swaps
 * in one step once it is at least as tall. Only a genuinely DIFFERENT question
 * (another camera set, another day) resets to {@link EMPTY_FEED}.
 *
 * Every function here is pure and total. React lives in `use-events-feed.ts`.
 */
import type { EventsTrackRow } from './events-track-row'

/**
 * The hub's own fan-out ceiling (`RECENT_FANOUT_ROW_BUDGET` in
 * `addon-post-analysis/.../store/track-store.ts`). Mirrored — NOT imported: the
 * embed is a browser bundle and cannot reach the addon's server tree. If the
 * server value changes, a page merely comes back shorter than asked and the
 * cursor still carries it, so the mirror is a performance hint, never a
 * correctness dependency.
 */
export const RECENT_FANOUT_ROW_BUDGET = 2_000

/** The cap's own hard ceiling on `limit` (`RECENT_TRACKS_MAX_LIMIT`). */
export const RECENT_TRACKS_MAX_LIMIT = 1_000

/**
 * The limit to actually REQUEST for a merged page.
 *
 * `min(asked, cap, floor(budget / devices))` — the server would clamp to the
 * same number anyway; asking for it directly is what keeps "this page was
 * short" meaningful. Never below 1: a request naming more devices than the
 * budget still has to return something and offer a cursor.
 */
export function resolveEventsPageLimit(requested: number, deviceCount: number): number {
  const asked = Math.max(1, Math.floor(requested))
  const devices = Math.max(1, Math.floor(deviceCount))
  const perFanout = Math.max(1, Math.floor(RECENT_FANOUT_ROW_BUDGET / devices))
  return Math.min(asked, RECENT_TRACKS_MAX_LIMIT, perFanout)
}

/** Comparator for the server's total order: (`lastSeen` DESC, `trackId` DESC). */
export function compareRowsDesc(a: EventsTrackRow, b: EventsTrackRow): number {
  if (a.lastSeen !== b.lastSeen) return b.lastSeen - a.lastSeen
  if (a.trackId === b.trackId) return 0
  return a.trackId < b.trackId ? 1 : -1
}

/**
 * A reload IN FLIGHT: the new generation's pages, accumulated OFF-SCREEN.
 *
 * A reload exists to re-read rows whose `lastSeen` did not move — a face
 * reassignment rewrites a label without touching the timestamp, so no delta can
 * ever carry it. Doing that by EMPTYING the feed is what cost the operator
 * their place: the scroller's content collapses, the browser clamps `scrollTop`
 * to 0, and closing a track detail lands back on row one. So the replacement is
 * paged into here while `FeedState.rows` keeps painting, and the two are
 * swapped in ONE step once the new generation is at least as tall.
 */
export interface FeedRebuild {
  readonly rows: readonly EventsTrackRow[]
  readonly cursor: string | null
  readonly exhausted: boolean
  /** Rows on screen when the rebuild started — the height to re-reach. */
  readonly floor: number
  /** Pages folded so far. Bounds the swap; see {@link MAX_REBUILD_PAGES}. */
  readonly pages: number
}

export interface FeedState {
  /** Everything loaded, in the server's order. Deduplicated by `trackId`. */
  readonly rows: readonly EventsTrackRow[]
  /** Continuation cursor for the NEXT page; null before the first page and
   *  after the last one (see `exhausted` for the difference). */
  readonly cursor: string | null
  /** The server reported `nextCursor: null` — there is nothing older. */
  readonly exhausted: boolean
  /** Non-null while a reload is being paged in behind the visible rows. */
  readonly rebuild: FeedRebuild | null
}

export const EMPTY_FEED: FeedState = { rows: [], cursor: null, exhausted: false, rebuild: null }

/**
 * Pages a rebuild will request before swapping regardless of height.
 *
 * The floor is a row COUNT and a page is whatever the fan-out budget allows, so
 * a surface deep in its scrollback could otherwise re-page a long way to match
 * itself. Hitting the bound swaps a shorter list — the scroller shrinks by
 * exactly as much as it must, which is still not a jump to the top.
 */
export const MAX_REBUILD_PAGES = 8

/** Merge rows into an ordered, `trackId`-unique list. Incoming rows WIN over
 *  held ones (a re-read of an active track is fresher). Immutable. */
function mergeRows(
  held: readonly EventsTrackRow[],
  incoming: readonly EventsTrackRow[],
): EventsTrackRow[] {
  const byId = new Map<string, EventsTrackRow>()
  for (const row of held) byId.set(row.trackId, row)
  for (const row of incoming) byId.set(row.trackId, row)
  return [...byId.values()].sort(compareRowsDesc)
}

/**
 * Fold ONE paged response into the feed (infinite scroll, oldest direction).
 *
 * The page is never truncated to a memory ceiling here: dropping the tail would
 * strand the cursor past a hole nobody could ever fill. The ceiling is enforced
 * by {@link hasMore}, which simply stops asking.
 */
export function appendPage(
  state: FeedState,
  rows: readonly EventsTrackRow[],
  nextCursor: string | null,
): FeedState {
  const rebuild = state.rebuild
  if (rebuild === null) {
    return {
      rows: mergeRows(state.rows, rows),
      cursor: nextCursor,
      exhausted: nextCursor === null,
      rebuild: null,
    }
  }
  // A rebuild folds into the SHADOW. Nothing the operator can see moves until
  // the swap below, which is the whole point.
  const merged = mergeRows(rebuild.rows, rows)
  const pages = rebuild.pages + 1
  const tallEnough = merged.length >= rebuild.floor
  if (nextCursor === null || tallEnough || pages >= MAX_REBUILD_PAGES) {
    return { rows: merged, cursor: nextCursor, exhausted: nextCursor === null, rebuild: null }
  }
  return {
    ...state,
    rebuild: { rows: merged, cursor: nextCursor, exhausted: false, floor: rebuild.floor, pages },
  }
}

/**
 * Start a reload WITHOUT clearing the surface.
 *
 * With nothing on screen there is nothing to protect and this is an ordinary
 * reset — a rebuild there would only defer the first page behind a comparison
 * against zero.
 */
export function beginRebuild(state: FeedState): FeedState {
  if (state.rows.length === 0) return EMPTY_FEED
  return {
    ...state,
    rebuild: { rows: [], cursor: null, exhausted: false, floor: state.rows.length, pages: 0 },
  }
}

/** Drop an in-flight rebuild and keep the generation that is on screen — what a
 *  page request that has exhausted its retries must do, so a failed reload
 *  leaves the operator with a stale list rather than a stalled one. */
export function abandonRebuild(state: FeedState): FeedState {
  return state.rebuild === null ? state : { ...state, rebuild: null }
}

/** True while a reload is being paged in behind the visible rows. */
export function isRebuilding(state: FeedState): boolean {
  return state.rebuild !== null
}

/**
 * The cursor the NEXT page request must carry.
 *
 * During a rebuild that is the new generation's cursor — the visible feed's
 * belongs to the generation being replaced, and continuing from it would page
 * the old answer into the new list.
 */
export function pageCursor(state: FeedState): string | null {
  return state.rebuild !== null ? state.rebuild.cursor : state.cursor
}

export interface DeltaResult {
  readonly state: FeedState
  /**
   * The delta window was not fully delivered — rows exist between the page's
   * oldest row and the previous head. `deltaCursor` continues it.
   */
  readonly gap: boolean
  readonly deltaCursor: string | null
  /** Rows the delta introduced that the feed did not already hold. */
  readonly added: number
}

/**
 * Fold a DELTA response (newest direction) into the feed.
 *
 * The paging `cursor` / `exhausted` are untouched — a delta says nothing about
 * how far back the feed has been paged, and clobbering them is exactly how an
 * "incremental" refresh turns into a restart.
 */
export function applyDelta(
  state: FeedState,
  rows: readonly EventsTrackRow[],
  nextCursor: string | null,
): DeltaResult {
  const held = new Set(state.rows.map((r) => r.trackId))
  let added = 0
  for (const row of rows) if (!held.has(row.trackId)) added += 1
  return {
    state: { ...state, rows: mergeRows(state.rows, rows) },
    gap: nextCursor !== null,
    deltaCursor: nextCursor,
    added,
  }
}

/**
 * The `since` bound for the next delta: the head row's `lastSeen`, INCLUSIVE.
 *
 * Inclusive on purpose. `lastSeen` is a millisecond and two tracks on two
 * cameras routinely share one; `since = head + 1` would skip every tie, and a
 * skipped track never comes back because the next delta's floor is higher
 * still. The overlap it costs is one row, which `applyDelta` deduplicates.
 *
 * Null when nothing is loaded — there is no head to be incremental about, and
 * the caller must do a normal first page instead.
 */
export function deltaSince(state: FeedState): number | null {
  const head = state.rows[0]
  return head !== undefined ? head.lastSeen : null
}

/**
 * WHY the feed would stop asking for another page. Three states, and two of
 * them are not the same sentence.
 *
 * - `more` — keep paging.
 * - `exhausted` — the SERVER said `nextCursor: null`. There is nothing older.
 * - `ceiling` — the in-memory row limit was reached. There is very probably
 *   plenty older; this client simply stopped.
 *
 * Collapsing the last two into one boolean is the bug the operator reported as
 * "it only goes back as far as 17:30": with the `maxRows` of the day (600) the
 * surface hit its own ceiling five hours in and rendered the SAME end-of-list
 * marker it renders for a genuinely exhausted feed. A ceiling that looks like
 * the beginning of history is a lie the operator cannot see through — nothing
 * on screen distinguishes it, and nothing offers to continue.
 *
 * The ceiling is now rare rather than routine (the gallery is virtualized, so
 * its bound is memory rather than the DOM — see `resolveMaxRows`), which makes
 * this distinction MORE load-bearing, not less: a reason that fires once a
 * month is the one nobody remembers is possible.
 */
export type FeedTailReason = 'more' | 'exhausted' | 'ceiling'

export function tailReason(state: FeedState, maxRows: number): FeedTailReason {
  // During a rebuild the question is about the generation being PAGED, not the
  // one being painted: a feed already at its ceiling would otherwise refuse to
  // fetch the first page of its own replacement.
  const target = state.rebuild ?? state
  if (target.exhausted) return 'exhausted'
  return target.rows.length < Math.max(1, maxRows) ? 'more' : 'ceiling'
}

/** More pages are worth asking for: the server has not said "exhausted" and the
 *  in-memory ceiling has not been reached. */
export function hasMore(state: FeedState, maxRows: number): boolean {
  return tailReason(state, maxRows) === 'more'
}

/**
 * The `since` floor for a PAGED request: never ask the server for anything
 * older than the age floor. The bound rides the request, so the payload is
 * bounded too — it is not a filter applied after the fact.
 */
export function ageFloor(anchorMs: number, maxAgeMs: number): number {
  return Math.max(0, anchorMs - Math.max(0, maxAgeMs))
}

/** The window a request is bounded by, as the server takes it. */
export interface FeedWindow {
  readonly since: number
  /** Absent ⇒ no upper bound (the rolling feed; the cursor bounds page 2+). */
  readonly until?: number
}

/**
 * Resolve the window to REQUEST.
 *
 * An explicit `sinceMs`/`untilMs` (day navigation) wins over the rolling
 * anchor — and both ride `listRecentTracks`'s own `since`/`until`, so a day
 * view never materialises a row outside its day and then hides it client-side.
 * That distinction is the whole reason this is not a post-filter: the fan-out
 * budget is spent on rows the caller can actually see.
 *
 * With no explicit bound the floor is the age floor and there is NO upper
 * bound: page 1 must be able to return everything detected since mount, and
 * pages 2+ are bounded exactly by the cursor.
 */
export function resolveFeedWindow(params: {
  readonly anchorMs: number
  readonly maxAgeMs: number
  readonly sinceMs?: number
  readonly untilMs?: number
}): FeedWindow {
  const since = params.sinceMs ?? ageFloor(params.anchorMs, params.maxAgeMs)
  return params.untilMs !== undefined ? { since, until: params.untilMs } : { since }
}

/**
 * Should the incremental poll run at all?
 *
 * No, once the window is CLOSED in the past: nothing newer can appear inside
 * it, so a poll asks a finished day the same question forever. `nowMs` is
 * injected so the rule is pure — and the comparison is against the window's
 * upper bound, not against "is a window set", because a window whose `untilMs`
 * is in the future (today, ending at midnight) is still live.
 */
export function shouldPoll(untilMs: number | undefined, nowMs: number): boolean {
  return untilMs === undefined || untilMs > nowMs
}

/**
 * Order rows for display.
 *
 * `time` is the server's own order and the one pagination walks — it is
 * returned as-is (the rows are already sorted; a re-sort would only mask a
 * merge bug).
 *
 * `importance` sorts CLIENT-SIDE, descending, over what is loaded. It cannot
 * be pushed into the query: `listRecentTracks` orders by `lastSeen` and its
 * cursor encodes that position, so an importance-ordered page could not be
 * continued. Ties, and rows with NO importance (legacy rows, and every row
 * written before scoring shipped), fall back to the time order rather than to
 * an arbitrary one — an unscored track sinks below every scored one instead of
 * scattering through them.
 */
export function sortRows(
  rows: readonly EventsTrackRow[],
  sort: 'time' | 'importance',
): readonly EventsTrackRow[] {
  if (sort === 'time') return rows
  return [...rows].sort((a, b) => {
    const ai = a.importance ?? -1
    const bi = b.importance ?? -1
    if (ai !== bi) return bi - ai
    return compareRowsDesc(a, b)
  })
}

/**
 * The day a page is showing → the feed's window.
 *
 * Day 0 is the LIVE day and must CLEAR both bounds, not pin them to "today so
 * far": a pinned upper bound stops the incremental poll, and the live day is
 * exactly the one that must keep gaining rows.
 *
 * **A past day pins the UPPER bound only.** The day says where the list
 * STARTS, not where it is allowed to end — so paging simply walks backwards
 * past midnight, into the day before and the one before that, by cursor. This
 * is the whole of "roll into the previous day": there is no lower cage left to
 * dead-end against. Pinning `sinceMs` as well is what produced the report "it
 * stops and nothing happens": the feed exhausted the calendar day, the hub
 * correctly answered `nextCursor: null`, and the surface drew its end-of-list
 * marker at 00:00 with a year of history one request away.
 *
 * The floor that remains is the feed's own `maxAgeMs`, which rides `since` on
 * every request. That one is a real bound, and the server's `nextCursor: null`
 * is still the only thing that means "nothing older".
 */
export function dayWindowFor(
  dayOffset: number,
  anchorMs: number,
): { readonly sinceMs?: number; readonly untilMs?: number } {
  if (dayOffset <= 0) return {}
  const start = new Date(anchorMs)
  start.setHours(0, 0, 0, 0)
  const dayMs = 24 * 60 * 60 * 1000
  return { untilMs: start.getTime() - dayOffset * dayMs + dayMs - 1 }
}

/**
 * What a pull-for-newer at the TOP of the feed means.
 *
 * On the live day it is a refresh (the delta fetches anything newer than the
 * head). On a PAST day the window is closed above, so a delta can never return
 * anything — the gesture's one obvious answer is the next day, so it rolls the
 * day forward instead of firing a request guaranteed to return the head back.
 */
export type EventsPullIntent = 'refresh' | 'roll-newer'

export function pullIntentFor(dayOffset: number): EventsPullIntent {
  return dayOffset > 0 ? 'roll-newer' : 'refresh'
}
