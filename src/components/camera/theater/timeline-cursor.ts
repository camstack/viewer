/**
 * timeline-cursor — WHAT the timeline's position cursor is saying.
 *
 * ## There is no CLIP arm, and there must not be one again
 *
 * > *"Rimuoviamo decisamente il cursore per la modalità clip e l'hook dello
 * > scroll, anche verso il live, non deve fare alcuna azione"* — the operator,
 * > 2026-09-23, having watched it run for a day on v1.0.540.
 *
 * A third arm existed here for exactly that day: while a native FILE held the
 * frame the cursor read the file's own axis — elapsed, the length when one had
 * been measured, an indeterminate sweep when none had — and the pill doubled
 * as the control that re-hooked a released scroll follow. It was built because
 * the pill had been printing `HH:MM:SS` of `activeEpoch` under a held file,
 * which is a moment in cluster time the picture is not at (no epoch addresses
 * a position inside a file — `clip-progress.ts`, D575).
 *
 * The reading was true and it was still the wrong object, for two reasons the
 * operator felt before either of them was written down:
 *
 *  - **A mark pinned over a list that cannot be dragged reads as a control.**
 *    While a file holds the frame the body under the cursor is the clip LIST:
 *    the scrub is refused at the source (`clips-surface.ts`, `scrub: false`)
 *    and so, now, is the live-edge snap. Every other cursor in this app sits
 *    over an axis a finger commands. This one sat over one that ignores it.
 *  - **A follow that fights the operator's own scroll is worse than no
 *    follow.** The pill's second job was re-hooking `clip-follow.ts`, which
 *    scrolled the list under the reader while he was looking for the next
 *    clip. Both are deleted; neither is disabled.
 *
 * So the cursor is withdrawn on that surface entirely — `playhead: false` on
 * the clip arm of `clips-surface.ts` — and the questions it used to answer
 * have owners that take a gesture: how far through, on the running row's own
 * strip (`clip-row-playback.ts` / `ClipRowProgress`), and the seekable
 * file-relative position on `ClipProgressBar` in the transport band (D575,
 * D602).
 *
 * A future edit that gives this union a `clip` arm, or hands
 * {@link TimelineCursorInput} a clip position, has rebuilt the thing that was
 * removed. `clip-row-and-rate-order-wiring.spec.ts` guards it.
 *
 * ## The cursor has never encoded a position by MOVING
 *
 * The theater's cursor is a line laid out at one of TWO positions down the
 * viewport (`timeline-indicator.ts`: a tenth at the live edge, a half
 * everywhere else, held still while a scrub is in flight) with a pill on it.
 * The content scrolls UNDER it: the line's y is layout, never a fraction, and
 * it does not move while the axis does — the two positions are switched by
 * WHAT the timeline is on, never by how far from live it has been dragged.
 *
 * What is left is the two things the EPOCH axis can be showing:
 *
 *  - {@link TimelineLiveCursor} — the live edge.
 *  - {@link TimelineEpochCursor} — a moment in OUR footage. It is also what a
 *    DERIVED clip gets: such a clip is played by seeking our own recording, so
 *    the cursor sits over the running card on the body's own axis, its
 *    wall-clock reading is TRUE, and a drag there really is a seek.
 *
 * Pure: no React, no i18n, no network.
 */

/** The live edge. The pill reads "LIVE" and the line takes the live accent. */
export interface TimelineLiveCursor {
  readonly kind: 'live'
}

/** A moment in OUR footage — cluster time, the axis the body is laid out on. */
export interface TimelineEpochCursor {
  readonly kind: 'epoch'
}

export type TimelineCursor = TimelineLiveCursor | TimelineEpochCursor

export const LIVE_CURSOR: TimelineLiveCursor = { kind: 'live' }
export const EPOCH_CURSOR: TimelineEpochCursor = { kind: 'epoch' }

export interface TimelineCursorInput {
  /** The playback machine is at the live edge. */
  readonly isLive: boolean
}

/**
 * Which of the two the cursor is.
 *
 * No clip input reaches here, deliberately — see the header. Where a file
 * holds the frame the cursor is not drawn at all, so there is nothing for a
 * file-relative reading to be an arm of.
 */
export function resolveTimelineCursor(input: TimelineCursorInput): TimelineCursor {
  return input.isLive ? LIVE_CURSOR : EPOCH_CURSOR
}
