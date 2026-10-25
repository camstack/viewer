import { beforeEach, describe, expect, it } from 'vitest'
import {
  EMPTY_LAG_WINDOW,
  lagWindow,
  recordLagSample,
  resetLagSamples,
  splitDuration,
  startLagSampler,
  stopLagSampler,
  summariseLag,
  type LagSample,
} from '../main-thread-lag'

describe('summariseLag', () => {
  it('is empty for an empty or inverted window', () => {
    expect(summariseLag([{ at: 10, lagMs: 5 }], 100, 100)).toEqual(EMPTY_LAG_WINDOW)
    expect(summariseLag([{ at: 10, lagMs: 5 }], 100, 50)).toEqual(EMPTY_LAG_WINDOW)
  })

  it('ignores stalls that finished before the window opened', () => {
    expect(summariseLag([{ at: 100, lagMs: 50 }], 200, 400)).toEqual(EMPTY_LAG_WINDOW)
  })

  it('sums the lateness of samples inside the window', () => {
    const samples: readonly LagSample[] = [
      { at: 250, lagMs: 100 },
      { at: 500, lagMs: 300 },
    ]
    expect(summariseLag(samples, 100, 600)).toEqual({ blockedMs: 400, maxLagMs: 300, samples: 2 })
  })

  it('counts only the OVERLAPPING part of a stall that straddles the edge', () => {
    // A timer that fired at 1200 having been 1000 ms late was blocked from 200.
    // The window [0, 500] contains 300 ms of that stall, not 1000.
    expect(summariseLag([{ at: 1200, lagMs: 1000 }], 0, 500)).toEqual({
      blockedMs: 300,
      maxLagMs: 1000,
      samples: 1,
    })
  })

  it('attributes a stall that ENDS after the window — the sample that explains the request', () => {
    // This is the case the naive "timestamp inside the window" filter throws
    // away, and it is exactly the 4 s block that makes a 40 ms response look
    // like a 4 s one.
    const w = summariseLag([{ at: 4500, lagMs: 4400 }], 100, 4450)
    expect(w.samples).toBe(1)
    expect(w.blockedMs).toBe(4350)
  })
})

describe('splitDuration', () => {
  it('leaves the whole duration on the wire when the thread was idle', () => {
    expect(splitDuration(120, EMPTY_LAG_WINDOW)).toMatchObject({ ms: 120, blockedMs: 0, netMs: 120 })
  })

  it('moves a blocked thread OUT of network time', () => {
    const s = splitDuration(4400, { blockedMs: 4200, maxLagMs: 4200, samples: 1 })
    expect(s).toMatchObject({ ms: 4400, blockedMs: 4200, netMs: 200 })
  })

  it('never reports negative network time when stalls overlap past the window', () => {
    const s = splitDuration(500, { blockedMs: 900, maxLagMs: 900, samples: 3 })
    expect(s.blockedMs).toBe(500)
    expect(s.netMs).toBe(0)
  })
})

describe('the sampler', () => {
  beforeEach(() => {
    stopLagSampler()
    resetLagSamples()
  })

  it('records the lateness of a timer that ran late, and nothing when it is on time', () => {
    let t = 0
    const now = (): number => t
    const ticks: Array<() => void> = []
    const tick = (): void => ticks[0]?.()
    startLagSampler(
      100,
      now,
      (fn) => {
        ticks.push(fn)
        return () => {}
      },
    )
    // On time: fires at 100, expected 100 → no sample (below the noise floor).
    t = 100
    tick()
    expect(lagWindow(0, 100)).toEqual(EMPTY_LAG_WINDOW)
    // Late: expected 200, fired at 1500 → 1300 ms of block.
    t = 1500
    tick()
    expect(lagWindow(0, 1500)).toMatchObject({ blockedMs: 1300, maxLagMs: 1300, samples: 1 })
  })

  it('is idempotent — a remount must not double-count every stall', () => {
    let starts = 0
    const start = (): void =>
      startLagSampler(
        100,
        () => 0,
        () => {
          starts += 1
          return () => {}
        },
      )
    start()
    start()
    expect(starts).toBe(1)
  })

  it('reports zero samples for a window nothing was recorded in — itself a finding', () => {
    recordLagSample({ at: 50, lagMs: 40 })
    expect(lagWindow(1000, 2000).samples).toBe(0)
  })
})
