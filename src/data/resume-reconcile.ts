/**
 * resume-reconcile — the client-side answer to "the app was away, what did it
 * miss?".
 *
 * ## The report this closes
 *
 * Four cameras were physically unplugged in the evening. The next morning the
 * app was resumed from the background and the Cameras tab still listed them in
 * their old state; only a manual pull-to-refresh corrected it (operator,
 * 2026-08-13).
 *
 * ## Why nothing recovered on its own
 *
 * Three gaps compound, and each one alone is survivable:
 *
 *  1. **The live channel does not carry `online` to the camera list.** A
 *     device's liveness reaches the hub as a `device-status` runtime-state
 *     slice, announced on the bus as `device.state-changed`. The client's
 *     invalidation map routed that category to the accessory/cap-status
 *     queries but NOT to `['v2','cameras']`, so the list's `online` flag was
 *     only ever corrected by its own five-minute reconcile poll. (Fixed
 *     alongside this module, in `use-live-invalidation.ts`.)
 *
 *  2. **A backgrounded app hears no events at all.** The WebSocket does not
 *     survive a long suspension, and every event emitted while it was down is
 *     gone — [D8](../../../docs/decisions/adr-0008.md) says events are
 *     telemetry and may be dropped, so a client that treats them as its only
 *     channel is wrong by construction. The RPC reconcile that D8 requires
 *     existed only as a five-minute POLL, and react-query parks intervals
 *     while unfocused: the poll had not run since the app was backgrounded.
 *
 *  3. **The one refetch that does fire on resume can be swallowed.**
 *     `focusManager` is wired to `AppState` (`app/query-focus.ts`), so the
 *     camera list refetches the instant the app comes back — which is
 *     precisely when the socket is dead or mid-reconnect. That attempt fails,
 *     and react-query's `Query.fetch` returns the IN-FLIGHT retryer promise to
 *     any later caller instead of starting a new request, so the recovery a
 *     reconnect would otherwise trigger is absorbed by the doomed one. After
 *     it settles, the next attempt is a full `RECONCILE_MS` away.
 *
 * ## The shape
 *
 * A resume, and a reconnection, each trigger ONE reconcile pass over the
 * volatile device-state keys — and the pass is retried, under a bound, until
 * it actually LANDS. "Landed" is checked against the camera list's
 * `dataUpdatedAt`, never against a signal that merely says a request was sent:
 * a fetch issued over a dying socket looks identical to a successful one right
 * up until it fails.
 *
 * ## The second report (operator, 2026-08-19), and what it changed
 *
 * The same symptom came back: three cameras that had come back online were
 * still listed offline on resume, until a manual pull-to-refresh.
 *
 * Gap 3 above has a race the first fix did not close. On resume the mirrored
 * connection state still says `connected` — nothing has yet told the client the
 * socket did not survive the suspension — so the pass is DISPATCHED rather than
 * deferred, and it goes into a black hole. What happens next is a stopwatch
 * problem:
 *
 *   • the doomed pass fails on the query deadline (12 s) plus one retry, so its
 *     outcome lands ~24 s after the resume;
 *   • the tRPC keep-alive notices the dead socket in ~16 s and the SDK dials a
 *     new one within a couple of seconds of that.
 *
 * So the reconnection arrives BEFORE the failure it is the cure for, at a
 * moment when the only evidence of trouble is a `lastRunAtMs` 18 seconds old —
 * which read as "we just reconciled" and was thrown away as throttled. The
 * state now records that a pass is OWED from the moment it is asked for, and
 * only a LANDED outcome clears it (see {@link ReconcileState.pending}).
 *
 * The other half of that fix is not here: waiting 16 s to find out the socket
 * is dead is itself the defect, and `connection/resume-probe.ts` closes it by
 * asking on the way back in.
 *
 * Everything here is pure and clock-injected; the wiring lives in
 * `use-resume-reconcile.ts` (which owns the `AppState` subscription and is
 * therefore not loadable in the node-env test suite).
 */

/** A react-query key PREFIX, as the invalidation map declares them. */
export type QueryKeyPrefix = readonly string[]

/**
 * The keys a resume/reconnect pass invalidates: device RUNTIME state, the
 * things that change while nobody is looking and that the app would otherwise
 * learn about only from an event it did not receive.
 *
 * Deliberately NOT here: the history feeds (`analytics`, `clips`, `recording`),
 * the identity/face catalogues and `event-kinds`. They are large, they are
 * paged, and a resume tells us nothing new about them — their own surfaces
 * refresh on their own triggers. Invalidating them here would turn every
 * app-switch into a re-page of everything the operator ever scrolled through.
 * The events surfaces are not query-cache clients at all any more: they are
 * the hub-hosted embed, refreshed through `events-feed-registry`.
 *
 * `refetchType: 'active'` at the call site keeps even this set to what is
 * actually mounted: on the Cameras tab that is the list, the badges and the
 * switch group — three calls, not a fan-out over every screen in the app.
 */
/**
 * The HEAD of a reconcile pass: the camera list. Its `dataUpdatedAt` is what
 * {@link reconcileLanded} measures, because it is both the surface the
 * operator reads first and the query every other one chains behind.
 *
 * Exported as a single frozen reference so the caller can dispatch the rest of
 * the set without invalidating this one twice (identity comparison — it is the
 * first entry of {@link VOLATILE_QUERY_KEYS}).
 */
export const RECONCILE_HEAD_KEY: QueryKeyPrefix = ['v2', 'cameras']

/**
 * Is `queryKey` under one of {@link VOLATILE_QUERY_KEYS}? A pass refetches the
 * volatile keys on purpose (awaiting the head) and then EVERY OTHER mounted
 * query: the screen in front of the operator — People, a rule, a timeline —
 * kept the answer it had when the app went away (or an error from a socket
 * that died under it) until a pull-to-refresh (operator, 2026-10-22). Pure.
 */
export function isVolatileQueryKey(queryKey: readonly unknown[]): boolean {
  return VOLATILE_QUERY_KEYS.some(
    (prefix) => prefix.length <= queryKey.length && prefix.every((part, i) => queryKey[i] === part),
  )
}

export const VOLATILE_QUERY_KEYS: readonly QueryKeyPrefix[] = [
  // The reported surface: membership AND the online flag.
  RECONCILE_HEAD_KEY,
  // Per-camera function switches (D62) — an operator can flip these from
  // another client while this one sleeps.
  ['v2', 'camera-switches'],
  // Battery / recording-mode aggregate behind the card badges.
  ['v2', 'camera-badges'],
  // Accessory children (sirens, floodlights, PIR) and their live slices.
  ['v2', 'children-states'],
  ['v2', 'accessories'],
  ['v2', 'cap-status'],
  ['v2', 'linked-devices'],
  ['v2', 'battery'],
  ['v2', 'device-live-fields'],
  // Who is in frame right now — the badge with no other push signal.
  ['v2', 'occupancy'],
  // Which frame each camera's thumbnail should point at. The image URLs are
  // cache-busted separately on foreground (`AppPhaseTracer`); this is the
  // freshness metadata those URLs are built from.
  ['v2', 'snapshot-overview'],
  ['v2', 'snapshot-links'],
]

/**
 * How long the app must have been away before a resume is worth a reconcile.
 *
 * Below this the socket almost certainly survived, which means the live
 * channel was never interrupted and there is nothing to catch up on. It also
 * keeps the iOS multitasking-switcher / notification-shade flicker
 * (`active` → `inactive` → `active`, often under a second) from costing a
 * round-trip per glance.
 */
export const RESUME_MIN_AWAY_MS = 10_000

/**
 * Floor on the gap between two passes, whatever triggered them. A flapping
 * socket emits `connected` repeatedly; without this, every flap would cost a
 * full pass.
 */
export const RECONCILE_MIN_GAP_MS = 20_000

/**
 * Bounded retry ladder for a pass that did not land.
 *
 * The first attempt on resume races the transport's own recovery and will
 * often lose it (see gap 3 above), so a single try is not enough — but an
 * unbounded retry over a hub that is genuinely unreachable is a battery leak.
 * Three attempts spanning ~23 s covers a WebSocket reconnect (exponential
 * backoff from the SDK's base delay) without becoming a poll; past that the
 * five-minute reconcile interval is the backstop, as it always was.
 */
export const RECONCILE_RETRY_DELAYS_MS: readonly number[] = [2_000, 6_000, 15_000]

/** Persistent decision state. Immutable — every decision returns a new copy. */
export interface ReconcileState {
  /** When the last pass was DISPATCHED. 0 = never. */
  readonly lastRunAtMs: number
  /**
   * A pass is OWED: one was asked for and has not LANDED yet.
   *
   * Armed by a resume — whether it deferred (transport down) or dispatched —
   * and cleared by exactly one thing: an outcome that landed. So it covers,
   * with one flag, every shape of "the state on screen is still the one the
   * operator was shown before the app went away":
   *
   *  - deferred, because the transport was down when they came back;
   *  - dispatched and STILL IN FLIGHT;
   *  - dispatched, failed, and out of retries.
   *
   * The middle one is why this is not simply `attempt > 0`. A pass issued over
   * a suspended socket takes the full query deadline plus its retry to fail —
   * longer than the SDK needs to notice the socket is dead and dial a new one.
   * So the reconnection routinely arrives BEFORE the outcome, i.e. before
   * `attempt` has been raised, and read the state of a pass that had already
   * failed as one that had already succeeded. It was thrown away by a throttle
   * clock the doomed pass itself had moved.
   */
  readonly pending: boolean
  /** How many consecutive retries have been spent on the current pass. */
  readonly attempt: number
}

export const INITIAL_RECONCILE_STATE: ReconcileState = {
  lastRunAtMs: 0,
  pending: false,
  attempt: 0,
}

/** What happened, for the log line. A pass that decides to do nothing still
 *  says so — a branch that silently drops work reads as "never happened". */
export type ReconcileReason =
  | 'run'
  | 'brief-away'
  | 'throttled'
  | 'deferred'
  | 'landed'
  | 'retry'
  | 'exhausted'
  | 'cold-start'

/** The app returned to the foreground. `awayMs` is null when no departure was
 *  recorded (a first foreground, or a listener attached mid-session). */
export interface ForegroundTrigger {
  readonly kind: 'foreground'
  readonly awayMs: number | null
  readonly connected: boolean
  readonly nowMs: number
}

/** The transport reached `connected` AFTER having been connected earlier in
 *  the session — i.e. a recovery, not the first dial. The caller is
 *  responsible for that distinction: a cold launch is already fetching
 *  everything and must not pay for a second pass. */
export interface ReconnectedTrigger {
  readonly kind: 'reconnected'
  readonly nowMs: number
}

/**
 * The transport reached `connected` for the FIRST time this session.
 *
 * Not a reconcile: a cold launch is already fetching every mounted query, and
 * the connect-time endpoint race deliberately tears the socket down and
 * rebuilds it (`SystemController.switchServerUrl`), so the boot sequence emits
 * a `connected` → `connecting` → `connected` echo within a second or two.
 * Without this the echo would read as a recovery and buy a second full pass on
 * top of the cold-launch waterfall. It arms the throttle clock instead — which
 * is the honest statement: everything was just fetched.
 */
export interface FirstConnectTrigger {
  readonly kind: 'first-connect'
  readonly nowMs: number
}

/** A scheduled retry fired. */
export interface RetryTrigger {
  readonly kind: 'retry'
  readonly nowMs: number
}

/** The result of a dispatched pass, measured on the data — not on the call. */
export interface OutcomeTrigger {
  readonly kind: 'outcome'
  readonly landed: boolean
  readonly nowMs: number
}

export type ReconcileTrigger =
  | ForegroundTrigger
  | ReconnectedTrigger
  | FirstConnectTrigger
  | RetryTrigger
  | OutcomeTrigger

export interface ReconcileDecision {
  /** Dispatch a pass now. */
  readonly run: boolean
  /** Schedule another attempt in this many ms, or null. */
  readonly retryInMs: number | null
  readonly reason: ReconcileReason
  /** The state to carry into the next decision. */
  readonly state: ReconcileState
}

/** Dispatch a pass. It stays OWED until an outcome says it landed — dispatching
 *  is not landing, and every fault this module exists for looks exactly like a
 *  dispatch that worked right up until it did not. */
function runNow(state: ReconcileState, nowMs: number, attempt: number): ReconcileDecision {
  return {
    run: true,
    retryInMs: null,
    reason: 'run',
    state: { lastRunAtMs: nowMs, pending: true, attempt },
  }
}

function skip(state: ReconcileState, reason: ReconcileReason): ReconcileDecision {
  return { run: false, retryInMs: null, reason, state }
}

function throttled(state: ReconcileState, nowMs: number): boolean {
  return state.lastRunAtMs > 0 && nowMs - state.lastRunAtMs < RECONCILE_MIN_GAP_MS
}

/**
 * Decide what a trigger should do. Pure: same state + same trigger → same
 * decision, and the input state is never mutated.
 */
export function decideReconcile(
  state: ReconcileState,
  trigger: ReconcileTrigger,
): ReconcileDecision {
  switch (trigger.kind) {
    case 'foreground': {
      if (trigger.awayMs !== null && trigger.awayMs < RESUME_MIN_AWAY_MS) {
        return skip(state, 'brief-away')
      }
      // NOT a skip: the reason we are here is that the transport is down and
      // the app has been away. Arm it so the reconnection owes us a pass — a
      // decision that gates on a channel being up must never be DROPPED
      // because the channel is down.
      if (!trigger.connected) {
        return { run: false, retryInMs: null, reason: 'deferred', state: { ...state, pending: true } }
      }
      if (throttled(state, trigger.nowMs)) return skip(state, 'throttled')
      return runNow(state, trigger.nowMs, 0)
    }
    case 'reconnected': {
      // A pass is OWED — deferred, in flight, or out of retries — and this is
      // the event it was waiting for. The throttle must not apply: its clock
      // was moved by the very failure we are recovering from.
      //
      // The cost of being wrong here is one `listAll` per reconnection on a
      // flapping socket, bounded by the SDK's own 2s→30s reconnect backoff. The
      // cost of the throttle winning is the report this module exists for: the
      // camera list still showing the state it had before the app went away,
      // until somebody pulls to refresh.
      if (state.pending) return runNow(state, trigger.nowMs, 0)
      if (throttled(state, trigger.nowMs)) return skip(state, 'throttled')
      return runNow(state, trigger.nowMs, 0)
    }
    case 'first-connect': {
      // A resume that happened while the app had never yet connected is still
      // owed its pass — the deferral outranks the cold-start bookkeeping.
      if (state.pending) return runNow(state, trigger.nowMs, 0)
      return {
        run: false,
        retryInMs: null,
        reason: 'cold-start',
        state: { ...state, lastRunAtMs: trigger.nowMs },
      }
    }
    case 'retry':
      // Already bounded by the ladder — a retry runs unconditionally and keeps
      // its place in the sequence.
      return runNow(state, trigger.nowMs, state.attempt)
    case 'outcome': {
      // The ONE thing that clears the debt. Everything else — a dispatch, a
      // retry, running out of retries — leaves it owed.
      if (trigger.landed) {
        return {
          run: false,
          retryInMs: null,
          reason: 'landed',
          state: { ...state, pending: false, attempt: 0 },
        }
      }
      const next = RECONCILE_RETRY_DELAYS_MS[state.attempt]
      if (next === undefined) {
        // Out of retries, still owed: the ladder covers a WebSocket reconnect,
        // and past that the next transport recovery is the honest next chance.
        // Resetting `attempt` only resets the ladder for that recovery.
        return { run: false, retryInMs: null, reason: 'exhausted', state: { ...state, attempt: 0 } }
      }
      return {
        run: false,
        retryInMs: next,
        reason: 'retry',
        state: { ...state, attempt: state.attempt + 1 },
      }
    }
  }
}

/** Inputs to the "did the pass land" question. */
export interface LandedInput {
  /** `dataUpdatedAt` of the camera-list query after the pass settled. */
  readonly dataUpdatedAt: number | undefined
  /** When the pass was dispatched. */
  readonly startedAtMs: number
  /** Whether anything is currently observing the query. */
  readonly observed: boolean
}

/**
 * Did the pass actually produce fresh data?
 *
 * Gated on the DATA moving, not on the request being issued: an invalidation
 * dispatched over a dying socket is indistinguishable from a successful one
 * until it fails. An unobserved query is reported landed — `refetchType:
 * 'active'` deliberately does not refetch it, and there is no screen showing a
 * stale value to correct.
 */
export function reconcileLanded(input: LandedInput): boolean {
  if (!input.observed) return true
  return input.dataUpdatedAt !== undefined && input.dataUpdatedAt >= input.startedAtMs
}
