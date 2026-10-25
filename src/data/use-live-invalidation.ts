/**
 * One subscription set for the whole app, driving the cache instead of polls.
 *
 * ## Why this replaces polling
 *
 * Every device-shaped query had its own `refetchInterval`: the camera list every
 * 10 s, accessory states every 12 s, cap statuses, linked devices, battery. On a
 * ten-camera install that is a steady stream of tRPC calls over a single
 * WebSocket — the client has no batching link — for data that changes a handful
 * of times a day and that the hub already ANNOUNCES.
 *
 * `device.state-changed` exists precisely for this; its own definition says
 * subscribers react "without polling `getStatus`". So the events drive the
 * cache, and the polls become a slow reconcile rather than the mechanism.
 *
 * ## Why the polls are not deleted outright
 *
 * [D8](../../../docs/decisions/adr-0008.md): events are TELEMETRY and may be
 * dropped. If loss would corrupt durable state, use an RPC — or an event plus an
 * RPC reconcile. This is the second form. It is not belt-and-braces caution:
 * `device.state-changed` from a forked child DID fail to reach other
 * forks when the DeviceProxy listened on `live.onEvent` (a hub tRPC
 * subscription that never declared UDS interest). That path is now
 * `ctx.eventBus`. This reconcile is still the D8 backstop for a dropped
 * event — not a substitute for a missing fan-out.
 *
 * So the reconcile interval is long (minutes, not seconds) — cheap enough to be
 * invisible on the wire, frequent enough that a dropped event self-heals well
 * before anyone files a bug.
 *
 * ## Why one subscription, not one per consumer
 *
 * `subscribeEvent` opens a tRPC subscription per call. A per-card hook therefore
 * opened N server-side subscriptions for ONE event stream. This mounts once and
 * fans out through the query cache.
 *
 * ## Why the fan-out is debounced
 *
 * An event is not a refetch trigger, it is a hint that state MOVED. The hub
 * emits one per device per slice, so a cold start delivers thousands in
 * seconds. Coalescing lives in `invalidation-debounce.ts` (with the measured
 * numbers); this file only decides WHAT each category touches.
 */

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useConnection } from '../connection/ConnectionProvider.js'
import { log } from '../lib/logger.js'
import {
  refreshEventsFeeds,
  reloadEventsFeeds,
} from '../events/events-feed-registry.js'
import {
  createInvalidationDebouncer,
  INVALIDATION_DEBOUNCE_MS,
} from './invalidation-debounce.js'
import { isDeviceStatusChange, readEventField } from './device-status-event.js'
import { BADGE_CAPS } from './use-camera-badges.js'

/**
 * Query key prefixes a `pipeline-analytics.track-lifecycle` event invalidates,
 * by `phase`.
 *
 * `start`/`end` — a row appearing or sealing — used to schedule ONLY
 * `device-tracks` + `events`: the live tail that makes a new track show up as
 * a CARD. It never touched `analytics/activity` (`useTimelineActivity`, which
 * feeds clips-mode's `deriveClipsFromClusters` — a cluster with no overlapping
 * `recording` coverage is dropped, never shown as a clip) or
 * `recording/availability` (`useRecordingAvailability`, which gates the
 * cluster detail's "go to this moment" seek affordance via
 * `recordingKnownAt`). Neither of those two queries carries a
 * `refetchInterval` or any other live channel of its own — they refresh ONLY
 * when their query key changes (a new day, a lookback extension) or on an
 * explicit manual retry.
 *
 * So a video could go LIVE — visible as a track/event card the instant it
 * started or ended — and never become WATCHABLE for as long as the camera
 * screen stayed open on the same day/window: exactly "the newest available
 * videos are not watchable" (2026-08-26 operator report). `update` stays
 * excluded, same rule as `device-tracks`: it is too chatty to invalidate on.
 */
export function trackLifecycleInvalidationKeys(
  phase: unknown,
): readonly (readonly string[])[] {
  if (phase !== 'start' && phase !== 'end') return []
  return [
    ['v2', 'analytics', 'device-tracks'],
    ['v2', 'events'],
    ['v2', 'analytics', 'activity'],
    ['v2', 'recording', 'availability'],
  ]
}

/** The generic per-device runtime-state category. Subscribed twice: once
 *  through the map below for the caps whose slices the accessory surfaces
 *  read, and once payload-FILTERED for the liveness slice (see the dedicated
 *  subscription further down). */
const DEVICE_STATE_CHANGED = 'device.state-changed'

/** Caps whose slices `use-children-states` reads off a camera's children. */
const CHILD_STATE_CAPS: ReadonlySet<string> = new Set(['switch', 'motion-trigger'])

/**
 * Caps that tick at telemetry rate and whose slices only the pinned live
 * readouts draw. `audio-metrics` (the dB meter) was 243 of 267 state events in a
 * 20 s sample of the live hub.
 */
const TELEMETRY_CAPS: ReadonlySet<string> = new Set(['audio-metrics'])

const BADGE_CAP_SET: ReadonlySet<string> = new Set(BADGE_CAPS)

/**
 * The query key prefixes ONE `device.state-changed` event invalidates, by the
 * cap whose slice moved.
 *
 * This used to be a static entry: every slice write anywhere invalidated
 * `children-states` (one `getChildren` + a `getStatus` fan-out PER CAMERA on the
 * screen), the badge aggregate, accessories, linked devices, cap status and the
 * live readouts. The hub emits ~13 of these a second, almost all dB ticks, so the
 * 300 ms trailing debounce kept firing and the Cameras screen re-sent 32
 * `getChildren` + a badge batch every ~0.5 s for as long as it was open — the
 * WebSocket that also carries snapshot links and WebRTC signalling never went
 * quiet (hosted PWA trace, 2026-10-06). Each query is now invalidated only by the
 * caps it actually reads. An event without a cap name keeps the old broad
 * fan-out: not knowing what moved is not the same as knowing it is irrelevant.
 */
export function deviceStateInvalidationKeys(event: unknown): readonly (readonly string[])[] {
  const capName = readEventField(event, 'capName')
  const known = typeof capName === 'string' && capName.length > 0 ? capName : null
  // The pinned live readouts (dB, °C, lux) drawn over a camera picture: every
  // one IS a sensor cap's `getStatus` slice, so any slice write may move one.
  // Added 2026-08-21 with the demotion of `LIVE_FIELDS_POLL_MS` to
  // `RECONCILE_MS`; without it a chip would move once every five minutes.
  const keys: (readonly string[])[] = [['v2', 'device-live-fields']]
  if (known === null || CHILD_STATE_CAPS.has(known)) keys.push(['v2', 'children-states'])
  // The badges aggregate carries the slice-backed values (recording mode,
  // battery, link) — a slice write IS the event the dot/moon must follow, or
  // they only move on the aggregate's 5-minute reconcile.
  if (known === null || BADGE_CAP_SET.has(known)) keys.push(['v2', 'camera-badges'])
  if (known === null || !TELEMETRY_CAPS.has(known)) {
    keys.push(['v2', 'accessories'], ['v2', 'cap-status'], ['v2', 'linked-devices'])
  }
  return keys
}

/**
 * Hub event category → the query key prefixes it invalidates.
 *
 * Keys are PREFIXES: React Query matches partially, so `['v2','battery']`
 * invalidates every per-device battery entry without listing them.
 * `device.state-changed` is not here: its keys depend on the payload — see
 * {@link deviceStateInvalidationKeys}.
 */
const INVALIDATION_MAP: readonly (readonly [string, readonly (readonly string[])[]])[] = [
  // Membership / identity of the camera list itself.
  ['device.registered', [['v2', 'cameras']]],
  ['device.unregistered', [['v2', 'cameras']]],
  // `stream-broker`, the first per-camera function switch (D62), IS
  // `deviceManager.setDisabled` — so these two announce a switch flipped by
  // another client and must move the switch group with the camera list, or the
  // panel and the card will disagree about the same camera.
  ['device.enabled', [['v2', 'cameras'], ['v2', 'camera-switches']]],
  ['device.disabled', [['v2', 'cameras'], ['v2', 'camera-switches']]],
  // An operator-edited field: location, name, `disabled`, a container's primary
  // child. The camera list was already here; the DEVICE-RELATIONSHIP queries
  // were not, and they are exactly what a location edit moves — the auto-link
  // rule matches on location, so re-saving one container's room changes what
  // every camera in that room links to. Without these two entries the operator
  // changed a room on the hub and the panel kept its old companions until the
  // 30 s window lapsed or the panel remounted.
  [
    'device.meta-changed',
    [
      ['v2', 'cameras'],
      ['v2', 'linked-devices'],
      ['v2', 'accessories'],
    ],
  ],
  ['device.ready', [['v2', 'cameras']]],
  // A wrapper binding moved — the authority behind the detection and audio
  // switches. Announced by the hub for exactly this, and the admin UI's group
  // listens to the same category.
  ['capability.binding-changed', [['v2', 'camera-switches']]],
  // Frame occupancy gained or lost — added on the hub for exactly this, so the
  // "who is in frame" badge stops asking every four seconds.
  ['zone-analytics.occupancy-changed', [['v2', 'occupancy']]],
  // A parked object appeared or left. Occupancy-changed does NOT fire on
  // promotion (the frame total is unchanged), so this is the nudge the
  // stationary overlay used to poll every 15 s for.
  ['pipeline-analytics.stationary-changed', [['v2', 'occupancy']]],
  // A wall switch / remote fired. The `event-emitter` cap writes its slice AND
  // announces the press on its own category, which is what the accessory row
  // needs: a press is exactly the kind of instant that must not wait for the
  // slow D8 reconcile to appear.
  ['event-emitter.event', [['v2', 'cap-status']]],
  // A face was assigned, reassigned or detached — by ANY client. The face
  // catalogue is stale until it refetches. The TRACK surfaces are not on this
  // map at all: they are the hub-hosted embed, which owns its own feed and is
  // reloaded explicitly below (`reloadEventsFeeds`), not through the query
  // cache. The feed-key entry that used to sit alongside `faces` here belonged
  // to the onboard renderer, deleted 2026-08-18, and has had no producer since.
  ['pipeline-analytics.face-gallery-changed', [['v2', 'faces']]],
  // Charge / sleep transitions, announced by the battery cap itself.
  // `camera-badges` is the AGGREGATE the cards actually read — without it a
  // sleep/wake flip waited for the aggregate's 5-minute reconcile poll and
  // the moon badge read as "loaded once" (operator report, 2026-08-16).
  ['battery.onStatusChanged', [['v2', 'battery'], ['v2', 'camera-badges']]],
  ['battery.onWakeStarted', [['v2', 'battery'], ['v2', 'camera-badges']]],
]

/**
 * Mount ONCE, above the screens. Subscribes while connected and tears down on
 * disconnect — the SDK rebuilds its tRPC client on reconnect, so a subscription
 * held across that would be attached to a dead client.
 */
export function useLiveInvalidation(): void {
  const { controller, state } = useConnection()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (state !== 'connected') return
    const system = controller.getSystem()
    if (!system) return

    // One event does NOT mean one invalidation. `device.state-changed` arrives
    // per device per state slice, so a cold start is a burst: measured 18,924
    // dispatches of `['v2','children-states']` in 30 s. Two defaults turned that
    // into a stall rather than mere waste —
    //
    //   • `invalidateQueries` defaults to `cancelRefetch: true`, so every
    //     dispatch aborted and restarted the in-flight refetch of all 19
    //     observers on that prefix. The work was restarted faster than it could
    //     finish, so it never finished.
    //   • every one of those refetches shares the SDK's single tRPC WebSocket
    //     (one `wsLink`, no batching link), so the churn also took an unrelated
    //     50 ms `snapshot-overview` call to 6000 ms and pushed the snapshot
    //     paint gate out by seconds.
    //
    // So: coalesce per key (trailing, one invalidation per quiet window) and
    // never cancel work that is already on the wire. `refetchType: 'active'` is
    // explicit for the same reason — an unmounted observer has nothing on
    // screen to correct and can wait for its own next mount.
    const debouncer = createInvalidationDebouncer(INVALIDATION_DEBOUNCE_MS, (queryKey) => {
      void queryClient.invalidateQueries(
        { queryKey, refetchType: 'active' },
        { cancelRefetch: false },
      )
    })

    const unsubscribers = INVALIDATION_MAP.map(([category, keys]) =>
      system.subscribeEvent(category, () => {
        for (const queryKey of keys) debouncer.schedule(queryKey)
      }),
    )
    unsubscribers.push(
      system.subscribeEvent(DEVICE_STATE_CHANGED, (event: unknown) => {
        for (const queryKey of deviceStateInvalidationKeys(event)) debouncer.schedule(queryKey)
      }),
    )

    // A mounted events EMBED owns its own feed and hears nothing from the query
    // cache, so it needs the announcement directly. Subscribed here — the one
    // place already holding the app's single event subscription — rather than
    // from each surface, which would open one server subscription per embed.
    //
    // This is the half the local mutation cannot cover: a face assigned from
    // admin-ui, or from another device, reaches the operator's open feed only
    // through the hub. The mutation's own call stays as the D8 reconcile for
    // when the event is dropped; the registry coalesces the pair.
    unsubscribers.push(
      // A camera going offline or coming back has NO category of its own. The
      // cap declares `device-status.onStatusChanged` but nothing emits it; the
      // liveness flag travels as a `device-status` runtime slice, i.e. as one
      // value of the generic category above. Until this subscription existed,
      // `['v2','cameras']` had no live channel at all for `online` — the flag
      // moved only on the five-minute reconcile poll (parked while the app is
      // backgrounded) or a manual pull-to-refresh. Four cameras unplugged in
      // the evening were still listed in their old state the next morning.
      //
      // Filtered by cap name rather than added to the map: the unfiltered
      // category is a firehose (18,924 dispatches in 30 s at cold start) and
      // this one refetches the WHOLE device list.
      system.subscribeEvent(DEVICE_STATE_CHANGED, (event: unknown) => {
        if (!isDeviceStatusChange(event)) return
        debouncer.schedule(['v2', 'cameras'])
      }),
      system.subscribeEvent('pipeline-analytics.face-gallery-changed', (event: unknown) => {
        const kind = readEventField(event, 'kind')
        if (kind === 'buffered') {
          // A newly persisted face accompanies a new/updated track. Pull only
          // the head delta; the cards already visible remain mounted.
          refreshEventsFeeds('face-buffered')
          return
        }
        // Assignment/deletion can rewrite an older row without moving
        // `lastSeen`, so only these mutations require a full re-page.
        reloadEventsFeeds('face-gallery-changed')
      }),
      system.subscribeEvent('pipeline-analytics.track-lifecycle', (event: unknown) => {
        const phase = readEventField(event, 'phase')
        if (phase === 'end') {
          // `end` is the durable visibility point for the final track summary.
          refreshEventsFeeds('track-ended')
        }
        // See `trackLifecycleInvalidationKeys` — start/end also carries the
        // recording-availability reads that decide whether the new/sealed
        // track is WATCHABLE, not only whether it is listed.
        for (const key of trackLifecycleInvalidationKeys(phase)) debouncer.schedule(key)
      }),
    )
    log.debug('data', 'live invalidation armed', { categories: INVALIDATION_MAP.length })

    return () => {
      for (const off of unsubscribers) off()
      // Before the unsubscribes would be equally fine; after is the safer
      // order — no timer can outlive the effect, and a flush racing teardown
      // has already been cancelled.
      debouncer.dispose()
    }
  }, [controller, state, queryClient])
}
