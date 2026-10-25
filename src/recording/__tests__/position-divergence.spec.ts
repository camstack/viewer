import { describe, it, expect } from 'vitest'
import {
  evaluateDivergence,
  DIVERGENCE_TOLERANCE_MS,
  DIVERGENCE_REPORT_INTERVAL_MS,
} from '../position-divergence.js'

/**
 * The measurement that turns "the cursor does not match the stream" into a
 * number — because five plausible causes were read out of the code and
 * eliminated, and none of them could say WHICH of the two numbers is wrong.
 * Nothing had ever compared them.
 */
describe('evaluateDivergence', () => {
  const base = { nowMs: 100_000, lastReportAt: null }

  it('says nothing when the two agree', () => {
    expect(
      evaluateDivergence({ ...base, indicatorEpoch: 1_000_000, playerEpoch: 1_000_500 }),
    ).toBeNull()
  })

  it('reports a real gap, and which side is ahead', () => {
    const ahead = evaluateDivergence({
      ...base,
      indicatorEpoch: 1_055_000,
      playerEpoch: 1_000_000,
    })
    expect(ahead).toEqual({ deltaMs: 55_000, indicatorAhead: true })

    const behind = evaluateDivergence({
      ...base,
      indicatorEpoch: 1_000_000,
      playerEpoch: 1_055_000,
    })
    expect(behind?.indicatorAhead).toBe(false)
  })

  it('stays quiet just inside the tolerance and speaks just outside it', () => {
    const near = DIVERGENCE_TOLERANCE_MS - 1
    expect(
      evaluateDivergence({ ...base, indicatorEpoch: 1_000_000 + near, playerEpoch: 1_000_000 }),
    ).toBeNull()
    expect(
      evaluateDivergence({
        ...base,
        indicatorEpoch: 1_000_000 + DIVERGENCE_TOLERANCE_MS,
        playerEpoch: 1_000_000,
      }),
    ).not.toBeNull()
  })

  it('a standing drift logs once a spell, not once per position message', () => {
    // Position reports arrive at ~1 Hz; without this a 10-minute session with a
    // constant offset would ship 600 identical warnings and bury itself.
    const args = { indicatorEpoch: 1_055_000, playerEpoch: 1_000_000 }
    expect(
      evaluateDivergence({ ...args, nowMs: 100_000, lastReportAt: 99_000 }),
    ).toBeNull()
    expect(
      evaluateDivergence({
        ...args,
        nowMs: 100_000,
        lastReportAt: 100_000 - DIVERGENCE_REPORT_INTERVAL_MS,
      }),
    ).not.toBeNull()
  })

  it('a missing number is silence, not a fault', () => {
    // Both null is the ordinary LIVE case — the indicator falls back to
    // wall-clock and the player reports nothing.
    expect(evaluateDivergence({ ...base, indicatorEpoch: null, playerEpoch: 1 })).toBeNull()
    expect(evaluateDivergence({ ...base, indicatorEpoch: 1, playerEpoch: null })).toBeNull()
    expect(evaluateDivergence({ ...base, indicatorEpoch: null, playerEpoch: null })).toBeNull()
  })
})
