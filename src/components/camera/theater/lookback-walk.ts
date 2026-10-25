import { dayBounds, shiftLocalDay } from '../../../lib/local-day.js'

/**
 * lookback-walk — the latch that decides whether a near-bottom scroll may ask
 * the timeline for ONE MORE DAY of history.
 *
 * The vertical timeline loads a window that starts at the viewed day's midnight
 * and grows BACKWARDS one calendar day at a time: `timelineFromMs =
 * shiftLocalDay(dayFrom, 1 − lookbackDays)` (TheaterTimeline). Scrolling near the oldest end asks
 * for the next day. Two facts make that ask harder than a boolean:
 *
 *  1. the request is asynchronous — `lookbackDays` is React state, so the value
 *     this hook reads still holds the OLD number for a render after the call.
 *     Without a latch, holding near the bottom fires the request on every scroll
 *     frame and widens the window by several days in one gesture;
 *  2. the owner RESETS `lookbackDays` to 1 whenever the VIEWED DAY changes, and
 *     scrubbing backwards across midnight changes the viewed day. So the number
 *     the latch watches does not only grow — it drops back, by a path that has
 *     nothing to do with any request.
 *
 * A latch that only remembers "I already asked at N" cannot tell (2) from (1):
 * after one extension it holds 1, the midnight crossing puts `lookbackDays` back
 * to 1, and every later ask is read as the not-yet-landed echo of a request that
 * landed minutes ago. The walk then stops dead at the SECOND midnight — the
 * first crossing works, the next one does not, which is exactly how the operator
 * described it ("si ferma a mezzanotte, come se non ricaricasse la timeline").
 *
 * ## …and why "any movement discharges it" was not the end of the story
 *
 * That rule — discharge on ANY movement of the observed value — is what the
 * latch held until 2026-09-21, and on the CLIPS body it turned one flick into
 * thirty reads (D574):
 *
 *   1. the near-bottom hit extends, so `lookbackDays` moves;
 *   2. the wider window has not answered, so the body draws NO cards;
 *   3. the content collapses and the ScrollView CLAMPS the parked offset to
 *      the new, much smaller maximum — emitting a scroll event nobody caused;
 *   4. the value moved at (1), so the latch is already discharged;
 *   5. the clamped offset is (of course) at the oldest end. Round again.
 *
 * The operator's finger left the glass at step 1 and the walk ran to the
 * 30-day cap on its own, each step a fresh read over a wider window, the body
 * pinned on "loading" for the whole run: *"se scrollo la lista di Clips va in
 * loading e non ne esce più"*. Measured in `clips-back-scroll.spec.ts`: **29
 * extensions from clamp frames alone, with no gesture in front of them.**
 *
 * The movement of `lookbackDays` was never evidence that the OPERATOR wanted
 * another day — it is evidence that WE changed it. So the arming moved to the
 * only thing that is: **a touch**. `armLookbackWalk` is called on
 * `onScrollBeginDrag`; one finger-down buys at most one extra day, and a scroll
 * event the surface generated for itself can buy none. A downward movement of
 * the observed value still discharges, because that is the day-change reset of
 * (2) and the request it would be guarding no longer exists.
 *
 * WHAT THIS WALK IS NOT: it is not data-driven. Nothing here, and nothing in the
 * scroller's content height (which is derived from `timelineFromMs` through
 * `epochToOffset`), consults whether the day being walked into HAS any footage
 * or any tracks. A day with nothing recorded costs exactly one more empty screen
 * of timeline and the walk continues through it. An absence can therefore never
 * present itself as the end of history here — and the three ways the walk can
 * decline to extend are named separately below and logged separately at the call
 * site, so a stalled timeline always says WHICH it was.
 */

/**
 * What a near-bottom hit is allowed to do.
 *
 * These are three different facts about the world and the operator needs them
 * apart: `capped` is a LIMIT (there is more history, we refuse to load it),
 * `spent` is THIS GESTURE'S extension already gone out (the next touch arms
 * another), and `extend` is the request actually going out. None of them is
 * "there is nothing older" — this walk cannot express that, because it never
 * asks.
 *
 * `spent` is also what an un-armed surface answers: a scroll event the list
 * generated for itself (a clamp, a programmatic scroll) has no gesture behind
 * it and buys nothing.
 */
export type LookbackWalkOutcome = 'extend' | 'spent' | 'capped'

export interface LookbackWalkState {
  /** The `lookbackDays` value last observed from the owner (−1 = never). */
  readonly observedDays: number
  /**
   * Whether a gesture has armed an extension that has not gone out yet.
   *
   * Starts FALSE. A surface nobody has touched extends nothing — which is the
   * whole of D574: the clamp frames a self-emptying list produces are scroll
   * events with no operator behind them.
   */
  readonly armed: boolean
}

/** Nothing observed, nothing armed. */
export const idleLookbackWalk: LookbackWalkState = {
  observedDays: -1,
  armed: false,
}

/**
 * A touch. `use-timeline-scrub.ts` calls this from `onScrollBeginDrag`, and
 * that is the ONLY thing that arms the walk.
 */
export function armLookbackWalk(state: LookbackWalkState): LookbackWalkState {
  if (state.armed) return state
  return { observedDays: state.observedDays, armed: true }
}

/**
 * Take the owner's current `lookbackDays`.
 *
 * Returns the SAME state object when the value has not moved, so a caller
 * mirroring this on every render does no work in the common case.
 */
export function observeLookbackDays(
  state: LookbackWalkState,
  lookbackDays: number,
): LookbackWalkState {
  if (lookbackDays === state.observedDays) return state
  // A move DOWN is the owner's day-change reset (`nextLookbackDaysAfterDayChange`)
  // — the window our request was for no longer exists, so the arming it would
  // have been spent on is handed back. Carrying the spent flag across that reset
  // is what wedged the walk at the second midnight.
  //
  // A move UP is OUR OWN extension landing, and it is not consent to another:
  // arming is a touch and nothing else (D574).
  if (lookbackDays < state.observedDays) return { observedDays: lookbackDays, armed: true }
  return { observedDays: lookbackDays, armed: state.armed }
}

/** Decide what a near-bottom hit should do. Pure. */
export function decideLookbackExtension(
  state: LookbackWalkState,
  maxLookbackDays: number,
): LookbackWalkOutcome {
  if (state.observedDays >= maxLookbackDays) return 'capped'
  if (!state.armed) return 'spent'
  return 'extend'
}

// ─── How close to the oldest end counts as "near" ─────────────────────

/**
 * The compressed (clips-mode) axis's near-end threshold, in px.
 *
 * Deliberately a small constant and not a fraction of the viewport: on the
 * compressed axis the ENTIRE history the operator can see is often shorter than
 * one screen — ten visits at one card each — so "within one viewport of the
 * oldest end" is satisfied at every offset the list can be at, including zero.
 * A single flick of a short clips list then extended the window one day per
 * landed fetch until the 30-day cap, each step refetching that camera's tracks
 * AND its availability over an ever-wider window, and re-deriving every clip.
 * The linear timeline never showed it: a day there is thousands of pixels.
 */
export const COMPRESSED_LOOKBACK_THRESHOLD_PX = 32

export interface NearOldestEndInput {
  /** Current scroll offset. */
  readonly offsetY: number
  /** Offset at which the oldest content sits at the bottom of the viewport. */
  readonly maxScrollPx: number
  readonly viewportHeightPx: number
  /** The clips-mode compressed axis is in force. */
  readonly compressed: boolean
}

/**
 * Whether a scroll offset is near enough the oldest end to ask for one more
 * day. Pure — the impure half (the latch, the log lines) is above and at the
 * call site.
 */
export function nearOldestEnd(input: NearOldestEndInput): boolean {
  const threshold = input.compressed
    ? COMPRESSED_LOOKBACK_THRESHOLD_PX
    : Math.max(0, input.viewportHeightPx)
  return input.offsetY >= input.maxScrollPx - threshold
}

/** Record that this gesture's extension went out. The next touch arms another. */
export function markLookbackRequested(state: LookbackWalkState): LookbackWalkState {
  return { observedDays: state.observedDays, armed: false }
}

// ─── The SECOND midnight bug: resetting mid-gesture ────────────────────

/**
 * Whether the OWNER's `lookbackDays` reset (`setLookbackDays(1)` on a `dayFrom`
 * change, TheaterTimeline.tsx) should fire for this `dayFrom` transition.
 *
 * This is a DIFFERENT bug from the one the latch above fixes, at the SAME
 * seam: `dayFrom` is derived from `selectActiveEpoch(machine)`
 * (playback-machine.ts), which is the DRAG'S `seekTarget` — a per-FRAME
 * preview — while `mode === 'seeking'`. Dragging the list backward across a
 * midnight boundary therefore flips `dayFrom` back and forth for every frame
 * straddling it, and the naive effect (`useEffect(() => setLookbackDays(1),
 * [dayFrom])`) fired the reset on EACH of those flips — mid-gesture, with a
 * finger still on the screen.
 *
 * The reset collapses `timelineFromMs` back to a single day, which shrinks the
 * scrollable content out from under the drag. The next `onScroll` frame reads
 * an offset the shrunk content clamps toward its (now much smaller) max, which
 * `mappedOffsetToEpoch` reports as very close to `topMs` — and `atLiveEdge`
 * (`use-timeline-scrub.ts`) reads THAT as "scrolled home", firing `GO_LIVE`.
 * The operator's cursor visibly "returns to live" for an instant while they
 * are still mid-drag into yesterday (2026-08-26 operator report, 3.4c) —
 * even though nothing they did asked to go live.
 *
 * The latch above already fixed the RELATED failure at this seam (the walk
 * stalling at the second midnight); that fix left this reset untouched, because
 * it is a different piece of state reacting to the same crossing. The rule
 * here: suppress the reset entirely while `mode === 'seeking'` — a live preview
 * has nothing settled to reset FOR yet — and apply it once the gesture SETTLES
 * (commit, tap, day-nav, go-live: any mode other than `'seeking'`), compared
 * against the last SETTLED day rather than every intermediate frame. A
 * genuine settled day change (an explicit seek/tap/nav that lands on a
 * different day) still resets exactly as before.
 */
export function isSettledDayChange(input: {
  readonly mode: 'live' | 'seeking' | 'playback' | 'gap' | 'error'
  readonly previousSettledDayFrom: number
  readonly nextDayFrom: number
}): boolean {
  if (input.mode === 'seeking') return false
  return input.previousSettledDayFrom !== input.nextDayFrom
}

// ─── The THIRD bug at this seam: collapsing an ALREADY-LOADED window ───

/**
 * The `lookbackDays` a settled day change should leave the owner with.
 *
 * 3.4b — "l'indice torna in cima" (the scroll position jumps back to the top,
 * operator report 2026-08-26). Before this, ANY settled day change reset
 * `lookbackDays` straight to 1 — correct for an explicit day-nav (prev/next,
 * the date picker), where starting the newly-picked day at a single loaded
 * day is exactly right. It is WRONG for the much more common case: the
 * operator extended lookback (scrolled near the bottom a few times) to see
 * several days of history, then tapped a card/clip from one of those
 * ALREADY-LOADED days — which is, simply, watching a video. `dayFrom` moves
 * to that day, the effect fired, and `lookbackDays` collapsed back to 1 —
 * discarding however many days of already-loaded, already-scrolled-into
 * history sat between the new `dayFrom` and the old oldest boundary. The
 * scrollable content shrinks out from under the current scroll offset in the
 * same way described in `isSettledDayChange`, and the ScrollView (or this
 * surface's own `scrollBand` clamp) snaps the visible band back toward its
 * new, much smaller max — which is close to the live edge, i.e. "the top".
 *
 * The fix: a day change PRESERVES the currently loaded oldest boundary
 * (`timelineFromMs`) whenever the newly-settled day still falls inside the
 * window that boundary already covers — `lookbackDays` is recomputed relative
 * to the NEW `dayFrom` so `timelineFromMs` does not move at all. Only a day
 * OUTSIDE the previously loaded range (an explicit nav past it, or a jump
 * forward — next-day, go-live returning to today) still starts over at a
 * single day, because there genuinely is no "already loaded" window to keep.
 */
export function nextLookbackDaysAfterDayChange(input: {
  readonly previousDayFrom: number
  readonly previousLookbackDays: number
  readonly nextDayFrom: number
  readonly maxLookbackDays: number
}): number {
  const oldTimelineFromMs = shiftLocalDay(input.previousDayFrom, 1 - input.previousLookbackDays)
  const withinLoadedWindow =
    input.nextDayFrom >= oldTimelineFromMs && input.nextDayFrom <= input.previousDayFrom
  if (!withinLoadedWindow) return 1

  const days = calendarDaysFrom(oldTimelineFromMs, input.nextDayFrom) + 1
  return Math.min(input.maxLookbackDays, Math.max(1, days))
}

/** Whole local calendar days from `earlierMs`'s day to `laterMs`'s day. */
function calendarDaysFrom(earlierMs: number, laterMs: number): number {
  const endMs = dayBounds(laterMs).startMs
  const cursor = new Date(dayBounds(earlierMs).startMs)
  let n = 0
  while (cursor.getTime() < endMs) {
    cursor.setDate(cursor.getDate() + 1)
    n += 1
  }
  return n
}
