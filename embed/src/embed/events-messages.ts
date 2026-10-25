/**
 * events-messages — the VERSIONED host↔embed protocol of the events embed.
 *
 * Transport is the shared one (`host-bridge.ts`): a native host receives
 * `ReactNativeWebView.postMessage(JSON)`, a web host receives
 * `parent.postMessage(object)`. Only the vocabulary lives here.
 *
 * Every OUTBOUND message carries `v: 1`. The grid protocol (`grid-messages.ts`)
 * predates versioning and cannot gain it without breaking shipped hosts; this
 * one is versioned from its first line so a host can branch on `v` instead of
 * probing for fields. Rule for v1: fields may be ADDED (a host ignores what it
 * does not know), never removed or retyped — that needs `v: 2`.
 *
 * ── embed → host ─────────────────────────────────────────────────────────────
 *   { v:1, type:'ready',        view, features }
 *   { v:1, type:'error',        message }
 *   { v:1, type:'state',        state:'loading'|'ready'|'empty'|'error', message? }
 *   { v:1, type:'trackClick',   trackId, deviceId, bestEventId, className,
 *                               firstSeen, lastSeen }
 *   { v:1, type:'trackList',    seq, tracks: [{ trackId, deviceId, bestEventId,
 *                               className, firstSeen, lastSeen }, …] }
 *   { v:1, type:'trackListDelta', seq, baseSeq, count,
 *                               prepend[], append[], removeIds[] }
 *   { v:1, type:'countChanged', loaded, shown, hasMore }
 *   { v:1, type:'scroll',       atTop }        (native-refresh arming, transitions only)
 *   { v:1, type:'refreshed' }                  (ack for a host-commanded refresh)
 *
 * ── host → embed ─────────────────────────────────────────────────────────────
 * Web: `parent.postMessage({ type:'embed-command', command }, '*')`.
 * Native: call `window.__camstackEvents.<fn>(…)` from injected JS.
 *   { type:'setConfig', patch }   patch = EventsConfigPatch (validated)
 *   { type:'setWindow', sinceMs?, untilMs? }   day navigation; null CLEARS
 *   { type:'refresh' }            force an immediate DELTA refresh
 *   { type:'reload' }             drop the feed and re-page from the top
 *   { type:'loadMore' }           request the next page now
 *   { type:'scrollToTop' }
 *   { type:'setTrackFlagPatches', patches }  overlay host-written flags
 *                               onto already-loaded rows (not a refetch)
 *   { type:'setTrackListMode', mode }  'delta' ⇒ the host ACCUMULATES the row
 *                               collection from `trackListDelta` messages; also
 *                               forces a fresh full baseline (a resync)
 */

import { z } from 'zod'
import { type EventsConfigPatch, type EventsView, eventsConfigPatchSchema } from './events-config'
import { emitHost } from './host-bridge'

/** Protocol version stamped on every outbound message. */
export const EVENTS_PROTOCOL_VERSION = 1

/**
 * What this build of the embed can do, announced on `ready`.
 *
 * The version stayed at 1 because every capability below is ADDITIVE — a host
 * that sends none of them gets byte-identical behaviour, which is exactly the
 * condition v1 declared for adding fields. Bumping to 2 would tell hosts to
 * branch on `v` for a break that does not exist.
 *
 * But "additive" is not the same as "discoverable": a viewer build can outrun
 * the DEPLOYED embed (they ship on different chains, and this repo has been
 * bitten by that twice). A host that wants day navigation should be able to ask
 * whether the page it just loaded has it, rather than sending a command into
 * silence. That is what this list is for.
 */
export const EVENTS_FEATURES = [
  /** `sinceMs`/`untilMs` config + the `setWindow` command (day navigation). */
  'window',
  /** `searchMode: 'semantic'` — CLIP passthrough. */
  'semantic-search',
  /** Class filter + free text expand through the server's kind taxonomy. */
  'macro-classes',
  /** `deviceNames` config + the `names=` URL param (host-side renames). */
  'device-names',
  /** `kindLabels` config: the host's TRANSLATED event taxonomy, so the class
   *  and sub-class on a card are rendered in the host's language. */
  'kind-labels',
  /** Host ping → embed heartbeat, used to recover a frozen WebView. */
  'heartbeat',
  /** `trackList` messages: the ORDERED shown rows, so a host detail view can
   *  offer prev/next without owning a feed of its own. */
  'track-list',
  /** `attrs` config: the per-track Faces / Plates filter axis. */
  'attr-filters',
  /** `filterDebug` / `filterTrain` / `filterFavourited` operator-flag chips. */
  'flag-filters',
  /** Host-local `reviewedTrackIds` — debug tracks already analyzed. */
  'debug-status',
  /**
   * The native-host pull-to-refresh handoff: `nativePullToRefresh` config (the
   * host draws the gesture, the embed's internal one stands down), `scroll`
   * messages (at-top transitions, so the host arms its RefreshControl only when
   * a pull cannot steal a mid-list scroll) and the `refreshed` ack (so the
   * host's spinner has something to close on).
   */
  'native-pull-refresh',
  /**
   * `trackListDelta` messages + the `setTrackListMode` command: the host can
   * ASK to be sent only what CHANGED and accumulate the collection itself.
   *
   * Announced, never assumed. The full `trackList` stays the default and is
   * what a host that never sends the command keeps receiving — see
   * {@link publishTrackList} for the two modes and `events-track-list.ts` for
   * why the delta is refused unless the host can rebuild the list exactly.
   */
  'track-list-delta',
] as const
export type EventsFeature = (typeof EVENTS_FEATURES)[number]

export type EventsReportState = 'loading' | 'ready' | 'empty' | 'error'

export type EventsHostMessage =
  | {
      readonly v: 1
      readonly type: 'ready'
      readonly view: EventsView
      /** See {@link EVENTS_FEATURES}. Absent on an embed older than this. */
      readonly features: readonly EventsFeature[]
    }
  | { readonly v: 1; readonly type: 'error'; readonly message: string }
  | {
      readonly v: 1
      readonly type: 'state'
      readonly state: EventsReportState
      readonly message?: string
    }
  | {
      readonly v: 1
      readonly type: 'trackClick'
      readonly trackId: string
      readonly deviceId: number
      /** The id the event-media plane resolves this track's crop against —
       *  `bestEventId` when the track produced object events, else the trackId. */
      readonly bestEventId: string
      readonly className: string
      readonly firstSeen: number
      readonly lastSeen: number
    }
  | {
      readonly v: 1
      readonly type: 'trackList'
      /** The shown rows IN DISPLAY ORDER — the collection a host detail view
       *  navigates with prev/next. Same per-row fields as `trackClick`. */
      readonly tracks: readonly TrackClickPayload[]
      /**
       * Sequence number of the collection this message ESTABLISHES.
       *
       * A full list is unconditional: whatever the host held, it now holds
       * this, at this `seq`. That makes it the resync primitive — every
       * `trackListDelta` names the `seq` it applies to, so a host that missed
       * one can tell, and one full list puts it back in step.
       *
       * Added in the delta revision; ADDITIVE, so an older host that reads
       * only `tracks` is unaffected (v1 rule).
       */
      readonly seq: number
    }
  /**
   * What CHANGED since {@link baseSeq} — sent only to a host that asked for it
   * (`setTrackListMode: 'delta'`).
   *
   * Applied as `prepend ++ held.filter(id ∉ removeIds) ++ append`, in that
   * order, and the result must be exactly {@link count} rows long. Those two
   * checks are the whole drift story: `baseSeq` catches a LOST message, `count`
   * catches a MISAPPLIED one, and either failure makes the host drop the
   * collection rather than navigate it.
   *
   * The embed emits this only when it has VERIFIED that the reconstruction
   * equals the list on screen; anything it cannot express that way (a reorder,
   * a sort change, a new day) is a full `trackList` instead.
   */
  | {
      readonly v: 1
      readonly type: 'trackListDelta'
      /** The collection's sequence number AFTER applying this delta. */
      readonly seq: number
      /** The `seq` the host must already hold. Mismatch ⇒ it lost a message. */
      readonly baseSeq: number
      /** New rows at the HEAD, in display order (the incremental refresh). */
      readonly prepend: readonly TrackClickPayload[]
      /** New rows at the TAIL, in display order (an appended page). */
      readonly append: readonly TrackClickPayload[]
      /** Ids removed from ANYWHERE in the held collection. A track whose
       *  `lastSeen` advanced moves to the head: that is a remove plus a
       *  prepend, and without this the move would force a full list. */
      readonly removeIds: readonly string[]
      /** Length of the collection after applying. The host's checksum. */
      readonly count: number
    }
  | {
      readonly v: 1
      readonly type: 'countChanged'
      /** Rows loaded from the server across every page. */
      readonly loaded: number
      /** Rows surviving the client-side class / text filters — what is on screen. */
      readonly shown: number
      /** More pages exist AND the memory ceiling has not been reached. */
      readonly hasMore: boolean
      /** Which feed produced these rows. `semantic` means the counts describe
       *  CLIP hits, not a paged window — `hasMore` is always false there. */
      readonly mode: 'feed' | 'semantic'
    }
  | { readonly v: 1; readonly type: 'heartbeat' }
  | {
      readonly v: 1
      readonly type: 'scroll'
      /**
       * A native pull-to-refresh may arm NOW: the embed's own scroller is at
       * the top of a gallery feed (semantic results excluded — they are a
       * complete set, not a feed). Emitted on TRANSITIONS only, and only when
       * the host enabled `nativePullToRefresh` — this is the knowledge the
       * use-pull-to-refresh module note used to say a native host could never
       * have.
       */
      readonly atTop: boolean
    }
  /** A host-commanded `refresh` settled (success or not) — the ack a native
   *  RefreshControl closes its spinner on. */
  | { readonly v: 1; readonly type: 'refreshed' }

export interface TrackClickPayload {
  readonly trackId: string
  readonly deviceId: number
  readonly bestEventId: string
  readonly className: string
  readonly firstSeen: number
  readonly lastSeen: number
  /**
   * WHY the host was asked to open this track.
   *
   * Absent is the ordinary tap on a card: open the detail, let the operator
   * look. `assign-face` is the "?" chip — a card that says a face is waiting
   * for a name, tapped ON the thing that says so. Opening the detail and
   * making the operator find the assignment again answers a question they
   * already asked.
   *
   * An intent the host does not understand must behave like a plain open, so
   * an older viewer paired with a newer embed loses a shortcut rather than a
   * tap.
   */
  readonly intent?: 'assign-face'
}

export function eventsReadyMsg(view: EventsView): EventsHostMessage {
  return { v: EVENTS_PROTOCOL_VERSION, type: 'ready', view, features: [...EVENTS_FEATURES] }
}

export function eventsErrorMsg(message: string): EventsHostMessage {
  return { v: EVENTS_PROTOCOL_VERSION, type: 'error', message }
}

export function eventsStateMsg(state: EventsReportState, message?: string): EventsHostMessage {
  return message !== undefined
    ? { v: EVENTS_PROTOCOL_VERSION, type: 'state', state, message }
    : { v: EVENTS_PROTOCOL_VERSION, type: 'state', state }
}

export function trackClickMsg(payload: TrackClickPayload): EventsHostMessage {
  return { v: EVENTS_PROTOCOL_VERSION, type: 'trackClick', ...payload }
}

/**
 * The ORDERED shown rows — what a host detail view navigates with prev/next.
 *
 * Unconditional: it REPLACES whatever the host held, at `seq`. Sent on every
 * change to a host that never asked for deltas, and as the baseline / resync to
 * one that did.
 */
export function trackListMsg(
  tracks: readonly TrackClickPayload[],
  seq: number,
): EventsHostMessage {
  return { v: EVENTS_PROTOCOL_VERSION, type: 'trackList', tracks, seq }
}

/** The fields of a {@link EventsHostMessage} of type `trackListDelta`. */
export interface TrackListDeltaPayload {
  readonly seq: number
  readonly baseSeq: number
  readonly prepend: readonly TrackClickPayload[]
  readonly append: readonly TrackClickPayload[]
  readonly removeIds: readonly string[]
  readonly count: number
}

/** What CHANGED since `baseSeq`. See the `trackListDelta` member of
 *  {@link EventsHostMessage} for the apply order and the two drift checks. */
export function trackListDeltaMsg(payload: TrackListDeltaPayload): EventsHostMessage {
  return { v: EVENTS_PROTOCOL_VERSION, type: 'trackListDelta', ...payload }
}

export function countChangedMsg(
  loaded: number,
  shown: number,
  hasMore: boolean,
  mode: 'feed' | 'semantic' = 'feed',
): EventsHostMessage {
  return { v: EVENTS_PROTOCOL_VERSION, type: 'countChanged', loaded, shown, hasMore, mode }
}

export function eventsHeartbeatMsg(): EventsHostMessage {
  return { v: EVENTS_PROTOCOL_VERSION, type: 'heartbeat' }
}

/** The native-refresh arming report. See the `scroll` member of
 *  {@link EventsHostMessage}. */
export function eventsScrollMsg(atTop: boolean): EventsHostMessage {
  return { v: EVENTS_PROTOCOL_VERSION, type: 'scroll', atTop }
}

/** Ack for a host-commanded `refresh` — emitted when the delta settles. */
export function eventsRefreshedMsg(): EventsHostMessage {
  return { v: EVENTS_PROTOCOL_VERSION, type: 'refreshed' }
}

/** Post a message to the host (native bridge or parent frame). No-op outside both. */
export function postToEventsHost(msg: EventsHostMessage): void {
  emitHost(msg)
}

/**
 * Emit a diagnostic on the SHARED host log channel (`type:'log'`, the same one
 * the player and recording pages use — the host forwards it to the hub's
 * client-log ingest). Not part of the versioned protocol: a host that does not
 * handle logs ignores it, and no embed behaviour depends on it.
 *
 * Used for the branches that would otherwise DROP work in silence — a page
 * request that failed, a delta that hit its drain bound. Silence reads as
 * "never happened".
 */
export function eventsLog(
  msg: string,
  data?: Record<string, unknown>,
  scope: 'feed' | 'media' = 'feed',
): void {
  emitHost({ type: 'log', scope, msg, ...(data !== undefined ? { data } : {}) })
}

// ── host → embed commands ───────────────────────────────────────────────────

export type EventsCommand =
  | { readonly type: 'setConfig'; readonly patch: EventsConfigPatch }
  | {
      readonly type: 'setWindow'
      /** `null` clears the bound (back to the rolling window); omitted leaves
       *  it untouched. The two are NOT the same and a day-nav host needs both. */
      readonly sinceMs?: number | null
      readonly untilMs?: number | null
    }
  | { readonly type: 'refresh' }
  | { readonly type: 'reload' }
  | { readonly type: 'loadMore' }
  | { readonly type: 'scrollToTop' }
  | { readonly type: 'ping' }
  /** Host-written operator flags for rows already in the feed. Replaces the
   *  overlay dictionary (not merged per key): a flag the host dropped must
   *  be able to disappear, which a merge could never express. */
  | {
      readonly type: 'setTrackFlagPatches'
      readonly patches: Readonly<Record<string, EventsTrackFlagPatch>>
    }
  /**
   * How the host wants the ordered row collection delivered.
   *
   * `delta` says "I accumulate": the embed may answer a change with a
   * `trackListDelta` naming only what moved. `full` (the DEFAULT, and what a
   * host that never sends this gets forever) says "send me the whole list".
   *
   * Receiving it ALWAYS posts a fresh full `trackList` at a new `seq`, so the
   * same command is also the resync: a host that detected drift re-sends it and
   * is back in step in one round trip.
   */
  | { readonly type: 'setTrackListMode'; readonly mode: TrackListMode }

/** How the ordered row collection is delivered. See the `setTrackListMode`
 *  member of {@link EventsCommand}. */
export const trackListModeSchema = z.enum(['full', 'delta'])
export type TrackListMode = z.infer<typeof trackListModeSchema>

const trackFlagPatchSchema = z.object({
  debug: z.boolean().optional(),
  markForTrain: z.boolean().optional(),
  favourited: z.boolean().optional(),
})
export type EventsTrackFlagPatch = z.infer<typeof trackFlagPatchSchema>
const trackFlagPatchesSchema = z.record(z.string(), trackFlagPatchSchema)

/**
 * Validate an untrusted host command. Returns null for anything unrecognised —
 * a host running ahead of a deployed embed must be IGNORED, never crash the
 * page, and never partially applied.
 */
export function parseEventsCommand(raw: unknown): EventsCommand | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  const type = obj.type
  if (
    type === 'refresh' ||
    type === 'reload' ||
    type === 'loadMore' ||
    type === 'scrollToTop' ||
    type === 'ping'
  ) {
    return { type }
  }
  if (type === 'setWindow') {
    const parsed = setWindowSchema.safeParse(obj)
    if (!parsed.success) return null
    return {
      type: 'setWindow',
      ...(parsed.data.sinceMs !== undefined ? { sinceMs: parsed.data.sinceMs } : {}),
      ...(parsed.data.untilMs !== undefined ? { untilMs: parsed.data.untilMs } : {}),
    }
  }
  if (type === 'setTrackListMode') {
    const parsed = trackListModeSchema.safeParse(obj.mode)
    if (!parsed.success) return null
    return { type: 'setTrackListMode', mode: parsed.data }
  }
  if (type === 'setTrackFlagPatches') {
    const parsed = trackFlagPatchesSchema.safeParse(obj.patches)
    if (!parsed.success) return null
    return { type: 'setTrackFlagPatches', patches: parsed.data }
  }
  if (type !== 'setConfig') return null
  const parsed = eventsConfigPatchSchema.safeParse(obj.patch)
  if (!parsed.success) return null
  return { type: 'setConfig', patch: parsed.data }
}

/** `setWindow` is sugar over the two config bounds — same validation, same
 *  null-clears-it rule, so the two entry points cannot drift. */
const setWindowSchema = z.object({
  sinceMs: z.number().int().nonnegative().nullable().optional(),
  untilMs: z.number().int().nonnegative().nullable().optional(),
})

/** The config patch a `setWindow` command means. One conversion, so the command
 *  and `setConfig({sinceMs, untilMs})` can never disagree. */
export function windowCommandToPatch(command: {
  readonly sinceMs?: number | null
  readonly untilMs?: number | null
}): EventsConfigPatch {
  return {
    ...(command.sinceMs !== undefined ? { sinceMs: command.sinceMs } : {}),
    ...(command.untilMs !== undefined ? { untilMs: command.untilMs } : {}),
  }
}
