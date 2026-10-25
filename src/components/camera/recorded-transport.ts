/**
 * recorded-transport — pure, render-free logic for the recorded-playback
 * transport cluster (see {@link TimelineTransportControls}). Kept RN-free so it
 * unit-tests under the node vitest environment.
 *
 * ## What is deliberately NOT here: a rate bound
 *
 * This file used to export `MIN_PLAYBACK_RATE`, `MAX_PLAYBACK_RATE = 4` and an
 * `isSupportedPlaybackRate` built on them, documented as *"the mirror of the
 * hub `clampPlaybackRate`"*. They were read by nothing but their own test, and
 * the day the broker's pacer reached 8× over media it HOLDS (D621) the mirror
 * became false — a leftover describing the right design, which reads as
 * verification and is worse than nothing.
 *
 * There is no replacement, because the question is not this app's. What a
 * camera may be played at is `videoclips.getPlaybackOptions`, per camera and
 * per provider, and its outer bound is `CLIP_BROKER_PACED_RATES` — the hub's
 * own ladder, which `clip-playback-options.ts` imports rather than re-typing.
 * `clipRateChoices` takes what the hub declares verbatim, including a rate
 * this build has never heard of, and that is the point: a local ceiling can
 * only ever start refusing a rate the hub can deliver.
 */

/**
 * WHICH WAY the rate menu opens off its chip.
 *
 * `up`   — the list grows ABOVE the chip (the docked playback bar: the bar sits
 *          at the bottom of the column, so the menu has nowhere else to go).
 * `down` — the list grows BELOW it, the ordinary dropdown.
 */
export type RateMenuDirection = 'up' | 'down'

/**
 * A LADDER, IN THE ORDER A MENU OPENING THAT WAY MUST LIST IT.
 *
 * > *"i playback rates dovrebbero avere in basso i piu' lenti, i piu' alti in
 * > alto"* — the operator, 2026-09-23.
 *
 * The ladder arrives ascending, because ascending is a fact about the rate SET
 * — it is the hub's own domain read low-to-high, and every other reader takes
 * it that way. Which end of a LIST the slow rates sit at is a fact about the
 * menu's geometry instead, and it inverts with the geometry: a menu that opens
 * UPWARD puts its first row furthest from the thumb, so listing it ascending
 * would put 0.25× at the top of the screen and 4× against the chip — the
 * reverse of what the operator reads. Hence a function OF the direction rather
 * than a re-ordered constant: if the bar ever opens downward again the order
 * follows it, and nothing has to remember to flip back.
 *
 * `rates` is a PARAMETER, and that is the D612 half of this function. The
 * ladder used to be a constant in this file — six numbers this app chose —
 * which offered 4× on a camera whose clips arrive at 1.01× realtime and can
 * never be paced above 1×. What a camera may be played at is the hub's answer
 * now (`clip-controls.ts` → `clipRateChoices`), it varies per camera, and this
 * function orders whatever it is handed without owning any of it.
 */
export function playbackRateMenuOrder(
  direction: RateMenuDirection,
  rates: readonly number[],
): readonly number[] {
  if (direction === 'down') return rates
  return [...rates].reverse()
}

/** Render a rate as its chip/menu label, e.g. `1` → "1×", `0.25` → "0.25×". */
export function formatRateLabel(rate: number): string {
  return `${rate}×`
}

/** Frame-step is meaningful only at server rate 0 (paused): the feeder holds the
 *  exact access unit. During playback the server ignores `stepFrame`, so the
 *  controls render ONLY while paused. */
export function shouldShowStepControls(paused: boolean): boolean {
  return paused
}
