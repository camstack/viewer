/**
 * The one cadence for "ask again in case an event was lost".
 *
 * Every device-shaped query used to carry its own short `refetchInterval` — the
 * camera list every 10 s, accessories every 12 s, motion every 2.5 s, occupancy
 * every 4 s. That was the mechanism by which the UI learned anything. It is now
 * the BACKSTOP: `use-live-invalidation.ts` subscribes once to the hub's events
 * and invalidates the matching queries, so a change reaches the screen when it
 * happens rather than up to an interval later.
 *
 * The polls are not deleted, and that is deliberate. Per
 * [D8](../../../docs/decisions/adr-0008.md) events are TELEMETRY and may be
 * dropped; if loss would corrupt state, the rule is an event PLUS an RPC
 * reconcile. This is that reconcile. It is not hypothetical caution:
 * `device.state-changed` from a forked child DID fail to reach other
 * forks when the DeviceProxy listened on `live.onEvent` (a hub tRPC
 * subscription that never declared UDS interest). That path is now
 * `ctx.eventBus`. This reconcile is still the D8 backstop for a dropped
 * event — not a substitute for a missing fan-out.
 *
 * Five minutes is chosen to be invisible on the wire — one call per query per
 * five minutes replaces up to 120 — while still healing a dropped event long
 * before a person would think to complain about it.
 */
export const RECONCILE_MS = 300_000

/**
 * **Every query that carries `refetchInterval: RECONCILE_MS` must also carry
 * `staleTime: RECONCILE_MS`.**
 *
 * Not a style preference — without it the design above does not hold. The
 * global default is `staleTime: 5000` (`src/app/query-client.ts`), so a query
 * that intends to be five minutes stale is considered stale after five
 * seconds: react-query refetches it on the next mount, and every tab re-entry
 * re-runs the whole per-camera fan-out over a WebSocket that does not batch.
 * The polls stop being a backstop and become the mechanism again, which is
 * exactly what this file exists to undo.
 *
 * Ten hooks were missing it (2026-08-05). The same rule applies to any other
 * cadence — pair `staleTime` with whatever interval the hook declares.
 */

/**
 * The cadence that USED to keep the parked-object overlay alive, before
 * `pipeline-analytics.stationary-changed` existed as a consumer of the
 * overlay. Kept exported so a wiring test can pin that the overlay no
 * longer asks for it. Five minutes is the D8 reconcile on
 * `useCurrentOccupancy`; the event is the mechanism.
 */
export const STATIONARY_POLL_MS = 15_000
