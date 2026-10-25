/**
 * timeline-card-centering — where the list must be scrolled so that a TAPPED
 * card is shown in the middle.
 *
 * > *"vorrei che al click su una clip la timeline si centri per mostrarla in
 * > mezzo"* — the operator, 2026-09-23.
 *
 * ## Why the card was never in the middle
 *
 * A card used to hang UPWARD from its anchor (bottom edge on the instant it
 * describes); `event-cluster.ts` now puts its TOP edge there and extends it
 * down, `topPx === epochToOffset(anchorMs)`. The history below is the old
 * convention, kept for the clips axis, which still measures from the END. The
 * compressed clips axis says the same thing by a different route:
 * `clipAxisEpochToOffset(axis, clip.startMs)` is `slot.topPx + slot.heightPx`,
 * because the fraction of a clip's card measured from its END is 1 at its
 * start. Both axes, one convention.
 *
 * So a tap that lands the ANCHOR on the cursor lands the card entirely above
 * it, flush — which is what the operator is looking at, and it is what the
 * playhead follower does on the seek arm (`mappedEpochToOffset(activeEpoch)`).
 * The file arm did not scroll at all.
 *
 * ## The geometry, in the scroller's own terms
 *
 * `TimelineScroller` lays every positioned child at
 * `top = cluster.topPx + indicatorOffsetPx` — the top spacer is an ADDITIVE
 * CONSTANT over all content — and the scroll offset subtracts from it. So a
 * card's middle appears at
 *
 *     screenY = cardTopPx + cardHeightPx / 2 + indicatorOffsetPx − offset
 *
 * and landing it on a line at `linePx` means
 *
 *     offset = cardTopPx + cardHeightPx / 2 + indicatorOffsetPx − linePx
 *
 * Note what this does NOT do: it never converts to an epoch and back. The
 * detour through `offsetToEpoch(epochToOffset(anchorMs) − sizePx / 2)` is
 * arithmetically the same answer on the linear day and is a trap on the
 * compressed axis, where `epochToOffset` is piecewise (a whole collapsed hole
 * maps to one marker's middle, and its inverse deliberately lands on the next
 * footage). A card's `topPx` is already expressed in whichever axis it belongs
 * to, so reading the RECTANGLE is axis-agnostic by construction — and it is
 * the same arithmetic the scroller already uses for cluster proximity.
 *
 * ## "In mezzo" is not the same line on both surfaces
 *
 * Where a cursor is drawn, the middle is the CURSOR: that is the line the
 * operator is reading against, and putting the card anywhere else would make
 * the card and the mark disagree. Where none is drawn it is the middle of the
 * VIEWPORT — on a body of files `resolveClipsSurface` answers `playhead:
 * false` (*"Rimuoviamo decisamente il cursore per la modalità clip"*), so
 * there is no line on the glass and "in mezzo" can only mean the middle of
 * what is on screen. The caller reads that from the one authority that
 * already decides it (D606), never from a second guess.
 *
 * ## It moves the LIST, never the pointer
 *
 * The result is a scroll offset, for `scrollListTo` — the programmatic seam
 * that marks the scroll as ours so the resulting `onScroll` is not read as a
 * scrub. A file clip deliberately leaves `activeClipId` null and detaches the
 * playback machine (D570); reaching for `onSeek` to move the list would seek
 * the recorded session behind the file, which is the exact defect
 * `clip-tap.ts` exists to prevent.
 *
 * Pure: no React, no react-native, no i18n. Geometry only.
 */

/** The card's rectangle on its own axis, plus the body it is being shown in. */
export interface CardCenteringInput {
  /** The card's layout offset on the axis it belongs to (`cluster.topPx`). */
  readonly cardTopPx: number
  readonly cardHeightPx: number
  /** The top spacer, which is also the cursor's offset down the viewport. */
  readonly indicatorOffsetPx: number
  readonly viewportHeightPx: number
  /**
   * A cursor line is DRAWN on this surface (`clipsSurface.playhead`).
   *
   * Not "the surface has an epoch axis" and not "the machine is live": the
   * question is whether there is a mark on the glass for the card to sit on.
   */
  readonly cursorDrawn: boolean
}

/**
 * The line the card's middle is brought to, in screen px from the top of the
 * timeline body.
 *
 * Exported so the two meanings of "in mezzo" are one tested statement rather
 * than a ternary buried in the offset arithmetic.
 */
export function cardCenterLinePx(input: CardCenteringInput): number {
  return input.cursorDrawn ? input.indicatorOffsetPx : input.viewportHeightPx / 2
}

/**
 * The scroll offset that shows this card in the middle — or `null` when the
 * question cannot be answered.
 *
 * `null`, never a number, for an unmeasured body or a non-finite rectangle: a
 * 0 px viewport has no middle, and the caller must do NOTHING rather than
 * scroll to a position derived from a measurement that does not exist. A
 * measurement that failed is not 0 (D393).
 *
 * ## A card taller than the body is TOP-aligned, not centred
 *
 * Centring a card that does not fit pushes its beginning off the top of the
 * glass — at the live cursor (a tenth) an 800 px card in a 700 px body would
 * hang 330 px above it, and the half that carries the time label is the half
 * that goes. A card is read from its top, so the top is what is shown: the
 * card's top edge is brought to the top of the body. Nothing then sits on the
 * cursor, which is honest — the cursor is inside the card.
 *
 * ## The ends of the axis clamp, and only the TOP one binds
 *
 * The offset is clamped at 0. That matters at the newest end: the newest
 * cluster hangs from the live edge at `topPx = −sizePx`, and on a file body
 * there are only `indicatorOffsetPx` px of axis above the first card — so the
 * first card or two cannot be pushed down to the line and sit as high as the
 * axis allows instead. There is no leading room to add: the spacer IS the
 * cursor's offset, and growing it would move the cursor.
 *
 * The far end needs no clamp of its own and is not given one, because the
 * bound is structural: `timeline-content-height.ts` extends the content one
 * viewport BELOW the cursor past the last addressable offset, so every offset
 * up to the axis span is reachable — and a centre offset is strictly less
 * than the card's bottom edge, which is at most that span. Asserted in the
 * spec against the real `timelineMaxScrollOffsetPx` rather than assumed.
 */
export function cardCenterScrollOffsetPx(input: CardCenteringInput): number | null {
  const { cardTopPx, cardHeightPx, indicatorOffsetPx, viewportHeightPx } = input
  if (!Number.isFinite(cardTopPx) || !Number.isFinite(cardHeightPx)) return null
  if (!Number.isFinite(indicatorOffsetPx)) return null
  if (!Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0) return null

  if (cardHeightPx > viewportHeightPx) {
    return Math.max(0, cardTopPx + indicatorOffsetPx)
  }
  return Math.max(0, cardTopPx + cardHeightPx / 2 + indicatorOffsetPx - cardCenterLinePx(input))
}

/**
 * The window a tap placed the list for.
 *
 * The tapped clip's own span — the only thing that can say when the operator
 * has stopped looking at what he asked for.
 */
export interface TapPlacement {
  readonly fromMs: number
  readonly toMs: number
}

/**
 * Is the tap's placement still the operator's, or has the machine taken the
 * list back?
 *
 * ## Why this exists at all
 *
 * On the SEEK arm the tap is followed by the playhead follower, which scrolls
 * to `mappedEpochToOffset(activeEpoch)` — the card's bottom edge, the very
 * placement being replaced — on every position report. Without a hold the
 * centring is not a move, it is a bounce: visible for one report and then
 * undone, which is worse than the flush-above placement it was meant to fix.
 *
 * ## …and why the hold is bounded by the CLIP, not by a timer
 *
 * A timer would be a number nobody can defend, and it would either expire
 * mid-clip (the bounce, late) or outlast the clip (the list stops following
 * work the operator never chose). The clip's own window is the fact that
 * answers the question: while the playhead is inside the clip the operator is
 * watching exactly what he tapped and the list must stay where his tap put
 * it — *"one deliberate move at the tap, and nothing afterwards"*. The moment
 * playback runs past its end, the SEQUENCER chose what is on screen, not him,
 * and the follower takes the list back — which is also what brings the next
 * clip's card into view.
 *
 * A playhead BEFORE the window releases too. The recorded transport snaps a
 * seek to the nearest footage, and a derived clip's window is footage-clamped
 * so it normally lands inside; if it does not, releasing degrades to exactly
 * today's behaviour, where a hold that never expires would strand the list.
 */
export function holdsTapPlacement(
  placement: TapPlacement | null,
  activeEpochMs: number | null,
): boolean {
  if (placement === null || activeEpochMs === null) return false
  if (!Number.isFinite(activeEpochMs)) return false
  return activeEpochMs >= placement.fromMs && activeEpochMs <= placement.toMs
}
