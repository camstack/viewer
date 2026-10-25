/**
 * clip-controls — what the chrome may OFFER for a clip, and what it must draw
 * disabled instead.
 *
 * ## What the hub says, and why it has to say it
 *
 * A clip reaches the player over one of two transports, and the provider's
 * wiring picks which (D599, D612). One of them, the provider's stream, is
 * FORWARD-ONLY: the bytes behind the playhead were never kept and the camera
 * offers no replay-from-offset, so a backward seek is refused and the position
 * re-sent. One of them is realtime-BOUND besides — a Hikvision RTSP replay
 * measured at 1.01× realtime, where a pacer asked for 2× drains a buffer the
 * rest of the clip was never in.
 *
 * Without being told, the chrome draws the same bar and the same six-rate
 * menu for all of them. The operator drags back and the bar snaps forward;
 * they pick 4× and get 1×. A control that undoes the gesture reads as BROKEN,
 * where a disabled one reads as unavailable. That is the distinction D62
 * exists for, and it is why this is a DECLARATION the hub makes per camera and
 * per provider (`videoclips.getPlaybackOptions`) rather than something this
 * app infers from a provider's name.
 *
 * ## One authority for four questions
 *
 * Seek freedom, backward frame-step, scrub, and the rate LADDER all come off
 * the same envelope. The ladder especially: this app used to draw its own
 * six-rate list from a local constant and offer rates the hub could not
 * deliver. `clip-playback-options.ts` imports the hub's own
 * `CLIP_BROKER_PACED_RATES` instead, and what a camera may actually be played
 * at is whatever ITS envelope said.
 *
 * ## Absent is the freedom we always had
 *
 * `getPlaybackOptions` is an `optionalMethod`. A hub that does not expose it
 * has not said the clip is restricted; it has said nothing.
 * {@link LEGACY_CONTROLS} is therefore the OLD behaviour — free seeking,
 * backward frame-step, scrub, the full broker ladder — and NOT the safest one.
 * A viewer newer than its hub must not start refusing gestures that worked.
 * `pending` and `unknown` resolve there too: a restriction is something the
 * hub SAYS (`clip-playback-options.ts` has the four-state reasoning, D315).
 *
 * ## What is NOT here
 *
 * The camera's own `playSpeed` (which reaches 8 and 16 on a Reolink). The rate
 * applied to a clip is the BROKER's — it re-paces frames it has already
 * decoded — and the camera's replay speed is deliberately not wired (D597,
 * D600: its 8x replay would need a resample the path has no decoder for). When
 * it IS wired its rates join the hub's ladder; they never appear here.
 *
 * Pure: no React, no i18n, no network.
 */

import type { ClipPlaybackOptions } from '@camstack/types'

import {
  CLIP_LEGACY_RATE_LADDER,
  type ClipPlaybackPresence,
} from './clip-playback-options.js'

/**
 * How far a position may be moved inside one clip.
 *
 * `forward` — only ahead of where playback has already reached. The bytes
 *   behind the head were never kept, so "back to the start" is as impossible
 *   as any other backward move.
 * `free` — anywhere, which needs an index and therefore the whole file.
 */
export type ClipSeekFreedom = 'forward' | 'free'

export interface ClipSourceControls {
  readonly seek: ClipSeekFreedom
  /** Frame-step BACKWARD is meaningful. Forward always is. */
  readonly stepBack: boolean
  /** A drag along the clip's own track is SERVED — a forward-only transport
   *  has nothing to scrub through. */
  readonly scrub: boolean
  /** The rates this camera's clips can really be played at, ascending, always
   *  containing 1. What a menu may ENABLE — never what it draws, see
   *  {@link clipRateChoices}. */
  readonly rates: readonly number[]
}

/**
 * What a clip gets when the hub has said nothing — the OLD behaviour,
 * deliberately, not the safest one.
 */
export const LEGACY_CONTROLS: ClipSourceControls = {
  seek: 'free',
  stepBack: true,
  scrub: true,
  rates: CLIP_LEGACY_RATE_LADDER,
}

/**
 * The controls for a clip, WITH the standing of the answer they came from.
 *
 * Both halves travel together because a control may only be drawn disabled on
 * the strength of an answer. The `controls` alone cannot say whether a `false`
 * came from the hub or from this app's fallback, and a surface that disabled a
 * control on a pending read would be claiming a camera cannot do something
 * nobody has asked about yet (D315).
 */
export interface ClipControlsView {
  readonly presence: ClipPlaybackPresence
  readonly controls: ClipSourceControls
}

/** The view a surface with nothing to ask about uses — every control live. */
export const LEGACY_CONTROLS_VIEW: ClipControlsView = {
  presence: 'absent',
  controls: LEGACY_CONTROLS,
}

/**
 * Turn one read of `getPlaybackOptions` into what the chrome may draw.
 *
 * `present` with a readable envelope is the ONLY arm that restricts anything.
 * The envelope is taken WHOLE — no per-field fallback, because the hub returns
 * one of three fixed envelopes and never composes one, so a field missing from
 * it is a payload that could not be read at all (the parser has already said
 * so by answering null) rather than a field the hub declined to state.
 */
export function resolveClipControls(
  presence: ClipPlaybackPresence,
  options: ClipPlaybackOptions | null,
): ClipControlsView {
  if (presence !== 'present' || options === null) {
    return { presence, controls: LEGACY_CONTROLS }
  }
  return {
    presence,
    controls: {
      seek: options.seek,
      stepBack: options.stepBack,
      scrub: options.scrub,
      rates: options.rates,
    },
  }
}

/**
 * May the surface commit a seek to `targetMs`, given where playback is?
 *
 * `forward` compares against the HEAD, not against zero: on a streamed clip
 * the bytes behind the head were never kept, so "back to the start" is as
 * impossible as any other backward move, and a surface that allowed it would
 * hang on a position that can never arrive.
 */
export function clipSeekAllowed(
  controls: ClipSourceControls,
  targetMs: number,
  headMs: number,
): boolean {
  return controls.seek === 'free' || targetMs >= headMs
}

/**
 * The lowest point on the clip's own track the gesture may reach, as a
 * fraction — the drawn half of {@link clipSeekAllowed}.
 *
 * `headFraction` is where the picture is, or `null` before the player has said.
 * A floor derived from an unknown position would lock the whole track on a clip
 * that has only just opened, so an unknown head means no floor at all: the same
 * discipline as everywhere else here, where absence is the freedom we had.
 *
 * It lives beside the commit gate so the control that DRAWS the limit and the
 * hook that ENFORCES it read one rule. They disagreed for a release, in the
 * direction that matters: the bar took a backward drag the commit then threw
 * away.
 */
export function clipSeekFloorFraction(
  controls: ClipSourceControls,
  headFraction: number | null,
): number {
  if (controls.seek === 'free') return 0
  if (headFraction === null || !Number.isFinite(headFraction)) return 0
  return Math.min(1, Math.max(0, headFraction))
}

/** May the surface offer a backward frame-step? */
export function clipStepBackAllowed(controls: ClipSourceControls): boolean {
  return controls.stepBack
}

/** May the surface offer a drag along the clip's own track? */
export function clipScrubAllowed(controls: ClipSourceControls): boolean {
  return controls.scrub
}

/** May this camera's clips be played at `rate`? */
export function clipRateAllowed(controls: ClipSourceControls, rate: number): boolean {
  return controls.rates.includes(rate)
}

/**
 * Every rate a menu DRAWS, ascending.
 *
 * ## This used to be a union, and the operator threw it out
 *
 * > *"nascondi il selettore e basta. Mostrare quella label non ha alcun senso
 * > proprio per niente"* — 2026-09-23, on a Hikvision and an Amcrest.
 *
 * It was the union of this build's ladder with the camera's own, so a rate the
 * camera could not serve was still drawn, greyed, with one line at the foot of
 * the list explaining the cap. That was D62's rule at its sharpest — a control
 * the camera cannot serve is disabled with its reason, never hidden — and the
 * reasoning is sound for a choice WITHIN a control: a menu that silently
 * stopped at 1× would be indistinguishable from a viewer that never built 2×.
 *
 * What it missed is the cost. Both of those cameras declare `[0.25, 0.5, 1]`,
 * so the menu drew three live rows, three dead ones and a paragraph, to say
 * something the operator learns once per camera and then never needs again. He
 * is the one who pays that every time he opens the menu, and he has said what
 * it is worth. Answered instead by drawing only what works — and by
 * {@link clipRateMenuShown}, which removes the control entirely when there is
 * nothing left to choose.
 *
 * On a `present` answer that is `controls.rates` verbatim: the hub decides
 * what exists, including a rate this build has never heard of. On anything
 * else nothing has been said about the camera, so the legacy ladder stands —
 * a pending read must never shrink a menu (D315).
 */
export function clipRateChoices(view: ClipControlsView): readonly number[] {
  const source = view.presence === 'present' ? view.controls.rates : CLIP_LEGACY_RATE_LADDER
  const all = new Set<number>(source)
  return [...all].sort((a, b) => a - b)
}

/**
 * Is there a rate CONTROL at all?
 *
 * A menu whose every row but one is gone is not a menu: there is nothing to
 * choose, and a chip that opens onto a single item is furniture. The absence
 * of a speed control on such a camera says "this one plays at one speed" more
 * plainly than a list explaining itself.
 *
 * Only ever hidden on a `present` answer, for the same reason as above.
 */
export function clipRateMenuShown(view: ClipControlsView): boolean {
  return clipRateChoices(view).length > 1
}

/**
 * Should this surface draw `rate` as DISABLED?
 *
 * Only on a `present` answer. On `pending`, `absent` or `unknown` the controls
 * are the legacy freedom and nothing is claimed about the camera — disabling a
 * row there would be a UI asserting an absence from a query that never
 * answered (D315).
 */
export function clipControlDisabled(view: ClipControlsView, allowed: boolean): boolean {
  return view.presence === 'present' && !allowed
}
