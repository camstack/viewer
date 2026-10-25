/**
 * The tail of the feed says WHY it stopped, and the two "stopped" reasons are
 * different sentences.
 *
 * The operator's report — "the events page only goes back as far as 17:30" —
 * was this distinction missing. `hasMore` folded the SERVER's `nextCursor:
 * null` together with the client's own `maxRows` ceiling, so a surface that had
 * simply filled its 600-row budget five hours into the day drew the same
 * end-of-list marker as a feed that had genuinely reached the beginning of
 * history. Nothing on screen could tell them apart, and nothing offered to go
 * on.
 */
import { describe, expect, it } from 'vitest'
import type { EventsTrackRow } from '../events-track-row'
import { EMPTY_FEED, type FeedState, appendPage, hasMore, tailReason } from '../events-feed'

function row(i: number, from: number): EventsTrackRow {
  return {
    trackId: `t${String(i)}`,
    deviceId: 101,
    cameraName: 'Front Door',
    className: 'person',
    firstSeen: from - i * 1_000 - 500,
    lastSeen: from - i * 1_000,
    state: 'idle',
    active: false,
    zonesVisited: [],
    zoneNames: [],
    classes: ['person'],
    audioLabels: [],
    bestEventId: `evt-${String(i)}`,
  }
}

function rows(n: number, from = 1_000_000): readonly EventsTrackRow[] {
  return Array.from({ length: n }, (_, i) => row(i, from))
}

function feedOf(count: number, nextCursor: string | null): FeedState {
  return appendPage(EMPTY_FEED, rows(count), nextCursor)
}

describe('tailReason — the ceiling is not the end of history', () => {
  it('says `more` while the server still offers a cursor and the budget holds', () => {
    expect(tailReason(feedOf(10, 'c1'), 600)).toBe('more')
  })

  it('says `exhausted` ONLY when the server said `nextCursor: null`', () => {
    expect(tailReason(feedOf(10, null), 600)).toBe('exhausted')
  })

  it('says `ceiling` — never `exhausted` — when the CLIENT ran out of budget', () => {
    // The 17:30 case: the server has more (a cursor), the client will not hold
    // it. Saying `exhausted` here is the lie; it is what drew "· fine ·" over a
    // year of history.
    const reason = tailReason(feedOf(600, 'c10'), 600)
    expect(reason).toBe('ceiling')
    expect(reason).not.toBe('exhausted')
  })

  it('an exhausted feed AT the ceiling is still exhausted — the server wins', () => {
    // Both conditions true at once. The server's answer is knowledge; the
    // ceiling is only this client's limit, so the truthful sentence is the
    // server's.
    expect(tailReason(feedOf(600, null), 600)).toBe('exhausted')
  })

  it('hasMore stays exactly `tail === more`, so no caller changed meaning', () => {
    expect(hasMore(feedOf(10, 'c1'), 600)).toBe(true)
    expect(hasMore(feedOf(600, 'c1'), 600)).toBe(false)
    expect(hasMore(feedOf(10, null), 600)).toBe(false)
  })

  it('a REBUILD is judged on the generation being paged, not the one on screen', () => {
    // Unchanged behaviour, asserted because `tailReason` now owns it: a feed
    // sitting at its ceiling must still be able to fetch page one of its own
    // replacement.
    const visible = feedOf(600, 'c10')
    const rebuilding: FeedState = {
      ...visible,
      rebuild: { rows: [], cursor: null, exhausted: false, floor: 600, pages: 0 },
    }
    expect(tailReason(rebuilding, 600)).toBe('more')
  })
})
