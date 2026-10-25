import { describe, it, expect } from 'vitest'
import { shiftLocalDay } from '../../../../lib/local-day.js'
import {
  armLookbackWalk,
  idleLookbackWalk,
  observeLookbackDays,
  decideLookbackExtension,
  markLookbackRequested,
  type LookbackWalkOutcome,
  nearOldestEnd,
  COMPRESSED_LOOKBACK_THRESHOLD_PX,
  type LookbackWalkState,
  isSettledDayChange,
  nextLookbackDaysAfterDayChange,
} from '../lookback-walk.js'

/**
 * The reported bug, at the model level.
 *
 * "Quando faccio scrubbing e passo al giorno precedente e poi provo ad andare a
 * quello ancora prima, si ferma a mezzanotte" — backwards scrubbing crosses ONE
 * midnight and then stops at the next one.
 *
 * The walk that stalls is a conversation between two places:
 *
 *   TheaterTimeline.tsx:334-344  owns `lookbackDays`, derives
 *                                `timelineFromMs = dayFrom − (lookbackDays−1)×1d`,
 *                                and RESETS `lookbackDays` to 1 on every change
 *                                of the viewed day;
 *   use-timeline-scrub.ts:328+   sees the scroll approach the oldest end and
 *                                asks for one more day, behind a latch.
 *
 * `DayWalk` below is those two, and only those two. It runs without a renderer
 * because both halves are arithmetic: the crossing is `viewedEpoch < dayFrom`,
 * not a layout event.
 */

const DAY_MS = 24 * 60 * 60 * 1000
/** Stands in for local midnight of the day the operator starts on. */
const TODAY = 1_700_000_000_000 - (1_700_000_000_000 % DAY_MS)
const MAX_LOOKBACK_DAYS = 30

interface WalkStep {
  readonly outcome: LookbackWalkOutcome
  readonly oldestMs: number
}

/**
 * The owner's state machine + the scrub hook's latch, wired exactly as the two
 * real files wire them.
 */
class DayWalk {
  private dayFrom = TODAY
  private lookbackDays = 1
  private latch: LookbackWalkState = observeLookbackDays(idleLookbackWalk, 1)

  /** `timelineFromMs` — TheaterTimeline.tsx:335. */
  oldest(): number {
    return this.dayFrom - (this.lookbackDays - 1) * DAY_MS
  }

  /** A finger goes down — `onScrollBeginDrag`. The ONLY thing that arms the
   *  walk since D574: our own extension moving `lookbackDays` is not consent
   *  to another, and a clamp frame has no operator behind it. */
  touch(): void {
    this.latch = armLookbackWalk(this.latch)
  }

  /** The operator drags the list to its oldest end. */
  dragToBottom(): WalkStep {
    this.touch()
    return this.nearBottom()
  }

  /** The scroll reached the oldest end — use-timeline-scrub.ts:328. */
  nearBottom(): WalkStep {
    const outcome = decideLookbackExtension(this.latch, MAX_LOOKBACK_DAYS)
    if (outcome === 'extend') {
      this.latch = markLookbackRequested(this.latch)
      // extendLookback — TheaterTimeline.tsx:336-339.
      this.lookbackDays = Math.min(MAX_LOOKBACK_DAYS, this.lookbackDays + 1)
      this.commit()
    }
    return { outcome, oldestMs: this.oldest() }
  }

  /**
   * Scrub the playhead to an epoch. Crossing below the viewed day's midnight
   * moves `dayFrom`, which fires the owner's reset effect
   * (TheaterTimeline.tsx:342-344).
   */
  scrubTo(epochMs: number): void {
    const nextDayFrom = epochMs - ((epochMs % DAY_MS) + DAY_MS) % DAY_MS
    if (nextDayFrom === this.dayFrom) return
    this.dayFrom = nextDayFrom
    this.lookbackDays = 1
    this.commit()
  }

  /** The effect that mirrors `lookbackDays` into the hook — use-timeline-scrub.ts:145-151. */
  private commit(): void {
    this.latch = observeLookbackDays(this.latch, this.lookbackDays)
  }
}

describe('the latch, on its own', () => {
  it('extends nothing until something touches the surface', () => {
    // D574. An un-armed walk is the resting state, not an edge case: the clamp
    // frames a self-emptying clips list produces arrive with no gesture behind
    // them, and before this they were indistinguishable from a drag.
    const cold = observeLookbackDays(idleLookbackWalk, 1)
    expect(decideLookbackExtension(cold, MAX_LOOKBACK_DAYS)).toBe('spent')
  })

  it('lets ONE ask through per touch, and swallows the echoes', () => {
    // The reason the latch exists: `lookbackDays` is React state, so the hook
    // keeps reading the OLD value for a render after the call. Unlatched, a
    // finger resting near the bottom widens the window by several days.
    let s = armLookbackWalk(observeLookbackDays(idleLookbackWalk, 1))
    expect(decideLookbackExtension(s, MAX_LOOKBACK_DAYS)).toBe('extend')
    s = markLookbackRequested(s)
    expect(decideLookbackExtension(s, MAX_LOOKBACK_DAYS)).toBe('spent')
    expect(decideLookbackExtension(s, MAX_LOOKBACK_DAYS)).toBe('spent')
  })

  it('does NOT re-arm because our own request landed', () => {
    // The 2026-09-21 change of mind (D574). `lookbackDays` moving UP is this
    // walk's own doing; reading it as permission to ask again is what turned
    // one flick into twenty-nine reads over ever-wider windows.
    const asked = markLookbackRequested(armLookbackWalk(observeLookbackDays(idleLookbackWalk, 1)))
    const landed = observeLookbackDays(asked, 2)
    expect(decideLookbackExtension(landed, MAX_LOOKBACK_DAYS)).toBe('spent')
    expect(decideLookbackExtension(armLookbackWalk(landed), MAX_LOOKBACK_DAYS)).toBe('extend')
  })

  it('re-arms when the observed value moves back DOWN — the day-change reset', () => {
    const asked = markLookbackRequested(armLookbackWalk(observeLookbackDays(idleLookbackWalk, 1)))
    const landed = observeLookbackDays(asked, 2)
    // Straight back down to 1, because the operator scrubbed past midnight and
    // the owner reset the window. This is the second-midnight bug in two lines:
    // the number the latch watches returns to the value it asked at by a path
    // that has nothing to do with any request, and a latch that only compares
    // numbers reads a landed request as one still in flight — forever.
    const afterMidnight = observeLookbackDays(landed, 1)
    expect(decideLookbackExtension(afterMidnight, MAX_LOOKBACK_DAYS)).toBe('extend')
  })

  it('reports the CAP as its own outcome, never as spent', () => {
    // A limit and an in-flight request both stop the timeline; only one of them
    // is worth telling the operator about, and they must not share a code path.
    const s = armLookbackWalk(observeLookbackDays(idleLookbackWalk, MAX_LOOKBACK_DAYS))
    expect(decideLookbackExtension(s, MAX_LOOKBACK_DAYS)).toBe('capped')
  })

  it('leaves the state object alone when the observed value has not moved', () => {
    const s = observeLookbackDays(idleLookbackWalk, 4)
    expect(observeLookbackDays(s, 4)).toBe(s)
  })
})

describe('scrubbing backwards across successive midnights', () => {
  it('reaches the day before yesterday, not just yesterday', () => {
    const walk = new DayWalk()

    // Day 1 → day 2: hit the bottom of today, load yesterday, scrub into it.
    expect(walk.dragToBottom().outcome).toBe('extend')
    expect(walk.oldest()).toBe(TODAY - DAY_MS)
    walk.scrubTo(TODAY - 1)

    // The window must not shrink when the viewed day flips: the operator is
    // standing in yesterday and yesterday is still the oldest loaded midnight.
    expect(walk.oldest()).toBe(TODAY - DAY_MS)

    // Day 2 → day 3. THIS is the ask that never went out.
    const second = walk.dragToBottom()
    expect(second.outcome).toBe('extend')
    expect(second.oldestMs).toBe(TODAY - 2 * DAY_MS)
    walk.scrubTo(TODAY - DAY_MS - 1)
    expect(walk.oldest()).toBe(TODAY - 2 * DAY_MS)
  })

  it('keeps walking for a week of midnights', () => {
    // Once is a fix; the shape of the bug (a latch that discharges only on one
    // kind of movement) fails on the Nth crossing just as readily as the second.
    const walk = new DayWalk()
    for (let day = 1; day <= 7; day++) {
      expect(walk.dragToBottom().outcome).toBe('extend')
      expect(walk.oldest()).toBe(TODAY - day * DAY_MS)
      walk.scrubTo(TODAY - (day - 1) * DAY_MS - 1)
      expect(walk.oldest()).toBe(TODAY - day * DAY_MS)
    }
  })

  it('an EMPTY day does not end the walk — the walk never asks about content', () => {
    // Three separate incidents on 2026-08-01 were an absence being read as a
    // refusal or a limit. This one cannot be: the whole walk is arithmetic on
    // midnights, so a day with no footage and a day full of it produce the
    // identical sequence of outcomes. The test states it so a future change that
    // starts consulting coverage has to break this line first.
    const empty = new DayWalk()
    const busy = new DayWalk()
    const outcomes = (w: DayWalk): readonly string[] => {
      const seen: string[] = []
      for (let day = 1; day <= 5; day++) {
        seen.push(w.dragToBottom().outcome)
        w.scrubTo(TODAY - (day - 1) * DAY_MS - 1)
      }
      return seen
    }
    expect(outcomes(empty)).toEqual(outcomes(busy))
    expect(outcomes(empty)).not.toContain('spent')
  })

  it('stops at the CAP — reachable only WITHOUT a day change, and named as a limit', () => {
    // Getting to MAX takes MAX−1 extensions from ONE viewed day, and since
    // D574 that is MAX−1 separate DRAGS: a single fling buys exactly one day,
    // however long it lasts. `activeEpoch` — and with it the viewed day —
    // never moves across them, which is what makes the cap reachable at all. Crossing a midnight resets `lookbackDays` to 1, which
    // is why an operator scrubbing day by day never meets this limit at all.
    // Worth stating: "the timeline stopped" and "the timeline hit its 30-day
    // ceiling" are different events and only one of them is this one.
    const walk = new DayWalk()
    for (let i = 1; i < MAX_LOOKBACK_DAYS; i++) {
      expect(walk.dragToBottom().outcome).toBe('extend')
    }
    expect(walk.oldest()).toBe(TODAY - (MAX_LOOKBACK_DAYS - 1) * DAY_MS)
    expect(walk.dragToBottom().outcome).toBe('capped')
  })
})

// ─── how close to the oldest end counts as "near" ─────────────────────

describe('nearOldestEnd', () => {
  const VIEWPORT = 400
  // A linear day is thousands of px; a compressed clips axis of ten visits is
  // often shorter than one viewport, so `maxScrollPx` sits a few dozen px away
  // from every offset the operator can reach.
  const LINEAR_MAX = 6_000
  const COMPRESSED_MAX = 40

  it('linear: within one viewport of the oldest end', () => {
    expect(nearOldestEnd({ offsetY: LINEAR_MAX - 399, maxScrollPx: LINEAR_MAX, viewportHeightPx: VIEWPORT, compressed: false })).toBe(true)
    expect(nearOldestEnd({ offsetY: LINEAR_MAX - 401, maxScrollPx: LINEAR_MAX, viewportHeightPx: VIEWPORT, compressed: false })).toBe(false)
  })

  it('compressed: the TOP of a short axis is not the oldest end', () => {
    // The defect: with a viewport-sized threshold this was true at offset 0, so
    // one flick of a ten-clip list walked the window back to the 30-day cap,
    // refetching every track and every availability range on the way.
    expect(nearOldestEnd({ offsetY: 0, maxScrollPx: COMPRESSED_MAX, viewportHeightPx: VIEWPORT, compressed: true })).toBe(false)
    expect(nearOldestEnd({ offsetY: 0, maxScrollPx: COMPRESSED_MAX, viewportHeightPx: VIEWPORT, compressed: false })).toBe(true)
  })

  it('compressed: reaching the end still asks for one more day', () => {
    expect(nearOldestEnd({ offsetY: COMPRESSED_MAX, maxScrollPx: COMPRESSED_MAX, viewportHeightPx: VIEWPORT, compressed: true })).toBe(true)
    expect(
      nearOldestEnd({
        offsetY: COMPRESSED_MAX - COMPRESSED_LOOKBACK_THRESHOLD_PX,
        maxScrollPx: COMPRESSED_MAX,
        viewportHeightPx: VIEWPORT,
        compressed: true,
      }),
    ).toBe(true)
  })

  it('overscroll past the end is still the end', () => {
    expect(nearOldestEnd({ offsetY: LINEAR_MAX + 120, maxScrollPx: LINEAR_MAX, viewportHeightPx: VIEWPORT, compressed: false })).toBe(true)
  })
})

// ─── 3.4c — "al cambio di giorno il cursore torna live per un attimo" ─────

describe('isSettledDayChange', () => {
  it('suppresses the reset while a drag is still in flight (mode = seeking)', () => {
    // The exact failure: `dayFrom` is the drag's per-frame `seekTarget` while
    // seeking, so crossing midnight mid-drag flips it — but there is nothing
    // SETTLED to reset for yet, and resetting here is what collapses the
    // content under the finger and false-triggers GO_LIVE.
    expect(
      isSettledDayChange({
        mode: 'seeking',
        previousSettledDayFrom: TODAY,
        nextDayFrom: TODAY - DAY_MS,
      }),
    ).toBe(false)
  })

  it('fires once the gesture SETTLES on a genuinely different day', () => {
    expect(
      isSettledDayChange({
        mode: 'playback',
        previousSettledDayFrom: TODAY,
        nextDayFrom: TODAY - DAY_MS,
      }),
    ).toBe(true)
  })

  it('a plain midnight rollover while parked live still resets (unchanged behaviour)', () => {
    // No drag involved: `mode` is 'live', so this path is untouched by the fix.
    expect(
      isSettledDayChange({
        mode: 'live',
        previousSettledDayFrom: TODAY - DAY_MS,
        nextDayFrom: TODAY,
      }),
    ).toBe(true)
  })

  it('no reset when the settled day has not actually moved', () => {
    expect(
      isSettledDayChange({ mode: 'playback', previousSettledDayFrom: TODAY, nextDayFrom: TODAY }),
    ).toBe(false)
  })

  it('end-to-end: dragging back and forth across midnight never resets mid-gesture, only on settle', () => {
    // Models the owner's ref-tracked comparison exactly as TheaterTimeline
    // wires it: `settledDayFromRef` only advances (and only resets lookback)
    // when `isSettledDayChange` says so.
    let settledDayFrom = TODAY
    let resets = 0
    const observe = (mode: 'seeking' | 'playback', dayFrom: number): void => {
      if (isSettledDayChange({ mode, previousSettledDayFrom: settledDayFrom, nextDayFrom: dayFrom })) {
        resets += 1
      }
      if (mode !== 'seeking') settledDayFrom = dayFrom
    }

    // The finger straddles midnight for a few frames — dayFrom flickers.
    observe('seeking', TODAY - 1) // crossed into yesterday
    observe('seeking', TODAY) // back onto today
    observe('seeking', TODAY - 1) // into yesterday again
    expect(resets).toBe(0) // nothing settled yet — no false GO_LIVE trigger

    // The finger lifts with yesterday still under it — NOW it settles.
    observe('playback', TODAY - 1)
    expect(resets).toBe(1)

    // Settling again on the SAME day (e.g. a second small scrub) resets nothing more.
    observe('playback', TODAY - 1)
    expect(resets).toBe(1)
  })
})

// ─── 3.4b — "l'indice torna in cima" ───────────────────────────────────────

describe('nextLookbackDaysAfterDayChange', () => {
  it('watching a card from an ALREADY-LOADED day keeps the same oldest boundary', () => {
    // Lookback was extended to 5 days (oldest = TODAY-4d) while viewing TODAY.
    // The operator taps a card from TODAY-2, well inside that window — this is
    // the everyday "watch a video from the history you already scrolled into"
    // case, and it must not discard the two days on either side of it.
    const days = nextLookbackDaysAfterDayChange({
      previousDayFrom: TODAY,
      previousLookbackDays: 5,
      nextDayFrom: TODAY - 2 * DAY_MS,
      maxLookbackDays: MAX_LOOKBACK_DAYS,
    })
    const newOldest = (TODAY - 2 * DAY_MS) - (days - 1) * DAY_MS
    expect(newOldest).toBe(TODAY - 4 * DAY_MS) // unchanged
  })

  it('landing exactly on the old oldest edge collapses to 1 (matches the prior single-extension walk)', () => {
    // Same scenario the existing DayWalk model exercises: one extension puts
    // the oldest boundary at TODAY-1d, then the operator scrubs onto that
    // exact day. There is nothing OLDER already loaded to preserve, so 1 is
    // correct here too — this pins that the fix does not regress that walk.
    const days = nextLookbackDaysAfterDayChange({
      previousDayFrom: TODAY,
      previousLookbackDays: 2,
      nextDayFrom: TODAY - DAY_MS,
      maxLookbackDays: MAX_LOOKBACK_DAYS,
    })
    expect(days).toBe(1)
  })

  it('a day OUTSIDE the loaded window (explicit nav past it) starts over at 1', () => {
    // Only 3 days were ever loaded (oldest = TODAY-2d); jumping to TODAY-10d
    // (e.g. the date picker) has nothing loaded to preserve.
    const days = nextLookbackDaysAfterDayChange({
      previousDayFrom: TODAY,
      previousLookbackDays: 3,
      nextDayFrom: TODAY - 10 * DAY_MS,
      maxLookbackDays: MAX_LOOKBACK_DAYS,
    })
    expect(days).toBe(1)
  })

  it('moving FORWARD a day (next-day nav, go-live back to today) also starts over at 1', () => {
    const days = nextLookbackDaysAfterDayChange({
      previousDayFrom: TODAY - 2 * DAY_MS,
      previousLookbackDays: 1,
      nextDayFrom: TODAY - DAY_MS,
      maxLookbackDays: MAX_LOOKBACK_DAYS,
    })
    expect(days).toBe(1)
  })

  it('never exceeds the cap even when the preserved span would', () => {
    const days = nextLookbackDaysAfterDayChange({
      previousDayFrom: TODAY,
      previousLookbackDays: MAX_LOOKBACK_DAYS,
      nextDayFrom: TODAY - 5 * DAY_MS,
      maxLookbackDays: MAX_LOOKBACK_DAYS,
    })
    expect(days).toBeLessThanOrEqual(MAX_LOOKBACK_DAYS)
  })

  it('crossing 2026-10-25 keeps the loaded window on calendar midnights', () => {
    const today = new Date(2026, 9, 26).getTime()
    const inside = new Date(2026, 9, 25).getTime()
    const days = nextLookbackDaysAfterDayChange({
      previousDayFrom: today,
      previousLookbackDays: 3,
      nextDayFrom: inside,
      maxLookbackDays: MAX_LOOKBACK_DAYS,
    })
    // 26, 25, 24 — tapping the 25th must not drop the 24th.
    expect(days).toBe(2)
    expect(shiftLocalDay(inside, 1 - days)).toBe(new Date(2026, 9, 24).getTime())
  })

  it('no change at all when the day did not actually move', () => {
    const days = nextLookbackDaysAfterDayChange({
      previousDayFrom: TODAY,
      previousLookbackDays: 5,
      nextDayFrom: TODAY,
      maxLookbackDays: MAX_LOOKBACK_DAYS,
    })
    expect(days).toBe(5)
  })
})
