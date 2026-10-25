/**
 * The cursor's geometry, and the TWO positions it is laid out at.
 *
 * > *"quando siamo in live va benissimo la posizione corrente ma man mano che
 * > ci si allontana deve arrivare a metà timeline. […] se faccio lo snap su un
 * > cluster il cursore va giustamente all'inizio del cluster e con la
 * > posizione attuale si perde visibilità del cluster"* — the operator,
 * > 2026-09-23.
 */
import { describe, it, expect } from 'vitest'
import {
  indicatorOffsetPx,
  resolveIndicatorPct,
  LIVE_INDICATOR_POSITION_PCT,
  PLAYBACK_INDICATOR_POSITION_PCT,
} from '../timeline-indicator.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('indicatorOffsetPx', () => {
  it('returns 0 at 0% (top of viewport)', () => {
    expect(indicatorOffsetPx(800, 0)).toBe(0)
  })

  it('returns 30% of the viewport', () => {
    // 30 % is not a position this app uses — it was the stepper's default
    // before the stepper was removed. Kept as an arithmetic case only.
    expect(indicatorOffsetPx(800, 30)).toBe(240)
  })

  it('returns the viewport center at 50%', () => {
    expect(indicatorOffsetPx(800, 50)).toBe(400)
  })

  it('returns the full viewport height at 100% (bottom)', () => {
    expect(indicatorOffsetPx(800, 100)).toBe(800)
  })

  it('clamps a percent below 0 to 0', () => {
    expect(indicatorOffsetPx(800, -25)).toBe(0)
  })

  it('clamps a percent above 100 to the viewport height', () => {
    expect(indicatorOffsetPx(800, 150)).toBe(800)
  })

  it('rounds to a whole pixel', () => {
    // 333 * 50 / 100 = 166.5 → 167
    expect(indicatorOffsetPx(333, 50)).toBe(167)
    // 777 * 33 / 100 = 256.41 → 256
    expect(indicatorOffsetPx(777, 33)).toBe(256)
  })

  it('returns 0 for a non-positive viewport height', () => {
    expect(indicatorOffsetPx(0, 50)).toBe(0)
    expect(indicatorOffsetPx(-100, 50)).toBe(0)
  })

  it('returns 0 for a non-finite viewport height', () => {
    expect(indicatorOffsetPx(Number.NaN, 50)).toBe(0)
  })

  it('degrades a non-finite percent to 0', () => {
    expect(indicatorOffsetPx(800, Number.NaN)).toBe(0)
  })
})

describe('resolveIndicatorPct — two states, and no hold', () => {
  const live = LIVE_INDICATOR_POSITION_PCT
  const playback = PLAYBACK_INDICATOR_POSITION_PCT

  it('the two positions are a tenth and a half', () => {
    // Named, so a future edit that nudges one of them fails here and reads
    // the reason rather than discovering it on a phone.
    expect(live).toBe(10)
    expect(playback).toBe(50)
  })

  it('a tenth on the live edge', () => {
    expect(resolveIndicatorPct({ atLiveEdge: true })).toBe(live)
  })

  it('a half everywhere else', () => {
    expect(resolveIndicatorPct({ atLiveEdge: false })).toBe(playback)
  })

  it('MOVES mid-drag — the hold through `seeking` is gone', () => {
    /**
     * This block used to assert the opposite, and it was right to at the time:
     * moving the spacer mid-gesture slides the content under the dragging
     * finger, so the change was deferred to the commit.
     *
     * Two things changed. The operator saw the commit version and asked for
     * the move during the scrub — *"accade al primo rilascio, riusciamo a
     * farlo accadere anche durante lo scrub?"* — and the hold's premise turned
     * out to be half wrong: the epoch under the line is `f(offsetY)` with NO
     * spacer term (`mappedOffsetToEpoch` is handed the raw scroll offset, and
     * `contentY(e)` adds the spacer to every child alike), so the readout does
     * not move at all. Only the pixels do, over CURSOR_SHIFT_MS, while the
     * content is already moving.
     *
     * The resolver no longer takes a previous value, so there is no state here
     * that could hold anything — the regression this replaces cannot be
     * reintroduced by accident, only by re-adding a parameter.
     */
    expect(resolveIndicatorPct.length).toBe(1)
    expect(resolveIndicatorPct({ atLiveEdge: false })).toBe(playback)
  })

  it('the LIVE LOCK is not the live edge', () => {
    // Browsing a past moment leaves the machine in `live` while `activeEpoch`
    // is set; the caller folds both into `atLiveEdge`, and what is on screen
    // is a past moment with cards hanging above the line. A resolver that
    // read `mode` alone would give it the live position and undo the fix for
    // exactly the gesture that motivated it.
    expect(resolveIndicatorPct({ atLiveEdge: false })).toBe(playback)
  })

  it('a whole drag out of live: the move lands on the FIRST frame past tolerance', () => {
    // The gesture as the machine really sequences it. `atLiveEdge` is
    // `mode === 'live' && activeEpoch === null`, so it goes false the moment
    // SCRUB_BEGIN fires — which is now where the cursor moves, instead of six
    // frames later at the commit.
    const atLiveEdgePerFrame = [true, false, false, false, false, false]
    expect(atLiveEdgePerFrame.map((atLiveEdge) => resolveIndicatorPct({ atLiveEdge }))).toEqual([
      live,
      playback,
      playback,
      playback,
      playback,
      playback,
    ])
  })

  it('a drag that stays within tolerance never leaves the live position', () => {
    // Under the 15 s tolerance the machine never leaves `live`, so
    // `atLiveEdge` stays true and nothing moves. The operator who nudges the
    // list at the live edge still sees no transition — that case is unchanged
    // by dropping the hold, and it is the one that would have been annoying.
    for (let frame = 0; frame < 3; frame++) {
      expect(resolveIndicatorPct({ atLiveEdge: true })).toBe(live)
    }
  })

  it('is PURE — the same input gives the same answer, and it keeps no state', () => {
    const input = { atLiveEdge: false } as const
    expect(resolveIndicatorPct(input)).toBe(resolveIndicatorPct(input))
  })
})

describe('the resolver is what TheaterTimeline runs', () => {
  it('asks the rule, and does not re-derive the percentage inline', () => {
    // A source guard: the rule is only a rule while the component calls it.
    // Re-inlining a ternary would pass every test above.
    const src = readFileSync(
      join(process.cwd(), 'src', 'components', 'camera', 'theater', 'TheaterTimeline.tsx'),
      'utf8',
    )
    expect(src).toContain('resolveIndicatorPct({ atLiveEdge: isLive })')
    expect(src).toContain('indicatorOffsetPx(viewportHeight, indicatorPct)')
    // The latch is GONE, not merely unused: a ref that still fed the resolver
    // would hold the value again the day someone restores the parameter.
    expect(src).not.toContain('indicatorPctRef')
  })
})
