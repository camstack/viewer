/**
 * Every MOUNTED events feed (the gallery, the reel), so a change made elsewhere
 * in the app can reach all of them at once.
 *
 * The reel and the gallery each own a feed; neither knows about the other,
 * and the code that reassigns a face knows about neither. A module-level
 * registry is the same shape `embed-channel.ts` already uses for the player,
 * and it keeps the mutation from having to thread a ref through three screens.
 *
 * ## Why RELOAD and not refresh
 *
 * `refresh` is incremental, and incremental means `since = rows[0].lastSeen`
 * (`deltaSince` in `shared/events/events-feed.ts`). Assigning an identity to a
 * face does NOT move the track's `lastSeen` — it rewrites its label. So a
 * delta on a track from an hour ago never includes that row, the merge never
 * gets a fresher copy to win with, and the card stays exactly as stale as it
 * was. `reload` drops the feed and re-pages, which is the only thing that
 * re-reads a row whose timestamp did not move.
 *
 * That is the opposite of the right answer for a RESUME (where the feed is
 * still correct and a delta is enough), which is why the two triggers
 * deliberately use different commands.
 *
 * A reload does NOT blank the surface: the feed pages the replacement in
 * behind the rows already on screen and swaps once it is at least as tall
 * (`events-feed.ts`, `beginRebuild`). It has to — this reload fires from inside
 * the track detail (a face assignment) and from a hub announcement that can
 * land while the detail is open, and the old blanking version is what sent the
 * operator back to the first row every time they came out of an event.
 */
import { log } from '../lib/logger.js'
import { unrefTimer } from '../lib/unref-timer.js'

/** What a mounted feed exposes to the rest of the app. */
export interface EventsFeedSurface {
  /** Fetch and prepend rows newer than the current head. */
  readonly refresh: () => void
  /** Drop the feed and re-page from the top. */
  readonly reload: () => void
}

const registry = new Set<EventsFeedSurface>()

/** Register a mounted surface. Returns the unregister fn for the effect. */
export function registerEventsFeed(surface: EventsFeedSurface): () => void {
  registry.add(surface)
  return () => {
    registry.delete(surface)
  }
}

/** How many surfaces are mounted — exported for the tests only. */
export function mountedEventsFeedCount(): number {
  return registry.size
}

/**
 * Collapse a burst into one reload.
 *
 * The same identity change arrives twice by design: the mutation's own
 * `onSuccess` (immediate, and certain for the operator who did it) and the
 * hub's `face-gallery-changed` event (which also covers a change made from
 * admin-ui, and lands after any async retro-propagation the server does). Both
 * are wanted — per D8 an event may be dropped, so the local path is the
 * reconcile — but two reloads a few hundred milliseconds apart would re-page
 * the feed twice for one operator action.
 */
const RELOAD_COALESCE_MS = 1_500
/**
 * How long after the LAST assignment the trailing reload fires.
 *
 * Leading-edge alone was the whole rule, and assigning faces is not a single
 * action — it is a burst. The operator worked a gallery on 2026-09-10 and the
 * hub recorded eight assignments in ninety seconds producing six full feed
 * reloads: every one re-pages the feed, and the app read as "blocked".
 *
 * Leading AND trailing is the shape this wants: the first assignment reloads
 * at once, so the operator sees the change they just made; the rest are
 * absorbed; and one final reload lands after they stop, so the feed is correct
 * without having been re-paged once per face.
 */
const RELOAD_TRAILING_MS = 4_000
let lastReloadAt = Number.NEGATIVE_INFINITY
let lastRefreshAt = Number.NEGATIVE_INFINITY
let trailingTimer: ReturnType<typeof setTimeout> | null = null
let trailingReason: string | null = null

/** True when `now` is far enough from the last accepted reload. Pure. */
export function shouldReload(lastAt: number, now: number): boolean {
  return now - lastAt >= RELOAD_COALESCE_MS
}

/** Injectable for the test; production uses the platform timer. */
let scheduleTrailing: (fn: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout
let cancelTrailing: (t: ReturnType<typeof setTimeout>) => void = clearTimeout

/** Test seam: swap the timer, and put it back. */
export function __setReloadTimerForTest(
  schedule: typeof scheduleTrailing,
  cancel: typeof cancelTrailing,
): void {
  scheduleTrailing = schedule
  cancelTrailing = cancel
}

/**
 * Re-page every mounted events feed.
 *
 * `reason` is logged (at `warn`, the level that ships) so a feed that re-pages
 * can be explained after the fact rather than guessed at.
 */
export function reloadEventsFeeds(reason: string, now: number = Date.now()): void {
  if (registry.size === 0) return
  if (!shouldReload(lastReloadAt, now)) return
  lastReloadAt = now
  reloadNow(reason)
}

/** The reload itself, with no windowing of its own. */
function reloadNow(reason: string): void {
  log.warn('events-feed', 'reloading mounted feeds', { reason, surfaces: registry.size })
  for (const surface of registry) {
    try {
      surface.reload()
    } catch {
      // One wedged surface must not stop the others.
    }
  }
}

/**
 * Re-page after a BURST of changes has stopped — the face-assignment path.
 *
 * {@link reloadEventsFeeds} coalesces at 1.5 s, which cannot help here: the
 * operator's measured pace on 2026-09-10 was one assignment every ~11 s, so
 * every single one cleared the window and re-paged the feed. Eight
 * assignments, six full reloads, and an app that read as blocked.
 *
 * No window shorter than the operator's own pace absorbs that, and a longer
 * one would re-page the feed while he is still working. So nothing reloads
 * until he stops: he is in the gallery while assigning, and the feed only has
 * to be right when he goes back to it.
 */
export function reloadEventsFeedsAfterBurst(reason: string): void {
  if (registry.size === 0) return
  armTrailingReload(reason)
}

/** (Re)start the trailing timer — the burst's last word. */
function armTrailingReload(reason: string): void {
  trailingReason = reason
  if (trailingTimer !== null) cancelTrailing(trailingTimer)
  trailingTimer = scheduleTrailing(() => {
    trailingTimer = null
    const why = trailingReason ?? reason
    trailingReason = null
    if (registry.size === 0) return
    lastReloadAt = Date.now()
    reloadNow(`${why}:settled`)
  }, RELOAD_TRAILING_MS)
  unrefTimer(trailingTimer)
}

/**
 * Prepend newly persisted tracks without clearing the current feed.
 *
 * Track lifecycle events can arrive in small bursts (`update` then `end`), so
 * collapse adjacent announcements. Unlike `reloadEventsFeeds`, this never
 * changes the feed generation and therefore never returns the surface to its
 * full loading state.
 */
export function refreshEventsFeeds(reason: string, now: number = Date.now()): void {
  if (registry.size === 0) return
  if (now - lastRefreshAt < RELOAD_COALESCE_MS) return
  lastRefreshAt = now
  log.info('events-feed', 'refreshing mounted feeds incrementally', {
    reason,
    surfaces: registry.size,
  })
  for (const surface of registry) {
    try {
      surface.refresh()
    } catch {
      // One wedged surface must not stop the others.
    }
  }
}

/** Test seam: forget the coalescing window. */
export function resetEventsFeedReloadWindow(): void {
  lastReloadAt = Number.NEGATIVE_INFINITY
  lastRefreshAt = Number.NEGATIVE_INFINITY
}
