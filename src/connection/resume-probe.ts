/**
 * resume-probe — asking, on the way back in, whether the socket survived.
 *
 * ## The gap this closes
 *
 * A suspended iOS app does not observe its WebSocket dying. The OS freezes the
 * process, the network drops the connection, and on resume the JS heap is
 * exactly as it was: `readyState` still OPEN, the mirrored connection state
 * still `connected`, every socket-gated query still enabled. Nothing in the app
 * knows anything is wrong.
 *
 * What eventually notices is the tRPC keep-alive — a 10 s ping interval with a
 * 6 s pong timeout, both frozen for the whole suspension — so the truth arrives
 * up to ~16 s after the operator is already looking at the screen. Everything
 * issued in that window is written into a black hole and then costs its own
 * 12 s query deadline plus a retry to fail.
 *
 * That window is the whole of the 2026-08-19 report. The camera list was
 * re-asked on resume exactly as designed (`data/resume-reconcile.ts`); the ask
 * went nowhere, and by the time anything could have retried, the operator had
 * pulled to refresh — which works, because `refetch()` bypasses the `enabled`
 * gate and by then the socket had been rebuilt.
 *
 * ## Probe, then rebuild — never rebuild blind
 *
 * `AppPhaseTracer` deliberately did NOT redial on resume: three different faults
 * produce the same "stuck on loading", and a blind resume-triggered redial would
 * have destroyed the evidence saying which one it is (`lifecycle-trace.ts`).
 * That reasoning still holds and this does not break it. A probe is a QUESTION:
 * it logs which shape actually occurred — the socket was fine, or it was dead —
 * and only the second answer rebuilds anything. The evidence is not destroyed,
 * it is finally produced.
 *
 * Pure and clock-free; the effects live in `SystemController.verifyAfterResume`.
 */
import type { ConnState } from './recheck-policy.js'

/**
 * How long the app must have been away before the socket is worth questioning.
 *
 * Below this it certainly survived: the app was never suspended, only obscured
 * (the multitasking switcher, the notification shade, a permission sheet). Same
 * floor as the reconcile's `RESUME_MIN_AWAY_MS`, and for the same reason —
 * these two answer the same "was there a gap?" question about the same event.
 */
export const RESUME_PROBE_MIN_AWAY_MS = 10_000

/**
 * How long the probe waits for `auth.me`.
 *
 * Sized against the healthy case, not the sick one: `auth.me` is a token
 * decode, single-digit ms on the LAN and well inside a second over mobile data.
 * Three seconds is an order of magnitude of headroom and still five times
 * faster than the keep-alive it is standing in for. The cost of being wrong —
 * a hub that was merely slow — is one rebuilt WebSocket, roughly a second, and
 * a line in the trail saying so.
 */
export const RESUME_PROBE_DEADLINE_MS = 3_000

/** Why a resume did or did not question the transport. Every outcome is named:
 *  a branch that quietly does nothing reads afterwards as "never happened". */
export type ResumeProbeDecision = 'probe' | 'brief-away' | 'already-down'

export interface ResumeProbeInput {
  /** How long the app was away, or null when no departure was recorded. */
  readonly awayMs: number | null
  /** The transport state as the controller last saw it — the value that is
   *  suspected of lying. */
  readonly state: ConnState
}

/**
 * Should this resume question the transport?
 *
 * Only when the mirror claims we are CONNECTED. Any other state means the
 * transport already knows it is down and is dialling on its own backoff; a
 * probe there would add a doomed round-trip and a redundant rebuild to a
 * recovery that is already in progress.
 */
export function decideResumeProbe(input: ResumeProbeInput): ResumeProbeDecision {
  if (input.state !== 'connected') return 'already-down'
  if (input.awayMs !== null && input.awayMs < RESUME_PROBE_MIN_AWAY_MS) return 'brief-away'
  return 'probe'
}

/** What a resume actually did to the transport. */
export type ResumeProbeOutcome =
  | ResumeProbeDecision
  /** No transport to question (never connected, or disposed mid-probe). */
  | 'no-transport'
  /** The socket answered — it survived the suspension. */
  | 'healthy'
  /** It did not answer inside the deadline; the transport was rebuilt. */
  | 'rebuilt'
  /** It did not answer AND the rebuild itself threw. Named rather than
   *  swallowed: a resume that cannot even redial is the worst outcome this
   *  function has, and it must not read as "nothing happened". */
  | 'rebuild-failed'
  /** The hub rejected the session; handed to the central sign-out path. */
  | 'unauthorized'
