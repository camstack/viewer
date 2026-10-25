/**
 * clip-loop — what happens when the file on the frame REACHES ITS END.
 *
 * > *"vorrei anche aggiungessi un pulsante di loop nella playback bar, default
 * > true, che riproduce in loop la stessa clip alla fine"* — the operator,
 * > 2026-09-23.
 *
 * ## The end of a clip is a fact somebody already owns
 *
 * There are exactly two ends in this app, and they belong to different
 * surfaces:
 *
 *  - a clip played by SEEKING our own recording (clips mode, `derived`) ends
 *    when the playhead reaches its `endMs`, and `resolveClipAdvance`
 *    (`clip-timeline.ts`) answers that with the NEXT clip;
 *  - a FILE on the stage (D575) ends when the player says `ended` — one state
 *    report on the same channel that already carries `loading` / `playing`
 *    (`clip-transport.ts`). Nothing else observes it.
 *
 * The loop is the second one, and it is decided HERE, off that same report.
 * There is no second detector — no timer comparing `positionMs` with the
 * measured duration, which is the obvious alternative and the one that would
 * fire alongside a report that has not arrived yet, on a duration that is
 * `null` until the broker measures it (`clip-progress.ts`).
 *
 * Loop and advance cannot both fire: the advance effect returns early in
 * `nativeMode`, which is precisely the mode in which a file can be on the
 * stage at all, and the loop is only ever armed while the stage holds one.
 * They answer the same question on two surfaces that never coexist.
 *
 * ## An iteration is a DIAL, not a seek to zero
 *
 * A looping clip is re-sent to the player with `offsetMs: 0` — the same
 * dispatch the tap makes (`useClipStage.replay`). It is deliberately not a
 * seek: `clipSeekAllowed` refuses every backward move on a `forward-only`
 * source (`clip-controls.ts`, D612), and "back to the start" is the most
 * backward move there is. So on a Hikvision or an Amcrest each iteration costs
 * one REPLAY SESSION on the camera, and those cameras have exactly one replay
 * slot: a second dial while the first is held is refused by the provider with
 * `a replay was refused, the camera's slot is held`
 * (`use-clip-stage-asserted-once.spec.ts` measured that cost for a duplicated
 * TAP; a loop that dialled twice per end would reproduce it once per
 * iteration, forever).
 *
 * Hence {@link ClipLoopMemo}: the clip whose end has ALREADY been answered. A
 * player is free to repeat `ended` — the embed re-posts state on reconnects
 * and a paused-at-end surface can report it more than once — and every repeat
 * after the first must dial nothing. The memo is cleared by any other state,
 * because a file that is loading or playing again has a NEW end ahead of it;
 * that is what lets the second, third and thousandth iteration loop.
 *
 * ## What this deliberately does not do
 *
 * Turning the switch ON while a clip is already sitting at its end replays
 * nothing: no report arrives to decide on, and manufacturing one would mean
 * this module watching a position instead of an event. The play button is the
 * way to restart a clip that has already stopped.
 *
 * Pure: no React, no i18n, no network, no timers.
 */

import type { PlaybackMode as EmbedPlaybackMode } from '../recording/playback-status.js'

/**
 * The clip whose end the loop has already answered, or `null`.
 *
 * Keyed by clip id rather than a boolean so an `ended` belonging to the file
 * BEFORE a prev/next cannot suppress the first loop of the file after it.
 */
export type ClipLoopMemo = string | null

export type ClipLoopEvent =
  /** A clip took the stage — its end has not been answered yet. */
  | { readonly kind: 'opened' }
  /** The stage let the clip go. */
  | { readonly kind: 'closed' }
  /** The player reported a state for the clip the stage holds. */
  | {
      readonly kind: 'player'
      readonly state: EmbedPlaybackMode
      /** The clip the STAGE holds — never the file id the port speaks. */
      readonly clipId: string
      /** The operator's switch, as it stands at this report. */
      readonly loop: boolean
    }

export interface ClipLoopDecision {
  readonly memo: ClipLoopMemo
  /** Re-send this clip to the player, from its first sample. */
  readonly replay: boolean
}

/** No end answered, nothing to replay — what `opened` and `closed` both mean. */
const IDLE: ClipLoopDecision = { memo: null, replay: false }

export function reduceClipLoop(prev: ClipLoopMemo, event: ClipLoopEvent): ClipLoopDecision {
  switch (event.kind) {
    case 'opened':
    case 'closed':
      return IDLE
    case 'player': {
      // Anything that is not the end clears the memo: the file is running
      // again and the end ahead of it is a new one. Without this the loop
      // would fire exactly once per clip and then go quiet.
      if (event.state !== 'ended') return IDLE
      if (!event.loop) return { memo: prev, replay: false }
      // The same end, reported twice. One dial per end — see the docblock for
      // what a second one costs on a single-slot replay.
      if (prev === event.clipId) return { memo: prev, replay: false }
      return { memo: event.clipId, replay: true }
    }
  }
}

/**
 * The loop switch, as the playback bar receives it.
 *
 * ABSENT ⟺ this surface has no clip to loop — the rule every other per-clip
 * binding on that bar follows (`clipProgress`, `record`). An absent binding is
 * an absent control, never a disabled one: there is no camera and no provider
 * that cannot be dialled again from offset 0, so there is no reason to
 * DISABLE this control anywhere (D62 asks for a reason, and inventing one is
 * worse than the control's absence where it has no meaning).
 */
export interface ClipLoopBinding {
  readonly enabled: boolean
  readonly onToggle: () => void
}
