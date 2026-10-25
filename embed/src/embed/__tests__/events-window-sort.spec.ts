import { describe, expect, it } from 'vitest'
import {
  applyEventsConfigPatch,
  cardEdgePx,
  type EventsConfig,
  parseEventsConfig,
  reelRowHeightPx,
  reelCardHeightPx,
  THUMB_MAX_EDGE_PX,
  THUMB_MIN_EDGE_PX,
  thumbEdgePx,
} from '../events-config'
import { resolveFeedWindow, shouldPoll, sortRows } from '../../../../shared/events/events-feed'
import type { EventsTrackRow } from '../../../../shared/events/events-track-row'

function row(trackId: string, lastSeen: number, importance?: number): EventsTrackRow {
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
    ...(importance !== undefined ? { importance } : {}),
  }
}

function parsed(raw: unknown): EventsConfig {
  const r = parseEventsConfig(raw)
  if (!r.ok) throw new Error(r.error)
  return r.config
}

const MINIMAL = { serverUrl: 'https://hub', token: 'jwt' }

describe('resolveFeedWindow — day navigation', () => {
  it('uses the rolling age floor and NO upper bound when unset', () => {
    // No `until` on page 1 is deliberate: the newest tracks must be reachable,
    // and pages 2+ are bounded exactly by the cursor.
    expect(resolveFeedWindow({ anchorMs: 1_000_000, maxAgeMs: 400_000 })).toEqual({
      since: 600_000,
    })
  })

  it('an explicit window WINS over the rolling anchor, on BOTH bounds', () => {
    expect(
      resolveFeedWindow({
        anchorMs: 1_000_000,
        maxAgeMs: 400_000,
        sinceMs: 10,
        untilMs: 20,
      }),
    ).toEqual({ since: 10, until: 20 })
  })

  it('an upper bound alone still floors on the age window', () => {
    expect(resolveFeedWindow({ anchorMs: 1_000_000, maxAgeMs: 400_000, untilMs: 900_000 })).toEqual(
      { since: 600_000, until: 900_000 },
    )
  })

  it('the bounds RIDE the request — they are not a post-filter', () => {
    // The whole point: a day view must not spend the fan-out budget on rows it
    // will then hide. `until` present in the resolved window is what carries
    // that into `listRecentTracks`.
    const w = resolveFeedWindow({ anchorMs: 0, maxAgeMs: 0, sinceMs: 100, untilMs: 200 })
    expect(w.until).toBe(200)
    expect(w.since).toBe(100)
  })
})

describe('shouldPoll', () => {
  it('polls the rolling feed and a window that is still open', () => {
    expect(shouldPoll(undefined, 1_000)).toBe(true)
    expect(shouldPoll(2_000, 1_000)).toBe(true)
  })

  it('stops polling a window CLOSED in the past', () => {
    // A finished day cannot gain rows; polling it is a query a minute that can
    // only ever return the head back.
    expect(shouldPoll(500, 1_000)).toBe(false)
    expect(shouldPoll(1_000, 1_000)).toBe(false)
  })
})

describe('sortRows', () => {
  it('leaves the time order exactly as the server sent it', () => {
    const rows = [row('a', 300), row('b', 200), row('c', 100)]
    expect(sortRows(rows, 'time')).toBe(rows)
  })

  it('orders by importance DESC', () => {
    const rows = [row('a', 300, 0.1), row('b', 200, 0.9), row('c', 100, 0.5)]
    expect(sortRows(rows, 'importance').map((r) => r.trackId)).toEqual(['b', 'c', 'a'])
  })

  it('sinks UNSCORED rows below every scored one instead of scattering them', () => {
    const rows = [row('a', 300), row('b', 200, 0.4), row('c', 100, 0.8)]
    expect(sortRows(rows, 'importance').map((r) => r.trackId)).toEqual(['c', 'b', 'a'])
  })

  it('breaks ties on the TIME order, not an arbitrary one', () => {
    const rows = [row('a', 100, 0.5), row('b', 300, 0.5), row('c', 200, 0.5)]
    expect(sortRows(rows, 'importance').map((r) => r.trackId)).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate the input', () => {
    const rows = [row('a', 100, 0.1), row('b', 200, 0.9)]
    sortRows(rows, 'importance')
    expect(rows.map((r) => r.trackId)).toEqual(['a', 'b'])
  })
})

describe('window config + patch semantics', () => {
  it('defaults to no explicit window', () => {
    const c = parsed(MINIMAL)
    expect(c.sinceMs).toBeUndefined()
    expect(c.untilMs).toBeUndefined()
    expect(c).not.toHaveProperty('sort')
    expect(c.searchMode).toBe('text')
  })

  it('a numeric patch SETS a bound', () => {
    const c = applyEventsConfigPatch(parsed(MINIMAL), { sinceMs: 10, untilMs: 20 })
    expect(c.sinceMs).toBe(10)
    expect(c.untilMs).toBe(20)
  })

  it('`null` CLEARS a bound — back to the rolling feed', () => {
    const day = applyEventsConfigPatch(parsed(MINIMAL), { sinceMs: 10, untilMs: 20 })
    const cleared = applyEventsConfigPatch(day, { sinceMs: null, untilMs: null })
    // Genuinely ABSENT, not `null` — the request builder tests `!== undefined`.
    expect(cleared.sinceMs).toBeUndefined()
    expect(cleared.untilMs).toBeUndefined()
    expect('sinceMs' in cleared && cleared.sinceMs !== undefined).toBe(false)
  })

  it('an OMITTED bound leaves the other one alone', () => {
    const day = applyEventsConfigPatch(parsed(MINIMAL), { sinceMs: 10, untilMs: 20 })
    const next = applyEventsConfigPatch(day, { untilMs: 30 })
    expect(next.sinceMs).toBe(10)
    expect(next.untilMs).toBe(30)
  })
})

describe('thumbnail scale — the NATIVE numbers', () => {
  it('matches the viewer REEL_THUMB_SIZE_PX exactly', () => {
    // Source of truth: `REEL_THUMB_SIZE_PX` in the viewer's settings-store.
    // A drift here re-breaks the reel strip (the host reserves its height from
    // these) and re-hides the time under the fold.
    expect(cardEdgePx('small')).toBe(60)
    expect(cardEdgePx('medium')).toBe(80)
    expect(cardEdgePx('large')).toBe(106)
  })

  it('reproduces the host row-height contract', () => {
    expect(reelRowHeightPx('small')).toBe(68)
    expect(reelRowHeightPx('medium')).toBe(88)
    expect(reelRowHeightPx('large')).toBe(114)
    expect(reelCardHeightPx('small')).toBe(60)
    expect(reelCardHeightPx('medium')).toBe(80)
    expect(reelCardHeightPx('large')).toBe(106)
  })

  it('asks the media plane for PHYSICAL pixels, not CSS ones', () => {
    expect(thumbEdgePx('small', 1)).toBe(THUMB_MIN_EDGE_PX)
    expect(thumbEdgePx('small', 2)).toBe(120)
    expect(thumbEdgePx('medium', 2)).toBe(160)
    expect(thumbEdgePx('large', 2)).toBe(212)
  })

  it('clamps to the range the plane accepts', () => {
    expect(thumbEdgePx('large', 3)).toBe(318)
    expect(thumbEdgePx('small', 0.1)).toBe(THUMB_MIN_EDGE_PX)
  })

  it('is total for a junk device pixel ratio', () => {
    expect(thumbEdgePx('small', Number.NaN)).toBe(THUMB_MIN_EDGE_PX)
    expect(thumbEdgePx('small', -2)).toBe(THUMB_MIN_EDGE_PX)
    expect(thumbEdgePx('small')).toBe(THUMB_MIN_EDGE_PX)
  })
})
