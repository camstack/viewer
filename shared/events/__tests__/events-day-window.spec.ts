/**
 * Day navigation is an ANCHOR, not a cage.
 *
 * The operator reported that scrolling back "stops and nothing happens". Two
 * bounds were doing that, and only one of them was ever intentional:
 *
 *  - the row ceiling (covered by `events-feed-tail.spec.ts`), and
 *  - the day window, which pinned BOTH `sinceMs` and `untilMs` to one calendar
 *    day. `listRecentTracks` then correctly answered `nextCursor: null` at
 *    00:00 and the surface drew its end-of-list marker with a month of history
 *    one request away.
 *
 * Unpinning the lower bound is what "rolls into the previous day": the cursor
 * walks straight past midnight, and no edge has to be detected to cross it.
 */
import { describe, expect, it } from 'vitest'
import { dayWindowFor, pullIntentFor } from '../events-feed.js'

/** 2026-09-01 14:35 local — a mid-afternoon anchor, so a day boundary is never
 *  confused with the anchor itself. */
const ANCHOR = new Date(2026, 8, 1, 14, 35, 0, 0).getTime()
const DAY_MS = 86_400_000

function endOfLocalDay(daysBack: number): number {
  const start = new Date(ANCHOR)
  start.setHours(0, 0, 0, 0)
  return start.getTime() - daysBack * DAY_MS + DAY_MS - 1
}

describe('dayWindowFor — the live day', () => {
  it('clears BOTH bounds, so the incremental refresh keeps running', () => {
    // A pinned upper bound stops the poll (`shouldPoll`), and the live day is
    // exactly the one that must keep gaining rows.
    expect(dayWindowFor(0, ANCHOR)).toEqual({})
    expect(dayWindowFor(-3, ANCHOR)).toEqual({})
  })
})

describe('dayWindowFor — a past day has no floor to dead-end against', () => {
  it('pins the upper bound to the END of the selected day', () => {
    expect(dayWindowFor(1, ANCHOR).untilMs).toBe(endOfLocalDay(1))
    expect(dayWindowFor(5, ANCHOR).untilMs).toBe(endOfLocalDay(5))
  })

  it('leaves the LOWER bound open — this is the rollover', () => {
    // With no `sinceMs` the feed falls back to its age floor, so page 2 of
    // "yesterday" is simply the day before yesterday.
    for (const offset of [1, 2, 7, 30]) {
      expect(dayWindowFor(offset, ANCHOR).sinceMs).toBeUndefined()
    }
  })

  it('days are contiguous at their upper edge', () => {
    expect(dayWindowFor(1, ANCHOR).untilMs).toBe((dayWindowFor(2, ANCHOR).untilMs ?? 0) + DAY_MS)
  })

  it('the selected day is INSIDE its own window, and later days are not', () => {
    const until = dayWindowFor(2, ANCHOR).untilMs ?? 0
    expect(ANCHOR - 2 * DAY_MS).toBeLessThanOrEqual(until)
    expect(ANCHOR - DAY_MS).toBeGreaterThan(until)
  })
})

describe('pullIntentFor — the top edge of a finished day', () => {
  it('on the live day a pull is a refresh — there may be something newer', () => {
    expect(pullIntentFor(0)).toBe('refresh')
  })

  it('on a PAST day a pull rolls the day forward instead of firing a no-op', () => {
    // The window is closed above, so a delta asks a finished day for something
    // it can never have. "Give me newer" at that edge has one answer: the next
    // day.
    expect(pullIntentFor(1)).toBe('roll-newer')
    expect(pullIntentFor(9)).toBe('roll-newer')
  })
})
