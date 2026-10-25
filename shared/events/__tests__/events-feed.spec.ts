import { describe, expect, it } from 'vitest'
import {
  abandonRebuild,
  ageFloor,
  appendPage,
  applyDelta,
  beginRebuild,
  compareRowsDesc,
  deltaSince,
  EMPTY_FEED,
  hasMore,
  isRebuilding,
  MAX_REBUILD_PAGES,
  pageCursor,
  RECENT_FANOUT_ROW_BUDGET,
  resolveEventsPageLimit,
} from '../events-feed'
import type { EventsTrackRow } from '../events-track-row'

function row(trackId: string, lastSeen: number, extra?: Partial<EventsTrackRow>): EventsTrackRow {
  return {
    trackId,
    deviceId: 101,
    cameraName: 'Front',
    className: 'person',
    firstSeen: lastSeen - 1000,
    lastSeen,
    state: 'idle',
    active: false,
    zonesVisited: [],
    zoneNames: [],
    classes: ['person'],
    audioLabels: [],
    bestEventId: `evt-${trackId}`,
    ...extra,
  }
}

describe('resolveEventsPageLimit', () => {
  it('returns the ask when the fan-out budget is not binding', () => {
    expect(resolveEventsPageLimit(60, 4)).toBe(60)
  })

  it('mirrors the server fan-out clamp (budget / devices)', () => {
    // 2000 / 40 = 50 — asking for 200 would be served as 50 anyway.
    expect(resolveEventsPageLimit(200, 40)).toBe(50)
    expect(resolveEventsPageLimit(200, 40)).toBe(Math.floor(RECENT_FANOUT_ROW_BUDGET / 40))
  })

  it('never returns 0, even with more devices than the budget', () => {
    expect(resolveEventsPageLimit(200, 5000)).toBe(1)
  })

  it("respects the cap's own hard ceiling", () => {
    expect(resolveEventsPageLimit(5000, 1)).toBe(1000)
  })

  it('is total for junk input', () => {
    expect(resolveEventsPageLimit(0, 0)).toBe(1)
    expect(resolveEventsPageLimit(-5, -5)).toBe(1)
  })
})

describe('compareRowsDesc', () => {
  it('orders by lastSeen DESC then trackId DESC — the server total order', () => {
    const rows = [row('a', 100), row('c', 200), row('b', 200)]
    expect([...rows].sort(compareRowsDesc).map((r) => r.trackId)).toEqual(['c', 'b', 'a'])
  })
})

describe('appendPage', () => {
  it('folds a first page and takes its cursor', () => {
    const s = appendPage(EMPTY_FEED, [row('a', 300), row('b', 200)], 'cur-1')
    expect(s.rows.map((r) => r.trackId)).toEqual(['a', 'b'])
    expect(s.cursor).toBe('cur-1')
    expect(s.exhausted).toBe(false)
  })

  it('marks the feed exhausted on a null cursor', () => {
    const s = appendPage(EMPTY_FEED, [row('a', 300)], null)
    expect(s.exhausted).toBe(true)
    expect(hasMore(s, 100)).toBe(false)
  })

  it('deduplicates by trackId, keeping the INCOMING row', () => {
    const first = appendPage(EMPTY_FEED, [row('a', 300)], 'c1')
    const second = appendPage(first, [row('a', 350, { state: 'moving' })], 'c2')
    expect(second.rows).toHaveLength(1)
    expect(second.rows[0]?.lastSeen).toBe(350)
    expect(second.rows[0]?.state).toBe('moving')
  })

  it('never truncates to a memory ceiling — that would strand the cursor', () => {
    const many = Array.from({ length: 50 }, (_, i) => row(`t${i}`, 1000 - i))
    const s = appendPage(EMPTY_FEED, many, 'c1')
    expect(s.rows).toHaveLength(50)
  })

  it('does not mutate the previous state', () => {
    const first = appendPage(EMPTY_FEED, [row('a', 300)], 'c1')
    appendPage(first, [row('b', 200)], 'c2')
    expect(first.rows).toHaveLength(1)
    expect(EMPTY_FEED.rows).toHaveLength(0)
  })
})

describe('hasMore', () => {
  it('stops asking once the in-memory ceiling is reached', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(`t${i}`, 1000 - i))
    const s = appendPage(EMPTY_FEED, rows, 'c1')
    expect(hasMore(s, 100)).toBe(true)
    expect(hasMore(s, 10)).toBe(false)
    expect(hasMore(s, 5)).toBe(false)
  })

  it('is true on a fresh feed so the first page is requested', () => {
    expect(hasMore(EMPTY_FEED, 600)).toBe(true)
  })
})

describe('deltaSince', () => {
  it('is the head row lastSeen, INCLUSIVE (ties must not be skipped)', () => {
    const s = appendPage(EMPTY_FEED, [row('a', 300), row('b', 200)], 'c1')
    expect(deltaSince(s)).toBe(300)
  })

  it('is null when nothing is loaded', () => {
    expect(deltaSince(EMPTY_FEED)).toBeNull()
  })
})

describe('applyDelta', () => {
  it('prepends new rows and leaves the paging cursor untouched', () => {
    const base = appendPage(EMPTY_FEED, [row('b', 200), row('c', 100)], 'page-cursor')
    const result = applyDelta(base, [row('a', 400)], null)
    expect(result.state.rows.map((r) => r.trackId)).toEqual(['a', 'b', 'c'])
    expect(result.state.cursor).toBe('page-cursor')
    expect(result.state.exhausted).toBe(false)
    expect(result.added).toBe(1)
  })

  it('REPLACES a held row whose lastSeen advanced instead of duplicating it', () => {
    const base = appendPage(EMPTY_FEED, [row('b', 200)], 'page-cursor')
    const result = applyDelta(base, [row('b', 260, { state: 'moving' })], null)
    expect(result.state.rows).toHaveLength(1)
    expect(result.state.rows[0]?.lastSeen).toBe(260)
    expect(result.added).toBe(0)
  })

  it('does NOT clobber exhausted — a delta says nothing about the older end', () => {
    const base = appendPage(EMPTY_FEED, [row('b', 200)], null)
    expect(base.exhausted).toBe(true)
    const result = applyDelta(base, [row('a', 400)], null)
    expect(result.state.exhausted).toBe(true)
    expect(result.state.cursor).toBeNull()
  })

  it('reports a gap (and the cursor to follow) when the delta was truncated', () => {
    const base = appendPage(EMPTY_FEED, [row('z', 100)], 'page-cursor')
    const result = applyDelta(base, [row('a', 400), row('b', 300)], 'delta-cursor')
    expect(result.gap).toBe(true)
    expect(result.deltaCursor).toBe('delta-cursor')
  })

  it('reports no gap when the delta page ended', () => {
    const base = appendPage(EMPTY_FEED, [row('z', 100)], 'page-cursor')
    const result = applyDelta(base, [row('a', 400)], null)
    expect(result.gap).toBe(false)
    expect(result.deltaCursor).toBeNull()
  })

  it('an inclusive since re-delivering the head is idempotent', () => {
    const base = appendPage(EMPTY_FEED, [row('a', 300), row('b', 200)], 'c1')
    const result = applyDelta(base, [row('a', 300)], null)
    expect(result.state.rows.map((r) => r.trackId)).toEqual(['a', 'b'])
    expect(result.added).toBe(0)
  })
})

describe('ageFloor', () => {
  it('is anchor - maxAge, clamped at 0', () => {
    expect(ageFloor(1_000_000, 400_000)).toBe(600_000)
    expect(ageFloor(1_000, 999_999)).toBe(0)
  })
})

/**
 * A RELOAD must not empty the surface.
 *
 * `reload` exists to re-read rows whose `lastSeen` did not move (a face
 * reassignment rewrites a label without touching the timestamp). Emptying the
 * feed to do it collapses the scroller's content, the browser clamps
 * `scrollTop` to 0, and the operator who opened one event comes back to row
 * one. The rebuild therefore pages the NEW generation off-screen and swaps only
 * once it is at least as tall as what it replaces.
 */
describe('beginRebuild / appendPage during a rebuild', () => {
  const loaded = appendPage(
    appendPage(EMPTY_FEED, [row('a', 500), row('b', 400)], 'c1'),
    [row('c', 300), row('d', 200)],
    'c2',
  )

  it('keeps the visible rows when a rebuild starts', () => {
    const s = beginRebuild(loaded)
    expect(s.rows.map((r) => r.trackId)).toEqual(['a', 'b', 'c', 'd'])
    expect(isRebuilding(s)).toBe(true)
  })

  it('remembers the height to re-reach and starts the new generation uncursored', () => {
    const s = beginRebuild(loaded)
    expect(pageCursor(s)).toBeNull()
    expect(hasMore(s, 600)).toBe(true)
  })

  it('is a plain reset when nothing is on screen', () => {
    const s = beginRebuild(EMPTY_FEED)
    expect(isRebuilding(s)).toBe(false)
    expect(s.rows).toHaveLength(0)
  })

  it('does NOT swap while the new generation is shorter than the old one', () => {
    const s = appendPage(beginRebuild(loaded), [row('a', 500), row('b', 400)], 'n1')
    expect(isRebuilding(s)).toBe(true)
    // The operator still sees four rows — the scroller never shrank.
    expect(s.rows).toHaveLength(4)
    expect(pageCursor(s)).toBe('n1')
  })

  it('swaps once the new generation is at least as tall', () => {
    const first = appendPage(beginRebuild(loaded), [row('a', 500), row('b', 400)], 'n1')
    const second = appendPage(first, [row('c', 300), row('e', 250)], 'n2')
    expect(isRebuilding(second)).toBe(false)
    expect(second.rows.map((r) => r.trackId)).toEqual(['a', 'b', 'c', 'e'])
    expect(second.cursor).toBe('n2')
    // `d` is gone because the new generation genuinely no longer has it.
    expect(second.exhausted).toBe(false)
  })

  it('swaps early when the feed is exhausted, however short', () => {
    const s = appendPage(beginRebuild(loaded), [row('a', 500)], null)
    expect(isRebuilding(s)).toBe(false)
    expect(s.rows).toHaveLength(1)
    expect(s.exhausted).toBe(true)
  })

  it('swaps at the page bound rather than paging a whole history', () => {
    let s = beginRebuild(appendPage(EMPTY_FEED, Array.from({ length: 400 }, (_, i) => row(`r${String(i)}`, 10_000 - i)), 'c1'))
    for (let i = 0; i < MAX_REBUILD_PAGES; i += 1) {
      s = appendPage(s, [row(`n${String(i)}`, 9_000 - i)], `n${String(i)}`)
    }
    expect(isRebuilding(s)).toBe(false)
    expect(s.rows).toHaveLength(MAX_REBUILD_PAGES)
  })

  it('abandons a rebuild without touching what is on screen', () => {
    const started = appendPage(beginRebuild(loaded), [row('a', 500)], 'n1')
    const s = abandonRebuild(started)
    expect(isRebuilding(s)).toBe(false)
    expect(s.rows.map((r) => r.trackId)).toEqual(['a', 'b', 'c', 'd'])
    // The OLD paging cursor survives — the abandoned generation's does not.
    expect(s.cursor).toBe('c2')
  })

  it('lets a delta land on the visible rows while a rebuild is in flight', () => {
    const s = applyDelta(beginRebuild(loaded), [row('z', 900)], null)
    expect(s.state.rows[0]?.trackId).toBe('z')
    expect(isRebuilding(s.state)).toBe(true)
  })
})
