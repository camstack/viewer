/**
 * timeline-content-height — how TALL the scroll content is, and therefore
 * which positions the list can actually be scrolled to.
 *
 * > *"il posizionamento del cursore non e' corretto, sembra andare parecchio
 * > sopra alla clip"* — the operator, 2026-09-23.
 *
 * ## The cursor cannot be in the wrong place
 *
 * It is laid out at a percentage of the viewport and the content scrolls
 * under it (`timeline-indicator.ts` — a tenth at the live edge, a half
 * everywhere else). So "the cursor is above the clip" is always a statement
 * about the OFFSET: the list was not scrolled as far as it was asked to be.
 *
 * That percentage having two values changes nothing below. The rule is
 * DERIVED from it, and the total content height is the same number at both
 * (`spacer + day + (viewport − spacer)`), so no position clamps that another
 * does not — asserted at both in the spec, not assumed.
 *
 * ## It was asked, and it could not comply
 *
 * The content was laid out as `spacer + dayHeight + footerInset`, where the
 * spacer is the cursor's own offset. A ScrollView clamps at
 * `contentHeight − viewportHeight`, so the furthest reachable offset was
 *
 *     indicatorPx + dayHeight + footerInset − viewportHeight
 *
 * while the furthest offset anything ASKS for is `dayHeight` — the oldest
 * addressable content. The shortfall is therefore a constant
 *
 *     viewportHeight − indicatorPx − footerInset
 *
 * which at 10 % and a ~72 px footer is about **0.8 × the viewport**: measured
 * at 558 px on a 700 px body. Every position within 558 px of the end of the
 * axis was unreachable, the scroll stopped short, and the card rendered that
 * far BELOW the cursor. On a compressed clips axis — six cards, 632 px — that
 * is nearly the whole list, which is why it read as "parecchio" and as
 * systematic rather than as an edge case.
 *
 * This is not new. The linear day has always had it at its oldest end, and the
 * playback auto-follow has always been clamped there. Nothing scrolled the
 * list for a native clip until the clip follow did (a short-lived module,
 * removed on 2026-09-23 — see `timeline-cursor.ts` for why), and that is what
 * made a long-standing under-scroll constant and visible. The follow is gone;
 * the shortfall it exposed is this module's and is NOT, which is why nothing
 * below changed with it.
 *
 * ## The rule, derived rather than nudged
 *
 * For an offset `o` to put its content on the cursor, the list must be able to
 * scroll to `o`. The last addressable offset is `dayHeight`, so the content
 * must extend **one viewport below the cursor line** past it — that is
 * `viewportHeight − indicatorPx` of trailing room, and it is the same quantity
 * whatever the axis, the zoom, the row height or the card size. No constant is
 * chosen here and none can be tuned: change the cursor's percentage and the
 * pad follows it.
 *
 * The footer's own inset is a DIFFERENT need — it keeps the last card clear of
 * a band that hovers over the content — so the two are taken as a MAXIMUM, not
 * a sum. A card resting on the cursor at a tenth of the viewport is nowhere
 * near the footer, and adding them would scroll a screenful of nothing past
 * the end of every timeline.
 *
 * Pure: no React, no i18n. Geometry only.
 */

export interface TimelineContentHeightInput {
  /** The top spacer, which is also the cursor's offset down the viewport. */
  readonly indicatorOffsetPx: number
  /** The axis's own span: the last addressable content offset. */
  readonly dayHeightPx: number
  /** Room reserved so the last card clears a hovering band at the bottom. */
  readonly contentBottomInsetPx: number
  /** Room reserved so the first cards can scroll below the top tools bar. */
  readonly contentTopInsetPx?: number
  readonly viewportHeightPx: number
}

/**
 * Trailing room below the last addressable offset, so ANY offset can be
 * brought to the cursor line.
 *
 * Exported for the guard that pins it: a future edit that replaces this with a
 * number has reintroduced the defect, and the number will look reasonable.
 */
export function timelineTrailingRoomPx(input: TimelineContentHeightInput): number {
  const { viewportHeightPx, indicatorOffsetPx, contentBottomInsetPx } = input
  if (!Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0) {
    return Math.max(0, contentBottomInsetPx)
  }
  // One viewport BELOW the cursor. The footer's reservation is a different
  // need competing for the same room — hence the max, never a sum.
  const toReachTheCursor = Math.max(0, viewportHeightPx - Math.max(0, indicatorOffsetPx))
  return Math.max(toReachTheCursor, Math.max(0, contentBottomInsetPx))
}

/** Total scroll-content height: the spacer, the axis, and the trailing room. */
export function timelineContentHeightPx(input: TimelineContentHeightInput): number {
  const spacer = Math.max(0, input.indicatorOffsetPx)
  const topPad = Math.max(0, input.contentTopInsetPx ?? 0)
  const day = Math.max(0, input.dayHeightPx)
  return spacer + topPad + day + timelineTrailingRoomPx(input)
}

/**
 * The furthest the list can be scrolled — what a ScrollView clamps to.
 *
 * Here so the invariant can be ASSERTED rather than reasoned about: every
 * offset the axis can name must be ≤ this.
 */
export function timelineMaxScrollOffsetPx(input: TimelineContentHeightInput): number {
  return Math.max(0, timelineContentHeightPx(input) - Math.max(0, input.viewportHeightPx))
}
