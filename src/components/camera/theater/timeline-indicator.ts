/**
 * timeline-indicator — pure geometry for the single configurable current-position
 * indicator line on the theater vertical timeline.
 *
 * The indicator marks where the CURRENT epoch (live edge / playhead / scrub) sits
 * on screen, as a percentage of the viewport height from the top. The timeline
 * content is laid out with a TOP SPACER of exactly this pixel height, so the
 * current epoch naturally rests on the indicator line while ALL existing
 * scroll/scrub geometry (`offsetToEpoch` / `epochToOffset`) stays unchanged.
 *
 * The percentage is NOT one number: it is two states on a fact the machine
 * already owns — on the live edge, or not — resolved by
 * {@link resolveIndicatorPct}. It follows that fact immediately, mid-gesture
 * included; the MOTION between the two positions is
 * `timeline-cursor-shift.ts`. Pure: no React, no i18n, geometry only.
 */
/** Clamp a percentage to [0, 100]; non-finite degrades to 0. */
function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0
  return Math.min(100, Math.max(0, pct))
}

/**
 * Pixel offset (from the top of the timeline body) where the current-position
 * indicator line is drawn — equivalently the height of the top spacer added to
 * the scroll content — for a given viewport height and configured percent.
 *
 *   indicatorOffsetPx(800, 50) === 400
 *   indicatorOffsetPx(800,  0) === 0
 *   indicatorOffsetPx(800, 100) === 800
 *
 * Guards: a non-positive / non-finite viewport height yields 0 (no spacer); a
 * non-finite percent degrades to 0. The result is rounded to a whole pixel and
 * the percent is clamped to [0, 100].
 */
export function indicatorOffsetPx(viewportHeight: number, indicatorPositionPct: number): number {
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0
  return Math.round((viewportHeight * clampPct(indicatorPositionPct)) / 100)
}

/**
 * Where the line sits while the timeline is ON the live edge, as a percent of
 * viewport height from the top.
 *
 * A tenth. The band above the line is the immediate FUTURE (times not yet
 * reached) and nothing is ever drawn there, so headroom at the live edge is
 * headroom spent on nothing — which is why the operator asked for this value
 * to be kept exactly as it is.
 */
export const LIVE_INDICATOR_POSITION_PCT = 10

/**
 * Where the line sits everywhere ELSE on the axis.
 *
 * Half. In playback the band above the line is *what plays next*, and it is
 * also where a card's older neighbours live. A card's TOP edge is its newest
 * event (`event-cluster.ts` — `topPx === epochToOffset(anchorMs)`) and it
 * extends down, so a snap to that event puts the card entirely BELOW the line
 * and the headroom above it is spent on the cards that come next. At a tenth of a 393×700 phone that is
 * 70 px of room for a 133 px default card: 53 % visible, 63 px cut off the top,
 * 44 % for the wide preset and 26 % in the landscape drawer. No preset fits at
 * a tenth on any body measured; every preset fits at a half on every one.
 *
 * Not a setting: the per-user stepper was removed at the operator's request
 * (`cea33fda`). Two states on a fact the machine already owns, never a ramp —
 * a continuous function of distance from live decouples the finger from the
 * content mid-drag and CREEPS while paused (6.8 px/min at the default zoom,
 * 0.45 at 12h), because the live edge advances on a 1 Hz clock the follow
 * re-runs on. See `docs/design/2026-09-23-dynamic-cursor-position.md` in the
 * server repo.
 */
export const PLAYBACK_INDICATOR_POSITION_PCT = 50

/**
 * What the line's position is decided from. Nothing else is consulted.
 *
 * The playback MODE used to be here too, for a hold through `seeking` that is
 * gone. It is not kept "for clarity": a field no branch reads is a field the
 * next reader will assume is load-bearing.
 */
export interface IndicatorPctInput {
  /**
   * The TIMELINE is on the live edge: `mode === 'live' && activeEpoch === null`.
   * The live lock (browsing a past moment while the machine stays in `live`)
   * therefore counts as not-live, which is what it looks like on screen.
   */
  readonly atLiveEdge: boolean
}

/**
 * The line's position, as a percent, from the current state alone.
 *
 * ## There WAS a hold through `seeking`, and it is gone (2026-09-23)
 *
 * `SCRUB_BEGIN` puts the machine in `seeking` on the first drag frame past the
 * 15 s live tolerance — mid-gesture, with a finger on the glass. This function
 * used to return its previous value for every frame of that, so the move
 * landed at the COMMIT instead. The operator, having seen the commit version:
 * *"Mooolto meglio il cursore ma accade al primo rilascio, riusciamo a farlo
 * accadere anche durante lo scrub?"*
 *
 * The hold's stated reason was that moving the line moves the top spacer and
 * every positioned child with it, so "the content would slide out from under
 * the finger". Half of that is true and the important half is not:
 *
 *  - **The moment under the line does not change.** `contentY(e)` is
 *    `f(e) + indicatorOffsetPx` — the spacer is an additive constant over ALL
 *    content — and the scrub maps the RAW scroll offset
 *    (`mappedOffsetToEpoch(offsetY, …)`, no spacer term). So the epoch under
 *    the cursor is a function of the scroll offset alone. Growing the spacer
 *    slides the line and the content down together, by the same pixels, and
 *    the readout is untouched. Verified against both call sites rather than
 *    argued from the docs.
 *  - **The content does slide**, by the distance between the two positions,
 *    relative to the finger. That is the real cost, and it is now paid over
 *    {@link CURSOR_SHIFT_MS} on an ease-out instead of in one frame
 *    (`timeline-cursor-shift.ts`) — and paid while the content is ALREADY
 *    moving under the finger, which is where it is least visible. At the
 *    commit, by contrast, everything else is still, which is exactly why that
 *    is where it showed.
 *
 * Total content height is `day + viewport` regardless of the spacer, so the
 * scroll offset cannot clamp and the gesture is not interrupted.
 *
 * `gap` and `error` are not the live edge and take the playback position. The
 * return to the live edge still lands at the commit, because `atLiveEdge`
 * requires `mode === 'live'` and a drag cannot be in that mode.
 */
export function resolveIndicatorPct(input: IndicatorPctInput): number {
  return input.atLiveEdge ? LIVE_INDICATOR_POSITION_PCT : PLAYBACK_INDICATOR_POSITION_PCT
}
