/**
 * background-suspend — the app CLOSES its socket when it leaves, and reopens
 * it when it comes back.
 *
 * ## The measurement
 *
 * On 2026-09-10 the hub died of GC thrash. One of the voices that took it
 * there was a tRPC WebSocket subscriber that had stopped READING and had not
 * closed: `writableLength` climbed from 33 MB to 88 MB over an evening while
 * `bytesRead` stayed at 160 KB. It was the operator's phone — and the app was
 * not being used. Being in the background was enough.
 *
 * The mechanism is not a bug in either half: iOS and Android suspend the JS
 * runtime, so the phone stops reading, but the TCP connection stays OPEN, so
 * the server keeps queueing for a reader that is not coming back.
 *
 * ## Why the client still has work after the server fix
 *
 * The server side is closed (D444, live from 1.2.270): a 16 MiB bound with a
 * 60 s grace, and — far more effective — tRPC's keepAlive (`pingMs` 30 s,
 * `pongWaitMs` 10 s). A PING is a frame the client's JS must answer and a
 * suspended runtime does not, so a backgrounded phone is now terminated in
 * ~40 s.
 *
 * Terminated is the right OUTCOME and the wrong AUTHOR. The app should decide
 * to leave, not be evicted 40 s later — those 40 s are 40 s of hub memory held
 * for a reader that is asleep, and the eviction arrives as an unexplained
 * disconnection the client then has to tell apart from a fault.
 *
 * ## What counts as leaving
 *
 * ONLY `background`. iOS raises `UIApplicationWillResignActive` — which
 * `RCTAppState` reports as `inactive` — for a Control Centre swipe, a
 * notification-shade pull, an app-switcher peek and an incoming call. None of
 * those is a departure; the runtime keeps reading through all of them, and
 * closing there would cost a reconnect per glance. Android emits
 * `active`/`background` only, and react-native-web derives the same two from
 * the Page Visibility API — so `background` means the same thing on all three
 * and is the only status that does.
 *
 * ## No grace timer
 *
 * The close is immediate. A "wait a couple of seconds in case they come right
 * back" timer is exactly the timer the OS is about to freeze: it would fire on
 * some devices, never on others, and the defect would survive as an
 * intermittent. A departure that turns out to be brief costs one reconnect,
 * which is bounded and visible; a frozen grace timer costs the hub an
 * unbounded queue, which is the thing being fixed.
 *
 * Pure and clock-free — the effects live in `SystemController`
 * (`suspendForBackground` / `handleForeground`) and the `AppState` wiring in
 * `AppPhaseTracer`.
 */

/**
 * Where the app is, as far as READING from the socket is concerned.
 *
 * `obscured` is deliberately its own word rather than a shade of background:
 * it is the state in which the runtime is still alive and still reading.
 */
export type AppPresence = 'foreground' | 'obscured' | 'background'

/**
 * Classify an `AppStateStatus`. Takes a plain string so this module stays
 * loadable in the node-env suite (no `react-native` import anywhere near it).
 */
export function classifyPresence(status: string): AppPresence {
  if (status === 'active') return 'foreground'
  if (status === 'background') return 'background'
  // `inactive`, `unknown`, `extension` — and anything a future platform adds.
  // Not reading is the claim that closes a socket; nothing but `background`
  // makes it.
  return 'obscured'
}

/** What a departure did to the transport. Every outcome is named: a branch
 *  that quietly does nothing reads afterwards as "it never happened". */
export type SuspendDecision = 'suspend' | 'already-suspended' | 'no-transport' | 'no-socket'

export interface SuspendInput {
  /** Whether WE have already closed the socket for a departure. */
  readonly suspended: boolean
  /** Whether a `System` exists at all (it does not before `connect()`). */
  readonly hasTransport: boolean
  /** Whether that transport is a WebSocket. An HTTP transport holds nothing
   *  open and has no queue to feed, so there is nothing to close. */
  readonly hasSocket: boolean
}

export function decideBackgroundSuspend(input: SuspendInput): SuspendDecision {
  if (input.suspended) return 'already-suspended'
  if (!input.hasTransport) return 'no-transport'
  if (!input.hasSocket) return 'no-socket'
  return 'suspend'
}

/**
 * What a return to the foreground owes the transport.
 *
 * `resume` when the socket is missing because we took it away — there is
 * nothing to ask, only something to rebuild. `probe` otherwise: the existing
 * resume question (`resume-probe.ts`), which asks whether a socket we did NOT
 * close survived the gap.
 */
export type ForegroundAction = 'resume' | 'probe'

/**
 * What reopening did. `no-transport` shares its name with the probe's outcome
 * on purpose: it is the same fact about the same thing, and two words for it
 * would make the log lines impossible to count together.
 */
export type BackgroundResumeOutcome = 'resumed' | 'resume-failed' | 'no-transport'

export function decideForegroundAction(suspended: boolean): ForegroundAction {
  return suspended ? 'resume' : 'probe'
}
