/**
 * clip-transport — what the transport band's verbs MEAN while a clip holds
 * the frame.
 *
 * ## Pause has two authorities, and a clip is on the wrong side of the switch
 *
 * The screen resolves ONE pause binding for the on-video overlay and the
 * playback bar (`effectivePaused`), and it picks the authority from the
 * playback machine's mode: off live, pause is the server's rate-0 hold on the
 * session; at the live edge, pause is a POSTER TEARDOWN — the player is
 * unmounted. A clip deliberately leaves the machine where it was (D570), so a
 * clip opened from the live edge left the machine saying `live`, and the
 * play/pause button did the live thing: it unmounted the player, and with it
 * the clip. On a held battery camera it was worse before the first press — the
 * live hold reads as "paused", so the bar drew ▶ over a clip that was playing.
 *
 * A clip is paused by the RATE, whatever the machine says. This module is the
 * one place that says so, and `clip-transport.spec.ts` checks that the screen
 * reads it for both halves of the binding, because two readers of one rule
 * that each re-derive it is how the two halves disagreed in the first place.
 *
 * ## Two exits, and go-live is the one that LEAVES
 *
 * The operator's answer to "where does exiting a clip land you": *go-live goes
 * to the live view; prev/next keep you in the list.* The server already leaves
 * the clip on `goLive` in one dispatch and forgets it (D570). The APP did not:
 * `playback.goLive()` ran the machine and the sink and never touched the clip
 * stage, so the frame went on "holding" a clip the server had dropped — the
 * bar kept its clip chrome over a live picture, and on a held camera nothing
 * happened at all, because the sink refuses to dial a held camera and the
 * stage was what kept the player mounted.
 *
 * Pure: no React, no i18n, no network.
 */

import type { PlaybackMode } from '../recording/playback-machine.js'
import type { PlaybackMode as EmbedPlaybackMode } from '../recording/playback-status.js'

/**
 * Which state answers "is the picture paused", and which verb a press runs.
 *
 * `rate` — the server-side rate-0 hold (`setRate(0)` / `setRate(rate)`).
 * `live-hold` — the live poster pause (teardown / remount).
 */
export type PauseAuthority = 'rate' | 'live-hold'

export interface PauseAuthorityInput {
  readonly mode: PlaybackMode
  /** A clip holds the camera's frame (`stageHoldsClip`). */
  readonly clipHeld: boolean
}

export function resolvePauseAuthority(input: PauseAuthorityInput): PauseAuthority {
  // A FILE is never the live edge, whatever the machine behind it is doing —
  // the same rule `playbackBarLayout` applies to the bar's chrome.
  if (input.clipHeld) return 'rate'
  return input.mode === 'live' ? 'live-hold' : 'rate'
}

/**
 * The two ways out of a clip, named so a caller cannot invent a third.
 *
 * `live` — leave the clip AND the recorded session: the frame goes to the
 *          live view (the poster, on a held camera). The stage is closed and
 *          the seed forgotten, so a remount cannot reopen the file.
 * `list` — prev/next: hand the frame to another file. The stage stays a
 *          stage; only its clip changes.
 */
export type ClipExit = 'live' | 'list'

export interface ClipExitPlan {
  /** Close the clip stage (and forget the mount seed) BEFORE the machine moves. */
  readonly closeStage: boolean
  /** Dispatch the machine's GO_LIVE (and its sink) afterwards. */
  readonly goLive: boolean
}

export function planClipExit(exit: ClipExit): ClipExitPlan {
  switch (exit) {
    case 'live':
      // Order matters: closing the stage first is what lets a held camera's
      // mount gate drop the player, and what stops the remount a normal
      // camera's sink performs from reopening the seed.
      return { closeStage: true, goLive: true }
    case 'list':
      return { closeStage: false, goLive: false }
  }
}

// ── The clip's own LOADING state ─────────────────────────────────────────────

/**
 * A clip has a loading state of its own, and it is the clip's — not the
 * session's.
 *
 * The bar's ring used to be resolved from the playback machine: a recorded
 * seek in flight, or a live picture still connecting. A clip leaves the
 * machine where it was (D570), so under a clip the ring read the LIVE branch
 * — and on a held battery camera, whose live picture is a poster that never
 * connects, it never rang. The operator stared at a frame that said nothing
 * for the whole cold fetch: 7.9 s on a hub child, measured 2026-09-22.
 *
 * What is known, and what is not. The player reports ONE state for the file
 * (`loading` → `playing` | `paused` | `ended` | `gap` | `error`); the stages
 * behind it — the camera descent, the mux, the broker's index — happen two
 * processes away and nothing on the wire names them. So this is one honest
 * state, armed by the TAP (the operator is waiting from the moment he
 * pressed, not from the first report) and cleared by the first state that is
 * not `loading`. A `live` report clears it too: the session left the clip.
 */
export type ClipLoadingEvent =
  /** The stage took this clip and dispatched it to the player. */
  | { readonly kind: 'opened'; readonly clipId: string }
  /** The player reported a state while this stage stood. */
  | { readonly kind: 'player'; readonly state: EmbedPlaybackMode }
  /** The stage let the clip go. */
  | { readonly kind: 'closed' }

/** The clip being loaded, or `null`. */
export type ClipLoading = string | null

export function reduceClipLoading(prev: ClipLoading, event: ClipLoadingEvent): ClipLoading {
  switch (event.kind) {
    case 'opened':
      return event.clipId
    case 'closed':
      return null
    case 'player':
      // `loading` keeps whatever was armed; anything else is the file's first
      // real state, and the wait is over — for better (`playing`) or worse
      // (`error`, which the fault notice will say).
      return event.state === 'loading' ? prev : null
  }
}

// ── A live capture and a clip cannot share the <video> ───────────────────────

/**
 * Should a running live capture END now?
 *
 * The capture records the decoded live `<video>` (`startLiveCapture`: "from
 * this moment, no lookback"). Leaving the live edge already ends it and offers
 * the bytes, because the element is about to show recorded footage. A clip
 * taking the frame is the same event — the element shows a stored file — but
 * the machine stays `live` under a clip (D570), so the effect that watched the
 * mode never fired and the recorder went on capturing the clip as if it were
 * the live picture. Ending it is the honest answer: the file the operator is
 * watching already exists and has its own download; a "live clip" that
 * contains a replay of it is neither.
 */
export function shouldEndLiveCapture(input: PauseAuthorityInput): boolean {
  return input.mode !== 'live' || input.clipHeld
}
