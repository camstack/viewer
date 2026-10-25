/**
 * lifecycle-trace — why the app comes back from the background stuck on
 * "loading".
 *
 * ## The report
 *
 * Open the app, background it, come back a while later: the socket does not
 * hold and the UI sits in a permanent loading state (operator, 2026-08-02).
 *
 * ## Why this is instrumentation and not a fix
 *
 * At the time of the report the connection layer had NO `AppState` awareness at
 * all — nothing observed foreground/background (it now does, through
 * `AppPhaseTracer` → `SystemController`) — so the obvious
 * story is "iOS suspends the app, the socket dies, nothing re-checks on
 * resume". That story is a guess, and at least three different faults produce
 * exactly the same symptom:
 *
 *  1. the socket is dead but no `disconnected` ever fires, so nothing triggers
 *     recovery (the controller re-races only via `handleStateChange`);
 *  2. `disconnected` fires and the re-race starts but never settles;
 *  3. the transport is fine and only the mirrored React state is stuck.
 *
 * Each needs a different fix, and the logs today cannot tell them apart —
 * there is not one line from the state machine. So: record the transitions and
 * the app-lifecycle changes on ONE timeline, then read it.
 *
 * These lines ship to the hub through the normal log pipeline, so a session on
 * a phone is readable from Loki afterwards.
 *
 * ## What to look for
 *
 * After a `foreground` line with a long `awayMs`:
 *  - NO connection line at all → fault 1: the socket died silently. The fix is
 *    an explicit liveness check on resume.
 *  - `disconnected` then nothing → fault 2: recovery starts and stalls; look at
 *    the race/probe.
 *  - `connected` while the UI still shows loading → fault 3: the mirror, not
 *    the transport.
 */
import { log } from '../lib/logger.js'
import { routeSummary, type RouteDescription } from './route-channel.js'
import {
  probeFailureHint,
  summariseProbe,
  type CandidateProbeResult,
} from './candidate-probe.js'

/** Scope for every line this module writes — one grep away. */
export const LIFECYCLE_SCOPE = 'conn:lifecycle'

export type AppPhase = 'foreground' | 'background'

export interface TransitionRecord {
  readonly from: string
  readonly to: string
  /** How long the previous state lasted. */
  readonly heldMs: number
}

/**
 * Track how long each state lasted. Pure and injectable so the sequencing is
 * testable without a socket or a phone.
 */
export class LifecycleTracker {
  private current: string
  private since: number
  private readonly now: () => number

  constructor(initial: string, now: () => number = () => Date.now()) {
    this.current = initial
    this.now = now
    this.since = this.now()
  }

  /** Record a transition. Returns null when the state did not actually change —
   *  the SDK re-emits the same state and repeats would drown the signal. */
  transition(to: string): TransitionRecord | null {
    if (to === this.current) return null
    const at = this.now()
    const record: TransitionRecord = { from: this.current, to, heldMs: at - this.since }
    this.current = to
    this.since = at
    return record
  }

  get state(): string {
    return this.current
  }

  /** How long the current state has been held. */
  heldMs(): number {
    return this.now() - this.since
  }
}

/**
 * Report a connection-state change. Silent on a no-op transition.
 *
 * `heldMs` is the number that matters most: a `connected` that held for hours
 * and then went `disconnected` the instant the app resumed is a different
 * story from one that flaps every few seconds.
 */
export function traceConnection(record: TransitionRecord | null, meta?: Record<string, unknown>): void {
  if (record === null) return
  log.info(LIFECYCLE_SCOPE, `connection ${record.from} → ${record.to}`, {
    from: record.from,
    to: record.to,
    heldMs: record.heldMs,
    ...meta,
  })
}

/**
 * Report an app foreground/background change, carrying how long the app was
 * away — the variable the operator's report hinges on ("riapro dopo un po'").
 */
export function traceAppPhase(phase: AppPhase, awayMs: number | null): void {
  log.info(LIFECYCLE_SCOPE, `app ${phase}`, { phase, awayMs })
}

/**
 * Report what a resume did to the transport.
 *
 * This is the line that resolves fault 1 above — "the socket died silently" —
 * from a guess into a measurement: `healthy` says the suspension was survived,
 * `rebuilt` says it was not and by how much the keep-alive would have been
 * late. Both ship; a resume that produced neither means the probe itself never
 * ran, which is its own finding.
 */
export function traceResumeProbe(
  outcome: string,
  meta?: Record<string, unknown>,
): void {
  log.info(LIFECYCLE_SCOPE, `resume probe ${outcome}`, { outcome, ...meta })
}

/** Report the outcome of an endpoint race, so a recovery that starts and never
 *  settles is visible as a start with no matching end. */
export function traceRace(stage: 'start' | 'won' | 'failed', meta?: Record<string, unknown>): void {
  log.info(LIFECYCLE_SCOPE, `race ${stage}`, { stage, ...meta })
}

/**
 * Report the route in use — WHICH endpoint, of WHAT nature, and WHY that one.
 *
 * The line the 2026-08-21 session did not have. Ninety minutes of logs from an
 * operator sitting on his own WiFi contained `race failed` three times and
 * `race won` never, so "am I on the LAN or on the public tunnel?" — a question
 * worth 3-4× on every request measured on this deployment — could not be
 * answered from them at all. Emitted on every pass, including the ones that
 * change nothing: a route that persists because nothing re-raced is exactly the
 * residue worth naming.
 */
export function traceRoute(route: RouteDescription): void {
  log.info(LIFECYCLE_SCOPE, `route ${routeSummary(route)}`, {
    url: route.url,
    host: route.host,
    channel: route.channel,
    endpointLabel: route.endpointLabel,
    reason: route.reason,
  })
}

/**
 * Report what ONE candidate did when probed on its own.
 *
 * `raceFastestEndpoint` is a `Promise.any` and discards every loser's reason,
 * which makes "the LAN endpoint presents a certificate this device will not
 * trust" and "the LAN endpoint is not routable from here" the same silence.
 * They are not the same problem and they do not have the same fix.
 */
export function traceCandidateProbe(meta: Record<string, unknown>): void {
  log.info(LIFECYCLE_SCOPE, 'candidate probe', meta)
}

/** One candidate's /health result, as a Settings-readable line.
 *  Failures are `warn` so they stand out next to the race winner. */
export function traceCandidateResult(
  result: CandidateProbeResult,
  meta?: Record<string, unknown>,
): void {
  const hint = probeFailureHint(result)
  const payload = { ...result, hint, ...meta }
  if (result.ok) log.info(LIFECYCLE_SCOPE, summariseProbe(result), payload)
  else log.warn(LIFECYCLE_SCOPE, summariseProbe(result), payload)
}

/** Health probe won, then the WebSocket to that URL died. The LAN pin's
 *  TestFlight shape: Settings shows "doesn't work" while /health was 200. */
export function traceSwitchDropped(url: string, pin: string | null): void {
  log.warn(LIFECYCLE_SCOPE, `switch then disconnected ${url}`, { url, pin })
}

/** Previous WS `onClose` after a successful `switchServerUrl`. Health still
 *  3/3; the new socket is up; treating this as offline disables every query. */
export function traceStaleSwitchClose(url: string, ageMs: number): void {
  log.info(LIFECYCLE_SCOPE, `ignored stale close after switch ${url}`, { url, ageMs })
}

/**
 * Report a deliberate departure: the app closed its own socket on the way into
 * the background (`background-suspend.ts`).
 *
 * The line answers, per session, the question the hub could otherwise only
 * answer by measuring a queue — did this client LEAVE, or did it stop reading
 * and say nothing until the keep-alive evicted it ~40 s later? `heldMs` is how
 * long the connection had been up when we let it go.
 */
export function traceBackgroundSuspend(outcome: string, meta?: Record<string, unknown>): void {
  log.info(LIFECYCLE_SCOPE, `background suspend ${outcome}`, { outcome, ...meta })
}

/**
 * Report the other end of that departure: what coming back did to the
 * transport, and how long the app was gone.
 *
 * `backgroundMs` is the number the hub-side story hinges on: a socket held
 * closed for two hours is the 88 MB that never accumulated.
 */
export function traceBackgroundResume(outcome: string, meta?: Record<string, unknown>): void {
  log.info(LIFECYCLE_SCOPE, `background resume ${outcome}`, { outcome, ...meta })
}
