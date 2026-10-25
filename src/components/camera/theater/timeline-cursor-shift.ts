/**
 * timeline-cursor-shift — the MOTION between the cursor's two positions.
 *
 * > *"non riusciamo a renderlo progressivo? E' abbastanza brutto cosi"* — the
 * > operator, 2026-09-23, on v1.0.542, having met the one artefact the
 * > two-state cursor left: at the release of a hand scrub that leaves live the
 * > content dropped 280 px in a single frame.
 *
 * ## What is progressive here, and what is emphatically NOT
 *
 * The RULE is unchanged and stays unchanged: two states on a fact the machine
 * already owns (`timeline-indicator.ts` — a tenth at the live edge, a half
 * everywhere else), held through `seeking`. Nothing here reads a distance from
 * live. A cursor whose position is a function of that distance was rejected on
 * measurement, not taste: it drifts 6.8 px/min at the default zoom **while
 * paused**, because the live edge advances on a 1 Hz clock the follow re-runs
 * on, and it decouples the finger from the content mid-drag.
 *
 * What becomes progressive is the TRANSITION. The layout jumps to its final
 * position in one commit — every `top`, the mount band, the content height —
 * and a single visual OFFSET, starting at the difference between the two
 * positions and easing to zero, carries what the eye sees from the old
 * position to the new one. So the geometry that was proved invariant is not
 * touched at all: the shift is a transform, never a height and never a `top`.
 *
 * ## Why a transform, and why the content height cannot move
 *
 * Total scroll-content height is `spacer + day + (viewport − spacer)` =
 * `day + viewport` — independent of the cursor's percentage
 * (`timeline-content-height.ts`, asserted at both positions). So the cursor
 * move never changes `contentSize` even at its endpoints. Carrying the motion
 * in a transform keeps that true DURING the animation as well: a transform
 * changes no frame, so no scroll event is emitted, nothing clamps, and the
 * scroll offset the operator scrubbed to is preserved to the pixel.
 *
 * Pure: no React, no react-native, no i18n. The easing is a plain function of
 * progress so the CURVE is a tested artefact rather than a library default.
 */

/**
 * How long the 280 px move takes.
 *
 * Chosen against the size of the move, not taken from a default. The shift is
 * 280 px on a 393×700 phone (40 % of the body) and 304 px on a Pro Max — a
 * large translation, and the published guidance for one of that size on a
 * hand-held display sits at 200–300 ms.
 *
 *  - Under ~150 ms the eye does not resolve the path and it reads as the jump
 *    it replaces, which is the thing being fixed.
 *  - Over ~350 ms the operator is waiting to READ the new position — and this
 *    fires at the release of a scrub, when he has just asked to see a moment.
 *    A slow settle there reads as the app being busy.
 *
 * 220 ms sits above the first threshold with margin and well under the second.
 */
export const CURSOR_SHIFT_MS = 220

/**
 * The curve: cubic ease-OUT, `1 − (1 − t)³`.
 *
 * Decelerating, deliberately, and it is the half of this the operator will
 * actually judge.
 *
 *  - **Linear lurches.** Constant velocity over 280 px starts and stops dead;
 *    the stop is read as a collision, and at this distance that is most of
 *    what "brutto" describes.
 *  - **Ease-in / ease-in-out is wrong at THIS moment.** The move begins at the
 *    instant the finger leaves the glass. A slow start there reads as the app
 *    not having noticed the release — unresponsiveness, which costs more than
 *    a hard landing.
 *  - **Ease-out** covers 65 % of the distance in the first third of the
 *    duration, so the answer is visibly under way immediately, and approaches
 *    the target asymptotically, which reads as settling rather than stopping.
 *
 * Cubic rather than quadratic: quad's tail is not slow enough to lose the stop
 * at 280 px, and quart overshoots into feeling sluggish in the last third.
 */
export function cursorShiftEase(progress: number): number {
  'worklet'
  if (!Number.isFinite(progress)) return 1
  const t = Math.min(1, Math.max(0, progress))
  const remaining = 1 - t
  return 1 - remaining * remaining * remaining
}

/** One cursor transition, as the component knows it. */
export interface CursorShiftInput {
  /**
   * The visual offset currently in force — 0 when nothing is animating, and
   * mid-flight when a transition is INTERRUPTED by another one.
   */
  readonly currentShiftPx: number
  /** The cursor offset the layout is leaving. */
  readonly fromOffsetPx: number
  /** The cursor offset the layout has already jumped to. */
  readonly toOffsetPx: number
}

/**
 * Where the visual offset must START so that nothing moves in the frame the
 * layout jumps.
 *
 * ## The interruption is the whole reason this is arithmetic and not `−Δ`
 *
 * Scrub away from live and, before the 220 ms are up, tap go-live. Three
 * behaviours were available and only one is right:
 *
 *  - **Queue** — the second move waits for the first. Rejected outright: the
 *    operator's last instruction is answered last, and the cursor is still
 *    travelling toward a position he has already left. Worse than the jump.
 *  - **Snap** — restart from the full new delta. Defensible, and wrong here:
 *    the visible offset is some value strictly between the two positions, and
 *    restarting from the full delta TELEPORTS the content by whatever distance
 *    had already been covered. It reintroduces exactly the jump being removed,
 *    at a moment the operator caused by pressing something.
 *  - **Retarget from where it is** — what this returns. The on-screen position
 *    of the content is `layoutOffset + shift`; preserving it across the layout
 *    jump means the new shift is `currentShift + (from − to)`. Continuous by
 *    construction: `to + start === from + currentShift`. That identity is the
 *    spec's assertion, and it holds for a chain of interruptions of any length
 *    because each one is expressed against the value actually in force.
 */
export function cursorShiftStartPx(input: CursorShiftInput): number {
  const { currentShiftPx, fromOffsetPx, toOffsetPx } = input
  const current = Number.isFinite(currentShiftPx) ? currentShiftPx : 0
  if (!Number.isFinite(fromOffsetPx) || !Number.isFinite(toOffsetPx)) return 0
  return current + (fromOffsetPx - toOffsetPx)
}

/**
 * Where content laid out at `layoutOffsetPx` actually appears while a shift of
 * `shiftPx` is in force.
 *
 * Exported for the continuity assertion — the invariant above is worth stating
 * once, in the vocabulary of the thing it protects, rather than as an
 * arithmetic identity a reader has to trust.
 */
export function cursorShiftScreenPx(layoutOffsetPx: number, shiftPx: number): number {
  return layoutOffsetPx + (Number.isFinite(shiftPx) ? shiftPx : 0)
}

/** What the component must know about the body to run a transition at all. */
export interface CursorShiftGate {
  readonly fromOffsetPx: number
  readonly toOffsetPx: number
  readonly viewportHeightPx: number
}

/**
 * Whether this change of cursor position is a MOVE to animate.
 *
 * Two things reach the component as a changed cursor offset and are not:
 *
 *  - **The body being measured.** `viewportHeight` is 0 until the first
 *    layout, so the offset goes 0 → 70 on mount. Sliding the whole timeline in
 *    from above on every mount is not what was asked for.
 *  - **A rotation or a drawer resize.** The percentage did not change; the
 *    viewport did. The offset moves with it and the content is re-laid-out by
 *    the same layout pass — animating a translation on top of that fights the
 *    resize.
 *
 * Both are `fromOffsetPx === toOffsetPx` OR an unmeasured body, which is why
 * the CALLER drives this from a change of PERCENTAGE and passes the offsets it
 * derived. A gate on the offsets alone could not tell a rotation from a move.
 */
export function shouldAnimateCursorShift(gate: CursorShiftGate): boolean {
  const { fromOffsetPx, toOffsetPx, viewportHeightPx } = gate
  if (!Number.isFinite(viewportHeightPx) || viewportHeightPx <= 0) return false
  if (!Number.isFinite(fromOffsetPx) || !Number.isFinite(toOffsetPx)) return false
  return fromOffsetPx !== toOffsetPx
}
