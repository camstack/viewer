/**
 * events-client — the narrow data interface the events feed depends on,
 * shared by the hub-hosted embed (`createEventsDataClient`, in the embed) and
 * the app's native gallery (an adapter over the viewer's own tRPC client).
 *
 * Everything downstream (the feed hook, the page) depends on this narrow
 * interface instead of `System`. Two reasons, both load-bearing:
 *
 *  - the generated procedure types live at exactly one call site, so a cap
 *    change surfaces here as a compile error rather than rotting silently
 *    behind a hand-written interface somewhere in the render tree;
 *  - the page and the feed become testable with an ordinary object. A fake
 *    `System` would need a cast; a fake `EventsDataClient` needs nothing.
 */
import type { EventsTrackSource } from './events-share-url.js'

/**
 * `listRecentTracks` input. A TYPE alias, not an interface, on purpose: the
 * generated procedure input is an intersection with `{ [x: string]: unknown }`
 * and only a type alias carries the implicit index signature that makes an
 * object literal assignable to it.
 */
export type RecentTracksInput = {
  deviceIds: number[]
  since: number
  limit: number
  projection: 'slim'
  /** Upper bound on `lastSeen`. Present only for an explicit (day) window —
   *  the rolling feed leaves page 1 unbounded and lets the cursor bound the
   *  rest. */
  until?: number
  cursor?: string
  /** Opt into parked (stationary-promoted) rows. Omit = hub default hide. */
  includeStationary?: boolean
  /**
   * Track SOURCES the hub must leave out. Omitted when nothing is hidden.
   *
   * A hub too old for it drops the key silently (Zod strips what it does not
   * declare), which is why the page ALSO applies the rule to the rows it has:
   * a narrowed read is the optimisation, not the guarantee.
   */
  excludeSources?: EventsTrackSource[]
}

/**
 * `searchObjectEvents` input — the CLIP text→image search.
 *
 * `deviceId` is a SINGLE optional camera and omitting it searches them ALL, so
 * the passthrough stays one request; it is not the per-camera fan-out the feed
 * was designed to avoid. Verified against the cap: the viewer's own semantic
 * search omits it for "all cameras".
 */
export type SearchObjectEventsInput = {
  text: string
  limit: number
  /** Absent = the hub's per-model floor (D649). Sent only when set explicitly. */
  minScore?: number
  deviceId?: number
  since?: number
  until?: number
}

/** A device row, reduced to what the embed reads. */
export interface EventsDeviceRow {
  readonly id: number
  readonly name?: string
  /**
   * Is this a CAMERA?
   *
   * Load-bearing, not decorative. `deviceManager.listAll` returns every device
   * — lights, switches, sensors, the lot — and the embed used to forward all of
   * them as `deviceIds`. The server's fan-out budget caps a page at
   * `floor(2000 / deviceCount)`, so on this deployment 318 devices bought a
   * page of SIX rows. Seventeen cameras buy 117.
   */
  readonly isCamera?: boolean
}

/** The ONE call the feed hook makes. The embed's full {@link EventsDataClient}
 *  satisfies it, and so does the app's adapter over its own tRPC client. */
export interface EventsFeedClient {
  /** The merged, slim track page. Returns the raw response — validated by the
   *  caller, because a hub older than this embed answers a different shape. */
  readonly listRecentTracks: (input: RecentTracksInput) => Promise<unknown>
}

export interface EventsDataClient extends EventsFeedClient {
  /** Every device the token can see. Used for names and for the "all cameras"
   *  default (`deviceIds: []`), which has to be RESOLVED: `listRecentTracks`
   *  answers `[]` for an empty device list. */
  readonly listDevices: () => Promise<readonly EventsDeviceRow[]>
  /** CLIP text search over object events, scored. Raw — validated by the caller. */
  readonly searchObjectEvents: (input: SearchObjectEventsInput) => Promise<unknown>
  /**
   * The event-kind vocabulary per camera — the class→macro taxonomy source.
   * Raw, and allowed to FAIL: an empty taxonomy narrows the class filter to an
   * exact-id compare, which is worse but never empty.
   */
  readonly listEventKinds: (deviceIds: number[]) => Promise<unknown>
}
