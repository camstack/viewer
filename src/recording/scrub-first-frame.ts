/**
 * scrub-first-frame — finger down → first scrub frame PAINTED, measured on the
 * client, because nothing else can measure it.
 *
 * The hub's drag census already carries `firstPushMs`: finger down → first
 * frame on the wire. What it cannot see is the other half — decode, compose,
 * paint — and that half is the one the operator actually experiences ("quasi 0
 * frame, playback parte dopo una vita"). The embed has emitted the signal for
 * this all along (`{type:'scrubDrawn'}` → `onScrubDrawn`), plumbed end to end
 * from `EmbedPlayerPage` to `LiveViewWebView` — and NO component ever passed
 * the prop, so the number has never existed. A pipe wired to nothing reads as
 * a measurement that was taken; it wasn't.
 *
 * The state machine is pure and lives here so it can be tested without a
 * WebView: one mark on the drag's first target, one on the first painted frame
 * of that drag, and every later paint in the same drag ignored (a drag paints
 * many frames; only the first answers "how long did I stare at nothing").
 */

import { log } from '../lib/logger.js'

/** Where a drag is between "finger down" and "first frame painted". */
export interface ScrubFirstFrameState {
  /** When the drag started, or null when no drag is being measured. */
  readonly startedAtMs: number | null
  /** Has the first frame of THIS drag already been counted? */
  readonly drawn: boolean
}

export const idleScrubFirstFrame: ScrubFirstFrameState = { startedAtMs: null, drawn: false }

/**
 * The drag began. Always restarts the measurement: a second `beginScrub`
 * without an intervening paint is a new gesture, and inheriting the old start
 * would report a number for a drag that never happened.
 */
export function markScrubStart(nowMs: number): ScrubFirstFrameState {
  return { startedAtMs: nowMs, drawn: false }
}

/** What one `scrubDrawn` produced: the new state, and the number if it is the first. */
export interface ScrubDrawnResult {
  readonly state: ScrubFirstFrameState
  /** Finger-down → painted, in ms. Null when this paint is not the drag's first. */
  readonly firstFrameMs: number | null
}

/**
 * A scrub frame was painted. Reports the elapsed time exactly once per drag;
 * a paint with no drag in progress (a seek's landing burst, a late frame after
 * the commit) reports nothing rather than a number measured from the wrong
 * start.
 */
export function noteScrubDrawn(state: ScrubFirstFrameState, nowMs: number): ScrubDrawnResult {
  if (state.startedAtMs === null || state.drawn) return { state, firstFrameMs: null }
  return {
    state: { startedAtMs: state.startedAtMs, drawn: true },
    firstFrameMs: Math.max(0, Math.round(nowMs - state.startedAtMs)),
  }
}

// ── the impure half: one module-level mark, one line ────────────────────────
//
// Module scope and not React state on purpose: the two ends of this
// measurement are in different trees (the playback bridge starts the drag, the
// player surface reports the paint) and threading a ref between them would put
// a measurement concern into every component in between.

let probe: ScrubFirstFrameState = idleScrubFirstFrame

/** The drag started driving the server. Called from the playback bridge. */
export function scrubDragStarted(): void {
  probe = markScrubStart(Date.now())
}

/**
 * The player painted a scrub frame (`onScrubDrawn`, the embed's `scrubDrawn`
 * message). Emits ONE line per drag — the client half of the hub's
 * `firstPushMs`, and the only place the decode+paint leg is visible at all.
 */
export function scrubFramePainted(deviceId: number): void {
  const result = noteScrubDrawn(probe, Date.now())
  probe = result.state
  if (result.firstFrameMs === null) return
  log.info('scrub:first-frame', 'first scrub frame painted', {
    deviceId,
    ms: result.firstFrameMs,
  })
}
