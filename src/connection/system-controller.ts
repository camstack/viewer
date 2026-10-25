import { createSystem, type System } from '@camstack/sdk'
import { isUnauthorizedError } from '../auth/unauthorized.js'
import { watchSessionEndedClose } from '../auth/session-ended.js'
import { shouldRerace, isStaleSwitchClose, type ConnState } from './recheck-policy.js'
import {
  decideResumeProbe,
  RESUME_PROBE_DEADLINE_MS,
  type ResumeProbeOutcome,
} from './resume-probe.js'
import {
  decideBackgroundSuspend,
  decideForegroundAction,
  type BackgroundResumeOutcome,
  type SuspendDecision,
} from './background-suspend.js'
import {
  LifecycleTracker,
  traceBackgroundResume,
  traceBackgroundSuspend,
  traceCandidateProbe,
  traceCandidateResult,
  traceConnection,
  traceRace,
  traceResumeProbe,
    traceRoute,
    traceStaleSwitchClose,
    traceSwitchDropped,
} from './lifecycle-trace.js'
import { markBoot } from './boot-timeline.js'
import { hubLanguage } from './hub-language.js'
import {
  classifySecureTwinFailure,
  probeCandidates,
  raceCandidates,
  type CandidateProbeDeps,
  type CandidateProbeResult,
  type CandidateRaceOutcome,
} from './candidate-probe.js'
import {
  describeRoute,
  normaliseBaseUrl,
  type RouteDescription,
  type RouteReason,
} from './route-channel.js'
// A pure module (no react, no react-native, no provider) — the same bound the
// data layer puts on a hub that never answers, reused rather than rewritten.
import { withQueryDeadline } from '../data/query-deadline.js'
import {
  currentPageProtocol,
  discoverEndpoints,
  dropMixedContentUrls,
  dropUnverifiedPortEndpoints,
  endpointsToCandidates,
  isIpv6Url,
  isMixedContentUrl,
  parsePortScheme,
  type DiscoveredEndpoint,
  type PortTrust,
  withSecureLanTwins,
} from './endpoint-discovery.js'

const RACE_TIMEOUT_MS = 1500

/** Why a pin was refused: plain http on an https page, or an IPv6 URL the hub never advertised. */
export type PinRefusal = 'mixed-content' | 'unknown-ipv6'

/** What `setPinnedRouteUrl` did with the operator's choice. */
export type PinRouteOutcome =
  | { readonly kind: 'applied' }
  | { readonly kind: 'refused'; readonly reason: PinRefusal }

/**
 * What a return to the foreground did — the two halves of the same question,
 * under one name because the caller asks it once. `ResumeProbeOutcome` covers
 * a socket we did not close; `BackgroundResumeOutcome` covers one we did.
 */
export type ForegroundOutcome = ResumeProbeOutcome | BackgroundResumeOutcome


export interface SystemControllerConfig {
  readonly serverUrl: string
  readonly token?: string
  /** LAN-first candidate base URLs to race for the fastest control-plane route.
   *  Seeded from the last session's persisted hub endpoints (plus `serverUrl`). */
  readonly candidates: readonly string[]
  /**
   * Operator-forced base URL. When set, the race offers only this URL
   * (the tunnel/LAN auto-pick is skipped). `null` / omitted = automatic.
   */
  readonly pinnedRouteUrl?: string | null
  /**
   * Called after each successful endpoint probe with the hub's freshly-advertised
   * endpoints. The host persists them (so next launch seeds the race) and surfaces
   * them in Settings. Never called with an empty list (no probe → no callback).
   */
  readonly onEndpointsDiscovered?: (endpoints: readonly DiscoveredEndpoint[]) => void
  /**
   * The candidate race, injectable.
   *
   * The controller's other I/O already arrives through seams; this one exists
   * because the race is now OURS rather than the SDK's, and a test that has to
   * stub global `fetch` to exercise a routing decision ends up asserting on the
   * number of HTTP calls a race happens to make instead of on the decision.
   * Defaults to the real prober against `/health`.
   */
  readonly raceCandidatesImpl?: (
    urls: readonly string[],
    timeoutMs: number,
  ) => Promise<CandidateRaceOutcome>
  /** Test seam. Production uses `Date.now`. */
  readonly now?: () => number
  /**
   * The serving page's protocol, `null` off-browser. Omitted = read from
   * `location`. From an `https:` page no plain-`http:` candidate is raced or
   * pinned — see `isMixedContentUrl`.
   */
  readonly pageProtocol?: string | null
}

/** Owns the live `System` transport: creates it for the active server, then
 *  continuously evaluates the fastest route (LAN vs remote) and pivots the
 *  transport onto the winner — on connect and on every connection recovery. It
 *  also probes the hub for its advertised endpoints and folds new LAN routes
 *  into the candidate set automatically. */
export class SystemController {
  private system: System | null = null
  /** Stops the session-ended watch on the socket it was attached to. */
  private socketWatch: { readonly client: object; readonly stop: () => void } | null = null
  private prevState: ConnState = 'connecting'
  /** Timeline of state changes — the connection layer wrote no logs at all,
   *  which is why "comes back from background stuck on loading" could not be
   *  told apart from three different faults. See `lifecycle-trace.ts`. */
  private readonly tracker = new LifecycleTracker('connecting')
  /** Live candidate set — seeded from config, grown by endpoint discovery. */
  private candidates: string[]
  /** The in-flight route-optimisation pass, or null. Single-flight: a recovery
   *  that lands while the connect-time pass is still running joins it. */
  private routePass: Promise<void> | null = null
  /** Secure-twin candidates whose failure was already logged this session. */
  private readonly loggedSecureTwinFailures = new Set<string>()
  /** True between OUR `switchServerUrl` and the `connected` it produces. The
   *  SDK cannot tell the host "this drop was yours", so we remember. */
  private selfSwitchPending = false
  /** Wallclock of the `connected` echo from our last switch. The previous
   *  socket's `onClose` arrives after that echo and must not flip us offline. */
  private selfSwitchConnectedAtMs: number | null = null
  /** Last endpoints the hub advertised — what turns a URL into a NAMED channel
   *  ("LAN — eth0", "Public tunnel") instead of a string to squint at. */
  private lastEndpoints: readonly DiscoveredEndpoint[] = []
  /** Operator pin; `null` means the usual fastest-wins race. */
  private pinnedRouteUrl: string | null
  /** `https:` on the hosted PWA, `null` on native. See `isMixedContentUrl`. */
  private readonly pageProtocol: string | null
  /**
   * The route in use, and WHY.
   *
   * Seeded with the configured URL and `initial` rather than left null: the app
   * is on a route from the first request, and a null here would make the window
   * before the first race — the slowest part of a cold launch — the one window
   * with no answer.
   */
  private route: RouteDescription

  /**
   * True between OUR background close and the foreground that reopens it.
   *
   * The same idea as `selfSwitchPending`: the SDK cannot tell the host "this
   * drop was yours", so we remember. While it is set, transport events are
   * recorded and NOT surfaced — the app has no socket because it decided not
   * to, and a `disconnected` here would arm the offline banner for a departure
   * the operator made on purpose.
   */
  private suspended = false
  /** When that close happened — `backgroundMs` on the resume line. */
  private suspendedAtMs: number | null = null

  /** Optional observer of connection-state changes (e.g. to mirror into React
   *  state). Part of the public contract — set it before `connect()`. */
  onStateChange?: (state: ConnState) => void

  /** Invoked when the hub rejects the session as UNAUTHORIZED (expired /
   *  revoked token) during the connect-time readiness probe. The host clears
   *  the stale token so the auth gate returns to login. (FIX 1) */
  onUnauthorized?: () => void

  constructor(private readonly config: SystemControllerConfig) {
    this.pageProtocol =
      config.pageProtocol === undefined ? currentPageProtocol() : config.pageProtocol
    this.candidates = dropMixedContentUrls(config.candidates, this.pageProtocol)
    const storedPin = config.pinnedRouteUrl ?? null
    const pin =
      storedPin !== null && isMixedContentUrl(storedPin, this.pageProtocol) ? null : storedPin
    // Ignore a leftover IPv6 pin only when that URL is not among the race
    // candidates. An operator-enabled IPv6 viewer URL is a real candidate.
    this.pinnedRouteUrl =
      pin !== null && isIpv6Url(pin) && !this.candidates.includes(pin) ? null : pin
    this.route = describeRoute(config.serverUrl, [], 'initial')
  }

  /**
   * Adopt a route and SAY SO.
   *
   * Every path that can change (or confirm) the route funnels through here, so
   * there is exactly one place that can be wrong and exactly one line shape to
   * grep. The line is emitted even when nothing changed: "still on the tunnel,
   * because the candidate set was unchanged" is the answer to the operator's
   * question, and a log that only speaks on change cannot give it.
   */
  private adoptRoute(url: string, reason: RouteReason): void {
    // `unchanged` is a NON-DECISION: it means no re-race ran because the hub
    // advertised the same candidates as last time. Letting it overwrite the
    // reason on a URL that has not moved would erase the actual decision —
    // every launch would end up reading "unchanged", which is the shape of
    // answer that made this question unanswerable in the first place.
    const sameUrl = normaliseBaseUrl(url) === this.route.url
    const effective = reason === 'unchanged' && sameUrl ? this.route.reason : reason
    this.route = describeRoute(url, this.lastEndpoints, effective)
    traceRoute(this.route)
  }

  /**
   * Attach both observers and get back a detach function. Detach BEFORE
   * `dispose()`: closing the `System` fires a final synchronous
   * `'disconnected'` through `onStateChange` (WS onClose), and routing that
   * teardown echo into an observer that has already been cleaned up is how
   * the post-login "stuck offline" latch happened. Detaching is a no-op if a
   * different observer pair has been attached since (last writer wins).
   */
  subscribe(observers: {
    onStateChange: (state: ConnState) => void
    onUnauthorized: () => void
  }): () => void {
    this.onStateChange = observers.onStateChange
    this.onUnauthorized = observers.onUnauthorized
    return () => {
      if (this.onStateChange === observers.onStateChange) this.onStateChange = undefined
      if (this.onUnauthorized === observers.onUnauthorized) this.onUnauthorized = undefined
    }
  }

  /**
   * Bring the transport up. Resolves as soon as a transport EXISTS — it does
   * not wait for the route to be optimised.
   *
   * Route selection used to run inline here: `await race()` then
   * `await discoverAndApply()` (which races again). Counted on a faithful fake
   * (`__tests__/connect-waterfall.spec.ts`), a cold launch ran FOUR
   * `raceFastestEndpoint` passes and TWO authenticated `getConnectionEndpoints`
   * round-trips before this promise settled, and every screen's first query
   * sits behind the connection state those produce. The app does not need the
   * FASTEST route to show a picture; it needs A route. So the optimisation is
   * started here and left to run behind the first frame.
   *
   * Await `routeSettled()` if you genuinely need the final route.
   */
  async connect(): Promise<void> {
    this.system = createSystem({
      serverUrl: this.config.serverUrl,
      token: this.config.token,
      getLanguage: hubLanguage,
      onConnectionChange: (state) => void this.handleStateChange(state as ConnState),
    })
    this.watchSocketForSessionEnd()
    markBoot('transportCreated', { candidates: this.candidates.length })
    // Baseline the state to 'connected' BEFORE the connect-time race so the SDK's
    // immediate 'connected' event does not trigger a second concurrent race.
    this.prevState = 'connected'
    // Off the critical path, both of them. `verifySession` drives the mirrored
    // connection state (and the 401 handoff) through the same callbacks; the
    // route optimisation pivots the transport underneath it if a faster route
    // exists.
    void this.optimiseRoute('connect')
    // Authoritatively confirm the session is live so the mirrored connection
    // state reflects reality even if the SDK's 'connected' event was missed
    // (→ FIX 4: no more stuck-on-"offline" right after login), and route an
    // expired/revoked token to the central 401 handler instead of a silent
    // "offline". Fire-and-forget — it drives state via the same callbacks.
    void this.verifySession()
  }

  /** Confirm the transport is authenticated (`auth.me` round-trip). Success →
   *  emit 'connected'; UNAUTHORIZED → hand off to `onUnauthorized`; any other
   *  failure → 'disconnected'. Guards against a stale system after dispose. */
  private async verifySession(): Promise<void> {
    const system = this.system
    if (!system) return
    try {
      await system.awaitConnected()
      if (this.system === system) {
        markBoot('transportReady')
        this.onStateChange?.('connected')
      }
    } catch (err) {
      if (isUnauthorizedError(err)) {
        this.onUnauthorized?.()
        return
      }
      // A probe that failed because WE tore the socket down mid-flight is not
      // an offline hub. `switchServerUrl` disposes the tRPC client the probe
      // was issued on, so its `auth.me` rejects — reporting that as
      // 'disconnected' would announce a fault we caused on purpose.
      if (this.selfSwitchPending) return
      if (this.system === system) this.onStateChange?.('disconnected')
    }
  }

  /** React to an SDK connection-state change; re-race + re-probe on recovery. */
  async handleStateChange(next: ConnState): Promise<void> {
    // `reconnect()` rebuilds the socket: follow it.
    this.watchSocketForSessionEnd()
    // A drop we caused on the way into the background. Recorded — the timeline
    // must still show the socket going down — but not surfaced and not raced:
    // there is nobody looking at the screen, and the state the app comes back
    // to must be "reconnecting", never "offline". Cleared by
    // `handleForeground`, so this is a window, not a latch.
    if (this.suspended) {
      this.prevState = 'connecting'
      traceConnection(this.tracker.transition(next), { suspended: true, surfaced: false })
      return
    }
    const prev = this.prevState
    this.prevState = next
    const nowMs = this.config.now?.() ?? Date.now()
    // Our OWN `switchServerUrl` emits `connecting` → `connected` (the SDK's
    // `reconnect()` tears the socket down and rebuilds it). That echo is not a
    // network change — it is the change we just asked for — and treating it as
    // a recovery re-races and re-probes in response to the previous race's
    // result. That feedback loop is where three of the four cold-launch races
    // came from.
    //
    // The flag is armed by `switchServerUrl` and disarmed by the FIRST terminal
    // state after it — `connected` (the switch worked, suppress this one
    // re-race) or `disconnected` (the switch failed, and the recovery that
    // follows is genuine). Only the intermediate `connecting` keeps it armed.
    // Disarming solely on `connected` would latch forever the day a switch
    // lands on a URL that never opens, and silently disable route recovery for
    // the rest of the session — the same shape as the stale-timer latch the
    // OfflineDebouncer exists to prevent.
    const wasSelfSwitch = this.selfSwitchPending
    if (wasSelfSwitch && next !== 'connecting') this.selfSwitchPending = false
    if (wasSelfSwitch && next === 'disconnected') {
      traceSwitchDropped(this.system?.serverUrl ?? this.route.url, this.pinnedRouteUrl)
    }
    const selfSwitchEcho = wasSelfSwitch && next === 'connected'
    if (selfSwitchEcho) this.selfSwitchConnectedAtMs = nowMs
    // The previous WS `onClose` is async. After a successful switch it lands
    // as connected → disconnected with selfSwitchEcho already false (the flag
    // disarmed on `connected`). Health is still 3/3 and in-flight tRPC still
    // succeeds — only the UI goes offline, because queries gate on this state.
    if (next === 'disconnected' && isStaleSwitchClose(this.selfSwitchConnectedAtMs, nowMs)) {
      this.prevState = prev
      traceStaleSwitchClose(
        this.system?.serverUrl ?? this.route.url,
        nowMs - (this.selfSwitchConnectedAtMs ?? nowMs),
      )
      return
    }
    const rerace = shouldRerace(prev, next) && !selfSwitchEcho
    // `heldMs` separates "held for an hour, dropped the moment the app woke"
    // from "flapping every few seconds" — the same symptom, different faults.
    traceConnection(this.tracker.transition(next), { rerace, selfSwitchEcho })
    this.onStateChange?.(next)
    if (rerace) await this.optimiseRoute('recovery')
  }

  /**
   * Pick the best route and adopt it: race the known candidates, then refresh
   * the candidate set from the hub and race again ONLY if that set actually
   * changed.
   *
   * Single-flight. Concurrent callers (the connect-time call and a recovery
   * that lands while it is still running) join the in-flight pass instead of
   * starting a competing one — two races over the same candidates cannot
   * disagree usefully, and the loser's `switchServerUrl` is a second transport
   * teardown for nothing.
   */
  private async optimiseRoute(reason: 'connect' | 'recovery' | 'reprobe' | 'pin'): Promise<void> {
    const inFlight = this.routePass
    if (inFlight) return inFlight
    const pass = (async () => {
      try {
        await this.race(reason)
        await this.discoverAndApply()
      } finally {
        this.routePass = null
      }
    })()
    this.routePass = pass
    return pass
  }

  /** Resolves when the in-flight route optimisation finishes (diagnostics and
   *  tests — nothing on the boot path may await this). */
  async routeSettled(): Promise<void> {
    await this.routePass
  }

  private async race(reason: string): Promise<void> {
    const urls = this.pinnedRouteUrl ? [this.pinnedRouteUrl] : [...this.candidates]
    if (!this.system || urls.length === 0) return
    // A race that starts and never ends is one of the shapes behind "stuck on
    // loading" — so both ends are logged, and a `start` with no matching line
    // IS the finding.
    traceRace('start', { candidates: urls.length, reason })
    // NOT the SDK's `raceFastestEndpoint`: it probes `/trpc/health` with a GET,
    // which the tRPC plugin answers 404 (there is no `health` procedure), so
    // every probe rejects and the race has been returning null for every client
    // on every channel. `raceCandidates` asks `/health` — which exists — and
    // keeps the losers, which ARE the diagnosis. See `candidate-probe.ts`.
    const outcome = await this.runRace(urls, RACE_TIMEOUT_MS)
    const winner = outcome.winner
    // Every probe, including the winner. Skipping the winner hid the TestFlight
    // shape "health 200 then the WebSocket dies" — Settings then reads as
    // "IPv6 doesn't work" with no line saying /health actually answered.
    for (const r of outcome.results) {
      traceCandidateResult(r, {
        trigger: reason,
        pinned: this.pinnedRouteUrl,
        channel: describeRoute(r.url, this.lastEndpoints, 'initial').channel,
      })
    }
    this.traceSecureTwinFailures(outcome.results)
    // Re-check `this.system`: dispose() may have nulled it during the await.
    if (winner && this.system) {
      markBoot('routeDecided', { reason })
      const changed = winner.replace(/\/+$/, '') !== this.system.serverUrl.replace(/\/+$/, '')
      const needsRebuild = !changed && this.prevState !== 'connected'
      if (changed) {
        // Arm BEFORE the call: `switchServerUrl` emits 'connecting'
        // synchronously from inside it.
        this.selfSwitchPending = true
        markBoot('routeSwitched', { winner })
        this.system.switchServerUrl(winner)
      } else if (needsRebuild) {
        // `switchServerUrl` is a no-op when the URL matches, so a re-probe that
        // re-elects LAN while the WS is down would leave the dead socket in
        // place. Force a rebuild against the same URL.
        this.selfSwitchPending = true
        this.system.reconnect()
      } else {
        this.system.switchServerUrl(winner)
      }
      traceRace('won', {
        winner,
        switched: changed,
        rebuilt: needsRebuild,
        reason,
        ms: outcome.results.find((r) => r.url === winner)?.ms ?? null,
      })
      this.adoptRoute(winner, this.pinnedRouteUrl ? 'pinned' : 'race-won')
      return
    }
    traceRace('failed', { hadWinner: winner !== null, disposed: this.system === null, reason })
    const system = this.system
    if (system === null) {
      // Disposed mid-race: nothing was decided and nothing is in use. Naming
      // the configured URL here would claim a route the app is not on.
      this.adoptRoute(this.config.serverUrl, 'disposed')
      return
    }
    // No candidate answered. The transport stays where it is — which is a
    // FALLBACK, not a choice, and the two used to be written down identically.
    this.adoptRoute(system.serverUrl, 'no-winner')
  }

  /**
   * Say, ONCE per session and candidate, why a secure twin (the hub's LAN
   * `https://` address, D859) lost: `tls-untrusted` (the host answers, the
   * certificate is not one this phone trusts — install the hub's CA) or
   * `unreachable`. The race already carries on with the other candidates; this
   * line only keeps the failure from being an unexplained gap, and from being
   * repeated on every re-race.
   */
  private traceSecureTwinFailures(results: readonly CandidateProbeResult[]): void {
    for (const r of results) {
      const reason = classifySecureTwinFailure(r, results)
      if (reason === null || this.loggedSecureTwinFailures.has(r.url)) continue
      this.loggedSecureTwinFailures.add(r.url)
      traceCandidateProbe({
        trigger: 'secure-twin-failed',
        url: r.url,
        reason,
        error: r.error,
        note: 'the plain-http candidate of the same host keeps racing; this one is skipped',
      })
    }
  }

  /** Real-world I/O for the prober. One place, so the race and any future
   *  diagnostic cannot drift into asking different questions. */
  private probeDeps(): CandidateProbeDeps {
    return { fetchImpl: (url, init) => fetch(url, init), now: () => Date.now() }
  }

  private runRace(urls: readonly string[], timeoutMs: number): Promise<CandidateRaceOutcome> {
    const injected = this.config.raceCandidatesImpl
    if (injected) return injected(urls, timeoutMs)
    return raceCandidates(urls, timeoutMs, this.probeDeps())
  }


  /**
   * Probe the hub (`localNetwork.getConnectionEndpoints`) for every URL it is
   * reachable on, hand them to the host for persistence + display, and fold
   * them into the candidate set. No-op (and no callback) when the probe yields
   * nothing — an older hub or a transient failure leaves the existing
   * candidates intact.
   *
   * Re-races ONLY when the candidate set actually changed. From the second
   * launch onwards the host seeds the race with the endpoints this probe
   * persisted last time, so the answer is usually identical to what we already
   * raced — and racing an unchanged list a second time can only re-elect the
   * same winner, at the cost of another full `Promise.any` pass.
   */
  private async discoverAndApply(): Promise<void> {
    if (!this.system) return
    const { port, scheme, explicitPort } = parsePortScheme(this.config.serverUrl)
    const advertised = await discoverEndpoints(this.system, port, scheme)
    if (advertised.endpoints.length === 0 || !this.system) return
    // ── The port is the SERVER's fact ────────────────────────────────────────
    //
    // A hub on the D226 contract resolves its own listen port and reports it as
    // `localPort`, so its LAN URLs stand on their own and this filter is inert.
    // A hub older than that ECHOES the port we sent: when the configured URL
    // carried none we inferred 443 from `https:`, and a hub listening on 4443
    // handed back `https://192.0.2.10:443`. Measured on the operator's device:
    // `{"url":"https://192.0.2.10:443","ok":false,"ms":6,"error":"Could not
    // connect","channel":"lan"}`.
    //
    // Inventing a better guess here would make the client a SECOND authority on
    // the hub's listen port (D62), and a second authority that disagrees with
    // the first is worse than none. So against an echoing hub the client makes
    // no claim: candidates built on a port it invented are dropped, and the drop
    // is logged rather than raced, because losing a race reads as "the LAN was
    // tried" when the LAN was never asked.
    const trust: PortTrust = { explicitPort, declared: advertised.localPort }
    const { kept: vouched, dropped } = dropUnverifiedPortEndpoints(advertised.endpoints, trust)
    // On an `https:` page a plain-http LAN address is unusable, but the hub
    // serves the same address on its TLS listener too — swap it for that twin
    // rather than leave the tunnel as the only route (`secureLanTwin`).
    const endpoints = withSecureLanTwins(vouched, advertised.localPort, this.pageProtocol)
    const twinned = endpoints.filter((e) => !vouched.some((v) => v.baseUrl === e.baseUrl))
    if (twinned.length > 0) {
      traceCandidateProbe({
        trigger: 'secure-lan-twin',
        added: twinned.map((e) => e.baseUrl),
        declaredPort: advertised.localPort?.port ?? null,
        note: 'plain-http LAN addresses replaced by the hub TLS listener on an https page',
      })
    }
    if (dropped.length > 0) {
      traceCandidateProbe({
        trigger: 'inferred-port',
        dropped: dropped.map((e) => e.baseUrl),
        inferredPort: port,
        configuredUrl: this.config.serverUrl,
        note: 'the hub declared no listen port and echoes ours, so these are unverifiable',
      })
    } else if (advertised.localPort !== null) {
      // Say which port the LAN candidates are addressed to and who vouched for
      // it. Without this line a working LAN and a LAN nobody asked about read
      // identically in the log — which is exactly how this went unseen.
      traceCandidateProbe({
        trigger: 'declared-port',
        declaredPort: advertised.localPort.port,
        declaredPortSource: advertised.localPort.source,
        configuredUrl: this.config.serverUrl,
      })
    }
    if (endpoints.length === 0) return
    // Adopted BEFORE the re-race so the route this pass elects is named against
    // the freshest endpoint list rather than the previous one's.
    this.lastEndpoints = endpoints
    this.config.onEndpointsDiscovered?.(endpoints)
    const next = dropMixedContentUrls(
      endpointsToCandidates(endpoints, this.config.serverUrl),
      this.pageProtocol,
    )
    const unchanged =
      next.length === this.candidates.length && next.every((u, i) => u === this.candidates[i])
    this.candidates = next
    if (unchanged) {
      traceRace('failed', { reason: 'candidates-unchanged', hadWinner: true, disposed: false })
      // Re-state the route against the freshly-named endpoints. `unchanged` is
      // the branch the operator's session took every time, and it used to end
      // the pass in silence — so the last thing the log said about the route
      // was a `race failed`, which reads as "no route at all".
      this.adoptRoute(this.system.serverUrl, 'unchanged')
      return
    }
    await this.race('discovery')
  }

  /**
   * The app is leaving: close the socket rather than hold it open for a reader
   * the OS is about to freeze.
   *
   * Measured on the hub, 2026-09-10: a phone that stopped reading and did not
   * close grew the server's outbound queue from 33 MB to 88 MB in an evening,
   * with 160 KB read back. The server now evicts such a client in ~40 s
   * (D444), which is the right outcome and the wrong author — see
   * `background-suspend.ts`.
   *
   * Never throws: a departure must not be able to fail.
   */
  suspendForBackground(): SuspendDecision {
    const system = this.system
    const decision = decideBackgroundSuspend({
      suspended: this.suspended,
      hasTransport: system !== null,
      hasSocket: system?.wsClient != null,
    })
    const heldMs = this.tracker.heldMs()
    if (decision !== 'suspend' || system === null) {
      traceBackgroundSuspend(decision, { state: this.prevState, heldMs })
      return decision
    }
    // Armed BEFORE the close: `close()` fires the WS `onClose` synchronously,
    // and that echo is exactly what must not reach the banner.
    this.suspended = true
    this.suspendedAtMs = this.config.now?.() ?? Date.now()
    // The honest state for "we are not connected and we intend to be again".
    // `disconnected` would be the truth about the socket and a lie about the
    // app, and it is the value the offline grace timer escalates from — a
    // timer that is frozen for the whole suspension and fires the instant the
    // operator is looking at the screen again.
    this.onStateChange?.('connecting')
    try {
      system.close()
    } catch (err) {
      traceBackgroundSuspend('close-failed', {
        heldMs,
        error: err instanceof Error ? err.message : String(err),
      })
      return decision
    }
    traceBackgroundSuspend(decision, { heldMs, route: this.route.url, state: this.prevState })
    return decision
  }

  /** True while the socket is closed because the app is in the background. */
  isSuspended(): boolean {
    return this.suspended
  }

  /**
   * The app came back. One entry point, because there is one question — "is
   * there a live socket, and if not, why not?" — and two answers: we closed it
   * (reopen it), or we did not (ask whether it survived).
   */
  async handleForeground(awayMs: number | null): Promise<ForegroundOutcome> {
    if (decideForegroundAction(this.suspended) === 'resume') {
      return this.resumeFromBackground(awayMs)
    }
    return this.verifyAfterResume(awayMs)
  }

  /**
   * Reopen what the departure closed.
   *
   * No probe: there is no socket to question. `reconnect()` emits `connecting`
   * synchronously and `connected` when the new one opens — which re-arms the
   * event subscriptions, re-enables every socket-gated query, and hands the
   * reconcile the recovery it is owed (`data/resume-reconcile.ts`). The
   * re-race rides along on that `connected`, which is wanted: the network the
   * app went to sleep on is often not the one it wakes up on.
   */
  private resumeFromBackground(awayMs: number | null): BackgroundResumeOutcome {
    const nowMs = this.config.now?.() ?? Date.now()
    const backgroundMs = this.suspendedAtMs === null ? null : nowMs - this.suspendedAtMs
    // Cleared FIRST: the `connecting` that `reconnect()` emits must reach the
    // UI, or the app comes back showing the state it had before it left.
    this.suspended = false
    this.suspendedAtMs = null
    const system = this.system
    if (!system) {
      traceBackgroundResume('no-transport', { awayMs, backgroundMs })
      return 'no-transport'
    }
    try {
      system.reconnect()
    } catch (err) {
      traceBackgroundResume('resume-failed', {
        awayMs,
        backgroundMs,
        error: err instanceof Error ? err.message : String(err),
      })
      return 'resume-failed'
    }
    traceBackgroundResume('resumed', { awayMs, backgroundMs, route: this.route.url })
    return 'resumed'
  }

  /**
   * The app came back to the foreground: confirm the socket survived, and
   * rebuild it when it did not.
   *
   * A suspended app cannot observe its WebSocket dying — see `resume-probe.ts`
   * for the whole of why, and for why this is a PROBE and not a blind redial.
   * One bounded `auth.me` answers the question in milliseconds where the
   * keep-alive takes up to ~16 s, and every branch is traced, including the
   * ones that do nothing.
   *
   * Never throws: a resume must not be able to fail.
   */
  async verifyAfterResume(awayMs: number | null): Promise<ResumeProbeOutcome> {
    const decision = decideResumeProbe({ awayMs, state: this.prevState })
    if (decision !== 'probe') {
      traceResumeProbe(decision, { awayMs, state: this.prevState })
      return decision
    }
    const system = this.system
    if (!system) {
      traceResumeProbe('no-transport', { awayMs })
      return 'no-transport'
    }
    const startedAt = Date.now()
    try {
      await withQueryDeadline(
        system.trpcClient.auth.me.query(),
        'auth.me (resume probe)',
        RESUME_PROBE_DEADLINE_MS,
      )
      traceResumeProbe('healthy', { awayMs, ms: Date.now() - startedAt })
      return 'healthy'
    } catch (err) {
      // An expired token is not a dead socket. Rebuilding the transport for it
      // would dial, authenticate, be refused again, and hide the one answer the
      // operator can act on behind a reconnect loop.
      if (isUnauthorizedError(err)) {
        traceResumeProbe('unauthorized', { awayMs, ms: Date.now() - startedAt })
        this.onUnauthorized?.()
        return 'unauthorized'
      }
      // Disposed underneath us (the effect tore down, a server switch landed):
      // whatever this probe learned is about a transport nobody is using.
      if (this.system !== system) {
        traceResumeProbe('no-transport', { awayMs, disposed: true })
        return 'no-transport'
      }
      traceResumeProbe('rebuilt', {
        awayMs,
        ms: Date.now() - startedAt,
        error: err instanceof Error ? err.message : String(err),
      })
      // `reconnect()` emits `connecting` synchronously and `connected` when the
      // new socket opens — which is what re-arms the event subscriptions, flips
      // every socket-gated query back on, and hands the reconcile the recovery
      // it is owed. Nothing else needs to be told.
      try {
        system.reconnect()
      } catch (rebuildErr) {
        traceResumeProbe('rebuild-failed', {
          awayMs,
          error: rebuildErr instanceof Error ? rebuildErr.message : String(rebuildErr),
        })
        return 'rebuild-failed'
      }
      return 'rebuilt'
    }
  }

  /** The operator's Retry on the hub-connection overlay: rebuild the socket
   *  now instead of waiting for the transport's own backoff. `reconnect()`
   *  emits `connecting`, then `connected` when the new socket opens. A rebuild
   *  that throws is reported as `disconnected` — the overlay keeps saying
   *  offline, which is the truth. Never throws. */
  retryNow(): void {
    const system = this.system
    if (system === null) return
    try {
      system.reconnect()
    } catch {
      this.onStateChange?.('disconnected')
    }
  }

  /** Manual re-probe (the Settings "re-probe" action): re-fetch the hub's
   *  endpoints and adopt the fastest. Safe to call anytime the system is up. */
  async reprobe(): Promise<void> {
    await this.optimiseRoute('reprobe')
  }

  getSystem(): System | null {
    return this.system
  }

  /**
   * The CONFIGURED hub URL — the stable identity of the hub the operator added.
   *
   * Not the same thing as `getSystem()?.serverUrl`, which is the ROUTE and
   * moves with the endpoint race (public URL on mobile data, LAN IP at home).
   * Anything that identifies the hub — a persisted per-hub cache key, a
   * settings row — must key on this one, or it silently keys on the network
   * the user happened to be on. It is also available BEFORE `connect()`, which
   * `getSystem()` is not.
   */
  get configuredServerUrl(): string {
    return this.config.serverUrl
  }

  /** Current live candidate set (for diagnostics / Settings display). */
  getCandidates(): readonly string[] {
    return this.candidates
  }

  /**
   * The route in use and why — for the Settings row and for anything that needs
   * to reason about the channel. Always defined; see `route`.
   */
  getRoute(): RouteDescription {
    return this.route
  }

  getPinnedRouteUrl(): string | null {
    return this.pinnedRouteUrl
  }

  /**
   * Probe every known base URL (advertised LAN, pin, configured hub) on
   * `/health`, one at a time, and write a Settings-readable line for each.
   * Independent of the pin: a pin-only race cannot tell IPv4 from IPv6 from
   * the tunnel.
   */
  async diagnoseRoutes(context: Record<string, unknown> = {}): Promise<readonly CandidateProbeResult[]> {
    const urls: string[] = []
    const add = (value: string | null | undefined): void => {
      if (!value || isMixedContentUrl(value, this.pageProtocol)) return
      const normalised = value.replace(/\/+$/, '')
      if (!urls.includes(normalised)) urls.push(normalised)
    }
    for (const endpoint of this.lastEndpoints) add(endpoint.baseUrl)
    for (const candidate of this.candidates) add(candidate)
    add(this.pinnedRouteUrl)
    add(this.route.url)
    add(this.config.serverUrl)
    traceRace('start', { candidates: urls.length, reason: 'diagnose', ...context, urls, pin: this.pinnedRouteUrl })
    const results = await probeCandidates(urls, RACE_TIMEOUT_MS, this.probeDeps())
    for (const r of results) {
      traceCandidateResult(r, { trigger: 'diagnose', pinned: this.pinnedRouteUrl })
    }
    const ok = results.filter((r) => r.ok).length
    traceRace(ok === 0 ? 'failed' : 'won', {
      reason: 'diagnose',
      ok,
      fail: results.length - ok,
      total: results.length,
    })
    return results
  }

  /**
   * Force one advertised (or configured) base URL, or `null` to return to the
   * automatic LAN-vs-tunnel race. Re-runs the route pass immediately.
   *
   * A pin this page cannot use is REFUSED and says why. It used to return
   * silently, and Settings — which re-reads the pin every 2 s — showed the
   * operator's choice flipping back to automatic with no reason given
   * (operator report 2026-10-07: a plain-http LAN address picked on the
   * hosted PWA).
   */
  async setPinnedRouteUrl(url: string | null): Promise<PinRouteOutcome> {
    const next = url === null || url === '' ? null : normaliseBaseUrl(url)
    if (next !== null && isMixedContentUrl(next, this.pageProtocol)) {
      traceRace('failed', { reason: 'pin-refused', pinned: next, refusal: 'mixed-content' })
      return { kind: 'refused', reason: 'mixed-content' }
    }
    if (
      next !== null &&
      isIpv6Url(next) &&
      !this.candidates.includes(next) &&
      !this.lastEndpoints.some((e) => e.baseUrl === next)
    ) {
      traceRace('failed', { reason: 'pin-refused', pinned: next, refusal: 'unknown-ipv6' })
      return { kind: 'refused', reason: 'unknown-ipv6' }
    }
    if (next === this.pinnedRouteUrl) return { kind: 'applied' }
    this.pinnedRouteUrl = next
    traceRace('start', { reason: 'pin', pinned: next, candidates: next === null ? this.candidates.length : 1 })
    await this.optimiseRoute(next === null ? 'reprobe' : 'pin')
    return { kind: 'applied' }
  }

  /**
   * The hub closes the socket of a revoked session with `session-ended`
   * (4401). The SDK reports a bare `disconnected` and the client would redial
   * with the dead token, so the close is read off the socket's own connection
   * state and handed to the same renewal path as an `UNAUTHORIZED` answer.
   * Re-attached whenever the socket object changes.
   */
  private watchSocketForSessionEnd(): void {
    const client = this.system?.wsClient ?? null
    if (client === null) return
    if (this.socketWatch?.client === client) return
    this.socketWatch?.stop()
    this.socketWatch = {
      client,
      stop: watchSessionEndedClose(client, () => this.onUnauthorized?.()),
    }
  }

  dispose(): void {
    this.socketWatch?.stop()
    this.socketWatch = null
    this.system?.close()
    this.system = null
    // A disposed controller is not a backgrounded one. Leaving the flag set
    // would hand the next foreground a `resumed` for a transport that no
    // longer exists.
    this.suspended = false
    this.suspendedAtMs = null
  }
}
